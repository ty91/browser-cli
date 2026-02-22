import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { SessionService } from '../../application/session/SessionService.js';
import { ContextResolver } from '../../application/context/ContextResolver.js';
import { AppError } from '../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../shared/errors/ErrorCode.js';
import type { RequestEnvelope, ResponseEnvelope } from '../../shared/schema/envelopes.js';
import { daemonContextSchema } from '../../shared/schema/common.js';
import { BrowserSlotManager } from '../cdp/BrowserSlotManager.js';
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

const pageIdSchema = z.number().int().positive();

const pageOpenSchema = z.object({
  url: z.string().min(1).optional()
});

const pageUseSchema = z.object({
  pageId: pageIdSchema
});

const pageNavigateSchema = z.object({
  pageId: pageIdSchema.optional(),
  url: z.string().min(1)
});

const pageWaitTextSchema = z.object({
  pageId: pageIdSchema.optional(),
  text: z.string().min(1)
});

const runtimeEvalSchema = z.object({
  pageId: pageIdSchema.optional(),
  functionSource: z.string().min(1)
});

const elementFillSchema = z.object({
  pageId: pageIdSchema.optional(),
  selector: z.string().min(1),
  value: z.string()
});

const elementClickSchema = z.object({
  pageId: pageIdSchema.optional(),
  selector: z.string().min(1)
});

const inputKeySchema = z.object({
  pageId: pageIdSchema.optional(),
  key: z.string().min(1)
});

const snapshotSchema = z.object({
  pageId: pageIdSchema.optional()
});

const sessionStartSchema = z.object({
  headless: z.boolean().optional()
});

export class BrokerDaemon {
  private readonly homeDir: string;
  private readonly sessionService: SessionService;
  private readonly contextResolver = new ContextResolver();
  private readonly slotManager: BrowserSlotManager;
  private readonly mutationQueues = new Map<string, Promise<void>>();
  private readonly pidFile: PidFile;
  private readonly startupLock: LockFile;

  private socketServer: JsonlSocketServer | null = null;
  private releaseStartupLock: (() => Promise<void>) | null = null;
  private shuttingDown = false;

  public constructor(options: BrokerDaemonOptions = {}) {
    this.homeDir = options.homeDir ?? resolveCdtHome();
    this.sessionService = new SessionService(this.homeDir);
    this.slotManager = new BrowserSlotManager(this.homeDir);
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

    await this.slotManager.closeAll();
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
        const payload = sessionStartSchema.parse(request.payload);
        const resolved = this.contextResolver.resolve(context);

        const data = await this.runWithQueue(resolved.contextKeyHash, async () => {
          const slotResult = await this.slotManager.startSession(resolved.contextKeyHash, {
            headless: payload.headless ?? false
          });

          let session;
          try {
            session = await this.sessionService.start({
              ...context,
              headless: slotResult.state.headless,
              chromePid: slotResult.state.chromePid,
              debugPort: slotResult.state.debugPort,
              currentPageId: slotResult.state.selectedPageId
            });
          } catch (error) {
            if (!slotResult.reused) {
              await this.slotManager.stopSession(resolved.contextKeyHash);
            }
            throw error;
          }

          return {
            ...session,
            reused: slotResult.reused,
            runtime: slotResult.state
          };
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.SESSION_STATUS) {
        const resolved = this.contextResolver.resolve(context);
        const data = await this.sessionService.status(context);
        const runtime = this.slotManager.getRuntimeState(resolved.contextKeyHash);

        return {
          id: request.id,
          ok: true,
          data: {
            ...data,
            runtime
          },
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.SESSION_STOP) {
        const resolved = this.contextResolver.resolve(context);
        const data = await this.runWithQueue(resolved.contextKeyHash, async () => {
          await this.slotManager.stopSession(resolved.contextKeyHash);
          return this.sessionService.stop(context);
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.PAGE_LIST) {
        const resolved = this.contextResolver.resolve(context);
        await this.sessionService.touch(context);
        const data = await this.slotManager.listPages(resolved.contextKeyHash);
        await this.sessionService.updateCurrentPage(context, data.selectedPageId);
        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.PAGE_OPEN) {
        const payload = pageOpenSchema.parse(request.payload);
        const data = await this.withContextMutation(context, async (contextKeyHash) => {
          return this.slotManager.openPage(contextKeyHash, {
            url: payload.url,
            timeoutMs: context.timeoutMs
          });
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.PAGE_USE) {
        const payload = pageUseSchema.parse(request.payload);
        const data = await this.withContextMutation(context, async (contextKeyHash) => {
          return this.slotManager.usePage(contextKeyHash, payload.pageId);
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.PAGE_NAVIGATE) {
        const payload = pageNavigateSchema.parse(request.payload);
        const data = await this.withContextMutation(context, async (contextKeyHash) => {
          return this.slotManager.navigatePage(contextKeyHash, {
            pageId: payload.pageId,
            url: payload.url,
            timeoutMs: context.timeoutMs
          });
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.PAGE_WAIT_TEXT) {
        const payload = pageWaitTextSchema.parse(request.payload);
        const data = await this.withContextMutation(context, async (contextKeyHash) => {
          return this.slotManager.waitText(contextKeyHash, {
            pageId: payload.pageId,
            text: payload.text,
            timeoutMs: context.timeoutMs
          });
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.RUNTIME_EVAL) {
        const payload = runtimeEvalSchema.parse(request.payload);
        const data = await this.withContextMutation(context, async (contextKeyHash) => {
          return this.slotManager.evaluate(contextKeyHash, {
            pageId: payload.pageId,
            functionSource: payload.functionSource
          });
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.ELEMENT_FILL) {
        const payload = elementFillSchema.parse(request.payload);
        const data = await this.withContextMutation(context, async (contextKeyHash) => {
          return this.slotManager.fillElement(contextKeyHash, {
            pageId: payload.pageId,
            selector: payload.selector,
            value: payload.value
          });
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.ELEMENT_CLICK) {
        const payload = elementClickSchema.parse(request.payload);
        const data = await this.withContextMutation(context, async (contextKeyHash) => {
          return this.slotManager.clickElement(contextKeyHash, {
            pageId: payload.pageId,
            selector: payload.selector,
            timeoutMs: context.timeoutMs
          });
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.INPUT_KEY) {
        const payload = inputKeySchema.parse(request.payload);
        const data = await this.withContextMutation(context, async (contextKeyHash) => {
          return this.slotManager.pressKey(contextKeyHash, {
            pageId: payload.pageId,
            key: payload.key
          });
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.CAPTURE_SNAPSHOT) {
        const payload = snapshotSchema.parse(request.payload);
        const data = await this.withContextMutation(context, async (contextKeyHash) => {
          return this.slotManager.snapshot(contextKeyHash, {
            pageId: payload.pageId
          });
        });

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

  private async withContextMutation<T>(
    context: z.infer<typeof daemonContextSchema>,
    task: (contextKeyHash: string) => Promise<T>
  ): Promise<T> {
    const resolved = this.contextResolver.resolve(context);

    const data = await this.runWithQueue(resolved.contextKeyHash, async () => {
      await this.sessionService.touch(context);
      const result = await task(resolved.contextKeyHash);

      const selectedPageId = this.slotManager.getRuntimeState(resolved.contextKeyHash)?.selectedPageId ?? null;
      await this.sessionService.updateCurrentPage(context, selectedPageId);

      return result;
    });

    return data;
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
