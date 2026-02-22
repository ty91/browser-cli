import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { SessionService } from '../../application/session/SessionService.js';
import { ContextResolver } from '../../application/context/ContextResolver.js';
import { AppError } from '../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../shared/errors/ErrorCode.js';
import type { RequestEnvelope, ResponseEnvelope } from '../../shared/schema/envelopes.js';
import { daemonContextSchema } from '../../shared/schema/common.js';
import { PidFile } from '../store/PidFile.js';
import {
  resolveCdtHome,
  resolveBrokerDir,
  resolveDaemonLockPath,
  resolveDaemonPidPath,
  resolveDaemonSocketPath
} from '../store/paths.js';
import { LockFile } from '../store/LockFile.js';
import { IPC_OP } from './protocol.js';
import { JsonlSocketServer } from './JsonlSocketServer.js';

export type BrokerDaemonOptions = {
  homeDir?: string;
};

export class BrokerDaemon {
  private readonly homeDir: string;
  private readonly sessionService: SessionService;
  private readonly contextResolver = new ContextResolver();
  private readonly mutationQueues = new Map<string, Promise<void>>();
  private readonly pidFile: PidFile;
  private readonly startupLock: LockFile;

  private socketServer: JsonlSocketServer | null = null;
  private releaseStartupLock: (() => Promise<void>) | null = null;
  private shuttingDown = false;

  public constructor(options: BrokerDaemonOptions = {}) {
    this.homeDir = options.homeDir ?? resolveCdtHome();
    this.sessionService = new SessionService(this.homeDir);
    this.pidFile = new PidFile(resolveDaemonPidPath(this.homeDir));
    this.startupLock = new LockFile(resolveDaemonLockPath(this.homeDir));
  }

  public async start(): Promise<void> {
    await this.ensureDirectories();

    if (await this.pidFile.isAlive()) {
      throw new AppError('Daemon already running.', {
        code: ERROR_CODE.SESSION_ALREADY_RUNNING,
        details: { pidFile: resolveDaemonPidPath(this.homeDir) },
        suggestions: ['Use existing daemon or stop it first: cdt daemon stop']
      });
    }

    this.releaseStartupLock = await this.startupLock.acquire(2_000);
    await this.pidFile.write(process.pid);

    this.socketServer = new JsonlSocketServer(
      resolveDaemonSocketPath(this.homeDir),
      async (request) => this.handleRequest(request)
    );

    try {
      await this.socketServer.start();
    } catch (error) {
      await this.cleanupArtifacts();
      throw error;
    }

    this.attachSignalHandlers();
  }

  public async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;

    if (this.socketServer) {
      await this.socketServer.close();
      this.socketServer = null;
    }

    await this.cleanupArtifacts();
  }

  private async handleRequest(request: RequestEnvelope): Promise<ResponseEnvelope> {
    const started = Date.now();

    try {
      const context = daemonContextSchema.parse(request.context);

      if (request.op === IPC_OP.DAEMON_PING || request.op === IPC_OP.DAEMON_STATUS) {
        return {
          id: request.id,
          ok: true,
          data: {
            pid: process.pid,
            socketPath: resolveDaemonSocketPath(this.homeDir),
            uptimeMs: Math.max(0, Math.floor(process.uptime() * 1000))
          },
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.DAEMON_STOP) {
        setTimeout(() => {
          void this.shutdown();
        }, 10);

        return {
          id: request.id,
          ok: true,
          data: { stopped: true, pid: process.pid },
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.SESSION_START) {
        const payload = request.payload as { headless?: boolean };
        const resolved = this.contextResolver.resolve(context);
        const data = await this.runWithQueue(resolved.contextKeyHash, async () =>
          this.sessionService.start({
            ...context,
            headless: payload.headless
          })
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.SESSION_STATUS) {
        const data = await this.sessionService.status(context);
        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.SESSION_STOP) {
        const resolved = this.contextResolver.resolve(context);
        const data = await this.runWithQueue(resolved.contextKeyHash, async () =>
          this.sessionService.stop(context)
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      throw new AppError(`Unsupported operation: ${request.op}`, {
        code: ERROR_CODE.VALIDATION_ERROR,
        details: { op: request.op },
        suggestions: ['Run: cdt --list']
      });
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : new AppError('Daemon request handling failed.', {
              code: ERROR_CODE.INTERNAL_ERROR,
              details: {
                reason: error instanceof Error ? error.message : String(error),
                op: request.op
              },
              suggestions: ['Retry once.', 'Restart daemon if this issue repeats.']
            });

      return {
        id: request.id,
        ok: false,
        error: {
          code: appError.code,
          message: appError.message,
          details: appError.details,
          suggestions: appError.suggestions
        },
        meta: { durationMs: Date.now() - started, retryable: appError.code === ERROR_CODE.TIMEOUT }
      };
    }
  }

  private async runWithQueue<T>(contextKeyHash: string, task: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueues.get(contextKeyHash) ?? Promise.resolve();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const queued = previous.then(() => gate);
    this.mutationQueues.set(contextKeyHash, queued);

    await previous;

    try {
      return await task();
    } finally {
      release();
      if (this.mutationQueues.get(contextKeyHash) === queued) {
        this.mutationQueues.delete(contextKeyHash);
      }
    }
  }

  private async ensureDirectories(): Promise<void> {
    await mkdir(resolveBrokerDir(this.homeDir), { recursive: true });
    await mkdir(path.join(this.homeDir, 'locks'), { recursive: true });
    await mkdir(path.join(this.homeDir, 'contexts'), { recursive: true });

    const pid = await this.pidFile.read();
    if (pid) {
      try {
        process.kill(pid.pid, 0);
      } catch {
        await this.cleanupArtifacts();
      }
    }

    await rm(resolveDaemonSocketPath(this.homeDir), { force: true });
  }

  private async cleanupArtifacts(): Promise<void> {
    await this.pidFile.remove();

    if (this.releaseStartupLock) {
      await this.releaseStartupLock();
      this.releaseStartupLock = null;
    }

    await rm(resolveDaemonSocketPath(this.homeDir), { force: true });
  }

  private attachSignalHandlers(): void {
    const shutdown = async () => {
      await this.shutdown();
      process.exit(0);
    };

    process.once('SIGINT', () => {
      void shutdown();
    });
    process.once('SIGTERM', () => {
      void shutdown();
    });
  }
}
