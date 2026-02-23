import type { Command } from 'commander';

import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
import { sendDaemonCommand, type CommandContext } from './common.js';

const toRef = (input: string): string => {
  const ref = input.trim();
  if (!ref) {
    throw new AppError('ref must not be empty.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Use: browser click e12']
    });
  }
  return ref;
};

const toKey = (input: string): string => {
  const key = input.trim();
  if (!key) {
    throw new AppError('key must not be empty.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Use: browser press Enter']
    });
  }
  return key;
};

const toTypeText = (input: string): string => {
  if (input.length === 0) {
    throw new AppError('text must not be empty.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Use: browser type e12 "Hello"']
    });
  }
  return input;
};

export const registerRefActionCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  root
    .command('click <ref>')
    .description('Click element by snapshot ref')
    .option('--describe', 'Show command schema and examples')
    .action(async (ref: string, opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'click',
          payload: { ref: 'string (required)' },
          examples: ['browser click e497']
        });
        return;
      }

      const normalizedRef = toRef(ref);
      const response = await sendDaemonCommand(getCtx(), IPC_OP.REF_CLICK, { ref: normalizedRef });
      if (!response.ok) {
        await onResponse(false, response);
        return;
      }
      await onResponse(true, { ...response, text: `clicked: ${normalizedRef}` });
    });

  root
    .command('doubleclick <ref>')
    .description('Double-click element by snapshot ref')
    .option('--describe', 'Show command schema and examples')
    .action(async (ref: string, opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'doubleclick',
          payload: { ref: 'string (required)' },
          examples: ['browser doubleclick e497']
        });
        return;
      }

      const normalizedRef = toRef(ref);
      const response = await sendDaemonCommand(getCtx(), IPC_OP.REF_DOUBLECLICK, { ref: normalizedRef });
      if (!response.ok) {
        await onResponse(false, response);
        return;
      }
      await onResponse(true, { ...response, text: `doubleclicked: ${normalizedRef}` });
    });

  root
    .command('hover <ref>')
    .description('Hover element by snapshot ref')
    .option('--describe', 'Show command schema and examples')
    .action(async (ref: string, opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'hover',
          payload: { ref: 'string (required)' },
          examples: ['browser hover e497']
        });
        return;
      }

      const normalizedRef = toRef(ref);
      const response = await sendDaemonCommand(getCtx(), IPC_OP.REF_HOVER, { ref: normalizedRef });
      if (!response.ok) {
        await onResponse(false, response);
        return;
      }
      await onResponse(true, { ...response, text: `hovered: ${normalizedRef}` });
    });

  root
    .command('fill <ref> <text>')
    .description('Clear existing value and fill text by ref')
    .option('--describe', 'Show command schema and examples')
    .action(async (ref: string, text: string, opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'fill',
          payload: { ref: 'string (required)', text: 'string (required)' },
          examples: ['browser fill e12 "Hello"']
        });
        return;
      }

      const normalizedRef = toRef(ref);
      const value = toTypeText(text);
      const response = await sendDaemonCommand(getCtx(), IPC_OP.REF_FILL, {
        ref: normalizedRef,
        text: value
      });
      if (!response.ok) {
        await onResponse(false, response);
        return;
      }
      await onResponse(true, { ...response, text: `filled: ${normalizedRef} (${value.length} chars)` });
    });

  root
    .command('type <ref> <text>')
    .description('Focus element by ref and type text')
    .option('--describe', 'Show command schema and examples')
    .action(async (ref: string, text: string, opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'type',
          payload: { ref: 'string (required)', text: 'string (required)' },
          examples: ['browser type e12 "Hello"']
        });
        return;
      }

      const normalizedRef = toRef(ref);
      const value = toTypeText(text);
      const response = await sendDaemonCommand(getCtx(), IPC_OP.REF_TYPE, {
        ref: normalizedRef,
        text: value
      });
      if (!response.ok) {
        await onResponse(false, response);
        return;
      }
      await onResponse(true, { ...response, text: `typed: ${normalizedRef} (${value.length} chars)` });
    });

  root
    .command('scrollintoview <ref>')
    .description('Scroll element into view by snapshot ref')
    .option('--describe', 'Show command schema and examples')
    .action(async (ref: string, opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'scrollintoview',
          payload: { ref: 'string (required)' },
          examples: ['browser scrollintoview e12']
        });
        return;
      }

      const normalizedRef = toRef(ref);
      const response = await sendDaemonCommand(getCtx(), IPC_OP.REF_SCROLL_INTO_VIEW, { ref: normalizedRef });
      if (!response.ok) {
        await onResponse(false, response);
        return;
      }
      await onResponse(true, { ...response, text: `scrolled into view: ${normalizedRef}` });
    });

  root
    .command('press <key>')
    .description('Press keyboard key on selected tab')
    .option('--describe', 'Show command schema and examples')
    .action(async (key: string, opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'press',
          payload: { key: 'string (required)' },
          examples: ['browser press Enter', 'browser press Tab']
        });
        return;
      }

      const normalizedKey = toKey(key);
      const response = await sendDaemonCommand(getCtx(), IPC_OP.INPUT_KEY, {
        key: normalizedKey
      });
      if (!response.ok) {
        await onResponse(false, response);
        return;
      }
      await onResponse(true, { ...response, text: `pressed: ${normalizedKey}` });
    });
};
