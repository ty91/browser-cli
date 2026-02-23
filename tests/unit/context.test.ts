import { describe, expect, it } from 'vitest';

import { resolveCallerTty } from '../../src/interface/cli/context.js';

describe('resolveCallerTty', () => {
  it('returns undefined when stdin is not a tty', () => {
    const tty = resolveCallerTty({
      isTTY: false,
      envTTY: '/dev/ttys006',
      readlink: () => '/dev/ttys006'
    });

    expect(tty).toBeUndefined();
  });

  it('prefers TTY env path when available', () => {
    const tty = resolveCallerTty({
      isTTY: true,
      envTTY: '/dev/ttys018',
      readlink: () => '/dev/ttys999'
    });

    expect(tty).toBe('/dev/ttys018');
  });

  it('resolves tty path from file descriptor link when env is missing', () => {
    const tty = resolveCallerTty({
      isTTY: true,
      readlink: (fdPath) => {
        if (fdPath === '/dev/fd/0') {
          return '/dev/ttys021';
        }
        throw new Error('unsupported');
      }
    });

    expect(tty).toBe('/dev/ttys021');
  });

  it('returns undefined when no /dev tty path can be resolved', () => {
    const tty = resolveCallerTty({
      isTTY: true,
      envTTY: 'tmux-256color',
      readlink: () => 'socket:[12345]',
      runTtyCommand: () => 'not a tty'
    });

    expect(tty).toBeUndefined();
  });

  it('falls back to tty command output when fd links are unavailable', () => {
    const tty = resolveCallerTty({
      isTTY: true,
      readlink: () => {
        throw new Error('unsupported');
      },
      runTtyCommand: () => '/dev/ttys031'
    });

    expect(tty).toBe('/dev/ttys031');
  });
});
