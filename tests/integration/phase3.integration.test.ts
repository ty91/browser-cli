import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';

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

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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

const handleRoot = (request: IncomingMessage, response: ServerResponse): void => {
  const html = [
    '<!doctype html>',
    '<html><head><title>CDT Phase3</title></head><body>',
    '<div id="hover-target">Hover Me</div>',
    '<div id="hover-status">idle</div>',
    '<div id="drag-source" draggable="true">drag</div>',
    '<div id="drop-target">drop</div>',
    '<div id="drop-status">not-dropped</div>',
    '<input id="first" value="" />',
    '<input id="second" value="" />',
    '<input id="file-input" type="file" />',
    '<div id="file-name">none</div>',
    '<div id="dialog-result">none</div>',
    '<script>',
    "window.__hovered = false; window.__dropped = false;",
    "document.querySelector('#hover-target').addEventListener('mouseenter', () => {",
    "  window.__hovered = true; document.querySelector('#hover-status').textContent = 'Hovered';",
    '});',
    "document.querySelector('#drag-source').addEventListener('dragstart', (event) => {",
    "  if (event.dataTransfer) { event.dataTransfer.setData('text/plain', 'drag'); }",
    '});',
    "document.querySelector('#drop-target').addEventListener('dragover', (event) => event.preventDefault());",
    "document.querySelector('#drop-target').addEventListener('drop', (event) => {",
    '  event.preventDefault();',
    "  window.__dropped = true; document.querySelector('#drop-status').textContent = 'Dropped';",
    '});',
    "document.querySelector('#file-input').addEventListener('change', (event) => {",
    '  const target = event.target;',
    '  const file = target && "files" in target ? target.files && target.files[0] : null;',
    "  document.querySelector('#file-name').textContent = file ? file.name : 'none';",
    '});',
    "console.log('phase3-console:boot');",
    '</script>',
    '</body></html>'
  ].join('');

  response.statusCode = 200;
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(html);
};

