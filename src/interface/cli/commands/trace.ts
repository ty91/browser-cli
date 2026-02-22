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

export const registerTraceCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const trace = root.command('trace').description('Performance trace capture');

  trace
    .command('start')
    .description('Start trace recording')
    .option('--page <id>', 'target page id')
    .option('--file <path>', 'trace file path')
    .action(async (opts: { page?: string; file?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.TRACE_START, {
        pageId: toPageId(opts.page),
        filePath: opts.file
      });
      await onResponse(response.ok, response);
    });

  trace
    .command('stop')
    .description('Stop trace recording')
    .option('--file <path>', 'optional output file path')
    .action(async (opts: { file?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.TRACE_STOP, {
        filePath: opts.file
      });
      await onResponse(response.ok, response);
    });

  trace
    .command('insight')
    .description('Analyze trace file summary')
    .option('--file <path>', 'trace file path')
    .option('--insight <name>', 'insight name')
    .action(async (opts: { file?: string; insight?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.TRACE_INSIGHT, {
        filePath: opts.file,
        insightName: opts.insight
      });
      await onResponse(response.ok, response);
    });

  trace.action(async () => {
    throw new AppError('Missing trace subcommand.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Run: cdt trace --help']
    });
  });
};
