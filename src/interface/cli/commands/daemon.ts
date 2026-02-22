import type { Command } from 'commander';

import { DaemonClient } from '../../../infrastructure/ipc/DaemonClient.js';
import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import type { CallerContext } from '../../../shared/schema/common.js';

export type DaemonCommandContext = {
  caller: CallerContext;
  shareGroup?: string;
  contextId?: string;
  timeout?: number;
  homeDir?: string;
};

const toContext = (ctx: DaemonCommandContext) => ({
  caller: ctx.caller,
  shareGroup: ctx.shareGroup,
  contextId: ctx.contextId,
  timeoutMs: ctx.timeout
});

export const registerDaemonCommands = (
  root: Command,
  getCtx: () => DaemonCommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const daemon = root.command('daemon').description('Broker daemon lifecycle').option('--list');

  daemon
    .command('status')
    .description('Check daemon availability')
    .action(async () => {
      const ctx = getCtx();
      const client = new DaemonClient(ctx.homeDir);
      const reachable = await client.isReachable(toContext(ctx));

      if (!reachable) {
        await onResponse(true, {
          id: 'daemon-status',
          ok: true,
          data: { running: false },
          meta: { durationMs: 0 }
        });
        return;
      }

      const response = await client.send(IPC_OP.DAEMON_STATUS, {}, toContext(ctx));
      await onResponse(response.ok, response);
    });

  daemon
    .command('start')
    .description('Start daemon explicitly')
    .action(async () => {
      const ctx = getCtx();
      const client = new DaemonClient(ctx.homeDir);
      await client.ensureRunning(toContext(ctx));
      const response = await client.send(IPC_OP.DAEMON_STATUS, {}, toContext(ctx));
      await onResponse(response.ok, response);
    });

  daemon
    .command('stop')
    .description('Stop daemon if running')
    .action(async () => {
      const ctx = getCtx();
      const client = new DaemonClient(ctx.homeDir);
      const stopped = await client.stop(toContext(ctx));

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
