import type { Command } from 'commander';

import { DaemonClient } from '../../../infrastructure/ipc/DaemonClient.js';
import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { toDaemonContext, type CommandContext } from './common.js';

type DaemonStatusData = {
  pid?: number;
  socketPath?: string;
};

const formatDaemonRunningText = (data: DaemonStatusData): string =>
  ['daemon running', `pid: ${typeof data.pid === 'number' ? data.pid : 'unknown'}`, `socket: ${data.socketPath ?? '-'}`].join('\n');

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
          meta: { durationMs: 0 },
          text: 'daemon stopped'
        });
        return;
      }

      const response = await client.send(IPC_OP.DAEMON_STATUS, {}, toDaemonContext(ctx));
      if (!response.ok) {
        await onResponse(false, response);
        return;
      }
      await onResponse(true, {
        ...response,
        text: formatDaemonRunningText((response.data ?? {}) as DaemonStatusData)
      });
    });

  daemon
    .command('start')
    .description('Start daemon explicitly')
    .action(async () => {
      const ctx = getCtx();
      const client = new DaemonClient(ctx.homeDir);
      await client.ensureRunning(toDaemonContext(ctx));
      const response = await client.send(IPC_OP.DAEMON_STATUS, {}, toDaemonContext(ctx));
      if (!response.ok) {
        await onResponse(false, response);
        return;
      }

      await onResponse(true, {
        ...response,
        text: formatDaemonRunningText((response.data ?? {}) as DaemonStatusData)
      });
    });

  daemon
    .command('stop')
    .description('Stop daemon if running')
    .action(async () => {
      const ctx = getCtx();
      const client = new DaemonClient(ctx.homeDir);
      const result = await client.stopAndWait(toDaemonContext(ctx));

      await onResponse(true, {
        id: 'daemon-stop',
        ok: true,
        data: { stopped: result.requestedStop },
        meta: { durationMs: 0 },
        text: result.requestedStop ? 'daemon stopped' : 'daemon already stopped'
      });
    });

  daemon
    .command('restart')
    .description('Restart daemon')
    .action(async () => {
      const ctx = getCtx();
      const client = new DaemonClient(ctx.homeDir);
      await client.stopAndWait(toDaemonContext(ctx));
      await client.ensureRunning(toDaemonContext(ctx));
      const status = await client.send(IPC_OP.DAEMON_STATUS, {}, toDaemonContext(ctx));

      if (!status.ok) {
        await onResponse(false, status);
        return;
      }

      const data = (status.data ?? {}) as { pid?: number; socketPath?: string };
      const text = ['daemon restarted', `pid: ${typeof data.pid === 'number' ? data.pid : 'unknown'}`, `socket: ${data.socketPath ?? '-'}`];

      await onResponse(true, {
        ...status,
        text: text.join('\n')
      });
    });

  daemon.action(async () => {
    daemon.outputHelp();
  });
};
