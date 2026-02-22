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

export const registerCaptureCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const capture = root.command('capture').description('Capture page artifacts').option('--list');

  capture
    .command('snapshot')
    .description('Capture HTML snapshot from target page')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.CAPTURE_SNAPSHOT, {
        pageId: toPageId(opts.page)
      });
      await onResponse(response.ok, response);
    });

  capture.action(async () => {
    const command = capture.optsWithGlobals() as { list?: boolean };
    if (command.list) {
      await onResponse(true, {
        id: 'capture-list-commands',
        ok: true,
        data: { commands: ['snapshot'] },
        meta: { durationMs: 0 }
      });
      return;
    }

    await onResponse(true, {
      id: 'capture-help',
      ok: true,
      data: { commands: ['snapshot'] },
      meta: { durationMs: 0 }
    });
  });
};
