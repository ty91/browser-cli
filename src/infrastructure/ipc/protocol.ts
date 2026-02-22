import { randomUUID } from 'node:crypto';

import { requestEnvelopeSchema, responseEnvelopeSchema, type RequestEnvelope, type ResponseEnvelope } from '../../shared/schema/envelopes.js';

export const IPC_OP = {
  DAEMON_PING: 'daemon.ping',
  DAEMON_STOP: 'daemon.stop',
  DAEMON_STATUS: 'daemon.status',
  SESSION_START: 'session.start',
  SESSION_STATUS: 'session.status',
  SESSION_STOP: 'session.stop'
} as const;

export type IpcOp = (typeof IPC_OP)[keyof typeof IPC_OP];

export const createRequestEnvelope = (
  op: IpcOp,
  payload: RequestEnvelope['payload'],
  context: RequestEnvelope['context']
): RequestEnvelope =>
  requestEnvelopeSchema.parse({
    id: randomUUID(),
    op,
    payload,
    context
  });

export const parseRequestEnvelope = (line: string): RequestEnvelope => requestEnvelopeSchema.parse(JSON.parse(line));

export const parseResponseEnvelope = (line: string): ResponseEnvelope => responseEnvelopeSchema.parse(JSON.parse(line));

export const serializeEnvelope = (envelope: RequestEnvelope | ResponseEnvelope): string =>
  `${JSON.stringify(envelope)}\n`;
