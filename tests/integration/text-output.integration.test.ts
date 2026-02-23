import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, rm } from 'node:fs/promises';

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
    suggestions?: string[];
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

describe.skipIf(!hasChrome)('default text output', () => {
  it('prints concise human-readable text for recent commands', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'cdt-text-'));

    const env = {
      ...process.env,
      BROWSER_HOME: tempHome,
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
  it('prints concise text for daemon start/status/stop', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'cdt-daemon-text-'));

    const env = {
      ...process.env,
      BROWSER_HOME: tempHome
    };

    try {
      const statusBefore = await runCli(['daemon', 'status'], env, cwd);
      expect(statusBefore.code).toBe(0);
      expect(statusBefore.stdout.toLowerCase()).toContain('daemon stopped');

      const start = await runCli(['daemon', 'start'], env, cwd);
      expect(start.code).toBe(0);
      expect(start.stdout.toLowerCase()).toContain('daemon running');
      expect(start.stdout.toLowerCase()).toContain('pid:');

      const statusRunning = await runCli(['daemon', 'status'], env, cwd);
      expect(statusRunning.code).toBe(0);
      expect(statusRunning.stdout.toLowerCase()).toContain('daemon running');
      expect(statusRunning.stdout.toLowerCase()).toContain('socket:');

      const stop = await runCli(['daemon', 'stop'], env, cwd);
      expect(stop.code).toBe(0);
      expect(stop.stdout.toLowerCase()).toContain('daemon stopped');

      const stopAgain = await runCli(['daemon', 'stop'], env, cwd);
      expect(stopAgain.code).toBe(0);
      expect(stopAgain.stdout.toLowerCase()).toContain('daemon already stopped');
    } finally {
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it('restarts daemon and prints concise text output by default', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'cdt-daemon-restart-'));

    const env = {
      ...process.env,
      BROWSER_HOME: tempHome
    };

    try {
      const start = await runCli(['daemon', 'start'], env, cwd);
      expect(start.code).toBe(0);

      const restart = await runCli(['daemon', 'restart'], env, cwd);
      expect(restart.code).toBe(0);
      expect(restart.stdout.toLowerCase()).toContain('daemon restarted');
      expect(restart.stdout.toLowerCase()).toContain('pid:');

      const status = await runCli(['daemon', 'status', '--output', 'json'], env, cwd);
      expect(status.code).toBe(0);
      const statusBody = parseEnvelope(status.stdout);
      expect(statusBody.ok).toBe(true);
      const data = (statusBody.data ?? {}) as { running?: boolean; pid?: number };
      expect(data.running).not.toBe(false);
      expect(typeof data.pid).toBe('number');
    } finally {
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasChrome)('screenshot command', () => {
  it('saves jpeg file under browser home and prints concise text output', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'browser-screenshot-'));

    const env = {
      ...process.env,
      BROWSER_HOME: tempHome,
      CDT_CONTEXT_ID: 'screenshot-output'
    };

    const pageA = 'data:text/html,%3Chtml%3E%3Chead%3E%3Ctitle%3EShotA%3C/title%3E%3C/head%3E%3Cbody%3EA%3C/body%3E%3C/html%3E';

    try {
      const start = await runCli(['start', '--headless'], env, cwd);
      expect(start.code).toBe(0);

      const open = await runCli(['open', pageA], env, cwd);
      expect(open.code).toBe(0);

      const shot = await runCli(['screenshot'], env, cwd);
      expect(shot.code).toBe(0);
      const shotMatch = shot.stdout.match(
        /^screenshot saved: (.+screenshot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9]{6}\.jpg)$/
      );
      expect(shotMatch).not.toBeNull();
      const shotPath = shotMatch?.[1];
      expect(shotPath).toBeDefined();
      expect(shotPath?.startsWith(path.join(tempHome, 'screenshots'))).toBe(true);
      if (shotPath) {
        await access(shotPath);
      }

      const shotTab2 = await runCli(['screenshot', '--tab', '2', '--full'], env, cwd);
      expect(shotTab2.code).toBe(0);
      const shotTab2Match = shotTab2.stdout.match(
        /^screenshot saved: (.+screenshot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9]{6}\.jpg)$/
      );
      expect(shotTab2Match).not.toBeNull();
      const shotTab2Path = shotTab2Match?.[1];
      expect(shotTab2Path).toBeDefined();
      if (shotTab2Path) {
        await access(shotTab2Path);
      }

    } finally {
      await runCli(['stop', '--output', 'json'], env, cwd);
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  }, 45_000);
});

