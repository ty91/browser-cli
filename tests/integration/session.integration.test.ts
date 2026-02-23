import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';
import { BrowserSlotManager } from '../../src/infrastructure/cdp/BrowserSlotManager.js';

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

const parseEnvelope = (stdout: string): Record<string, any> =>
  JSON.parse(stdout) as Record<string, any>;

const hasChrome = BrowserSlotManager.resolveChromePath() !== null;

const findRefByText = (snapshotText: string, marker: string): string => {
  for (const line of snapshotText.split('\n')) {
    if (!line.includes(marker)) {
      continue;
    }

    const match = line.match(/\[ref=(e\d+)\]/);
    if (match?.[1]) {
      return match[1];
    }
  }

  throw new Error(`Ref not found for marker: ${marker}`);
};

describe.skipIf(!hasChrome)('session integration', () => {
  it('starts, reuses, and stops session in same context', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'cdt-it-'));

    const env = {
      ...process.env,
      BROWSER_HOME: tempHome,
      CDT_CONTEXT_ID: 'ctx-a'
    };

    try {
      const start1 = await runCli(['start', '--headless', '--output', 'json'], env, cwd);
      expect(start1.code).toBe(0);
      const start1Body = parseEnvelope(start1.stdout);
      expect(start1Body.ok).toBe(true);
      expect(start1Body.data.reused).toBe(false);

      const start2 = await runCli(['start', '--headless', '--output', 'json'], env, cwd);
      expect(start2.code).toBe(0);
      const start2Body = parseEnvelope(start2.stdout);
      expect(start2Body.ok).toBe(true);
      expect(start2Body.data.reused).toBe(true);

      const status = await runCli(['status', '--output', 'json'], env, cwd);
      expect(status.code).toBe(0);
      const statusBody = parseEnvelope(status.stdout);
      expect(statusBody.ok).toBe(true);
      expect(statusBody.data.session.status).toBe('running');

      const stop = await runCli(['stop', '--output', 'json'], env, cwd);
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
      BROWSER_HOME: tempHome,
      CDT_CONTEXT_ID: 'ctx-A'
    };

    const envB = {
      ...process.env,
      BROWSER_HOME: tempHome,
      CDT_CONTEXT_ID: 'ctx-B'
    };

    try {
      const a = await runCli(['start', '--headless', '--output', 'json'], envA, cwd);
      const b = await runCli(['start', '--headless', '--output', 'json'], envB, cwd);

      expect(a.code).toBe(0);
      expect(b.code).toBe(0);

      const bodyA = parseEnvelope(a.stdout);
      const bodyB = parseEnvelope(b.stdout);

      expect(bodyA.data.context.contextKeyHash).not.toBe(bodyB.data.context.contextKeyHash);

      const statusA = await runCli(['status', '--output', 'json'], envA, cwd);
      const statusB = await runCli(['status', '--output', 'json'], envB, cwd);

      expect(parseEnvelope(statusA.stdout).data.context.contextKeyHash).not.toBe(
        parseEnvelope(statusB.stdout).data.context.contextKeyHash
      );
    } finally {
      await runCli(['stop', '--output', 'json'], envA, cwd);
      await runCli(['stop', '--output', 'json'], envB, cwd);
      await runCli(['daemon', 'stop', '--output', 'json'], envA, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it('runs Phase 2 MVP browser commands end-to-end', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'cdt-e2e-'));

    const env = {
      ...process.env,
      BROWSER_HOME: tempHome,
      CDT_CONTEXT_ID: 'phase2-e2e'
    };

    const html = [
      '<html><head><title>CDT Phase2</title></head><body>',
      '<input id="q" value="" />',
      "<button id=\"btn\" onclick=\"window.__clicked=true;document.querySelector('#status').textContent='Clicked'\">Go</button>",
      '<p id="status">Ready</p>',
      '<script>window.__clicked=false;</script>',
      '</body></html>'
    ].join('');

    const dataUrl = `data:text/html,${encodeURIComponent(html)}`;

    try {
      const start = await runCli(['start', '--headless', '--output', 'json'], env, cwd);
      expect(start.code).toBe(0);

      const opened = await runCli(['open', dataUrl, '--output', 'json'], env, cwd);
      expect(opened.code).toBe(0);

      const evalTitle = await runCli(
        ['runtime', 'eval', '--function', '() => document.title', '--output', 'json'],
        env,
        cwd
      );
      expect(evalTitle.code).toBe(0);
      expect((parseEnvelope(evalTitle.stdout).data as { value: string }).value).toBe('CDT Phase2');

      const fill = await runCli(
        ['element', 'fill', '--uid', '#q', '--value', 'hello', '--output', 'json'],
        env,
        cwd
      );
      expect(fill.code).toBe(0);

      const focus = await runCli(
        [
          'runtime',
          'eval',
          '--function',
          "() => { const el = document.querySelector('#q'); if (el && typeof el.focus === 'function') { el.focus(); } return document.activeElement && document.activeElement.id; }",
          '--output',
          'json'
        ],
        env,
        cwd
      );
      expect(focus.code).toBe(0);

      const key = await runCli(['press', 'A', '--output', 'json'], env, cwd);
      expect(key.code).toBe(0);

      const snapshotText = await runCli(['snapshot'], env, cwd);
      expect(snapshotText.code).toBe(0);
      const buttonRef = findRefByText(snapshotText.stdout, 'Go');

      const click = await runCli(['click', buttonRef, '--output', 'json'], env, cwd);
      expect(click.code).toBe(0);

      const waitText = await runCli(
        ['page', 'wait-text', '--text', 'Clicked', '--timeout', '3000', '--output', 'json'],
        env,
        cwd
      );
      expect(waitText.code).toBe(0);

      const checkState = await runCli(
        [
          'runtime',
          'eval',
          '--function',
          "() => ({ value: document.querySelector('#q') && document.querySelector('#q').value, clicked: window.__clicked === true })",
          '--output',
          'json'
        ],
        env,
        cwd
      );
      expect(checkState.code).toBe(0);
      const state = (parseEnvelope(checkState.stdout).data as { value: { value: string; clicked: boolean } }).value;
      expect(state.value).toContain('hello');
      expect(state.clicked).toBe(true);

      const snapshot = await runCli(['snapshot', '--output', 'json'], env, cwd);
      expect(snapshot.code).toBe(0);
      const snapshotBody = parseEnvelope(snapshot.stdout);
      expect((snapshotBody.data as { snapshot?: { text?: string } }).snapshot?.text ?? '').toContain('[ref=');

      const listed = await runCli(['tabs', '--output', 'json'], env, cwd);
      expect(listed.code).toBe(0);
      const tabs = (parseEnvelope(listed.stdout).data as { tabs: Array<{ index: number }> }).tabs;
      expect(tabs.length).toBeGreaterThan(0);
    } finally {
      await runCli(['stop', '--output', 'json'], env, cwd);
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it('reuses same context across sequential commands without CDT_CONTEXT_ID', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'cdt-shellctx-'));

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      BROWSER_HOME: tempHome
    };

    delete env.CDT_CONTEXT_ID;

    const html = '<html><head><title>Shell Context</title></head><body><h1>ok</h1></body></html>';
    const dataUrl = `data:text/html,${encodeURIComponent(html)}`;

    try {
      const started = await runCli(['start', '--headless', '--output', 'json'], env, cwd);
      expect(started.code).toBe(0);
      const startedBody = parseEnvelope(started.stdout);
      expect(startedBody.ok).toBe(true);
      expect(startedBody.data.context.resolvedBy).toBe('fingerprint');

      const opened = await runCli(['open', dataUrl, '--output', 'json'], env, cwd);
      expect(opened.code).toBe(0);
      const openedBody = parseEnvelope(opened.stdout);
      expect(openedBody.ok).toBe(true);

      const title = await runCli(
        ['runtime', 'eval', '--function', '() => document.title', '--output', 'json'],
        env,
        cwd
      );
      expect(title.code).toBe(0);
      expect((parseEnvelope(title.stdout).data as { value: string }).value).toBe('Shell Context');
    } finally {
      await runCli(['stop', '--output', 'json'], env, cwd);
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  });
});
