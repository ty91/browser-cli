import net from 'node:net';
import { rm } from 'node:fs/promises';

import { AppError } from '../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../shared/errors/ErrorCode.js';
import type { RequestEnvelope, ResponseEnvelope } from '../../shared/schema/envelopes.js';
import { parseRequestEnvelope, serializeEnvelope } from './protocol.js';

type RequestHandler = (request: RequestEnvelope) => Promise<ResponseEnvelope>;

export class JsonlSocketServer {
  private server: net.Server | null = null;

  public constructor(
    private readonly socketPath: string,
    private readonly onRequest: RequestHandler
  ) {}

  public async start(): Promise<void> {
    await rm(this.socketPath, { force: true });

    await new Promise<void>((resolve, reject) => {
      this.server = net.createServer((socket) => {
        let buffer = '';

        socket.on('data', async (chunk) => {
          buffer += chunk.toString('utf8');
          let newlineIndex = buffer.indexOf('\n');

          while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);

            const response = await this.safeHandle(line);
            socket.write(serializeEnvelope(response));
            newlineIndex = buffer.indexOf('\n');
          }
        });
      });

      this.server.once('error', (error) => reject(error));
      this.server.listen(this.socketPath, () => resolve());
    });
  }

  public async close(): Promise<void> {
    if (!this.server) {
      await rm(this.socketPath, { force: true });
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.server = null;
    await rm(this.socketPath, { force: true });
  }

  private async safeHandle(line: string): Promise<ResponseEnvelope> {
    try {
      const request = parseRequestEnvelope(line);
      return await this.onRequest(request);
    } catch (error) {
      const fallbackId = this.tryExtractId(line);
      const appError =
        error instanceof AppError
          ? error
          : new AppError('Invalid IPC request.', {
              code: ERROR_CODE.IPC_PROTOCOL_ERROR,
              details: {
                raw: line,
                reason: error instanceof Error ? error.message : String(error)
              },
              suggestions: ['Ensure request envelope matches schema.']
            });

      return {
        id: fallbackId,
        ok: false,
        error: {
          code: appError.code,
          message: appError.message,
          details: appError.details,
          suggestions: appError.suggestions
        },
        meta: {
          durationMs: 0,
          retryable: false
        }
      };
    }
  }

  private tryExtractId(line: string): string {
    try {
      const parsed = JSON.parse(line) as { id?: string };
      return parsed.id ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
