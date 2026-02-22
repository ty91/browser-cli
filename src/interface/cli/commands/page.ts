import type { Command } from 'commander';

import { AppError } from '../../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { sendDaemonCommand, type CommandContext } from './common.js';

const toPageId = (input?: string): number | undefined => {
  if (!input) {
    return undefined;
  }

  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(`Invalid page id: ${input}`, {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Use a positive integer: --page 1']
    });
  }

  return value;
};

export const registerPageCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const page = root.command('page').description('Page operations').option('--list');

  page
    .command('open')
    .description('Open new page in current context')
    .requiredOption('--url <url>', 'target url')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { url: string; describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'page open',
          payload: { url: 'string (required)' },
          examples: ['cdt page open --url https://example.com']
        });
        return;
      }

      const response = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_OPEN, {
        url: opts.url
      });
      await onResponse(response.ok, response);
    });

  page
    .command('list')
    .description('List pages in current context')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'page list',
          payload: {},
          examples: ['cdt page list --output json']
        });
        return;
      }

      const response = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_LIST, {});
      await onResponse(response.ok, response);
    });

  page
    .command('use')
    .description('Select page as current page')
    .requiredOption('--page <id>', 'page id')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { page: string; describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'page use',
          payload: { page: 'number (required)' },
          examples: ['cdt page use --page 1']
        });
        return;
      }

      const response = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_USE, {
        pageId: toPageId(opts.page)
      });
      await onResponse(response.ok, response);
    });

  page
    .command('navigate')
    .description('Navigate current/selected page')
    .requiredOption('--url <url>', 'target url')
    .option('--page <id>', 'target page id (default: current page)')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { page?: string; url: string; describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'page navigate',
          payload: { url: 'string (required)', page: 'number (optional)' },
          examples: ['cdt page navigate --url https://example.com', 'cdt page navigate --page 2 --url https://example.com']
        });
        return;
      }

      const response = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_NAVIGATE, {
        pageId: toPageId(opts.page),
        url: opts.url
      });
      await onResponse(response.ok, response);
    });

  page
    .command('wait-text')
    .description('Wait until text appears in page body')
    .requiredOption('--text <text>', 'text to wait for')
    .option('--page <id>', 'target page id (default: current page)')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { page?: string; text: string; describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'page wait-text',
          payload: { text: 'string (required)', page: 'number (optional)' },
          examples: ['cdt page wait-text --text Ready', 'cdt page wait-text --page 1 --text Success --timeout 5000']
        });
        return;
      }

      const response = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_WAIT_TEXT, {
        pageId: toPageId(opts.page),
        text: opts.text
      });
      await onResponse(response.ok, response);
    });

  page.action(async () => {
    const command = page.optsWithGlobals() as { list?: boolean };
    if (command.list) {
      await onResponse(true, {
        id: 'page-list-commands',
        ok: true,
        data: { commands: ['open', 'list', 'use', 'navigate', 'wait-text'] },
        meta: { durationMs: 0 }
      });
      return;
    }

    await onResponse(true, {
      id: 'page-help',
      ok: true,
      data: { commands: ['open', 'list', 'use', 'navigate', 'wait-text'] },
      meta: { durationMs: 0 }
    });
  });
};
