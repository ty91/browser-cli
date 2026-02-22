import type { Command } from 'commander';

import { AppError } from '../../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { writeDiagnostic } from '../output.js';
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
  const page = root.command('page').description('Page operations');

  page
    .command('open')
    .description('Open new page in current context (deprecated: use browser open <url>)')
    .requiredOption('--url <url>', 'target url')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { url: string; describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'page open',
          payload: { url: 'string (required)' },
          examples: ['browser page open --url https://example.com', 'browser open https://example.com']
        });
        return;
      }

      writeDiagnostic('[deprecated] Use "browser open <url>" instead of "browser page open --url <url>".');
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
          examples: ['browser page list --output json']
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
          examples: ['browser page use --page 1']
        });
        return;
      }

      const response = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_USE, {
        pageId: toPageId(opts.page)
      });
      await onResponse(response.ok, response);
    });

  page
    .command('close')
    .description('Close current/selected page')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_CLOSE, {
        pageId: toPageId(opts.page)
      });
      await onResponse(response.ok, response);
    });

  page
    .command('navigate')
    .description('Navigate current/selected page (deprecated: use browser navigate <url>)')
    .requiredOption('--url <url>', 'target url')
    .option('--page <id>', 'target page id (default: current page)')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { page?: string; url: string; describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'page navigate',
          payload: { url: 'string (required)', page: 'number (optional)' },
          examples: [
            'browser page navigate --url https://example.com',
            'browser page navigate --page 2 --url https://example.com',
            'browser navigate https://example.com'
          ]
        });
        return;
      }

      writeDiagnostic('[deprecated] Use "browser navigate <url>" instead of "browser page navigate --url <url>".');
      const response = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_NAVIGATE, {
        pageId: toPageId(opts.page),
        url: opts.url
      });
      await onResponse(response.ok, response);
    });

  page
    .command('resize')
    .description('Resize viewport of current/selected page')
    .requiredOption('--width <px>', 'viewport width')
    .requiredOption('--height <px>', 'viewport height')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { page?: string; width: string; height: string }) => {
      const width = Number(opts.width);
      const height = Number(opts.height);

      if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        throw new AppError('width/height must be positive integers.', {
          code: ERROR_CODE.VALIDATION_ERROR,
          suggestions: ['Use values like --width 1280 --height 720']
        });
      }

      const response = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_RESIZE, {
        pageId: toPageId(opts.page),
        width,
        height
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
          examples: ['browser page wait-text --text Ready', 'browser page wait-text --page 1 --text Success --timeout 5000']
        });
        return;
      }

      const response = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_WAIT_TEXT, {
        pageId: toPageId(opts.page),
        text: opts.text
      });
      await onResponse(response.ok, response);
    });

  page
    .command('wait-selector')
    .description('Wait until selector appears in page')
    .requiredOption('--selector <selector>', 'CSS selector to wait for')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { page?: string; selector: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_WAIT_SELECTOR, {
        pageId: toPageId(opts.page),
        selector: opts.selector
      });
      await onResponse(response.ok, response);
    });

  page
    .command('wait-url')
    .description('Wait until page URL matches expected pattern')
    .requiredOption('--pattern <pattern>', 'substring or /regex/flags pattern')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { page?: string; pattern: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.PAGE_WAIT_URL, {
        pageId: toPageId(opts.page),
        pattern: opts.pattern
      });
      await onResponse(response.ok, response);
    });

  page.action(async () => {
    throw new AppError('Missing page subcommand.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Run: browser page --help']
    });
  });
};
