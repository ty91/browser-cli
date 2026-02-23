import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { ContextResolver } from '../../application/context/ContextResolver.js';
import { SessionService } from '../../application/session/SessionService.js';
import { AppError } from '../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../shared/errors/ErrorCode.js';
import { daemonContextSchema } from '../../shared/schema/common.js';
import type { RequestEnvelope, ResponseEnvelope } from '../../shared/schema/envelopes.js';
import { BrowserSlotManager } from '../cdp/BrowserSlotManager.js';
import { LockFile } from '../store/LockFile.js';
import { PidFile } from '../store/PidFile.js';
import {
  resolveBrokerDir,
  resolveCdtHome,
  resolveDaemonLockPath,
  resolveDaemonPidPath,
  resolveDaemonSocketPath
} from '../store/paths.js';
import { JsonlSocketServer } from './JsonlSocketServer.js';
import { IPC_OP } from './protocol.js';

export type BrokerDaemonOptions = {
  homeDir?: string;
};

const pageIdSchema = z.number().int().positive();

const sessionStartSchema = z.object({
  headless: z.boolean().optional()
});

const pageOpenSchema = z.object({
  url: z.string().min(1).optional()
});

const pageUseSchema = z.object({
  pageId: pageIdSchema
});

const pageCloseSchema = z.object({
  pageId: pageIdSchema.optional()
});

const pageNavigateSchema = z.object({
  pageId: pageIdSchema.optional(),
  url: z.string().min(1)
});

const pageResizeSchema = z.object({
  pageId: pageIdSchema.optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

const pageWaitTextSchema = z.object({
  pageId: pageIdSchema.optional(),
  text: z.string().min(1)
});

const pageWaitSelectorSchema = z.object({
  pageId: pageIdSchema.optional(),
  selector: z.string().min(1)
});

const pageWaitUrlSchema = z.object({
  pageId: pageIdSchema.optional(),
  pattern: z.string().min(1)
});

const observeStateSchema = z.object({
  pageId: pageIdSchema.optional()
});

const observeTargetsSchema = z.object({
  pageId: pageIdSchema.optional(),
  limit: z.number().int().positive().optional(),
  onlyVisible: z.boolean().optional()
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

const elementFillFormSchema = z.object({
  pageId: pageIdSchema.optional(),
  entries: z
    .array(
      z.object({
        selector: z.string().min(1),
        value: z.string()
      })
    )
    .min(1)
});

const elementClickSchema = z.object({
  pageId: pageIdSchema.optional(),
  selector: z.string().min(1)
});

const elementHoverSchema = z.object({
  pageId: pageIdSchema.optional(),
  selector: z.string().min(1)
});

const elementDragSchema = z.object({
  pageId: pageIdSchema.optional(),
  fromSelector: z.string().min(1),
  toSelector: z.string().min(1),
  steps: z.number().int().positive().optional()
});

const elementUploadSchema = z.object({
  pageId: pageIdSchema.optional(),
  selector: z.string().min(1),
  filePath: z.string().min(1)
});

const inputKeySchema = z.object({
  pageId: pageIdSchema.optional(),
  key: z.string().min(1)
});

const mouseButtonSchema = z.enum(['left', 'right', 'middle']);

const inputTypeSchema = z.object({
  pageId: pageIdSchema.optional(),
  text: z.string(),
  delayMs: z.number().int().positive().optional()
});

const inputMouseMoveSchema = z.object({
  pageId: pageIdSchema.optional(),
  x: z.number(),
  y: z.number(),
  steps: z.number().int().positive().optional()
});

const inputClickSchema = z.object({
  pageId: pageIdSchema.optional(),
  x: z.number(),
  y: z.number(),
  button: mouseButtonSchema.optional(),
  count: z.number().int().positive().optional(),
  delayMs: z.number().int().nonnegative().optional()
});

const inputMouseDownSchema = z.object({
  pageId: pageIdSchema.optional(),
  button: mouseButtonSchema.optional(),
  count: z.number().int().positive().optional()
});

const inputMouseUpSchema = z.object({
  pageId: pageIdSchema.optional(),
  button: mouseButtonSchema.optional(),
  count: z.number().int().positive().optional()
});

const inputDragSchema = z.object({
  pageId: pageIdSchema.optional(),
  fromX: z.number(),
  fromY: z.number(),
  toX: z.number(),
  toY: z.number(),
  steps: z.number().int().positive().optional(),
  button: mouseButtonSchema.optional()
});

const inputScrollSchema = z.object({
  pageId: pageIdSchema.optional(),
  dx: z.number().optional(),
  dy: z.number()
});

const refActionSchema = z.object({
  pageId: pageIdSchema.optional(),
  ref: z.string().min(1)
});

const refTypeSchema = z.object({
  pageId: pageIdSchema.optional(),
  ref: z.string().min(1),
  text: z.string()
});

const dialogHandleSchema = z.object({
  pageId: pageIdSchema.optional(),
  action: z.enum(['accept', 'dismiss']),
  promptText: z.string().optional()
});

const snapshotSchema = z.object({
  pageId: pageIdSchema.optional()
});

const snapshotAriaSchema = z.object({
  pageId: pageIdSchema.optional()
});

const screenshotSchema = z.object({
  pageId: pageIdSchema.optional(),
  filePath: z.string().optional(),
  dirPath: z.string().optional(),
  label: z.string().optional(),
  fullPage: z.boolean().optional(),
  format: z.enum(['png', 'jpeg', 'webp']).optional(),
  quality: z.number().int().min(0).max(100).optional(),
  maxWidth: z.number().int().positive().optional(),
  maxHeight: z.number().int().positive().optional(),
  keep: z.number().int().positive().optional()
});

const consoleListSchema = z.object({
  pageId: pageIdSchema.optional(),
  limit: z.number().int().positive().optional(),
  type: z.string().optional()
});

const consoleGetSchema = z.object({
  id: z.number().int().positive()
});

const consoleWaitSchema = z.object({
  pageId: pageIdSchema.optional(),
  pattern: z.string().min(1),
  type: z.string().optional()
});

const networkListSchema = z.object({
  pageId: pageIdSchema.optional(),
  limit: z.number().int().positive().optional(),
  method: z.string().optional()
});

const networkGetSchema = z.object({
  id: z.number().int().positive(),
  requestFilePath: z.string().optional(),
  responseFilePath: z.string().optional()
});

const networkWaitSchema = z.object({
  pageId: pageIdSchema.optional(),
  pattern: z.string().min(1),
  method: z.string().optional(),
  status: z.number().int().positive().optional()
});

const emulationSetSchema = z.object({
  viewport: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      deviceScaleFactor: z.number().positive().optional(),
      isMobile: z.boolean().optional(),
      hasTouch: z.boolean().optional(),
      isLandscape: z.boolean().optional()
    })
    .nullable()
    .optional(),
  userAgent: z.string().nullable().optional(),
  networkProfile: z.string().nullable().optional(),
  geolocation: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      accuracy: z.number().nonnegative().optional()
    })
    .nullable()
    .optional()
});

