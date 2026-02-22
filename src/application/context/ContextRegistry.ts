import { mkdir } from 'node:fs/promises';

import { AtomicJsonFile } from '../../infrastructure/store/AtomicJsonFile.js';
import {
  resolveContextDir,
  resolveContextLeasePath,
  resolveContextMetadataPath
} from '../../infrastructure/store/paths.js';
import type { ResolvedContext, SessionLease, SessionMetadata } from './types.js';

export class ContextRegistry {
  public constructor(private readonly homeDir?: string) {}

  public async getMetadata(contextKeyHash: string): Promise<SessionMetadata | null> {
    const filePath = resolveContextMetadataPath(contextKeyHash, this.homeDir);
    return AtomicJsonFile.read<SessionMetadata>(filePath);
  }

  public async getLease(contextKeyHash: string): Promise<SessionLease | null> {
    const filePath = resolveContextLeasePath(contextKeyHash, this.homeDir);
    return AtomicJsonFile.read<SessionLease>(filePath);
  }

  public async markRunning(
    resolved: ResolvedContext,
    options: {
      headless: boolean;
      chromePid?: number | null;
      debugPort?: number | null;
      currentPageId?: number | null;
    }
  ): Promise<SessionMetadata> {
    const now = new Date().toISOString();
    const current = await this.getMetadata(resolved.contextKeyHash);

    const next: SessionMetadata = {
      contextKeyHash: resolved.contextKeyHash,
      shareGroup: resolved.shareGroup,
      resolvedBy: resolved.resolvedBy,
      startedAt: current?.startedAt ?? now,
      updatedAt: now,
      stoppedAt: null,
      status: 'running',
      chromePid: options.chromePid ?? current?.chromePid ?? null,
      debugPort: options.debugPort ?? current?.debugPort ?? null,
      currentPageId: options.currentPageId ?? current?.currentPageId ?? null,
      headless: options.headless,
      lastSeenAt: now
    };

    await this.ensureContextDir(resolved.contextKeyHash);
    await AtomicJsonFile.write(resolveContextMetadataPath(resolved.contextKeyHash, this.homeDir), next);
    return next;
  }

  public async markStopped(contextKeyHash: string): Promise<SessionMetadata | null> {
    const current = await this.getMetadata(contextKeyHash);
    if (!current) {
      return null;
    }

    const now = new Date().toISOString();

    const next: SessionMetadata = {
      ...current,
      status: 'stopped',
      updatedAt: now,
      stoppedAt: now,
      lastSeenAt: now
    };

    await AtomicJsonFile.write(resolveContextMetadataPath(contextKeyHash, this.homeDir), next);
    return next;
  }

  public async updateCurrentPage(
    contextKeyHash: string,
    currentPageId: number | null
  ): Promise<SessionMetadata | null> {
    const current = await this.getMetadata(contextKeyHash);
    if (!current) {
      return null;
    }

    const now = new Date().toISOString();
    const next: SessionMetadata = {
      ...current,
      currentPageId,
      updatedAt: now,
      lastSeenAt: now
    };

    await AtomicJsonFile.write(resolveContextMetadataPath(contextKeyHash, this.homeDir), next);
    return next;
  }

  public async touchLease(contextKeyHash: string, ownerPid: number, ttlMs: number): Promise<SessionLease> {
    const now = Date.now();
    const lease: SessionLease = {
      contextKeyHash,
      ownerPid,
      lastSeenAt: new Date(now).toISOString(),
      leaseExpiresAt: new Date(now + ttlMs).toISOString()
    };

    await this.ensureContextDir(contextKeyHash);
    await AtomicJsonFile.write(resolveContextLeasePath(contextKeyHash, this.homeDir), lease);
    return lease;
  }

  private async ensureContextDir(contextKeyHash: string): Promise<void> {
    await mkdir(resolveContextDir(contextKeyHash, this.homeDir), { recursive: true });
  }
}
