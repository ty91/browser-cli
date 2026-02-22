import { ERROR_CODE, type ErrorCode } from './ErrorCode.js';

export type AppErrorOptions = {
  code?: ErrorCode;
  details?: Record<string, unknown>;
  suggestions?: string[];
  cause?: unknown;
};

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;
  public readonly suggestions: string[];

  public constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code ?? ERROR_CODE.INTERNAL_ERROR;
    this.details = options.details;
    this.suggestions = options.suggestions ?? [];
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
