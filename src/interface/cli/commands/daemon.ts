import type { Command } from 'commander';

import { DaemonClient } from '../../../infrastructure/ipc/DaemonClient.js';
import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { toDaemonContext, type CommandContext } from './common.js';

export const registerDaemonCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const daemon = root.command('daemon').description('Broker daemon lifecycle').option('--list');

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

  daemon.action(async () => {
    const command = daemon.optsWithGlobals() as { list?: boolean };
    if (command.list) {
      await onResponse(true, {
        id: 'daemon-list',
        ok: true,
        data: { commands: ['start', 'status', 'stop'] },
        meta: { durationMs: 0 }
      });
      return;
    }

    await onResponse(true, {
      id: 'daemon-help',
      ok: true,
      data: { commands: ['start', 'status', 'stop'] },
      meta: { durationMs: 0 }
    });
  });
};
