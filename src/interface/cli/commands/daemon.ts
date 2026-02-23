import type { Command } from 'commander';

import { DaemonClient } from '../../../infrastructure/ipc/DaemonClient.js';
import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
import { toDaemonContext, type CommandContext } from './common.js';

export const registerDaemonCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const daemon = root.command('daemon').description('Broker daemon lifecycle');

  daemon
    .command('status')
    .description('Check daemon availability')
    .action(async () => {
      const ctx = getCtx();
      const client = new DaemonClient(ctx.homeDir);
      const reachable = await client.isReachable(toDaemonContext(ctx));

      if (!reachable) {
        await onResponse(true, {
          id: 'daemon-status',
          ok: true,
          data: { running: false },
          meta: { durationMs: 0 }
        });
        return;
      }

      const response = await client.send(IPC_OP.DAEMON_STATUS, {}, toDaemonContext(ctx));
      await onResponse(response.ok, response);
    });

  daemon
    .command('start')
    .description('Start daemon explicitly')
    .action(async () => {
      const ctx = getCtx();
      const client = new DaemonClient(ctx.homeDir);
      await client.ensureRunning(toDaemonContext(ctx));
      const response = await client.send(IPC_OP.DAEMON_STATUS, {}, toDaemonContext(ctx));
      await onResponse(response.ok, response);
    });

  daemon
    .command('stop')
    .description('Stop daemon if running')
    .action(async () => {
      const ctx = getCtx();
      const client = new DaemonClient(ctx.homeDir);
      const stopped = await client.stop(toDaemonContext(ctx));

      await onResponse(true, {
        id: 'daemon-stop',
        ok: true,
        data: { stopped },
        meta: { durationMs: 0 }
      });
    });

  daemon
    .command('restart')
    .description('Restart daemon')
    .action(async () => {
      const ctx = getCtx();
      const client = new DaemonClient(ctx.homeDir);
      const wasRunning = await client.stop(toDaemonContext(ctx));
      await client.ensureRunning(toDaemonContext(ctx));
      const status = await client.send(IPC_OP.DAEMON_STATUS, {}, toDaemonContext(ctx));

      if (!status.ok) {
        await onResponse(false, status);
        return;
      }

      const data = (status.data ?? {}) as { pid?: number; socketPath?: string };
      const text = ['daemon restarted', `pid: ${typeof data.pid === 'number' ? data.pid : 'unknown'}`, `socket: ${data.socketPath ?? '-'}`];
      if (!wasRunning) {
        text.push('previously running: no');
      }

      await onResponse(true, {
        ...status,
        text: text.join('\n')
      });
    });

  daemon.action(async () => {
    throw new AppError('Missing daemon subcommand.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Run: browser daemon --help']
    });
  });
};
