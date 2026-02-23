import type { Command } from 'commander';

import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
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

export const registerDialogCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const dialog = root.command('dialog').description('Browser dialog handling');

  dialog
    .command('handle')
    .description('Accept or dismiss currently opened dialog')
    .requiredOption('--action <accept|dismiss>', 'dialog action')
    .option('--prompt-text <text>', 'optional prompt text for accept')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { action: string; promptText?: string; page?: string }) => {
      if (opts.action !== 'accept' && opts.action !== 'dismiss') {
        throw new AppError('action must be accept or dismiss.', {
          code: ERROR_CODE.VALIDATION_ERROR,
          suggestions: ['Use: --action accept', 'Use: --action dismiss']
        });
      }

      const response = await sendDaemonCommand(getCtx(), IPC_OP.DIALOG_HANDLE, {
        pageId: toPageId(opts.page),
        action: opts.action,
        promptText: opts.promptText
      });
      await onResponse(response.ok, response);
    });

  dialog.action(async () => {
    dialog.outputHelp();
  });
};
