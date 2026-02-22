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

export const registerElementCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const element = root.command('element').description('Element interactions');

  element
    .command('fill')
    .description('Fill input/textarea/contenteditable element')
    .requiredOption('--uid <selector>', 'CSS selector')
    .requiredOption('--value <value>', 'value to fill')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { uid: string; value: string; page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.ELEMENT_FILL, {
        pageId: toPageId(opts.page),
        selector: opts.uid,
        value: opts.value
      });
      await onResponse(response.ok, response);
    });

  element
    .command('click')
    .description('Click target element')
    .requiredOption('--uid <selector>', 'CSS selector')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { uid: string; page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.ELEMENT_CLICK, {
        pageId: toPageId(opts.page),
        selector: opts.uid
      });
      await onResponse(response.ok, response);
    });

  element.action(async () => {
    throw new AppError('Missing element subcommand.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Run: cdt element --help']
    });
  });
};
