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

const toPositiveInt = (name: string, input?: string): number | undefined => {
  if (!input) {
    return undefined;
  }

  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(`${name} must be a positive integer.`, {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: [`Use: --${name} 100`]
    });
  }

  return value;
};

export const registerObserveCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const observe = root.command('observe').description('Loop-friendly observation commands');

  observe
    .command('state')
    .description('Observe current page state summary')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.OBSERVE_STATE, {
        pageId: toPageId(opts.page)
      });
      await onResponse(response.ok, response);
    });

  observe
    .command('targets')
    .description('Observe interactable targets and geometry')
    .option('--page <id>', 'target page id (default: current page)')
    .option('--limit <n>', 'max number of targets to return')
    .option('--only-visible', 'include only visible targets')
    .action(async (opts: { page?: string; limit?: string; onlyVisible?: boolean }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.OBSERVE_TARGETS, {
        pageId: toPageId(opts.page),
        limit: toPositiveInt('limit', opts.limit),
        onlyVisible: opts.onlyVisible
      });
      await onResponse(response.ok, response);
    });

  observe.action(async () => {
    observe.outputHelp();
  });
};
