import type { Command } from 'commander';

import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
import { sendDaemonCommand, type CommandContext } from './common.js';

const toUrl = (input: string): string => {
  const value = input.trim();
  if (!value) {
    throw new AppError('url must not be empty.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Use: browser open https://example.com']
    });
  }

  return value;
};

const formatPageText = (headline: string, data: unknown): string => {
  const payload = (data ?? {}) as { page?: { title?: string; url?: string } };
  const page = payload.page;
  const title = typeof page?.title === 'string' && page.title.trim().length > 0 ? page.title : '(untitled)';
  const url = typeof page?.url === 'string' ? page.url : '-';
  return [headline, `${title} ${url}`].join('\n');
};

export const registerNavigationCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  root
    .command('open <url>')
    .description('Open url in a new tab')
    .option('--describe', 'Show command schema and examples')
    .action(async (url: string, opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'open',
          payload: { url: 'string (required)' },
          examples: ['browser open https://example.com']
        });
        return;
      }

      const response = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_OPEN, {
        url: toUrl(url)
      });
      if (!response.ok) {
        await onResponse(false, response);
        return;
      }

      await onResponse(true, { ...response, text: formatPageText('tab opened', response.data) });
    });

  root
    .command('navigate <url>')
    .description('Navigate the selected tab to url')
    .option('--describe', 'Show command schema and examples')
    .action(async (url: string, opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'navigate',
          payload: { url: 'string (required)' },
          examples: ['browser navigate https://example.com/dashboard']
        });
        return;
      }

      const response = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_NAVIGATE, {
        url: toUrl(url)
      });
      if (!response.ok) {
        await onResponse(false, response);
        return;
      }

      await onResponse(true, { ...response, text: formatPageText('navigated', response.data) });
    });
};
