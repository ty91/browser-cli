import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, rm } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

type CliResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type CliEnvelope = {
  ok: boolean;
  data?: Record<string, unknown>;
};

const runCli = async (args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<CliResult> => {
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

const runDuplicateDaemonAttempt = async (env: NodeJS.ProcessEnv, cwd: string): Promise<CliResult> => {
  const rootDir = path.resolve(cwd);
  const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const entry = path.join(rootDir, 'src', 'bin', 'cdt-daemon.ts');

  return new Promise<CliResult>((resolve) => {
    const child = spawn(process.execPath, [tsxCli, entry], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, 10_000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
};

const parseEnvelope = (stdout: string): CliEnvelope => JSON.parse(stdout) as CliEnvelope;

describe('daemon resilience', () => {
  it('keeps daemon socket available when duplicate start is attempted', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'browser-daemon-resilience-'));
    const socketPath = path.join(tempHome, 'broker', 'daemon.sock');

    const env = {
      ...process.env,
      BROWSER_HOME: tempHome
    };

    try {
      const start = await runCli(['daemon', 'start', '--output', 'json'], env, cwd);
      expect(start.code).toBe(0);

      const duplicate = await runDuplicateDaemonAttempt(env, cwd);
      expect(duplicate.code).not.toBe(0);

      const status = await runCli(['daemon', 'status', '--output', 'json'], env, cwd);
      expect(status.code).toBe(0);
      const body = parseEnvelope(status.stdout);
      expect(body.ok).toBe(true);
      const data = (body.data ?? {}) as { pid?: number; socketPath?: string; uptimeMs?: number };
      expect(typeof data.pid).toBe('number');
      expect(data.socketPath).toBe(socketPath);
      expect(typeof data.uptimeMs).toBe('number');
      await access(socketPath);
    } finally {
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  });
});