describe.skipIf(!hasChrome)('snapshot command', () => {
  it('prints ref-based snapshot and truncates after 1500 lines', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'browser-snapshot-'));

    const env = {
      ...process.env,
      BROWSER_HOME: tempHome,
      CDT_CONTEXT_ID: 'snapshot-output'
    };

    const smallPage = 'data:text/html,%3Chtml%3E%3Chead%3E%3Ctitle%3ESnapshotSmall%3C/title%3E%3C/head%3E%3Cbody%3E%3Cbutton%3EOne%3C/button%3E%3C/body%3E%3C/html%3E';
    const pageHtml = `<!doctype html><html><head><title>SnapshotBig</title></head><body><main id="root"></main><script>const root=document.getElementById("root");for(let i=0;i<6000;i++){const b=document.createElement("button");b.textContent="Button "+i;root.appendChild(b);}</script></body></html>`;
    const pageUrl = `data:text/html,${encodeURIComponent(pageHtml)}`;

    try {
      const start = await runCli(['start', '--headless'], env, cwd);
      expect(start.code).toBe(0);

      const open = await runCli(['open', pageUrl], env, cwd);
      expect(open.code).toBe(0);

      const snapshot = await runCli(['snapshot'], env, cwd);
      expect(snapshot.code).toBe(0);
      expect(snapshot.stdout).not.toContain('snapshot (do-not-commit)');
      expect(snapshot.stdout).toContain('url:');
      expect(snapshot.stdout).toMatch(/\[ref=e\d+\]/);
      const lines = snapshot.stdout.split('\n');
      expect(lines.length).toBeLessThanOrEqual(1500);

      const openSmall = await runCli(['open', smallPage], env, cwd);
      expect(openSmall.code).toBe(0);

      const snapshotJson = await runCli(['snapshot', '--output', 'json'], env, cwd);
      expect(snapshotJson.code).toBe(0);
      const body = parseEnvelope(snapshotJson.stdout);
      expect(body.ok).toBe(true);
      const snapshotData = (body.data as { snapshot?: Record<string, unknown> })?.snapshot ?? {};
      expect(snapshotData.format).toBe('playwright-aria');
      const snapshotText = snapshotData.text;
      expect(typeof snapshotText).toBe('string');
      expect(String(snapshotText)).toMatch(/\[ref=e\d+\]/);
      const truncated = snapshotData.truncated;
      const totalLines = snapshotData.totalLines;
      const outputLines = snapshotData.outputLines;
      expect(typeof truncated).toBe('boolean');
      expect(typeof totalLines).toBe('number');
      expect(typeof outputLines).toBe('number');
      expect(outputLines as number).toBeLessThanOrEqual(1500);
      expect(totalLines as number).toBeGreaterThanOrEqual(outputLines as number);
      if (truncated === true) {
        expect(outputLines).toBe(1500);
      } else {
        expect(totalLines).toBe(outputLines);
      }

    } finally {
      await runCli(['stop', '--output', 'json'], env, cwd);
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  }, 45_000);
});

