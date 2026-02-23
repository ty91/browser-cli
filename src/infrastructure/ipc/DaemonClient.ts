import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DaemonContext } from '../../shared/schema/common.js';
import { AppError } from '../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../shared/errors/ErrorCode.js';
import { PidFile } from '../store/PidFile.js';
import {
  resolveBrokerDir,
  resolveDaemonLogPath,
  resolveDaemonPidPath,
  resolveDaemonSocketPath
} from '../store/paths.js';
import { JsonlSocketClient } from './JsonlSocketClient.js';
import { IPC_OP } from './protocol.js';

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

export class DaemonClient {
  private readonly socketPath: string;
  private readonly pidFile: PidFile;
  private readonly logPath: string;

  public constructor(private readonly homeDir?: string) {
    this.socketPath = resolveDaemonSocketPath(homeDir);
    this.pidFile = new PidFile(resolveDaemonPidPath(homeDir));
    this.logPath = resolveDaemonLogPath(homeDir);
  }

  public async ensureRunning(context: DaemonContext): Promise<void> {
    if (await this.isReachable(context)) {
      return;
    }

    await this.startDetachedProcess();
    await this.waitUntilReady(context);
  }

  public async send(op: (typeof IPC_OP)[keyof typeof IPC_OP], payload: Record<string, unknown>, context: DaemonContext) {
    const client = new JsonlSocketClient(this.socketPath);
    return client.send(op, payload, context);
  }

  public async isReachable(context: DaemonContext): Promise<boolean> {
    try {
      const response = await this.send(IPC_OP.DAEMON_PING, {}, context);
      return response.ok;
    } catch {
      return false;
    }
  }

  public async stop(context: DaemonContext): Promise<boolean> {
    if (!(await this.isReachable(context))) {
      return false;
    }

    const response = await this.send(IPC_OP.DAEMON_STOP, {}, context);
    return response.ok;
  }

  public async stopAndWait(
    context: DaemonContext,
    timeoutMs = 5_000
  ): Promise<{ requestedStop: boolean; stopped: boolean }> {
    if (!(await this.isReachable(context))) {
      return {
        requestedStop: false,
        stopped: true
      };
    }

    const response = await this.send(IPC_OP.DAEMON_STOP, {}, context);
    if (!response.ok) {
      return {
        requestedStop: true,
        stopped: false
      };
    }

    await this.waitUntilStopped(context, timeoutMs);
    return {
      requestedStop: true,
      stopped: true
    };
  }

  private async startDetachedProcess(): Promise<void> {
    await mkdir(resolveBrokerDir(this.homeDir), { recursive: true });

    if (await this.pidFile.isAlive()) {
      return;
    }

    const thisFilePath = fileURLToPath(import.meta.url);
    const rootDir = path.resolve(path.dirname(thisFilePath), '../../..');
    const distEntry = path.join(rootDir, 'dist', 'bin', 'cdt-daemon.js');
    const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const srcEntry = path.join(rootDir, 'src', 'bin', 'cdt-daemon.ts');

    const isDistRuntime = thisFilePath.includes(`${path.sep}dist${path.sep}`);
    const shouldUseDistEntry = isDistRuntime && (await this.pathExists(distEntry));

    const daemonArgs = shouldUseDistEntry ? [distEntry] : [tsxCli, srcEntry];

    const child = spawn(process.execPath, daemonArgs, {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        BROWSER_HOME: this.homeDir ?? process.env.BROWSER_HOME,
        CDT_DAEMON_FOREGROUND: '0',
        CDT_DAEMON_LOG: this.logPath
      }
    });

    child.unref();
  }

  private async waitUntilReady(context: DaemonContext): Promise<void> {
    const timeoutMs = 5_000;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      if (await this.isReachable(context)) {
        return;
      }
      await sleep(80);
    }

    throw new AppError('Failed to start broker daemon.', {
      code: ERROR_CODE.DAEMON_UNAVAILABLE,
      details: { socketPath: this.socketPath, timeoutMs },
      suggestions: ['Check daemon log and retry: browser start --output json']
    });
  }

  private async waitUntilStopped(context: DaemonContext, timeoutMs: number): Promise<void> {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      if (!(await this.isReachable(context))) {
        return;
      }
      await sleep(80);
    }

    throw new AppError('Failed to stop broker daemon.', {
      code: ERROR_CODE.DAEMON_UNAVAILABLE,
      details: { socketPath: this.socketPath, timeoutMs },
      suggestions: ['Retry: browser daemon stop', 'If problem persists, wait briefly and run: browser daemon restart']
    });
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  public async socketExists(): Promise<boolean> {
    try {
      await access(this.socketPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
