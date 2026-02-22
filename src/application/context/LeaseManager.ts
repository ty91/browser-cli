import { AppError } from '../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../shared/errors/ErrorCode.js';
import type { ContextRegistry } from './ContextRegistry.js';
import type { SessionLease } from './types.js';

export class LeaseManager {
  public constructor(
    private readonly registry: ContextRegistry,
    private readonly ttlMs = 60_000
  ) {}

  public async touch(contextKeyHash: string, ownerPid: number): Promise<SessionLease> {
    return this.registry.touchLease(contextKeyHash, ownerPid, this.ttlMs);
  }

  public async assertAlive(contextKeyHash: string): Promise<SessionLease> {
    const lease = await this.registry.getLease(contextKeyHash);
    if (!lease) {
      throw new AppError('Session lease missing for context.', {
        code: ERROR_CODE.CONTEXT_LEASE_EXPIRED,
        details: { contextKeyHash },
        suggestions: ['Restart the session: cdt session start --output json']
      });
    }

    const expires = Date.parse(lease.leaseExpiresAt);
    if (Number.isNaN(expires) || expires < Date.now()) {
      throw new AppError('Session lease has expired.', {
        code: ERROR_CODE.CONTEXT_LEASE_EXPIRED,
        details: { contextKeyHash, leaseExpiresAt: lease.leaseExpiresAt },
        suggestions: ['Restart the session: cdt session start --output json']
      });
    }

    return lease;
  }
}