describe.skipIf(!hasChrome)('ref action commands', () => {
  it('runs click/doubleclick/hover/fill/type/scrollintoview/press on selected tab', async () => {
    const cwd = process.cwd();
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'browser-ref-actions-'));

    const env = {
      ...process.env,
      BROWSER_HOME: tempHome,
      CDT_CONTEXT_ID: 'ref-actions-output'
    };

    const pageHtml = `<!doctype html><html><head><title>RefActions</title><style>body{margin:0;padding:0}#spacer{height:2400px}#deep{margin-top:24px}</style></head><body><button id="click">Click Target</button><button id="double">Double Target</button><div id="hover" role="button" tabindex="0">Hover Target</div><input id="type" aria-label="Type Target" /><div id="spacer"></div><button id="deep">Deep Target</button><script>window.__events={clickCount:0,doubleCount:0,hovered:false,inputValue:'',lastKey:'',deepInView:false};document.getElementById('click').addEventListener('click',()=>{window.__events.clickCount+=1;});document.getElementById('double').addEventListener('dblclick',()=>{window.__events.doubleCount+=1;});document.getElementById('hover').addEventListener('mouseenter',()=>{window.__events.hovered=true;});document.getElementById('type').addEventListener('input',(event)=>{window.__events.inputValue=event.target.value;});document.addEventListener('keydown',(event)=>{window.__events.lastKey=event.key;});window.__captureDeepInView=()=>{const rect=document.getElementById('deep').getBoundingClientRect();window.__events.deepInView=rect.top>=0&&rect.top<=window.innerHeight;};</script></body></html>`;
    const pageUrl = `data:text/html,${encodeURIComponent(pageHtml)}`;

    try {
      const start = await runCli(['start', '--headless'], env, cwd);
      expect(start.code).toBe(0);

      const open = await runCli(['open', pageUrl], env, cwd);
      expect(open.code).toBe(0);

      const snapshot = await runCli(['snapshot'], env, cwd);
      expect(snapshot.code).toBe(0);
      const clickRef = findRefByText(snapshot.stdout, 'Click Target');
      const doubleRef = findRefByText(snapshot.stdout, 'Double Target');
      const hoverRef = findRefByText(snapshot.stdout, 'Hover Target');
      const typeRef = findRefByText(snapshot.stdout, 'Type Target');
      const deepRef = findRefByText(snapshot.stdout, 'Deep Target');

      const click = await runCli(['click', clickRef], env, cwd);
      expect(click.code).toBe(0);
      expect(click.stdout).toBe(`clicked: ${clickRef}`);

      const doubleClick = await runCli(['doubleclick', doubleRef], env, cwd);
      expect(doubleClick.code).toBe(0);
      expect(doubleClick.stdout).toBe(`doubleclicked: ${doubleRef}`);

      const hover = await runCli(['hover', hoverRef], env, cwd);
      expect(hover.code).toBe(0);
      expect(hover.stdout).toBe(`hovered: ${hoverRef}`);

      const typedText = 'Hello Browser';
      const type = await runCli(['type', typeRef, typedText], env, cwd);
      expect(type.code).toBe(0);
      expect(type.stdout).toBe(`typed: ${typeRef} (${typedText.length} chars)`);

      const filledText = 'Overwritten Value';
      const fill = await runCli(['fill', typeRef, filledText], env, cwd);
      expect(fill.code).toBe(0);
      expect(fill.stdout).toBe(`filled: ${typeRef} (${filledText.length} chars)`);

      const press = await runCli(['press', 'Enter'], env, cwd);
      expect(press.code).toBe(0);
      expect(press.stdout).toBe('pressed: Enter');

      const scrollIntoView = await runCli(['scrollintoview', deepRef], env, cwd);
      expect(scrollIntoView.code).toBe(0);
      expect(scrollIntoView.stdout).toBe(`scrolled into view: ${deepRef}`);

      const captureInView = await runCli(
        ['runtime', 'eval', '--function', '() => { window.__captureDeepInView(); return true; }', '--output', 'json'],
        env,
        cwd
      );
      expect(captureInView.code).toBe(0);

      const runtime = await runCli(['runtime', 'eval', '--function', '() => window.__events', '--output', 'json'], env, cwd);
      expect(runtime.code).toBe(0);
      const runtimeBody = parseEnvelope(runtime.stdout);
      expect(runtimeBody.ok).toBe(true);
      const value = (runtimeBody.data ?? {}).value as {
        clickCount?: number;
        doubleCount?: number;
        hovered?: boolean;
        inputValue?: string;
        lastKey?: string;
        deepInView?: boolean;
      };
      expect(value.clickCount).toBe(1);
      expect(value.doubleCount).toBe(1);
      expect(value.hovered).toBe(true);
      expect(value.inputValue).toBe(filledText);
      expect(value.lastKey).toBe('Enter');
      expect(value.deepInView).toBe(true);

      const invalidRef = await runCli(['click', 'e999999', '--output', 'json'], env, cwd);
      expect(invalidRef.code).toBe(3);
      const invalidEnvelope = parseEnvelope(invalidRef.stdout);
      expect(invalidEnvelope.ok).toBe(false);
      expect(invalidEnvelope.error?.code).toBe('ELEMENT_NOT_FOUND');
      expect(invalidEnvelope.error?.suggestions ?? []).toContain('Run: browser snapshot');
    } finally {
      await runCli(['stop', '--output', 'json'], env, cwd);
      await runCli(['daemon', 'stop', '--output', 'json'], env, cwd);
      await rm(tempHome, { recursive: true, force: true });
    }
  }, 60_000);
});
