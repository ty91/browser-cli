import { AppError, isAppError } from './AppError.js';
import { ERROR_CODE } from './ErrorCode.js';

export type CliError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  suggestions: string[];
};

const INTERNAL_SUGGESTIONS = ['Retry once. If it still fails, run with --debug for diagnostics.'];

export const toCliError = (error: unknown): CliError => {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      suggestions: error.suggestions.length > 0 ? error.suggestions : INTERNAL_SUGGESTIONS
    };
  }

  const wrapped = new AppError('Unexpected internal failure.', {
    code: ERROR_CODE.INTERNAL_ERROR,
    details: {
      originalError: error instanceof Error ? error.message : String(error)
    },
    suggestions: INTERNAL_SUGGESTIONS
  });

  return {
    code: wrapped.code,
    message: wrapped.message,
    details: wrapped.details,
    suggestions: wrapped.suggestions
  };
};
