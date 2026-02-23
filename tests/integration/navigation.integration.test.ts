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

type CliEnvelope = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: {
    code?: string;
    message?: string;
  };
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

const parseEnvelope = (stdout: string): CliEnvelope => JSON.parse(stdout) as CliEnvelope;

const hasChrome = BrowserSlotManager.resolveChromePath() !== null;

describe.skipIf(!hasChrome)('navigation commands integration', () => {
  it('supports root open/navigate and keeps page commands with deprecation warnings', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'cdt-nav-'));

    const env = {
      ...process.env,
      BROWSER_HOME: tempHome,
      CDT_CONTEXT_ID: 'nav-root'
    };

    const pageA = 'data:text/html,%3Chtml%3E%3Chead%3E%3Ctitle%3ENavA%3C/title%3E%3C/head%3E%3Cbody%3EA%3C/body%3E%3C/html%3E';
    const pageB = 'data:text/html,%3Chtml%3E%3Chead%3E%3Ctitle%3ENavB%3C/title%3E%3C/head%3E%3Cbody%3EB%3C/body%3E%3C/html%3E';
    const pageC = 'data:text/html,%3Chtml%3E%3Chead%3E%3Ctitle%3ENavC%3C/title%3E%3C/head%3E%3Cbody%3EC%3C/body%3E%3C/html%3E';
    const pageD = 'data:text/html,%3Chtml%3E%3Chead%3E%3Ctitle%3ENavD%3C/title%3E%3C/head%3E%3Cbody%3ED%3C/body%3E%3C/html%3E';

    try {
      const start = await runCli(['start', '--headless', '--output', 'json'], env, cwd);
      expect(start.code).toBe(0);

      const openRoot = await runCli(['open', pageA, '--output', 'json'], env, cwd);
      expect(openRoot.code).toBe(0);
      const openRootBody = parseEnvelope(openRoot.stdout);
      expect(openRootBody.ok).toBe(true);

      const titleAfterOpen = await runCli(
        ['runtime', 'eval', '--function', '() => document.title', '--output', 'json'],
        env,
        cwd
      );
      expect(titleAfterOpen.code).toBe(0);
      expect((parseEnvelope(titleAfterOpen.stdout).data as { value?: string }).value).toBe('NavA');

      const navigateRoot = await runCli(['navigate', pageB, '--output', 'json'], env, cwd);
      expect(navigateRoot.code).toBe(0);

      const titleAfterNavigate = await runCli(
        ['runtime', 'eval', '--function', '() => document.title', '--output', 'json'],
        env,
        cwd
      );
      expect(titleAfterNavigate.code).toBe(0);
      expect((parseEnvelope(titleAfterNavigate.stdout).data as { value?: string }).value).toBe('NavB');

      const pageOpenDeprecated = await runCli(['page', 'open', '--url', pageC, '--output', 'json'], env, cwd);
      expect(pageOpenDeprecated.code).toBe(0);
      expect(pageOpenDeprecated.stderr.toLowerCase()).toContain('deprecated');

      const pageNavigateDeprecated = await runCli(
        ['page', 'navigate', '--url', pageD, '--output', 'json'],
        env,
        cwd
      );
      expect(pageNavigateDeprecated.code).toBe(0);
      expect(pageNavigateDeprecated.stderr.toLowerCase()).toContain('deprecated');

      const titleAfterDeprecatedNavigate = await runCli(
        ['runtime', 'eval', '--function', '() => document.title', '--output', 'json'],
        env,
        cwd
      );
      expect(titleAfterDeprecatedNavigate.code).toBe(0);
      expect((parseEnvelope(titleAfterDeprecatedNavigate.stdout).data as { value?: string }).value).toBe('NavD');
    } finally {
      await runCli(['stop', '--output', 'json'], env, cwd);
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  }, 45_000);
});
