import type { Command } from 'commander';

import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
import { sendDaemonCommand, type CommandContext } from './common.js';

const toPositiveInt = (name: string, input?: string): number | undefined => {
  if (!input) {
    return undefined;
  }

  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(`${name} must be a positive integer.`, {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: [`Use: --${name} 1`]
    });
  }

  return value;
};

export const registerConsoleCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const consoleCommand = root.command('console').description('Console message inspection');

  consoleCommand
    .command('list')
    .description('List console messages')
    .option('--page <id>', 'target page id')
    .option('--limit <n>', 'max messages')
    .option('--type <kind>', 'console type filter')
    .action(async (opts: { page?: string; limit?: string; type?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.CONSOLE_LIST, {
        pageId: toPositiveInt('page', opts.page),
        limit: toPositiveInt('limit', opts.limit),
        type: opts.type
      });
      await onResponse(response.ok, response);
    });

  consoleCommand
    .command('get')
    .description('Get a single console message by id')
    .requiredOption('--id <id>', 'message id')
    .action(async (opts: { id: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.CONSOLE_GET, {
        id: toPositiveInt('id', opts.id)
      });
      await onResponse(response.ok, response);
    });

  consoleCommand
    .command('wait')
    .description('Wait until console message matches pattern')
    .requiredOption('--pattern <pattern>', 'substring or /regex/flags pattern')
    .option('--page <id>', 'target page id')
    .option('--type <kind>', 'console type filter')
    .action(async (opts: { pattern: string; page?: string; type?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.CONSOLE_WAIT, {
        pattern: opts.pattern,
        pageId: toPositiveInt('page', opts.page),
        type: opts.type
      });
      await onResponse(response.ok, response);
    });

  consoleCommand.action(async () => {
    consoleCommand.outputHelp();
  });
};
