import { randomInt } from 'node:crypto';
import path from 'node:path';

import type { Command } from 'commander';

import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { resolveCdtHome } from '../../../infrastructure/store/paths.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
import { sendDaemonCommand, type CommandContext } from './common.js';

type PageSummary = {
  id: number;
};

type PageListData = {
  pages: PageSummary[];
};

const RANDOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const ensurePageListData = (payload: unknown): PageListData => {
  if (!isRecord(payload) || !Array.isArray(payload.pages)) {
    throw new AppError('Daemon returned malformed page list payload.', {
      code: ERROR_CODE.IPC_PROTOCOL_ERROR,
      suggestions: ['Retry once.', 'If this issue repeats, restart daemon: browser daemon stop']
    });
  }

  const pages = payload.pages as unknown[];
  if (!pages.every((page) => isRecord(page) && typeof page.id === 'number' && Number.isInteger(page.id))) {
    throw new AppError('Daemon returned malformed page id list.', {
      code: ERROR_CODE.IPC_PROTOCOL_ERROR,
      suggestions: ['Retry once.', 'If this issue repeats, restart daemon: browser daemon stop']
    });
  }

  return {
    pages: pages as PageSummary[]
  };
};

const parseTabIndex = (input?: string): number | undefined => {
  if (!input) {
    return undefined;
  }

  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(`Invalid tab index: ${input}`, {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Use a positive tab index: browser screenshot --tab 1']
    });
  }

  return value;
};

export const formatScreenshotTimestamp = (date: Date): string => date.toISOString().replace(/[:.]/g, '-');

export const generateLowerAlnumSuffix = (length = 6): string => {
  let suffix = '';
  for (let index = 0; index < length; index += 1) {
    suffix += RANDOM_ALPHABET[randomInt(0, RANDOM_ALPHABET.length)];
  }
  return suffix;
};

export const buildScreenshotFilename = (date: Date, suffix: string): string =>
  `screenshot-${formatScreenshotTimestamp(date)}-${suffix}.jpg`;

export const buildScreenshotFilePath = (homeDir: string, date: Date, suffix: string): string =>
  path.join(homeDir, 'screenshots', buildScreenshotFilename(date, suffix));

export const registerScreenshotCommand = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  root
    .command('screenshot')
    .description('Capture screenshot and save under browser home')
    .option('--tab <index>', 'tab index (default: selected tab)')
    .option('--full', 'capture full page screenshot')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { tab?: string; full?: boolean; describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'screenshot',
          payload: { tab: 'number (optional)', full: 'boolean (optional)' },
          examples: ['browser screenshot', 'browser screenshot --tab 2 --full']
        });
        return;
      }

      const ctx = getCtx();
      const tabIndex = parseTabIndex(opts.tab);
      let pageId: number | undefined;

      if (tabIndex !== undefined) {
        const listResponse = await sendDaemonCommand(ctx, IPC_OP.PAGE_LIST, {});
        if (!listResponse.ok) {
          await onResponse(false, listResponse);
          return;
        }

        const listData = ensurePageListData(listResponse.data);
        const tab = listData.pages[tabIndex - 1];
        if (!tab) {
          throw new AppError(`Tab ${tabIndex} does not exist in current context.`, {
            code: ERROR_CODE.PAGE_NOT_FOUND,
            details: { requestedIndex: tabIndex, tabCount: listData.pages.length },
            suggestions: ['Run: browser tabs --output json', 'Then choose a valid tab index.']
          });
        }

        pageId = tab.id;
      }

      const homeDir = ctx.homeDir ?? resolveCdtHome();
      const filePath = buildScreenshotFilePath(homeDir, new Date(), generateLowerAlnumSuffix(6));

      const response = await sendDaemonCommand(ctx, IPC_OP.CAPTURE_SCREENSHOT, {
        pageId,
        filePath,
        fullPage: opts.full === true,
        format: 'jpeg'
      });

      if (!response.ok) {
        await onResponse(false, response);
        return;
      }

      const data = (response.data ?? {}) as { filePath?: string };
      const savedPath = typeof data.filePath === 'string' ? data.filePath : filePath;

      await onResponse(true, {
        ...response,
        text: `screenshot saved: ${savedPath}`
      });
    });
};
