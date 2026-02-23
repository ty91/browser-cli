import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { BrowserSlotManager } from '../../src/infrastructure/cdp/BrowserSlotManager.js';

type CliResult = {
  code: number;
  stdout: string;
  stderr: string;
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

const hasChrome = BrowserSlotManager.resolveChromePath() !== null;

describe.skipIf(!hasChrome)('default text output', () => {
  it('prints concise human-readable text for recent commands', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'cdt-text-'));

    const env = {
      ...process.env,
      CDT_HOME: tempHome,
      CDT_CONTEXT_ID: 'text-output'
    };

    const pageA = 'data:text/html,%3Chtml%3E%3Chead%3E%3Ctitle%3ETextA%3C/title%3E%3C/head%3E%3Cbody%3EA%3C/body%3E%3C/html%3E';
    const pageB = 'data:text/html,%3Chtml%3E%3Chead%3E%3Ctitle%3ETextB%3C/title%3E%3C/head%3E%3Cbody%3EB%3C/body%3E%3C/html%3E';

    try {
      const start = await runCli(['start', '--headless'], env, cwd);
      expect(start.code).toBe(0);
      expect(start.stdout.toLowerCase()).toContain('session started');

      const status = await runCli(['status'], env, cwd);
      expect(status.code).toBe(0);
      expect(status.stdout.toLowerCase()).toContain('session running');

      const open = await runCli(['open', pageA], env, cwd);
      expect(open.code).toBe(0);
      expect(open.stdout.toLowerCase()).toContain('tab opened');

      const tabs = await runCli(['tabs'], env, cwd);
      expect(tabs.code).toBe(0);
      expect(tabs.stdout.toLowerCase()).toContain('tabs:');

      const tabNew = await runCli(['tab', 'new'], env, cwd);
      expect(tabNew.code).toBe(0);
      expect(tabNew.stdout.toLowerCase()).toContain('tab opened');

      const tabSelect = await runCli(['tab', 'select', '2'], env, cwd);
      expect(tabSelect.code).toBe(0);
      expect(tabSelect.stdout.toLowerCase()).toContain('tab selected: 2');

      const navigate = await runCli(['navigate', pageB], env, cwd);
      expect(navigate.code).toBe(0);
      expect(navigate.stdout.toLowerCase()).toContain('navigated');

      const stop = await runCli(['stop'], env, cwd);
      expect(stop.code).toBe(0);
      expect(stop.stdout.toLowerCase()).toContain('session stopped');
    } finally {
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  }, 45_000);
});

describe('daemon restart command', () => {
  it('restarts daemon and prints concise text output by default', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'cdt-daemon-restart-'));

    const env = {
      ...process.env,
      CDT_HOME: tempHome
    };

    try {
      const restart = await runCli(['daemon', 'restart'], env, cwd);
      expect(restart.code).toBe(0);
      expect(restart.stdout.toLowerCase()).toContain('daemon restarted');
      expect(restart.stdout.toLowerCase()).toContain('pid:');

      const status = await runCli(['daemon', 'status', '--output', 'json'], env, cwd);
      expect(status.code).toBe(0);
      expect(status.stdout).toContain('"ok":true');
      expect(status.stdout).toContain('"pid"');
    } finally {
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  });
});
