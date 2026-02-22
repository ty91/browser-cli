import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, stat } from 'node:fs/promises';

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

const parseEnvelope = (stdout: string): CliEnvelope => JSON.parse(stdout) as CliEnvelope;

const startFixtureServer = async (): Promise<{ origin: string; close: () => Promise<void> }> => {
  const server: Server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url?.startsWith('/api/ping') && request.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }

      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: true, body: Buffer.concat(chunks).toString('utf8') }));
      return;
    }

    const html = [
      '<!doctype html>',
      '<html><head><title>Loop Primitives</title></head><body style="margin:0">',
      '<button id="run" style="position:fixed;left:20px;top:20px;z-index:10">Run</button>',
      '<input id="name" style="position:fixed;left:100px;top:20px;z-index:10" />',
      '<div id="status">idle</div>',
      '<div id="scroll-y">0</div>',
      '<div style="height:3200px"></div>',
      '<script>',
      "window.addEventListener('scroll', () => {",
      "  const y = Math.round(window.scrollY || 0);",
      "  document.querySelector('#scroll-y').textContent = String(y);",
      '});',
      "document.querySelector('#run').addEventListener('click', async () => {",
      "  document.querySelector('#status').textContent = 'clicked';",
      "  console.log('loop:clicked');",
      "  await fetch('/api/ping', { method: 'POST', body: 'loop-body' });",
      "  setTimeout(() => {",
      "    const done = document.createElement('div');",
      "    done.id = 'done';",
      "    done.textContent = 'Ready';",
      '    document.body.appendChild(done);',
      "    history.pushState({}, '', '/done');",
      '  }, 120);',
      '});',
      '</script>',
      '</body></html>'
    ].join('');

    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(html);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Fixture server failed to start');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
};

const hasChrome = BrowserSlotManager.resolveChromePath() !== null;

describe.skipIf(!hasChrome)('loop primitives integration', () => {
  it('supports observe, coordinate actions, waits, and screenshot metadata', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'cdt-loop-'));
    const tempArtifacts = await mkdtemp(path.join(os.tmpdir(), 'cdt-loop-artifacts-'));
    const fixture = await startFixtureServer();

    const env = {
      ...process.env,
      CDT_HOME: tempHome,
      CDT_CONTEXT_ID: 'loop-primitives'
    };

    try {
      const start = await runCli(['session', 'start', '--headless', '--output', 'json'], env, cwd);
      expect(start.code).toBe(0);

      const open = await runCli(['page', 'open', '--url', fixture.origin, '--output', 'json'], env, cwd);
      expect(open.code).toBe(0);

      const observeState = await runCli(['observe', 'state', '--output', 'json'], env, cwd);
      expect(observeState.code).toBe(0);
      const stateValue = parseEnvelope(observeState.stdout).data as {
        state?: { viewport?: { width?: number; height?: number } };
      };
      expect((stateValue.state?.viewport?.width ?? 0) > 0).toBe(true);

      const observeTargets = await runCli(['observe', 'targets', '--limit', '50', '--output', 'json'], env, cwd);
      expect(observeTargets.code).toBe(0);
      const targets = (((parseEnvelope(observeTargets.stdout).data as { targets?: Array<{ text: string }> })?.targets ??
        []) as Array<{ text: string }>);
      expect(targets.some((target) => target.text.includes('Run'))).toBe(true);

      const getRunCenter = await runCli(
        [
          'runtime',
          'eval',
          '--function',
          "() => { const rect = document.querySelector('#run').getBoundingClientRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }; }",
          '--output',
          'json'
        ],
        env,
        cwd
      );
      expect(getRunCenter.code).toBe(0);
      const center = (parseEnvelope(getRunCenter.stdout).data as { value: { x: number; y: number } }).value;

      const click = await runCli(
        ['input', 'click', '--x', String(center.x), '--y', String(center.y), '--output', 'json'],
        env,
        cwd
      );
      expect(click.code).toBe(0);

      const waitText = await runCli(['page', 'wait-text', '--text', 'clicked', '--timeout', '5000', '--output', 'json'], env, cwd);
      expect(waitText.code).toBe(0);

      const waitConsole = await runCli(
        ['console', 'wait', '--pattern', 'loop:clicked', '--timeout', '5000', '--output', 'json'],
        env,
        cwd
      );
      expect(waitConsole.code).toBe(0);

      const waitNetwork = await runCli(
        ['network', 'wait', '--match', '/api/ping', '--method', 'POST', '--status', '200', '--timeout', '5000', '--output', 'json'],
        env,
        cwd
      );
      expect(waitNetwork.code).toBe(0);

      const waitSelector = await runCli(
        ['page', 'wait-selector', '--selector', '#done', '--timeout', '5000', '--output', 'json'],
        env,
        cwd
      );
      expect(waitSelector.code).toBe(0);

      const waitUrl = await runCli(
        ['page', 'wait-url', '--pattern', '/done', '--timeout', '5000', '--output', 'json'],
        env,
        cwd
      );
      expect(waitUrl.code).toBe(0);

      const focusInput = await runCli(
        ['runtime', 'eval', '--function', "() => { const el = document.querySelector('#name'); el.focus(); return true; }", '--output', 'json'],
        env,
        cwd
      );
      expect(focusInput.code).toBe(0);

      const type = await runCli(['input', 'type', '--text', 'hello-loop', '--output', 'json'], env, cwd);
      expect(type.code).toBe(0);

      const readInput = await runCli(
        ['runtime', 'eval', '--function', "() => document.querySelector('#name').value", '--output', 'json'],
        env,
        cwd
      );
      expect(readInput.code).toBe(0);
      expect((parseEnvelope(readInput.stdout).data as { value: string }).value).toBe('hello-loop');

      const scroll = await runCli(['input', 'scroll', '--dy', '900', '--output', 'json'], env, cwd);
      expect(scroll.code).toBe(0);

      const readScroll = await runCli(
        ['runtime', 'eval', '--function', "() => Number(document.querySelector('#scroll-y').textContent || '0')", '--output', 'json'],
        env,
        cwd
      );
      expect(readScroll.code).toBe(0);
      expect((parseEnvelope(readScroll.stdout).data as { value: number }).value).toBeGreaterThan(0);

      const screenshot = await runCli(
        [
          'capture',
          'screenshot',
          '--dir',
          tempArtifacts,
          '--label',
          'loop',
          '--max-width',
          '600',
          '--max-height',
          '400',
          '--keep',
          '5',
          '--output',
          'json'
        ],
        env,
        cwd
      );
      expect(screenshot.code).toBe(0);
      const shotData = parseEnvelope(screenshot.stdout).data as {
        filePath: string;
        bytes: number;
        sha256: string;
        width: number | null;
        height: number | null;
        resized: boolean;
      };
      expect(shotData.sha256.length).toBe(64);
      expect(shotData.bytes).toBeGreaterThan(0);
      expect(await stat(shotData.filePath)).toBeTruthy();
      expect(typeof shotData.resized).toBe('boolean');
      expect(shotData.width === null || shotData.width > 0).toBe(true);
      expect(shotData.height === null || shotData.height > 0).toBe(true);
    } finally {
      await runCli(['session', 'stop', '--output', 'json'], env, cwd);
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await fixture.close();
      await rm(tempHome, { recursive: true, force: true });
      await rm(tempArtifacts, { recursive: true, force: true });
    }
  }, 60_000);
});
