import type { Command } from 'commander';

import { AppError } from '../../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { sendDaemonCommand, type CommandContext } from './common.js';

const toPageId = (input?: string): number | undefined => {
  if (!input) {
    return undefined;
  }

  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(`Invalid page id: ${input}`, {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Use a positive integer: --page 1']
    });
  }

  return value;
};

const toNumber = (name: string, input?: string): number | undefined => {
  if (input === undefined) {
    return undefined;
  }

  const value = Number(input);
  if (!Number.isFinite(value)) {
    throw new AppError(`${name} must be a finite number.`, {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: [`Use: --${name} 100`]
    });
  }

  return value;
};

const toPositiveInt = (name: string, input?: string): number | undefined => {
  if (input === undefined) {
    return undefined;
  }

  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(`${name} must be a positive integer.`, {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: [`Use: --${name} 1`]
    });
  }

  return value;
};

const toMouseButton = (input?: string): 'left' | 'right' | 'middle' | undefined => {
  if (!input) {
    return undefined;
  }

  if (input === 'left' || input === 'right' || input === 'middle') {
    return input;
  }

  throw new AppError('button must be one of left|right|middle.', {
    code: ERROR_CODE.VALIDATION_ERROR,
    suggestions: ['Use: --button left']
  });
};

export const registerInputCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const input = root.command('input').description('Keyboard and mouse input');

  input
    .command('key')
    .description('Press key or key-combo')
    .requiredOption('--key <key>', 'key name (e.g. Enter, Tab, ArrowDown)')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { key: string; page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.INPUT_KEY, {
        pageId: toPageId(opts.page),
        key: opts.key
      });
      await onResponse(response.ok, response);
    });

  input
    .command('type')
    .description('Type text into currently focused element')
    .requiredOption('--text <text>', 'text to type')
    .option('--delay-ms <n>', 'delay per character in milliseconds')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { text: string; delayMs?: string; page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.INPUT_TYPE, {
        pageId: toPageId(opts.page),
        text: opts.text,
        delayMs: toPositiveInt('delay-ms', opts.delayMs)
      });
      await onResponse(response.ok, response);
    });

  input
    .command('mouse-move')
    .description('Move mouse cursor to coordinates')
    .requiredOption('--x <n>', 'x coordinate')
    .requiredOption('--y <n>', 'y coordinate')
    .option('--steps <n>', 'number of interpolation steps')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { x: string; y: string; steps?: string; page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.INPUT_MOUSE_MOVE, {
        pageId: toPageId(opts.page),
        x: toNumber('x', opts.x),
        y: toNumber('y', opts.y),
        steps: toPositiveInt('steps', opts.steps)
      });
      await onResponse(response.ok, response);
    });

  input
    .command('click')
    .description('Click at coordinates')
    .requiredOption('--x <n>', 'x coordinate')
    .requiredOption('--y <n>', 'y coordinate')
    .option('--button <kind>', 'left|right|middle', 'left')
    .option('--count <n>', 'click count', '1')
    .option('--delay-ms <n>', 'delay between mousedown and mouseup')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { x: string; y: string; button?: string; count?: string; delayMs?: string; page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.INPUT_CLICK, {
        pageId: toPageId(opts.page),
        x: toNumber('x', opts.x),
        y: toNumber('y', opts.y),
        button: toMouseButton(opts.button),
        count: toPositiveInt('count', opts.count),
        delayMs: toPositiveInt('delay-ms', opts.delayMs)
      });
      await onResponse(response.ok, response);
    });

  input
    .command('mouse-down')
    .description('Press mouse button')
    .option('--button <kind>', 'left|right|middle', 'left')
    .option('--count <n>', 'click count', '1')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { button?: string; count?: string; page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.INPUT_MOUSE_DOWN, {
        pageId: toPageId(opts.page),
        button: toMouseButton(opts.button),
        count: toPositiveInt('count', opts.count)
      });
      await onResponse(response.ok, response);
    });

  input
    .command('mouse-up')
    .description('Release mouse button')
    .option('--button <kind>', 'left|right|middle', 'left')
    .option('--count <n>', 'click count', '1')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { button?: string; count?: string; page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.INPUT_MOUSE_UP, {
        pageId: toPageId(opts.page),
        button: toMouseButton(opts.button),
        count: toPositiveInt('count', opts.count)
      });
      await onResponse(response.ok, response);
    });

  input
    .command('drag')
    .description('Drag from source coordinates to target coordinates')
    .requiredOption('--from-x <n>', 'source x coordinate')
    .requiredOption('--from-y <n>', 'source y coordinate')
    .requiredOption('--to-x <n>', 'target x coordinate')
    .requiredOption('--to-y <n>', 'target y coordinate')
    .option('--steps <n>', 'number of interpolation steps', '16')
    .option('--button <kind>', 'left|right|middle', 'left')
    .option('--page <id>', 'target page id (default: current page)')
    .action(
      async (opts: {
        fromX: string;
        fromY: string;
        toX: string;
        toY: string;
        steps?: string;
        button?: string;
        page?: string;
      }) => {
        const response = await sendDaemonCommand(getCtx(), IPC_OP.INPUT_DRAG, {
          pageId: toPageId(opts.page),
          fromX: toNumber('from-x', opts.fromX),
          fromY: toNumber('from-y', opts.fromY),
          toX: toNumber('to-x', opts.toX),
          toY: toNumber('to-y', opts.toY),
          steps: toPositiveInt('steps', opts.steps),
          button: toMouseButton(opts.button)
        });
        await onResponse(response.ok, response);
      }
    );

  input
    .command('scroll')
    .description('Scroll using mouse wheel deltas')
    .requiredOption('--dy <n>', 'vertical delta')
    .option('--dx <n>', 'horizontal delta', '0')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { dx?: string; dy: string; page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.INPUT_SCROLL, {
        pageId: toPageId(opts.page),
        dx: toNumber('dx', opts.dx),
        dy: toNumber('dy', opts.dy)
      });
      await onResponse(response.ok, response);
    });

  input.action(async () => {
    input.outputHelp();
  });
};
