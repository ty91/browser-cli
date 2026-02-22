import net from 'node:net';

import { AppError } from '../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../shared/errors/ErrorCode.js';
import type { DaemonContext } from '../../shared/schema/common.js';
import type { ResponseEnvelope } from '../../shared/schema/envelopes.js';
import { createRequestEnvelope, parseResponseEnvelope, serializeEnvelope, type IpcOp } from './protocol.js';

export class JsonlSocketClient {
  public constructor(private readonly socketPath: string) {}

  public async send(op: IpcOp, payload: Record<string, unknown>, context: DaemonContext): Promise<ResponseEnvelope> {
    const request = createRequestEnvelope(op, payload, context);

    return new Promise<ResponseEnvelope>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      let buffer = '';
      let settled = false;

      const finalize = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        fn();
      };

      socket.once('connect', () => {
        socket.write(serializeEnvelope(request));
      });

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) {
          return;
        }

        const line = buffer.slice(0, newlineIndex);
        finalize(() => {
          socket.end();
          try {
            resolve(parseResponseEnvelope(line));
          } catch (error) {
            reject(
              new AppError('Received malformed IPC response.', {
                code: ERROR_CODE.IPC_PROTOCOL_ERROR,
                details: { raw: line, parseError: error instanceof Error ? error.message : String(error) },
                suggestions: ['Restart daemon: cdt daemon stop && cdt session start']
              })
            );
          }
        });
      });

      socket.once('error', (error) => {
        finalize(() => {
          reject(
            new AppError('Unable to communicate with daemon.', {
              code: ERROR_CODE.DAEMON_UNAVAILABLE,
              details: { socketPath: this.socketPath, reason: error.message },
              suggestions: ['Run: cdt session start --output json', 'If problem persists, run: cdt daemon stop']
            })
          );
        });
      });

      socket.once('end', () => {
        if (!settled) {
          finalize(() => {
            reject(
              new AppError('Daemon closed the connection before replying.', {
                code: ERROR_CODE.IPC_PROTOCOL_ERROR,
                details: { socketPath: this.socketPath },
                suggestions: ['Retry once.', 'Restart daemon if this keeps happening.']
              })
            );
          });
        }
      });
    });
  }
}
