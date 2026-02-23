import { spawn } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type CliResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type CliEnvelope = {
  ok: boolean;
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

describe('help output behavior', () => {
  it('prints help for root and help alias', async () => {
    const cwd = process.cwd();
    const env = { ...process.env };

    const root = await runCli([], env, cwd);
    expect(root.code).toBe(0);
    expect(root.stdout).toContain('Usage: browser');

    const rootHelp = await runCli(['help'], env, cwd);
    expect(rootHelp.code).toBe(0);
    expect(rootHelp.stdout).toContain('Usage: browser');
  });

  it('prints help when required arguments are missing', async () => {
    const cwd = process.cwd();
    const env = { ...process.env };

    const tab = await runCli(['tab'], env, cwd);
    expect(tab.code).toBe(0);
    expect(tab.stdout).toContain('Usage: browser tab');

    const tabSelect = await runCli(['tab', 'select'], env, cwd);
    expect(tabSelect.code).toBe(0);
    expect(tabSelect.stdout).toContain('Usage: browser tab select');
    expect(tabSelect.stdout).toContain('<index>');
  });

  it('prints error and command help when arguments are invalid', async () => {
    const cwd = process.cwd();
    const env = { ...process.env };

    const invalid = await runCli(['tab', 'select', 'abc'], env, cwd);
    expect(invalid.code).toBe(2);
    expect(invalid.stdout).toContain('error(VALIDATION_ERROR): Invalid tab index: abc');
    expect(invalid.stderr).toContain('Usage: browser tab select');
  });

  it('keeps json error envelope and prints help to stderr for invalid arguments', async () => {
    const cwd = process.cwd();
    const env = { ...process.env };

    const invalid = await runCli(['tab', 'select', 'abc', '--output', 'json'], env, cwd);
    expect(invalid.code).toBe(2);
    const body = parseEnvelope(invalid.stdout);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(invalid.stderr).toContain('Usage: browser tab select');
  });
});
