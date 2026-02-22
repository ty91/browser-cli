import { inspect } from 'node:util';

import type { ResponseEnvelope } from '../../shared/schema/envelopes.js';

export type OutputFormat = 'json' | 'text';

const renderText = (payload: ResponseEnvelope): string => {
  if (payload.ok) {
    return `ok\n${inspect(payload.data, { depth: null, colors: false })}`;
  }

  return `error(${payload.error?.code ?? 'UNKNOWN'}): ${payload.error?.message ?? 'unknown error'}`;
};

export const writeResponse = (payload: ResponseEnvelope, format: OutputFormat): void => {
  if (format === 'text') {
    process.stdout.write(`${renderText(payload)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(payload)}\n`);
};

export const writeDiagnostic = (message: string): void => {
  process.stderr.write(`${message}\n`);
};
