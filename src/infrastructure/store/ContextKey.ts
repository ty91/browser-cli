import crypto from 'node:crypto';

export const hashContextKey = (rawKey: string): string =>
  `ctx_${crypto.createHash('sha256').update(rawKey).digest('hex').slice(0, 16)}`;