const traceStartSchema = z.object({
  pageId: pageIdSchema.optional(),
  filePath: z.string().optional()
});

const traceStopSchema = z.object({
  filePath: z.string().optional()
});

const traceInsightSchema = z.object({
  filePath: z.string().optional(),
  insightName: z.string().optional()
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
        const data = await this.withContextAccess(context, async (contextKeyHash) => {
          return this.slotManager.listPages(contextKeyHash);
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.PAGE_OPEN) {
        const payload = pageOpenSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.openPage(contextKeyHash, {
              url: payload.url,
              timeoutMs: context.timeoutMs
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.PAGE_USE) {
        const payload = pageUseSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => this.slotManager.usePage(contextKeyHash, payload.pageId),
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.PAGE_CLOSE) {
        const payload = pageCloseSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => this.slotManager.closePage(contextKeyHash, { pageId: payload.pageId }),
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.PAGE_NAVIGATE) {
        const payload = pageNavigateSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.navigatePage(contextKeyHash, {
              pageId: payload.pageId,
              url: payload.url,
              timeoutMs: context.timeoutMs
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.PAGE_RESIZE) {
        const payload = pageResizeSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.resizePage(contextKeyHash, {
              pageId: payload.pageId,
              width: payload.width,
              height: payload.height
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.PAGE_WAIT_TEXT) {
        const payload = pageWaitTextSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.waitText(contextKeyHash, {
              pageId: payload.pageId,
              text: payload.text,
              timeoutMs: context.timeoutMs
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.PAGE_WAIT_SELECTOR) {
        const payload = pageWaitSelectorSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.waitSelector(contextKeyHash, {
              pageId: payload.pageId,
              selector: payload.selector,
              timeoutMs: context.timeoutMs
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.PAGE_WAIT_URL) {
        const payload = pageWaitUrlSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.waitUrl(contextKeyHash, {
              pageId: payload.pageId,
              pattern: payload.pattern,
              timeoutMs: context.timeoutMs
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.OBSERVE_STATE) {
        const payload = observeStateSchema.parse(request.payload);
        const data = await this.withContextAccess(context, async (contextKeyHash) => {
          return this.slotManager.observeState(contextKeyHash, { pageId: payload.pageId });
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.OBSERVE_TARGETS) {
        const payload = observeTargetsSchema.parse(request.payload);
        const data = await this.withContextAccess(context, async (contextKeyHash) => {
          return this.slotManager.observeTargets(contextKeyHash, {
            pageId: payload.pageId,
            limit: payload.limit,
            onlyVisible: payload.onlyVisible
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
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.evaluate(contextKeyHash, {
              pageId: payload.pageId,
              functionSource: payload.functionSource
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.ELEMENT_FILL) {
        const payload = elementFillSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.fillElement(contextKeyHash, {
              pageId: payload.pageId,
              selector: payload.selector,
              value: payload.value
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.ELEMENT_FILL_FORM) {
        const payload = elementFillFormSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.fillForm(contextKeyHash, {
              pageId: payload.pageId,
              entries: payload.entries
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.ELEMENT_CLICK) {
        const payload = elementClickSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.clickElement(contextKeyHash, {
              pageId: payload.pageId,
              selector: payload.selector,
              timeoutMs: context.timeoutMs
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.ELEMENT_HOVER) {
        const payload = elementHoverSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.hoverElement(contextKeyHash, {
              pageId: payload.pageId,
              selector: payload.selector,
              timeoutMs: context.timeoutMs
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.ELEMENT_DRAG) {
        const payload = elementDragSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.dragElement(contextKeyHash, {
              pageId: payload.pageId,
              fromSelector: payload.fromSelector,
              toSelector: payload.toSelector,
              steps: payload.steps
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.ELEMENT_UPLOAD) {
        const payload = elementUploadSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.uploadFile(contextKeyHash, {
              pageId: payload.pageId,
              selector: payload.selector,
              filePath: payload.filePath
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.INPUT_KEY) {
        const payload = inputKeySchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.pressKey(contextKeyHash, {
              pageId: payload.pageId,
              key: payload.key
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.INPUT_TYPE) {
        const payload = inputTypeSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.typeText(contextKeyHash, {
              pageId: payload.pageId,
              text: payload.text,
              delayMs: payload.delayMs
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.INPUT_MOUSE_MOVE) {
        const payload = inputMouseMoveSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.mouseMove(contextKeyHash, {
              pageId: payload.pageId,
              x: payload.x,
              y: payload.y,
              steps: payload.steps
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.INPUT_CLICK) {
        const payload = inputClickSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.mouseClick(contextKeyHash, {
              pageId: payload.pageId,
              x: payload.x,
              y: payload.y,
              button: payload.button,
              count: payload.count,
              delayMs: payload.delayMs
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.INPUT_MOUSE_DOWN) {
        const payload = inputMouseDownSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.mouseDown(contextKeyHash, {
              pageId: payload.pageId,
              button: payload.button,
              count: payload.count
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.INPUT_MOUSE_UP) {
        const payload = inputMouseUpSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.mouseUp(contextKeyHash, {
              pageId: payload.pageId,
              button: payload.button,
              count: payload.count
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.INPUT_DRAG) {
        const payload = inputDragSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.mouseDrag(contextKeyHash, {
              pageId: payload.pageId,
              fromX: payload.fromX,
              fromY: payload.fromY,
              toX: payload.toX,
              toY: payload.toY,
              steps: payload.steps,
              button: payload.button
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.INPUT_SCROLL) {
        const payload = inputScrollSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.mouseScroll(contextKeyHash, {
              pageId: payload.pageId,
              dx: payload.dx,
              dy: payload.dy
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.REF_CLICK) {
        const payload = refActionSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.clickByRef(contextKeyHash, {
              pageId: payload.pageId,
              ref: payload.ref
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.REF_DOUBLECLICK) {
        const payload = refActionSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.doubleClickByRef(contextKeyHash, {
              pageId: payload.pageId,
              ref: payload.ref
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.REF_HOVER) {
        const payload = refActionSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.hoverByRef(contextKeyHash, {
              pageId: payload.pageId,
              ref: payload.ref
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.REF_TYPE) {
        const payload = refTypeSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.typeByRef(contextKeyHash, {
              pageId: payload.pageId,
              ref: payload.ref,
              text: payload.text
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.REF_SCROLL_INTO_VIEW) {
        const payload = refActionSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.scrollIntoViewByRef(contextKeyHash, {
              pageId: payload.pageId,
              ref: payload.ref
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.DIALOG_HANDLE) {
        const payload = dialogHandleSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.handleDialog(contextKeyHash, {
              pageId: payload.pageId,
              action: payload.action,
              promptText: payload.promptText
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.CAPTURE_SNAPSHOT) {
        const payload = snapshotSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => this.slotManager.snapshot(contextKeyHash, { pageId: payload.pageId }),
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.SNAPSHOT_ARIA) {
        const payload = snapshotAriaSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => this.slotManager.snapshotAria(contextKeyHash, { pageId: payload.pageId }),
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.CAPTURE_SCREENSHOT) {
        const payload = screenshotSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.screenshot(contextKeyHash, {
              pageId: payload.pageId,
              filePath: payload.filePath,
              dirPath: payload.dirPath,
              label: payload.label,
              fullPage: payload.fullPage,
              format: payload.format,
              quality: payload.quality,
              maxWidth: payload.maxWidth,
              maxHeight: payload.maxHeight,
              keep: payload.keep
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.CONSOLE_LIST) {
        const payload = consoleListSchema.parse(request.payload);
        const data = await this.withContextAccess(context, async (contextKeyHash) => {
          return this.slotManager.listConsoleMessages(contextKeyHash, {
            pageId: payload.pageId,
            limit: payload.limit,
            type: payload.type as never
          });
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.CONSOLE_GET) {
        const payload = consoleGetSchema.parse(request.payload);
        const data = await this.withContextAccess(context, async (contextKeyHash) => {
          return this.slotManager.getConsoleMessage(contextKeyHash, payload.id);
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.CONSOLE_WAIT) {
        const payload = consoleWaitSchema.parse(request.payload);
        const data = await this.withContextAccess(context, async (contextKeyHash) => {
          return this.slotManager.waitConsoleMessage(contextKeyHash, {
            pageId: payload.pageId,
            pattern: payload.pattern,
            type: payload.type as never,
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

      if (request.op === IPC_OP.NETWORK_LIST) {
        const payload = networkListSchema.parse(request.payload);
        const data = await this.withContextAccess(context, async (contextKeyHash) => {
          return this.slotManager.listNetworkRequests(contextKeyHash, {
            pageId: payload.pageId,
            limit: payload.limit,
            method: payload.method
          });
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.NETWORK_GET) {
        const payload = networkGetSchema.parse(request.payload);
        const data = await this.withContextAccess(context, async (contextKeyHash) => {
          return this.slotManager.getNetworkRequest(contextKeyHash, {
            id: payload.id,
            requestFilePath: payload.requestFilePath,
            responseFilePath: payload.responseFilePath
          });
        });

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.NETWORK_WAIT) {
        const payload = networkWaitSchema.parse(request.payload);
        const data = await this.withContextAccess(context, async (contextKeyHash) => {
          return this.slotManager.waitNetworkRequest(contextKeyHash, {
            pageId: payload.pageId,
            pattern: payload.pattern,
            method: payload.method,
            status: payload.status,
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

      if (request.op === IPC_OP.EMULATION_SET) {
        const payload = emulationSetSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.setEmulation(contextKeyHash, {
              viewport: payload.viewport,
              userAgent: payload.userAgent,
              networkProfile: payload.networkProfile,
              geolocation: payload.geolocation
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.EMULATION_RESET) {
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => this.slotManager.resetEmulation(contextKeyHash),
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.TRACE_START) {
        const payload = traceStartSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => {
            return this.slotManager.traceStart(contextKeyHash, {
              pageId: payload.pageId,
              filePath: payload.filePath
            });
          },
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.TRACE_STOP) {
        const payload = traceStopSchema.parse(request.payload);
        const data = await this.withContextAccess(
          context,
          async (contextKeyHash) => this.slotManager.traceStop(contextKeyHash, { filePath: payload.filePath }),
          { queue: true }
        );

        return {
          id: request.id,
          ok: true,
          data,
          meta: { durationMs: Date.now() - started }
        };
      }

      if (request.op === IPC_OP.TRACE_INSIGHT) {
        const payload = traceInsightSchema.parse(request.payload);
        const data = await this.withContextAccess(context, async (contextKeyHash) => {
          return this.slotManager.traceInsight(contextKeyHash, {
            filePath: payload.filePath,
            insightName: payload.insightName
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
        suggestions: ['Run: cdt --help']
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

  private async withContextAccess<T>(
    context: z.infer<typeof daemonContextSchema>,
    task: (contextKeyHash: string) => Promise<T>,
    options?: { queue?: boolean }
  ): Promise<T> {
    const resolved = this.contextResolver.resolve(context);

    const execute = async (): Promise<T> => {
      await this.sessionService.touch(context);
      const result = await task(resolved.contextKeyHash);

      const selectedPageId = this.slotManager.getRuntimeState(resolved.contextKeyHash)?.selectedPageId ?? null;
      await this.sessionService.updateCurrentPage(context, selectedPageId);

      return result;
    };

    if (options?.queue) {
      return this.runWithQueue(resolved.contextKeyHash, execute);
    }

    return execute();
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
        return;
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
