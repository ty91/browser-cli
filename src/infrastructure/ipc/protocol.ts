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
  PAGE_CLOSE: 'page.close',
  PAGE_NAVIGATE: 'page.navigate',
  PAGE_RESIZE: 'page.resize',
  PAGE_WAIT_TEXT: 'page.waitText',
  PAGE_WAIT_SELECTOR: 'page.waitSelector',
  PAGE_WAIT_URL: 'page.waitUrl',
  OBSERVE_STATE: 'observe.state',
  OBSERVE_TARGETS: 'observe.targets',
  RUNTIME_EVAL: 'runtime.eval',
  ELEMENT_FILL: 'element.fill',
  ELEMENT_FILL_FORM: 'element.fillForm',
  ELEMENT_CLICK: 'element.click',
  ELEMENT_HOVER: 'element.hover',
  ELEMENT_DRAG: 'element.drag',
  ELEMENT_UPLOAD: 'element.upload',
  INPUT_KEY: 'input.key',
  INPUT_TYPE: 'input.type',
  INPUT_MOUSE_MOVE: 'input.mouseMove',
  INPUT_CLICK: 'input.click',
  INPUT_MOUSE_DOWN: 'input.mouseDown',
  INPUT_MOUSE_UP: 'input.mouseUp',
  INPUT_DRAG: 'input.drag',
  INPUT_SCROLL: 'input.scroll',
  DIALOG_HANDLE: 'dialog.handle',
  CAPTURE_SNAPSHOT: 'capture.snapshot',
  SNAPSHOT_ARIA: 'snapshot.aria',
  CAPTURE_SCREENSHOT: 'capture.screenshot',
  CONSOLE_LIST: 'console.list',
  CONSOLE_GET: 'console.get',
  CONSOLE_WAIT: 'console.wait',
  NETWORK_LIST: 'network.list',
  NETWORK_GET: 'network.get',
  NETWORK_WAIT: 'network.wait',
  EMULATION_SET: 'emulation.set',
  EMULATION_RESET: 'emulation.reset',
  TRACE_START: 'trace.start',
  TRACE_STOP: 'trace.stop',
  TRACE_INSIGHT: 'trace.insight'
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
