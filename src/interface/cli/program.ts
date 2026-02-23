import { Command, CommanderError } from 'commander';

import { collectCallerContext } from './context.js';
import { mapExitCode, toFailureEnvelope } from './errors.js';
import { writeDiagnostic, writeResponse, type OutputFormat, type RenderableResponse } from './output.js';
import { AppError } from '../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../shared/errors/ErrorCode.js';
import { registerSessionCommands } from './commands/session.js';
import { registerDaemonCommands } from './commands/daemon.js';
import { registerPageCommands } from './commands/page.js';
import { registerTabCommands } from './commands/tab.js';
import { registerNavigationCommands } from './commands/navigation.js';
import { registerObserveCommands } from './commands/observe.js';
import { registerElementCommands } from './commands/element.js';
import { registerInputCommands } from './commands/input.js';
import { registerDialogCommands } from './commands/dialog.js';
import { registerRuntimeCommands } from './commands/runtime.js';
import { registerSnapshotCommand } from './commands/snapshot.js';
import { registerScreenshotCommand } from './commands/screenshot.js';
import { registerRefActionCommands } from './commands/ref-actions.js';
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

const COMMANDER_HELP_CODES = new Set(['commander.helpDisplayed', 'commander.version']);
const COMMANDER_MISSING_INPUT_CODES = new Set(['commander.missingArgument', 'commander.optionMissingArgument']);

const normalizeEnvelope = (payload: unknown): RenderableResponse => {
  const maybeEnvelope = payload as Partial<RenderableResponse>;

  if (typeof maybeEnvelope === 'object' && maybeEnvelope && 'ok' in maybeEnvelope) {
    return {
      id: maybeEnvelope.id ?? 'response',
      ok: Boolean(maybeEnvelope.ok),
      data: maybeEnvelope.data,
      error: maybeEnvelope.error,
      meta: maybeEnvelope.meta ?? { durationMs: 0 },
      text: typeof maybeEnvelope.text === 'string' ? maybeEnvelope.text : undefined
    };
  }

  return {
    id: 'local-success',
    ok: true,
    data: payload as Record<string, unknown>,
    meta: { durationMs: 0 }
  };
};

const formatHelpText = (command: Command): string => {
  const help = command.helpInformation();
  return help.endsWith('\n') ? help : `${help}\n`;
};

const writeCommandHelp = (command: Command, stream: 'stdout' | 'stderr'): void => {
  const help = formatHelpText(command);
  if (stream === 'stdout') {
    process.stdout.write(help);
    return;
  }

  process.stderr.write(help);
};

const findDirectSubcommand = (command: Command, token: string): Command | null => {
  for (const subcommand of command.commands) {
    if (subcommand.name() === token || subcommand.aliases().includes(token)) {
      return subcommand;
    }
  }

  return null;
};

const resolveCommandPath = (
  root: Command,
  rawTokens: string[]
): {
  command: Command;
  consumedAll: boolean;
} => {
  const tokens = [...rawTokens];
  let current = root;
  let consumed = 0;
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token || token === '--') {
      break;
    }

    if (token.startsWith('-')) {
      const normalized = token.startsWith('--') ? token.split('=')[0] : token;
      const matchedOption = current.options.find((option) => option.short === normalized || option.long === normalized);
      index += 1;

      if (matchedOption && !token.includes('=') && (matchedOption.required || matchedOption.optional) && index < tokens.length) {
        index += 1;
      }

      continue;
    }

    const next = findDirectSubcommand(current, token);
    if (!next) {
      break;
    }

    current = next;
    consumed += 1;
    index += 1;
  }

  return {
    command: current,
    consumedAll: consumed === rawTokens.filter((token) => token && !token.startsWith('-')).length
  };
};

const resolveHelpTarget = (program: Command, argv: string[], lastActionCommand: Command | null): Command => {
  if (lastActionCommand) {
    return lastActionCommand;
  }

  const tokens = argv.slice(2);
  const resolved = resolveCommandPath(program, tokens);
  return resolved.command;
};

const toValidationEnvelope = (message: string): RenderableResponse =>
  toFailureEnvelope(
    'local-error',
    new AppError(message, {
      code: ERROR_CODE.VALIDATION_ERROR
    })
  );

const stripCommanderPrefix = (message: string): string => message.replace(/^error:\s*/i, '').trim();

const applyCommanderParsingConfig = (command: Command): void => {
  command.exitOverride();
  command.configureOutput({
    writeOut: (str) => {
      process.stdout.write(str);
    },
    writeErr: () => {
      // Commander parse errors are rendered by our own error handling in runProgram().
    },
    outputError: () => {
      // Commander parse errors are rendered by our own error handling in runProgram().
    }
  });

  for (const subcommand of command.commands) {
    applyCommanderParsingConfig(subcommand);
  }
};

