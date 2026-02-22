import type { Command } from 'commander';

import { DaemonClient } from '../../../infrastructure/ipc/DaemonClient.js';
import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import type { CallerContext } from '../../../shared/schema/common.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
import { AppError } from '../../../shared/errors/AppError.js';

export type SessionCommandContext = {
  caller: CallerContext;
  output: 'json' | 'text';
  shareGroup?: string;
  contextId?: string;
  timeout?: number;
  homeDir?: string;
};

const parseHeadless = (opts: { headless?: boolean; headed?: boolean }): boolean => {
  if (opts.headed) {
    return false;
  }
  if (opts.headless === false) {
    return false;
  }
  return true;
};

const baseContext = (ctx: SessionCommandContext) => ({
  caller: ctx.caller,
  shareGroup: ctx.shareGroup,
  contextId: ctx.contextId,
  timeoutMs: ctx.timeout
});

export const registerSessionCommands = (
  root: Command,
  getCtx: () => SessionCommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const session = root.command('session').description('Manage context-bound browser sessions').option('--list');

  session
    .command('start')
    .description('Start or reuse current context session')
    .option('--headless', 'Run in headless mode', true)
    .option('--headed', 'Run in headed mode')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { headless?: boolean; headed?: boolean; describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'session start',
          payload: { headless: 'boolean (default: true)' },
          examples: ['cdt session start --headless', 'cdt session start --headed --share-group qa']
        });
        return;
      }

      const ctx = getCtx();
      const daemon = new DaemonClient(ctx.homeDir);
      await daemon.ensureRunning(baseContext(ctx));
      const response = await daemon.send(
        IPC_OP.SESSION_START,
        { headless: parseHeadless(opts) },
        baseContext(ctx)
      );
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
      const daemon = new DaemonClient(ctx.homeDir);
      await daemon.ensureRunning(baseContext(ctx));
      const response = await daemon.send(IPC_OP.SESSION_STATUS, {}, baseContext(ctx));
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
      const daemon = new DaemonClient(ctx.homeDir);
      await daemon.ensureRunning(baseContext(ctx));
      const response = await daemon.send(IPC_OP.SESSION_STOP, {}, baseContext(ctx));
      await onResponse(response.ok, response);
    });

  session.action(async () => {
    const command = session.optsWithGlobals() as { list?: boolean };
    if (command.list) {
      await onResponse(true, {
        id: 'session-list',
        ok: true,
        data: { commands: ['start', 'status', 'stop'] },
        meta: { durationMs: 0 }
      });
      return;
    }

    throw new AppError('Missing session subcommand. Use --list to inspect available commands.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Run: cdt session --list', 'Run: cdt session start --describe']
    });
  });
};
