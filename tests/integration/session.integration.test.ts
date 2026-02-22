import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

type CliResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const runCli = async (
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string
): Promise<CliResult> => {
  const rootDir = path.resolve(cwd);
  const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const entry = path.join(rootDir, 'src', 'bin', 'cdt.ts');

  return new Promise<CliResult>((resolve) => {
    const child = spawn(process.execPath, [tsxCli, entry, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
};

const parseEnvelope = (stdout: string): Record<string, any> => JSON.parse(stdout);

describe('session integration', () => {
  it('starts, reuses, and stops session in same context', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'cdt-it-'));

    const env = {
      ...process.env,
      CDT_HOME: tempHome,
      CDT_CONTEXT_ID: 'ctx-a'
    };

    try {
      const start1 = await runCli(['session', 'start', '--output', 'json'], env, cwd);
      expect(start1.code).toBe(0);
      const start1Body = parseEnvelope(start1.stdout);
      expect(start1Body.ok).toBe(true);
      expect(start1Body.data.reused).toBe(false);

      const start2 = await runCli(['session', 'start', '--output', 'json'], env, cwd);
      expect(start2.code).toBe(0);
      const start2Body = parseEnvelope(start2.stdout);
      expect(start2Body.ok).toBe(true);
      expect(start2Body.data.reused).toBe(true);

      const status = await runCli(['session', 'status', '--output', 'json'], env, cwd);
      expect(status.code).toBe(0);
      const statusBody = parseEnvelope(status.stdout);
      expect(statusBody.ok).toBe(true);
      expect(statusBody.data.session.status).toBe('running');

      const stop = await runCli(['session', 'stop', '--output', 'json'], env, cwd);
      expect(stop.code).toBe(0);
      const stopBody = parseEnvelope(stop.stdout);
      expect(stopBody.ok).toBe(true);
      expect(stopBody.data.session.status).toBe('stopped');
    } finally {
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it('separates session slots by context id', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'cdt-it-'));

    const envA = {
      ...process.env,
      CDT_HOME: tempHome,
      CDT_CONTEXT_ID: 'ctx-A'
    };

    const envB = {
      ...process.env,
      CDT_HOME: tempHome,
      CDT_CONTEXT_ID: 'ctx-B'
    };

    try {
      const a = await runCli(['session', 'start', '--output', 'json'], envA, cwd);
      const b = await runCli(['session', 'start', '--output', 'json'], envB, cwd);

      expect(a.code).toBe(0);
      expect(b.code).toBe(0);

      const bodyA = parseEnvelope(a.stdout);
      const bodyB = parseEnvelope(b.stdout);

      expect(bodyA.data.context.contextKeyHash).not.toBe(bodyB.data.context.contextKeyHash);

      const statusA = await runCli(['session', 'status', '--output', 'json'], envA, cwd);
      const statusB = await runCli(['session', 'status', '--output', 'json'], envB, cwd);

      expect(parseEnvelope(statusA.stdout).data.context.contextKeyHash).not.toBe(
        parseEnvelope(statusB.stdout).data.context.contextKeyHash
      );
    } finally {
      await runCli(['session', 'stop', '--output', 'json'], envA, cwd);
      await runCli(['session', 'stop', '--output', 'json'], envB, cwd);
      await runCli(['daemon', 'stop', '--output', 'json'], envA, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  });
});
