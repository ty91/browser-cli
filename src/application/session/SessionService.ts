import { AppError } from '../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../shared/errors/ErrorCode.js';
import type { CallerContext } from '../../shared/schema/common.js';
import { LockFile } from '../../infrastructure/store/LockFile.js';
import { resolveContextLockPath } from '../../infrastructure/store/paths.js';
import { ContextRegistry } from '../context/ContextRegistry.js';
import { ContextResolver } from '../context/ContextResolver.js';
import { LeaseManager } from '../context/LeaseManager.js';
import type { ResolvedContext, SessionMetadata } from '../context/types.js';

export type SessionCommandInput = {
  caller: CallerContext;
  shareGroup?: string;
  contextId?: string;
};

export type SessionStartInput = SessionCommandInput & {
  headless?: boolean;
  chromePid?: number | null;
  debugPort?: number | null;
  currentPageId?: number | null;
};

export type SessionStartResult = {
  reused: boolean;
  context: ResolvedContext;
  session: SessionMetadata;
};

export type SessionStatusResult = {
  context: ResolvedContext;
  session: SessionMetadata;
  lease: {
    ownerPid: number;
    lastSeenAt: string;
    leaseExpiresAt: string;
  };
};

export type SessionStopResult = {
  context: ResolvedContext;
  session: SessionMetadata;
};

export type SessionTouchResult = {
  context: ResolvedContext;
  session: SessionMetadata;
};

export class SessionService {
  private readonly resolver = new ContextResolver();
  private readonly registry: ContextRegistry;
  private readonly leaseManager: LeaseManager;

  public constructor(private readonly homeDir?: string) {
    this.registry = new ContextRegistry(homeDir);
    this.leaseManager = new LeaseManager(this.registry);
  }

  public async start(input: SessionStartInput): Promise<SessionStartResult> {
    const resolved = this.resolver.resolve(input);
    const lock = new LockFile(resolveContextLockPath(resolved.contextKeyHash, this.homeDir));
    const release = await lock.acquire();

    try {
      const existing = await this.registry.getMetadata(resolved.contextKeyHash);
      const headless = input.headless ?? false;

      const session = await this.registry.markRunning(resolved, {
        headless,
        chromePid: input.chromePid ?? existing?.chromePid ?? null,
        debugPort: input.debugPort ?? existing?.debugPort ?? null,
        currentPageId: input.currentPageId ?? existing?.currentPageId ?? null
      });
      await this.leaseManager.touch(resolved.contextKeyHash, input.caller.pid);

      return {
        reused: existing?.status === 'running',
        context: resolved,
        session
      };
    } finally {
      await release();
    }
  }

  public async status(input: SessionCommandInput): Promise<SessionStatusResult> {
    const resolved = this.resolver.resolve(input);
    const session = await this.registry.getMetadata(resolved.contextKeyHash);

    if (!session) {
      throw new AppError('No session exists for current context.', {
        code: ERROR_CODE.SESSION_NOT_FOUND,
        details: { contextKeyHash: resolved.contextKeyHash },
        suggestions: ['Start one first: browser start --output json']
      });
    }

    const lease = await this.leaseManager.assertAlive(resolved.contextKeyHash);
    return {
      context: resolved,
      session,
      lease: {
        ownerPid: lease.ownerPid,
        lastSeenAt: lease.lastSeenAt,
        leaseExpiresAt: lease.leaseExpiresAt
      }
    };
  }

  public async stop(input: SessionCommandInput): Promise<SessionStopResult> {
    const resolved = this.resolver.resolve(input);
    const lock = new LockFile(resolveContextLockPath(resolved.contextKeyHash, this.homeDir));
    const release = await lock.acquire();

    try {
      const session = await this.registry.markStopped(resolved.contextKeyHash);
      if (!session) {
        throw new AppError('No running session for current context.', {
          code: ERROR_CODE.SESSION_NOT_FOUND,
          details: { contextKeyHash: resolved.contextKeyHash },
          suggestions: ['Start one first: browser start --output json']
        });
      }

      await this.leaseManager.touch(resolved.contextKeyHash, input.caller.pid);

      return {
        context: resolved,
        session
      };
    } finally {
      await release();
    }
  }

  public async touch(input: SessionCommandInput): Promise<SessionTouchResult> {
    const resolved = this.resolver.resolve(input);
    const session = await this.registry.getMetadata(resolved.contextKeyHash);
    if (!session) {
      throw new AppError('No session exists for current context.', {
        code: ERROR_CODE.SESSION_NOT_FOUND,
        details: { contextKeyHash: resolved.contextKeyHash },
        suggestions: ['Start one first: browser start --output json']
      });
    }

    await this.leaseManager.touch(resolved.contextKeyHash, input.caller.pid);

    return { context: resolved, session };
  }

  public async updateCurrentPage(
    input: SessionCommandInput,
    currentPageId: number | null
  ): Promise<SessionMetadata | null> {
    const resolved = this.resolver.resolve(input);
    return this.registry.updateCurrentPage(resolved.contextKeyHash, currentPageId);
  }
}
