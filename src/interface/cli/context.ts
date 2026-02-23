import { readlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import type { CallerContext } from '../../shared/schema/common.js';

const TTY_FD_CANDIDATES = ['/dev/fd/0', '/proc/self/fd/0'] as const;

const toTtyPath = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.startsWith('/dev/') ? trimmed : undefined;
};

export const resolveCallerTty = (input: {
  isTTY: boolean;
  envTTY?: string;
  readlink?: (path: string) => string;
  runTtyCommand?: () => string;
}): string | undefined => {
  if (!input.isTTY) {
    return undefined;
  }

  const fromEnv = toTtyPath(input.envTTY);
  if (fromEnv) {
    return fromEnv;
  }

  const readlink = input.readlink ?? readlinkSync;
  for (const fdPath of TTY_FD_CANDIDATES) {
    try {
      const linked = toTtyPath(readlink(fdPath));
      if (linked) {
        return linked;
      }
    } catch {
      // Ignore unsupported fd paths and continue trying fallbacks.
    }
  }

  const runTtyCommand =
    input.runTtyCommand ??
    (() =>
      execFileSync('tty', {
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'ignore']
      }));
  try {
    const fromCommand = toTtyPath(runTtyCommand());
    if (fromCommand) {
      return fromCommand;
    }
  } catch {
    // Ignore command failures and fall back to cwd-based routing.
  }

  return undefined;
};

export const collectCallerContext = (): CallerContext => {
  const runtimeContextId = process.env.CDT_CONTEXT_ID?.trim();
  const tty = resolveCallerTty({
    isTTY: process.stdin.isTTY === true,
    envTTY: process.env.TTY
  });

  return {
    runtimeContextId: runtimeContextId && runtimeContextId.length > 0 ? runtimeContextId : undefined,
    pid: process.pid,
    ppid: process.ppid,
    tty,
    cwd: process.cwd()
  };
};
