import { inspect } from 'node:util';

import type { ResponseEnvelope } from '../../shared/schema/envelopes.js';

export type OutputFormat = 'json' | 'text';
export type RenderableResponse = ResponseEnvelope & {
  text?: string;
};

const renderText = (payload: RenderableResponse): string => {
  if (payload.ok) {
    if (typeof payload.text === 'string' && payload.text.trim().length > 0) {
      return payload.text;
    }
    return `ok\n${inspect(payload.data, { depth: null, colors: false })}`;
  }

  return `error(${payload.error?.code ?? 'UNKNOWN'}): ${payload.error?.message ?? 'unknown error'}`;
};

export const writeResponse = (payload: RenderableResponse, format: OutputFormat): void => {
  if (format === 'text') {
    process.stdout.write(`${renderText(payload)}\n`);
    return;
  }

  const jsonPayload = { ...payload } as RenderableResponse;
  delete jsonPayload.text;
  process.stdout.write(`${JSON.stringify(jsonPayload)}\n`);
};

export const writeDiagnostic = (message: string): void => {
  process.stderr.write(`${message}\n`);
};
