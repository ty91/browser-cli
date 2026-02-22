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

export const registerRuntimeCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const runtime = root.command('runtime').description('Script execution').option('--list');

  runtime
    .command('eval')
    .description('Evaluate JavaScript function source in page context')
    .requiredOption('--function <source>', 'function source string')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { function: string; page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.RUNTIME_EVAL, {
        pageId: toPageId(opts.page),
        functionSource: opts.function
      });
      await onResponse(response.ok, response);
    });

  runtime.action(async () => {
    const command = runtime.optsWithGlobals() as { list?: boolean };
    if (command.list) {
      await onResponse(true, {
        id: 'runtime-list-commands',
        ok: true,
        data: { commands: ['eval'] },
        meta: { durationMs: 0 }
      });
      return;
    }

    await onResponse(true, {
      id: 'runtime-help',
      ok: true,
      data: { commands: ['eval'] },
      meta: { durationMs: 0 }
    });
  });
};
