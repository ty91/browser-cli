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

describe.skipIf(!hasChrome)('tab commands integration', () => {
  it('supports listing, creating, selecting, and closing tabs by index', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'cdt-tab-'));

    const env = {
      ...process.env,
      BROWSER_HOME: tempHome,
      CDT_CONTEXT_ID: 'tab-commands'
    };

    try {
      const start = await runCli(['start', '--headless', '--output', 'json'], env, cwd);
      expect(start.code).toBe(0);

      const initialTabsResult = await runCli(['tabs', '--output', 'json'], env, cwd);
      expect(initialTabsResult.code).toBe(0);
      const initialTabsData = parseEnvelope(initialTabsResult.stdout).data as {
        tabs: Array<{ index: number; id: number; selected: boolean }>;
        selectedIndex: number | null;
      };

      expect(initialTabsData.tabs.length).toBeGreaterThan(0);
      expect(initialTabsData.tabs[0]?.index).toBe(1);
      const initialCount = initialTabsData.tabs.length;

      const tabNew1 = await runCli(['tab', 'new', '--output', 'json'], env, cwd);
      expect(tabNew1.code).toBe(0);
      const tabNew1Data = parseEnvelope(tabNew1.stdout).data as {
        tab: { index: number };
      };
      expect(tabNew1Data.tab.index).toBe(initialCount + 1);

      const tabNew2 = await runCli(['tab', 'new', '--output', 'json'], env, cwd);
      expect(tabNew2.code).toBe(0);
      const tabNew2Data = parseEnvelope(tabNew2.stdout).data as {
        tab: { index: number };
      };
      expect(tabNew2Data.tab.index).toBe(initialCount + 2);

      const afterNewTabsResult = await runCli(['tabs', '--output', 'json'], env, cwd);
      expect(afterNewTabsResult.code).toBe(0);
      const afterNewTabsData = parseEnvelope(afterNewTabsResult.stdout).data as {
        tabs: Array<{ index: number }>;
      };
      expect(afterNewTabsData.tabs.length).toBe(initialCount + 2);

      const selectSecond = await runCli(['tab', 'select', '2', '--output', 'json'], env, cwd);
      expect(selectSecond.code).toBe(0);
      const selectData = parseEnvelope(selectSecond.stdout).data as {
        selectedIndex: number | null;
        tab: { index: number } | null;
      };
      expect(selectData.selectedIndex).toBe(2);
      expect(selectData.tab?.index).toBe(2);

      const focusState = await runCli(
        ['runtime', 'eval', '--function', '() => ({ hasFocus: document.hasFocus(), visibility: document.visibilityState })', '--output', 'json'],
        env,
        cwd
      );
      expect(focusState.code).toBe(0);
      const focusValue = (parseEnvelope(focusState.stdout).data as { value?: { hasFocus?: boolean; visibility?: string } })
        ?.value;
      expect(focusValue?.hasFocus).toBe(true);
      expect(focusValue?.visibility).toBe('visible');

      const closeSecond = await runCli(['tab', 'close', '2', '--output', 'json'], env, cwd);
      expect(closeSecond.code).toBe(0);
      const closeData = parseEnvelope(closeSecond.stdout).data as {
        closedTab: { index: number };
        tabs: Array<{ index: number }>;
      };
      expect(closeData.closedTab.index).toBe(2);
      expect(closeData.tabs.length).toBe(initialCount + 1);

      const invalidSelect = await runCli(['tab', 'select', '999', '--output', 'json'], env, cwd);
      expect(invalidSelect.code).toBe(3);
      const invalidSelectBody = parseEnvelope(invalidSelect.stdout);
      expect(invalidSelectBody.ok).toBe(false);
      expect(invalidSelectBody.error?.code).toBe('PAGE_NOT_FOUND');
    } finally {
      await runCli(['stop', '--output', 'json'], env, cwd);
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  }, 45_000);
});
