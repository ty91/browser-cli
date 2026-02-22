import { z } from 'zod';

import { daemonContextSchema } from './common.js';

export const requestEnvelopeSchema = z.object({
  id: z.string().min(1),
  op: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  context: daemonContextSchema
});

export const responseEnvelopeSchema = z.object({
  id: z.string().min(1),
  ok: z.boolean(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      details: z.record(z.string(), z.unknown()).optional(),
      suggestions: z.array(z.string()).default([])
    })
    .optional(),
  meta: z
    .object({
      durationMs: z.number().nonnegative(),
      retryable: z.boolean().optional()
    })
    .optional()
});

export type RequestEnvelope = z.infer<typeof requestEnvelopeSchema>;
export type ResponseEnvelope = z.infer<typeof responseEnvelopeSchema>;
