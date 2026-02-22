export type ResolvedContext = {
  contextKey: string;
  contextKeyHash: string;
  shareGroup: string | null;
  resolvedBy: 'manual:context-id' | 'env:CDT_CONTEXT_ID' | 'share-group' | 'fingerprint' | 'fallback';
};

export type SessionMetadata = {
  contextKeyHash: string;
  shareGroup: string | null;
  resolvedBy: ResolvedContext['resolvedBy'];
  startedAt: string;
  updatedAt: string;
  stoppedAt: string | null;
  status: 'running' | 'stopped';
  chromePid: number | null;
  debugPort: number | null;
  currentPageId: number | null;
  headless: boolean;
  lastSeenAt: string;
};

export type SessionLease = {
  contextKeyHash: string;
  ownerPid: number;
  lastSeenAt: string;
  leaseExpiresAt: string;
};