export const createProgram = (): Command => {
  const program = new Command();

  program
    .name('browser')
    .description('Chrome DevTools style browser control CLI')
    .option('--output <format>', 'output format: json|text', 'text')
    .option('--share-group <name>', 'explicit context sharing group')
    .option('--context-id <id>', 'manual context routing override')
    .option('--timeout <ms>', 'request timeout in ms')
    .option('--home <path>', 'override browser home directory (default: ~/.browser)')
    .option('--describe', 'show schema/examples for command')
    .option('--debug', 'print diagnostics to stderr for errors');
  program.addHelpCommand(false);

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
  registerNavigationCommands(program, getContext, onResponse);
  registerTabCommands(program, getContext, onResponse);
  registerPageCommands(program, getContext, onResponse);
  registerObserveCommands(program, getContext, onResponse);
  registerElementCommands(program, getContext, onResponse);
  registerInputCommands(program, getContext, onResponse);
  registerDialogCommands(program, getContext, onResponse);
  registerRuntimeCommands(program, getContext, onResponse);
  registerSnapshotCommand(program, getContext, onResponse);
  registerScreenshotCommand(program, getContext, onResponse);
  registerRefActionCommands(program, getContext, onResponse);
  registerConsoleCommands(program, getContext, onResponse);
  registerNetworkCommands(program, getContext, onResponse);
  registerEmulationCommands(program, getContext, onResponse);
  registerTraceCommands(program, getContext, onResponse);

  program
    .command('help [command...]')
    .description('display help for command')
    .action(async (commandPath: string[] = []) => {
      if (commandPath.length === 0) {
        writeCommandHelp(program, 'stdout');
        return;
      }

      const current = commandPath.reduce<Command | null>((command, token) => {
        if (!command) {
          return null;
        }
        return findDirectSubcommand(command, token);
      }, program);

      if (!current) {
        throw new AppError(`Unknown command path: ${commandPath.join(' ')}`, {
          code: ERROR_CODE.VALIDATION_ERROR,
          suggestions: ['Run: browser --help']
        });
      }

      writeCommandHelp(current, 'stdout');
    });

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
          'TARGET_OUT_OF_VIEW',
          'TARGET_OBSCURED',
          'TARGET_NOT_INTERACTABLE',
          'ACTION_NO_EFFECT',
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
          command: 'browser',
          examples: [
            'browser start',
            'browser open https://example.com',
            'browser navigate https://example.com/dashboard',
            'browser tabs',
            'browser tab new',
            'browser snapshot',
            'browser screenshot',
            'browser click e497',
            'browser doubleclick e497',
            'browser hover e497',
            'browser type e12 "Hello"',
            'browser scrollintoview e497',
            'browser press Enter',
            'browser observe state',
            'browser runtime eval --function "() => document.title"',
            'browser trace start --file ./trace.json'
          ]
        },
        meta: { durationMs: 0 }
      });
      return;
    }

    writeCommandHelp(program, 'stdout');
  });

  return program;
};

export const runProgram = async (argv: string[]): Promise<ProgramResult> => {
  const program = createProgram();
  let lastActionCommand: Command | null = null;

  applyCommanderParsingConfig(program);
  program.hook('preAction', (_thisCommand, actionCommand) => {
    lastActionCommand = actionCommand;
  });

  try {
    await program.parseAsync(argv);
    return { exitCode: typeof process.exitCode === 'number' ? process.exitCode : 0 };
  } catch (error) {
    const options = program.opts<GlobalOptions>();

    if (error instanceof CommanderError) {
      if (COMMANDER_HELP_CODES.has(error.code)) {
        return { exitCode: 0 };
      }

      const target = resolveHelpTarget(program, argv, lastActionCommand);

      if (COMMANDER_MISSING_INPUT_CODES.has(error.code)) {
        writeCommandHelp(target, 'stdout');
        return { exitCode: 0 };
      }

      const envelope = toValidationEnvelope(stripCommanderPrefix(error.message));
      if (options.debug) {
        writeDiagnostic(error.stack ?? error.message);
      }
      writeResponse(envelope, options.output === 'text' ? 'text' : 'json');
      writeCommandHelp(target, 'stderr');
      return { exitCode: mapExitCode(ERROR_CODE.VALIDATION_ERROR) };
    }

    const envelope = toFailureEnvelope('local-error', error);

    if (options.debug) {
      writeDiagnostic(error instanceof Error ? error.stack ?? error.message : String(error));
    }

    writeResponse(envelope, options.output === 'text' ? 'text' : 'json');
    if (envelope.error?.code === ERROR_CODE.VALIDATION_ERROR) {
      const target = resolveHelpTarget(program, argv, lastActionCommand);
      writeCommandHelp(target, 'stderr');
    }

    return { exitCode: mapExitCode(envelope.error?.code ?? 'INTERNAL_ERROR') };
  }
};
