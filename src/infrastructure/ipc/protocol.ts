import { randomUUID } from 'node:crypto';

import { requestEnvelopeSchema, responseEnvelopeSchema, type RequestEnvelope, type ResponseEnvelope } from '../../shared/schema/envelopes.js';

export const IPC_OP = {
  DAEMON_PING: 'daemon.ping',
  DAEMON_STOP: 'daemon.stop',
  DAEMON_STATUS: 'daemon.status',
  SESSION_START: 'session.start',
  SESSION_STATUS: 'session.status',
  SESSION_STOP: 'session.stop',
  PAGE_OPEN: 'page.open',
  PAGE_LIST: 'page.list',
  PAGE_USE: 'page.use',
  PAGE_NAVIGATE: 'page.navigate',
  PAGE_WAIT_TEXT: 'page.waitText',
  RUNTIME_EVAL: 'runtime.eval',
  ELEMENT_FILL: 'element.fill',
  ELEMENT_CLICK: 'element.click',
  INPUT_KEY: 'input.key',
  CAPTURE_SNAPSHOT: 'capture.snapshot'
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
