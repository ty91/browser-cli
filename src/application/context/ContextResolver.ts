import type { CallerContext } from '../../shared/schema/common.js';
import { hashContextKey } from '../../infrastructure/store/ContextKey.js';
import { AppError } from '../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../shared/errors/ErrorCode.js';
import type { ResolvedContext } from './types.js';

export type ResolveContextInput = {
  caller: CallerContext;
  contextId?: string;
  shareGroup?: string;
};

export class ContextResolver {
  public resolve(input: ResolveContextInput): ResolvedContext {
    const contextId = input.contextId?.trim();
    if (contextId) {
      return this.fromRaw(`manual:${contextId}`, input.shareGroup ?? null, 'manual:context-id');
    }

    const runtimeContext = input.caller.runtimeContextId?.trim();
    if (runtimeContext) {
      return this.fromRaw(`env:${runtimeContext}`, input.shareGroup ?? null, 'env:CDT_CONTEXT_ID');
    }

    const shareGroup = input.shareGroup?.trim();
    if (shareGroup) {
      return this.fromRaw(`group:${shareGroup}`, shareGroup, 'share-group');
    }

    const fingerprint = this.buildFingerprint(input.caller);
    if (fingerprint) {
      return this.fromRaw(`fingerprint:${fingerprint}`, null, 'fingerprint');
    }

    const fallback = `fallback:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    return this.fromRaw(fallback, null, 'fallback');
  }

  private fromRaw(
    raw: string,
    shareGroup: string | null,
    resolvedBy: ResolvedContext['resolvedBy']
  ): ResolvedContext {
    if (!raw.trim()) {
      throw new AppError('Context key resolution failed.', {
        code: ERROR_CODE.CONTEXT_RESOLUTION_FAILED,
        suggestions: ['Set CDT_CONTEXT_ID or pass --share-group for explicit routing.']
      });
    }

    return {
      contextKey: raw,
      contextKeyHash: hashContextKey(raw),
      shareGroup,
      resolvedBy
    };
  }

  private buildFingerprint(caller: CallerContext): string {
    const parts = [
      String(caller.pid),
      String(caller.ppid ?? 0),
      caller.tty ?? 'no-tty',
      caller.cwd
    ];

    return parts.join('|');
  }
}
