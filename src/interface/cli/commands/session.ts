import type { Command } from 'commander';

import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { sendDaemonCommand, type CommandContext } from './common.js';

export const parseHeadless = (opts: { headless?: boolean; headed?: boolean }): boolean => {
  if (opts.headed) {
    return false;
  }
  return opts.headless === true;
};

export const registerSessionCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const session = root.command('session').description('Manage context-bound browser sessions');

  session
    .command('start')
    .description('Start or reuse current context session')
    .option('--headless', 'Run in headless mode')
    .option('--headed', 'Run in headed mode')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { headless?: boolean; headed?: boolean; describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'session start',
          payload: { headless: 'boolean (default: false)' },
          examples: ['cdt session start', 'cdt session start --headless --share-group qa']
        });
        return;
      }

      const ctx = getCtx();
      const response = await sendDaemonCommand(ctx, IPC_OP.SESSION_START, {
        headless: parseHeadless(opts)
      });
      await onResponse(response.ok, response);
    });

  session
    .command('status')
    .description('Get session status for current context')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'session status',
          payload: {},
          examples: ['cdt session status --output json']
        });
        return;
      }

      const ctx = getCtx();
      const response = await sendDaemonCommand(ctx, IPC_OP.SESSION_STATUS, {});
      await onResponse(response.ok, response);
    });

  session
    .command('stop')
    .description('Stop current context session')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'session stop',
          payload: {},
          examples: ['cdt session stop --output json']
        });
        return;
      }

      const ctx = getCtx();
      const response = await sendDaemonCommand(ctx, IPC_OP.SESSION_STOP, {});
      await onResponse(response.ok, response);
    });

  session.action(async () => {
    throw new AppError('Missing session subcommand.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Run: cdt session --help', 'Run: cdt session start --describe']
    });
  });
};
