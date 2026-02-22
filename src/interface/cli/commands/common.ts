import type { DaemonContext } from '../../../shared/schema/common.js';
import { DaemonClient } from '../../../infrastructure/ipc/DaemonClient.js';
import type { IPC_OP } from '../../../infrastructure/ipc/protocol.js';

export type CommandContext = {
  caller: DaemonContext['caller'];
  output: 'json' | 'text';
  shareGroup?: string;
  contextId?: string;
  timeout?: number;
  homeDir?: string;
};

export const toDaemonContext = (ctx: CommandContext): DaemonContext => ({
  caller: ctx.caller,
  shareGroup: ctx.shareGroup,
  contextId: ctx.contextId,
  timeoutMs: ctx.timeout
});

export const sendDaemonCommand = async (
  ctx: CommandContext,
  op: (typeof IPC_OP)[keyof typeof IPC_OP],
  payload: Record<string, unknown>
) => {
  const daemon = new DaemonClient(ctx.homeDir);
  const daemonContext = toDaemonContext(ctx);
  await daemon.ensureRunning(daemonContext);
  return daemon.send(op, payload, daemonContext);
};
