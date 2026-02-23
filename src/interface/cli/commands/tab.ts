import type { Command } from 'commander';

import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
import type { ResponseEnvelope } from '../../../shared/schema/envelopes.js';
import { sendDaemonCommand, type CommandContext } from './common.js';

type PageSummary = {
  id: number;
  url: string;
  title: string;
  selected: boolean;
};

type TabSummary = PageSummary & {
  index: number;
};

type TabsView = {
  tabs: TabSummary[];
  selectedIndex: number | null;
};

type PageListData = {
  pages: PageSummary[];
  selectedPageId: number | null;
};

type PageOpenData = {
  page: PageSummary;
  pages: PageSummary[];
};

type PageCloseData = {
  closedPageId: number;
  pages: PageSummary[];
  selectedPageId: number | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPageSummary = (value: unknown): value is PageSummary => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    typeof value.url === 'string' &&
    typeof value.title === 'string' &&
    typeof value.selected === 'boolean'
  );
};

const ensurePageListData = (payload: unknown): PageListData => {
  if (!isRecord(payload) || !Array.isArray(payload.pages) || !payload.pages.every(isPageSummary)) {
    throw new AppError('Daemon returned malformed page list payload.', {
      code: ERROR_CODE.IPC_PROTOCOL_ERROR,
      suggestions: ['Retry once.', 'If this issue repeats, restart daemon: browser daemon stop']
    });
  }

  const selectedPageId = payload.selectedPageId;
  if (selectedPageId !== null && typeof selectedPageId !== 'number') {
    throw new AppError('Daemon returned malformed selectedPageId.', {
      code: ERROR_CODE.IPC_PROTOCOL_ERROR,
      suggestions: ['Retry once.', 'If this issue repeats, restart daemon: browser daemon stop']
    });
  }

  return {
    pages: payload.pages,
    selectedPageId: selectedPageId ?? null
  };
};

const ensurePageOpenData = (payload: unknown): PageOpenData => {
  if (!isRecord(payload) || !isPageSummary(payload.page) || !Array.isArray(payload.pages) || !payload.pages.every(isPageSummary)) {
    throw new AppError('Daemon returned malformed page open payload.', {
      code: ERROR_CODE.IPC_PROTOCOL_ERROR,
      suggestions: ['Retry once.', 'If this issue repeats, restart daemon: browser daemon stop']
    });
  }

  return {
    page: payload.page,
    pages: payload.pages
  };
};

const ensurePageCloseData = (payload: unknown): PageCloseData => {
  if (
    !isRecord(payload) ||
    typeof payload.closedPageId !== 'number' ||
    !Number.isInteger(payload.closedPageId) ||
    !Array.isArray(payload.pages) ||
    !payload.pages.every(isPageSummary)
  ) {
    throw new AppError('Daemon returned malformed page close payload.', {
      code: ERROR_CODE.IPC_PROTOCOL_ERROR,
      suggestions: ['Retry once.', 'If this issue repeats, restart daemon: browser daemon stop']
    });
  }

  const selectedPageId = payload.selectedPageId;
  if (selectedPageId !== null && typeof selectedPageId !== 'number') {
    throw new AppError('Daemon returned malformed selectedPageId.', {
      code: ERROR_CODE.IPC_PROTOCOL_ERROR,
      suggestions: ['Retry once.', 'If this issue repeats, restart daemon: browser daemon stop']
    });
  }

  return {
    closedPageId: payload.closedPageId,
    pages: payload.pages,
    selectedPageId: selectedPageId ?? null
  };
};

export const parseTabIndex = (input: string): number => {
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(`Invalid tab index: ${input}`, {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Use a positive tab index: browser tab select 1']
    });
  }

  return value;
};

export const toTabsView = (pages: PageSummary[], selectedPageId: number | null): TabsView => {
  const tabs = pages.map((page, index) => ({
    index: index + 1,
    id: page.id,
    url: page.url,
    title: page.title,
    selected: selectedPageId !== null ? page.id === selectedPageId : page.selected
  }));

  const selectedIndex = tabs.find((tab) => tab.selected)?.index ?? null;

  return {
    tabs,
    selectedIndex
  };
};

export const findTabByIndex = (tabs: TabSummary[], index: number): TabSummary => {
  const tab = tabs.find((item) => item.index === index);
  if (!tab) {
    throw new AppError(`Tab ${index} does not exist in current context.`, {
      code: ERROR_CODE.PAGE_NOT_FOUND,
      details: {
        requestedIndex: index,
        tabCount: tabs.length
      },
      suggestions: ['Run: browser tabs --output json', 'Then choose a valid tab index.']
    });
  }

  return tab;
};

const displayTitle = (title: string): string => (title.trim().length > 0 ? title : '(untitled)');

const formatTabLine = (tab: TabSummary): string => {
  const marker = tab.selected ? '*' : '';
  return `[${tab.index}${marker}] ${displayTitle(tab.title)} ${tab.url}`;
};

