import { ERROR_CODE } from '../../shared/errors/ErrorCode.js';
import { toCliError } from '../../shared/errors/toCliError.js';
import type { ResponseEnvelope } from '../../shared/schema/envelopes.js';

export const mapExitCode = (errorCode: string): number => {
  switch (errorCode) {
    case ERROR_CODE.VALIDATION_ERROR:
      return 2;
    case ERROR_CODE.SESSION_NOT_FOUND:
    case ERROR_CODE.PAGE_NOT_FOUND:
    case ERROR_CODE.ELEMENT_NOT_FOUND:
    case ERROR_CODE.NETWORK_REQUEST_NOT_FOUND:
      return 3;
    case ERROR_CODE.TIMEOUT:
      return 4;
    case ERROR_CODE.SESSION_ALREADY_RUNNING:
    case ERROR_CODE.CONTEXT_LOCK_TIMEOUT:
      return 5;
    case ERROR_CODE.BROWSER_LAUNCH_FAILED:
      return 6;
    case ERROR_CODE.IPC_PROTOCOL_ERROR:
      return 7;
    case ERROR_CODE.DAEMON_UNAVAILABLE:
    case ERROR_CODE.CDP_DISCONNECTED:
      return 10;
    case ERROR_CODE.INTERNAL_ERROR:
    default:
      return 11;
  }
};

export const toFailureEnvelope = (id = 'local-error', error: unknown): ResponseEnvelope => {
  const cliError = toCliError(error);

  return {
    id,
    ok: false,
    error: {
      code: cliError.code,
      message: cliError.message,
      details: cliError.details,
      suggestions: cliError.suggestions
    },
    meta: {
      durationMs: 0,
      retryable: false
    }
  };
};
