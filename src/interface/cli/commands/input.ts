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

export const registerInputCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const input = root.command('input').description('Keyboard input');

  input
    .command('key')
    .description('Press key or key-combo')
    .requiredOption('--key <key>', 'key name (e.g. Enter, Tab, ArrowDown)')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { key: string; page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.INPUT_KEY, {
        pageId: toPageId(opts.page),
        key: opts.key
      });
      await onResponse(response.ok, response);
    });

  input.action(async () => {
    throw new AppError('Missing input subcommand.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Run: cdt input --help']
    });
  });
};
