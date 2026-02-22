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

describe.skipIf(!hasChrome)('session integration', () => {
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

  it('runs Phase 2 MVP browser commands end-to-end', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'cdt-e2e-'));

    const env = {
      ...process.env,
      CDT_HOME: tempHome,
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
      const start = await runCli(['session', 'start', '--output', 'json'], env, cwd);
      expect(start.code).toBe(0);

      const opened = await runCli(['page', 'open', '--url', dataUrl, '--output', 'json'], env, cwd);
      expect(opened.code).toBe(0);
      const openBody = parseEnvelope(opened.stdout);
      const openedPage = (openBody.data as { page: { id: number } }).page;

      const evalTitle = await runCli(
        ['runtime', 'eval', '--page', String(openedPage.id), '--function', '() => document.title', '--output', 'json'],
        env,
        cwd
      );
      expect(evalTitle.code).toBe(0);
      expect((parseEnvelope(evalTitle.stdout).data as { value: string }).value).toBe('CDT Phase2');

      const fill = await runCli(
        ['element', 'fill', '--page', String(openedPage.id), '--uid', '#q', '--value', 'hello', '--output', 'json'],
        env,
        cwd
      );
      expect(fill.code).toBe(0);

      const focus = await runCli(
        [
          'runtime',
          'eval',
          '--page',
          String(openedPage.id),
          '--function',
          "() => { const el = document.querySelector('#q'); if (el && typeof el.focus === 'function') { el.focus(); } return document.activeElement && document.activeElement.id; }",
          '--output',
          'json'
        ],
        env,
        cwd
      );
      expect(focus.code).toBe(0);

      const key = await runCli(
        ['input', 'key', '--page', String(openedPage.id), '--key', 'A', '--output', 'json'],
        env,
        cwd
      );
      expect(key.code).toBe(0);

      const click = await runCli(
        ['element', 'click', '--page', String(openedPage.id), '--uid', '#btn', '--output', 'json'],
        env,
        cwd
      );
      expect(click.code).toBe(0);

      const waitText = await runCli(
        ['page', 'wait-text', '--page', String(openedPage.id), '--text', 'Clicked', '--timeout', '3000', '--output', 'json'],
        env,
        cwd
      );
      expect(waitText.code).toBe(0);

      const checkState = await runCli(
        [
          'runtime',
          'eval',
          '--page',
          String(openedPage.id),
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

      const snapshot = await runCli(
        ['capture', 'snapshot', '--page', String(openedPage.id), '--output', 'json'],
        env,
        cwd
      );
      expect(snapshot.code).toBe(0);
      const snapshotBody = parseEnvelope(snapshot.stdout);
      expect((snapshotBody.data as { snapshot: { html: string } }).snapshot.html).toContain('id="q"');

      const listed = await runCli(['page', 'list', '--output', 'json'], env, cwd);
      expect(listed.code).toBe(0);
      const pages = (parseEnvelope(listed.stdout).data as { pages: Array<{ id: number }> }).pages;
      expect(pages.some((item) => item.id === openedPage.id)).toBe(true);
    } finally {
      await runCli(['session', 'stop', '--output', 'json'], env, cwd);
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  });
});