const formatTabsText = (view: TabsView): string => {
  const lines = [`tabs: ${view.tabs.length} (selected: ${view.selectedIndex ?? 'none'})`];
  for (const tab of view.tabs) {
    lines.push(formatTabLine(tab));
  }

  return lines.join('\n');
};

const relayFailure = async (
  onResponse: (ok: boolean, response: unknown) => Promise<void>,
  response: ResponseEnvelope
): Promise<boolean> => {
  if (response.ok) {
    return false;
  }

  await onResponse(false, response);
  return true;
};

export const registerTabCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  root
    .command('tabs')
    .description('List tabs in current context (1-based index)')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'tabs',
          payload: {},
          examples: ['browser tabs --output json']
        });
        return;
      }

      const listResponse = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_LIST, {});
      if (await relayFailure(onResponse, listResponse)) {
        return;
      }

      const listData = ensurePageListData(listResponse.data);
      const view = toTabsView(listData.pages, listData.selectedPageId);
      await onResponse(true, {
        ...listResponse,
        data: view,
        text: formatTabsText(view)
      });
    });

  const tab = root.command('tab').description('Manage tabs by 1-based index');

  tab
    .command('new')
    .description('Open a new tab')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'tab new',
          payload: {},
          examples: ['browser tab new --output json']
        });
        return;
      }

      const openResponse = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_OPEN, {});
      if (await relayFailure(onResponse, openResponse)) {
        return;
      }

      const openData = ensurePageOpenData(openResponse.data);
      const view = toTabsView(openData.pages, openData.page.id);
      const tabSummary = view.tabs.find((item) => item.id === openData.page.id) ?? null;

      await onResponse(true, {
        ...openResponse,
        data: {
          tab: tabSummary,
          tabs: view.tabs,
          selectedIndex: view.selectedIndex
        },
        text:
          tabSummary === null
            ? 'tab opened'
            : ['tab opened', `${displayTitle(tabSummary.title)} ${tabSummary.url}`].join('\n')
      });
    });

  tab
    .command('select <index>')
    .description('Focus tab by 1-based index')
    .option('--describe', 'Show command schema and examples')
    .action(async (index: string, opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'tab select',
          payload: { index: 'number (required)' },
          examples: ['browser tab select 2 --output json']
        });
        return;
      }

      const tabIndex = parseTabIndex(index);
      const listResponse = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_LIST, {});
      if (await relayFailure(onResponse, listResponse)) {
        return;
      }

      const listData = ensurePageListData(listResponse.data);
      const view = toTabsView(listData.pages, listData.selectedPageId);
      const selectedTab = findTabByIndex(view.tabs, tabIndex);

      const useResponse = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_USE, { pageId: selectedTab.id });
      if (await relayFailure(onResponse, useResponse)) {
        return;
      }

      const afterListResponse = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_LIST, {});
      if (await relayFailure(onResponse, afterListResponse)) {
        return;
      }

      const afterListData = ensurePageListData(afterListResponse.data);
      const afterView = toTabsView(afterListData.pages, afterListData.selectedPageId);
      const focusedTab = afterView.tabs.find((item) => item.selected) ?? null;

      await onResponse(true, {
        ...useResponse,
        data: {
          tab: focusedTab,
          tabs: afterView.tabs,
          selectedIndex: afterView.selectedIndex
        },
        text:
          focusedTab === null
            ? `tab selected: ${tabIndex}`
            : [`tab selected: ${focusedTab.index}`, `${displayTitle(focusedTab.title)} ${focusedTab.url}`].join('\n')
      });
    });

  tab
    .command('close <index>')
    .description('Close tab by 1-based index')
    .option('--describe', 'Show command schema and examples')
    .action(async (index: string, opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'tab close',
          payload: { index: 'number (required)' },
          examples: ['browser tab close 2 --output json']
        });
        return;
      }

      const tabIndex = parseTabIndex(index);
      const listResponse = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_LIST, {});
      if (await relayFailure(onResponse, listResponse)) {
        return;
      }

      const listData = ensurePageListData(listResponse.data);
      const view = toTabsView(listData.pages, listData.selectedPageId);
      const targetTab = findTabByIndex(view.tabs, tabIndex);

      const closeResponse = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_CLOSE, { pageId: targetTab.id });
      if (await relayFailure(onResponse, closeResponse)) {
        return;
      }

      const closeData = ensurePageCloseData(closeResponse.data);
      const afterView = toTabsView(closeData.pages, closeData.selectedPageId);

      await onResponse(true, {
        ...closeResponse,
        data: {
          closedTab: {
            index: targetTab.index,
            id: closeData.closedPageId,
            url: targetTab.url,
            title: targetTab.title
          },
          tabs: afterView.tabs,
          selectedIndex: afterView.selectedIndex
        },
        text: [`tab closed: ${targetTab.index}`, `tabs: ${afterView.tabs.length} (selected: ${afterView.selectedIndex ?? 'none'})`].join(
          '\n'
        )
      });
    });

  tab.action(async () => {
    tab.outputHelp();
  });
};