const startFixtureServer = async (): Promise<{ origin: string; close: () => Promise<void> }> => {
  const server: Server = createServer(async (request, response) => {
    if (request.url === '/api/ping' && request.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }

      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(
        JSON.stringify({
          ok: true,
          body: Buffer.concat(chunks).toString('utf8')
        })
      );
      return;
    }

    handleRoot(request, response);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Fixture server failed to start.');
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

describe.skipIf(!hasChrome)('phase 3 integration', () => {
  it('supports remaining parity commands end-to-end', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'cdt-phase3-'));
    const tempFiles = await mkdtemp(path.join(os.tmpdir(), 'cdt-phase3-files-'));
    const fixture = await startFixtureServer();

    const env = {
      ...process.env,
      BROWSER_HOME: tempHome,
      CDT_CONTEXT_ID: 'phase3-e2e'
    };

    const uploadPath = path.join(tempFiles, 'upload.txt');
    const fillEntriesPath = path.join(tempFiles, 'entries.json');
    const screenshotPath = path.join(tempFiles, 'screen.png');
    const tracePath = path.join(tempFiles, 'trace.json');
    const requestBodyPath = path.join(tempFiles, 'request.txt');
    const responseBodyPath = path.join(tempFiles, 'response.txt');

    await writeFile(uploadPath, 'upload-body', 'utf8');
    await writeFile(
      fillEntriesPath,
      JSON.stringify([
        { selector: '#first', value: 'alpha' },
        { selector: '#second', value: 'beta' }
      ]),
      'utf8'
    );

    try {
      const start = await runCli(['start', '--headless', '--output', 'json'], env, cwd);
      expect(start.code).toBe(0);

      const openMain = await runCli(['page', 'open', '--url', fixture.origin, '--output', 'json'], env, cwd);
      expect(openMain.code).toBe(0);
      const openMainBody = parseEnvelope(openMain.stdout);
      const mainPageId = Number(
        ((openMainBody.data as { page?: { id?: number } })?.page?.id as number | undefined) ?? 0
      );
      expect(mainPageId).toBeGreaterThan(0);

      const openSecond = await runCli(
        ['page', 'open', '--url', `${fixture.origin}/second`, '--output', 'json'],
        env,
        cwd
      );
      expect(openSecond.code).toBe(0);
      const secondPageId = Number(
        ((parseEnvelope(openSecond.stdout).data as { page?: { id?: number } })?.page?.id as number | undefined) ?? 0
      );
      expect(secondPageId).toBeGreaterThan(0);

      const closeSecond = await runCli(
        ['page', 'close', '--page', String(secondPageId), '--output', 'json'],
        env,
        cwd
      );
      expect(closeSecond.code).toBe(0);

      const useMain = await runCli(['page', 'use', '--page', String(mainPageId), '--output', 'json'], env, cwd);
      expect(useMain.code).toBe(0);

      const resize = await runCli(
        ['page', 'resize', '--page', String(mainPageId), '--width', '900', '--height', '700', '--output', 'json'],
        env,
        cwd
      );
      expect(resize.code).toBe(0);

      const fillForm = await runCli(
        ['element', 'fill-form', '--page', String(mainPageId), '--entries-file', fillEntriesPath, '--output', 'json'],
        env,
        cwd
      );
      expect(fillForm.code).toBe(0);

      const hover = await runCli(
        ['element', 'hover', '--page', String(mainPageId), '--uid', '#hover-target', '--output', 'json'],
        env,
        cwd
      );
      expect(hover.code).toBe(0);

      const hoverWait = await runCli(
        ['page', 'wait-text', '--page', String(mainPageId), '--text', 'Hovered', '--timeout', '3000', '--output', 'json'],
        env,
        cwd
      );
      expect(hoverWait.code).toBe(0);

      const drag = await runCli(
        [
          'element',
          'drag',
          '--page',
          String(mainPageId),
          '--from',
          '#drag-source',
          '--to',
          '#drop-target',
          '--output',
          'json'
        ],
        env,
        cwd
      );
      expect(drag.code).toBe(0);

      const dropWait = await runCli(
        ['page', 'wait-text', '--page', String(mainPageId), '--text', 'Dropped', '--timeout', '3000', '--output', 'json'],
        env,
        cwd
      );
      expect(dropWait.code).toBe(0);

      const upload = await runCli(
        ['element', 'upload', '--page', String(mainPageId), '--uid', '#file-input', '--file', uploadPath, '--output', 'json'],
        env,
        cwd
      );
      expect(upload.code).toBe(0);

      const uploadWait = await runCli(
        ['page', 'wait-text', '--page', String(mainPageId), '--text', 'upload.txt', '--timeout', '3000', '--output', 'json'],
        env,
        cwd
      );
      expect(uploadWait.code).toBe(0);

      const promptTrigger = await runCli(
        [
          'runtime',
          'eval',
          '--page',
          String(mainPageId),
          '--function',
          "() => { setTimeout(() => { const value = prompt('Name?', 'anon'); const el = document.querySelector('#dialog-result'); if (el) { el.textContent = value || 'none'; } }, 0); return true; }",
          '--output',
          'json'
        ],
        env,
        cwd
      );
      expect(promptTrigger.code).toBe(0);

      let dialogHandled = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const dialogHandle = await runCli(
          [
            'dialog',
            'handle',
            '--page',
            String(mainPageId),
            '--action',
            'accept',
            '--prompt-text',
            'CDT',
            '--output',
            'json'
          ],
          env,
          cwd
        );

        if (dialogHandle.code === 0) {
          dialogHandled = true;
          break;
        }

        const envelope = parseEnvelope(dialogHandle.stdout);
        if (envelope.error?.code !== 'DIALOG_NOT_OPEN') {
          throw new Error(`Unexpected dialog error: ${dialogHandle.stdout}`);
        }

        await wait(100);
      }
      expect(dialogHandled).toBe(true);

      const dialogWait = await runCli(
        ['page', 'wait-text', '--page', String(mainPageId), '--text', 'CDT', '--timeout', '3000', '--output', 'json'],
        env,
        cwd
      );
      expect(dialogWait.code).toBe(0);

      const screenshot = await runCli(
        ['capture', 'screenshot', '--page', String(mainPageId), '--file', screenshotPath, '--full-page', '--output', 'json'],
        env,
        cwd
      );
      expect(screenshot.code).toBe(0);
      expect((await stat(screenshotPath)).size).toBeGreaterThan(0);

      const consoleEval = await runCli(
        [
          'runtime',
          'eval',
          '--page',
          String(mainPageId),
          '--function',
          "() => { console.log('phase3-console:marker'); return true; }",
          '--output',
          'json'
        ],
        env,
        cwd
      );
      expect(consoleEval.code).toBe(0);

      let consoleId = 0;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const consoleList = await runCli(['console', 'list', '--limit', '100', '--output', 'json'], env, cwd);
        expect(consoleList.code).toBe(0);
        const messages = ((parseEnvelope(consoleList.stdout).data as { messages?: Array<{ id: number; text: string }> })
          ?.messages ?? []) as Array<{ id: number; text: string }>;
        const marker = messages.find((message) => message.text.includes('phase3-console:marker'));
        if (marker) {
          consoleId = marker.id;
          break;
        }
        await wait(100);
      }
      expect(consoleId).toBeGreaterThan(0);

      const consoleGet = await runCli(['console', 'get', '--id', String(consoleId), '--output', 'json'], env, cwd);
      expect(consoleGet.code).toBe(0);
      expect(
        (((parseEnvelope(consoleGet.stdout).data as { message?: { text?: string } })?.message?.text as string | undefined) ?? '')
          .includes('phase3-console:marker')
      ).toBe(true);

      const networkEval = await runCli(
        [
          'runtime',
          'eval',
          '--page',
          String(mainPageId),
          '--function',
          "() => fetch('/api/ping', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'phase3-body' }).then((res) => res.text())",
          '--output',
          'json'
        ],
        env,
        cwd
      );
      expect(networkEval.code).toBe(0);

      let networkId = 0;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const networkList = await runCli(
          ['network', 'list', '--method', 'POST', '--limit', '100', '--output', 'json'],
          env,
          cwd
        );
        expect(networkList.code).toBe(0);
        const requests = ((parseEnvelope(networkList.stdout).data as { requests?: Array<{ id: number; url: string }> })
          ?.requests ?? []) as Array<{ id: number; url: string }>;
        const apiCall = requests.find((request) => request.url.includes('/api/ping'));
        if (apiCall) {
          networkId = apiCall.id;
          break;
        }
        await wait(100);
      }
      expect(networkId).toBeGreaterThan(0);

      const networkGet = await runCli(
        [
          'network',
          'get',
          '--id',
          String(networkId),
          '--request-file',
          requestBodyPath,
          '--response-file',
          responseBodyPath,
          '--output',
          'json'
        ],
        env,
        cwd
      );
      expect(networkGet.code).toBe(0);
      expect(await readFile(requestBodyPath, 'utf8')).toContain('phase3-body');
      expect(await readFile(responseBodyPath, 'utf8')).toContain('"ok":true');

      const emulationSet = await runCli(
        [
          'emulation',
          'set',
          '--viewport',
          '640x480',
          '--user-agent',
          'cdt-phase3-agent',
          '--network',
          'Fast 3G',
          '--geolocation',
          '37.7749,-122.4194',
          '--output',
          'json'
        ],
        env,
        cwd
      );
      expect(emulationSet.code).toBe(0);

      const emulationCheck = await runCli(
        [
          'runtime',
          'eval',
          '--page',
          String(mainPageId),
          '--function',
          "() => ({ width: window.innerWidth, ua: navigator.userAgent })",
          '--output',
          'json'
        ],
        env,
        cwd
      );
      expect(emulationCheck.code).toBe(0);
      const emulationValue = (parseEnvelope(emulationCheck.stdout).data as { value?: { width?: number; ua?: string } })
        ?.value;
      expect(emulationValue?.width).toBe(640);
      expect(emulationValue?.ua?.includes('cdt-phase3-agent')).toBe(true);

      const emulationReset = await runCli(['emulation', 'reset', '--output', 'json'], env, cwd);
      expect(emulationReset.code).toBe(0);

      const traceStart = await runCli(
        ['trace', 'start', '--page', String(mainPageId), '--file', tracePath, '--output', 'json'],
        env,
        cwd
      );
      expect(traceStart.code).toBe(0);

      const traceWork = await runCli(
        [
          'runtime',
          'eval',
          '--page',
          String(mainPageId),
          '--function',
          "() => { for (let i = 0; i < 100; i += 1) { Math.sqrt(i * 99); } return true; }",
          '--output',
          'json'
        ],
        env,
        cwd
      );
      expect(traceWork.code).toBe(0);

      const traceStop = await runCli(['trace', 'stop', '--output', 'json'], env, cwd);
      expect(traceStop.code).toBe(0);
      expect((await stat(tracePath)).size).toBeGreaterThan(0);

      const insight = await runCli(
        ['trace', 'insight', '--file', tracePath, '--insight', 'overview', '--output', 'json'],
        env,
        cwd
      );
      expect(insight.code).toBe(0);
      const insightSummary = (parseEnvelope(insight.stdout).data as { summary?: { eventCount?: number } })?.summary;
      expect((insightSummary?.eventCount ?? 0) > 0).toBe(true);
    } finally {
      await runCli(['stop', '--output', 'json'], env, cwd);
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await fixture.close();
      await rm(tempHome, { recursive: true, force: true });
      await rm(tempFiles, { recursive: true, force: true });
    }
  }, 90_000);
});
