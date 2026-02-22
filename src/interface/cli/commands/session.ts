import type { Command } from 'commander';

import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
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
  root
    .command('start')
    .description('Start or reuse current context session')
    .option('--headless', 'Run in headless mode')
    .option('--headed', 'Run in headed mode')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { headless?: boolean; headed?: boolean; describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'start',
          payload: { headless: 'boolean (default: false)' },
          examples: ['browser start', 'browser start --headless --share-group qa']
        });
        return;
      }

      const ctx = getCtx();
      const response = await sendDaemonCommand(ctx, IPC_OP.SESSION_START, {
        headless: parseHeadless(opts)
      });
      await onResponse(response.ok, response);
    });

  root
    .command('status')
    .description('Get session status for current context')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'status',
          payload: {},
          examples: ['browser status --output json']
        });
        return;
      }

      const ctx = getCtx();
      const response = await sendDaemonCommand(ctx, IPC_OP.SESSION_STATUS, {});
      await onResponse(response.ok, response);
    });

  root
    .command('stop')
    .description('Stop current context session')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'stop',
          payload: {},
          examples: ['browser stop --output json']
        });
        return;
      }

      const ctx = getCtx();
      const response = await sendDaemonCommand(ctx, IPC_OP.SESSION_STOP, {});
      await onResponse(response.ok, response);
    });
};
