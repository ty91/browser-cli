import { describe, expect, it } from 'vitest';

import { ContextResolver } from '../../src/application/context/ContextResolver.js';

describe('ContextResolver auto context fallback', () => {
  it('reuses the same key for the same tty', () => {
    const resolver = new ContextResolver();

    const first = resolver.resolve({
      caller: {
        pid: 1001,
        ppid: 888,
        tty: 'ttys001',
        cwd: '/tmp/work'
      }
    });

    const second = resolver.resolve({
      caller: {
        pid: 1002,
        ppid: 999,
        tty: 'ttys001',
        cwd: '/tmp/another'
      }
    });

    expect(first.contextKeyHash).toBe(second.contextKeyHash);
    expect(first.resolvedBy).toBe('fingerprint');
  });

  it('falls back to cwd when tty is missing', () => {
    const resolver = new ContextResolver();

    const first = resolver.resolve({
      caller: {
        pid: 1001,
        ppid: 0,
        cwd: '/tmp/work'
      }
    });

    const second = resolver.resolve({
      caller: {
        pid: 1002,
        ppid: 0,
        cwd: '/tmp/work'
      }
    });

    expect(first.resolvedBy).toBe('fingerprint');
    expect(first.contextKeyHash).toBe(second.contextKeyHash);
  });
});
