import { Command } from 'commander';

import type { ResponseEnvelope } from '../../shared/schema/envelopes.js';
import { collectCallerContext } from './context.js';
import { mapExitCode, toFailureEnvelope } from './errors.js';
import { writeDiagnostic, writeResponse, type OutputFormat } from './output.js';
import { registerSessionCommands } from './commands/session.js';
import { registerDaemonCommands } from './commands/daemon.js';
import { registerPageCommands } from './commands/page.js';
import { registerElementCommands } from './commands/element.js';
import { registerInputCommands } from './commands/input.js';
import { registerDialogCommands } from './commands/dialog.js';
import { registerRuntimeCommands } from './commands/runtime.js';
import { registerCaptureCommands } from './commands/capture.js';
import { registerConsoleCommands } from './commands/console.js';
import { registerNetworkCommands } from './commands/network.js';
import { registerEmulationCommands } from './commands/emulation.js';
import { registerTraceCommands } from './commands/trace.js';

export type ProgramResult = {
  exitCode: number;
};

type GlobalOptions = {
  output: OutputFormat;
  shareGroup?: string;
  contextId?: string;
  timeout?: string;
  describe?: boolean;
  debug?: boolean;
  home?: string;
};

const normalizeEnvelope = (payload: unknown): ResponseEnvelope => {
  const maybeEnvelope = payload as Partial<ResponseEnvelope>;

  if (typeof maybeEnvelope === 'object' && maybeEnvelope && 'ok' in maybeEnvelope) {
    return {
      id: maybeEnvelope.id ?? 'response',
      ok: Boolean(maybeEnvelope.ok),
      data: maybeEnvelope.data,
      error: maybeEnvelope.error,
      meta: maybeEnvelope.meta ?? { durationMs: 0 }
    };
  }

  return {
    id: 'local-success',
    ok: true,
    data: payload as Record<string, unknown>,
    meta: { durationMs: 0 }
  };
};

export const createProgram = (): Command => {
  const program = new Command();

  program
    .name('cdt')
    .description('Chrome DevTools style browser control CLI')
    .option('--output <format>', 'output format: json|text', 'json')
    .option('--share-group <name>', 'explicit context sharing group')
    .option('--context-id <id>', 'manual context routing override')
    .option('--timeout <ms>', 'request timeout in ms')
    .option('--home <path>', 'override cdt home directory (default: ~/.cdt)')
    .option('--describe', 'show schema/examples for command')
    .option('--debug', 'print diagnostics to stderr for errors');

  const getContext = (): {
    caller: ReturnType<typeof collectCallerContext>;
    output: OutputFormat;
    shareGroup?: string;
    contextId?: string;
    timeout?: number;
    debug: boolean;
    homeDir?: string;
  } => {
    const options = program.opts<GlobalOptions>();
    return {
      caller: collectCallerContext(),
      output: options.output === 'text' ? 'text' : 'json',
      shareGroup: options.shareGroup,
      contextId: options.contextId,
      timeout: options.timeout ? Number(options.timeout) : undefined,
      debug: options.debug ?? false,
      homeDir: options.home
    };
  };

  const onResponse = async (ok: boolean, payload: unknown): Promise<void> => {
    const options = getContext();
    const envelope = normalizeEnvelope(payload);
    writeResponse(envelope, options.output);
    if (!ok || !envelope.ok) {
      process.exitCode = mapExitCode(envelope.error?.code ?? 'INTERNAL_ERROR');
    }
  };

  registerSessionCommands(program, getContext, onResponse);
  registerDaemonCommands(program, getContext, onResponse);
  registerPageCommands(program, getContext, onResponse);
  registerElementCommands(program, getContext, onResponse);
  registerInputCommands(program, getContext, onResponse);
  registerDialogCommands(program, getContext, onResponse);
  registerRuntimeCommands(program, getContext, onResponse);
  registerCaptureCommands(program, getContext, onResponse);
  registerConsoleCommands(program, getContext, onResponse);
  registerNetworkCommands(program, getContext, onResponse);
  registerEmulationCommands(program, getContext, onResponse);
  registerTraceCommands(program, getContext, onResponse);

  program.command('errors').action(async () => {
    await onResponse(true, {
      id: 'errors-list',
      ok: true,
      data: {
        codes: [
          'VALIDATION_ERROR',
          'SESSION_NOT_FOUND',
          'SESSION_ALREADY_RUNNING',
          'CONTEXT_RESOLUTION_FAILED',
          'CONTEXT_LOCK_TIMEOUT',
          'CONTEXT_LEASE_EXPIRED',
          'TIMEOUT',
          'DAEMON_UNAVAILABLE',
          'IPC_PROTOCOL_ERROR',
          'INTERNAL_ERROR'
        ]
      },
      meta: { durationMs: 0 }
    });
  });

  program.action(async () => {
    const options = program.opts<GlobalOptions>();
    if (options.describe) {
      await onResponse(true, {
        id: 'root-describe',
        ok: true,
        data: {
          command: 'cdt',
          examples: [
            'cdt session start',
            'cdt page open --url https://example.com',
            'cdt runtime eval --function "() => document.title"',
            'cdt trace start --file ./trace.json'
          ]
        },
        meta: { durationMs: 0 }
      });
      return;
    }

    await onResponse(true, {
      id: 'root-help',
      ok: true,
      data: {
        message: 'Run cdt --help for available commands.'
      },
      meta: { durationMs: 0 }
    });
  });

  return program;
};

export const runProgram = async (argv: string[]): Promise<ProgramResult> => {
  const program = createProgram();

  try {
    await program.parseAsync(argv);
    return { exitCode: typeof process.exitCode === 'number' ? process.exitCode : 0 };
  } catch (error) {
    const options = program.opts<GlobalOptions>();
    const envelope = toFailureEnvelope('local-error', error);

    if (options.debug) {
      writeDiagnostic(error instanceof Error ? error.stack ?? error.message : String(error));
    }

    writeResponse(envelope, options.output === 'text' ? 'text' : 'json');

    return { exitCode: mapExitCode(envelope.error?.code ?? 'INTERNAL_ERROR') };
  }
};
