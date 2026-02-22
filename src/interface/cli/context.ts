import type { CallerContext } from '../../shared/schema/common.js';

export const collectCallerContext = (): CallerContext => {
  const runtimeContextId = process.env.CDT_CONTEXT_ID?.trim();

  const tty = process.stdin.isTTY
    ? process.env.TERM_PROGRAM ?? process.env.TERM ?? 'tty'
    : undefined;

  return {
    runtimeContextId: runtimeContextId && runtimeContextId.length > 0 ? runtimeContextId : undefined,
    pid: process.pid,
    ppid: process.ppid,
    tty,
    cwd: process.cwd()
  };
};
