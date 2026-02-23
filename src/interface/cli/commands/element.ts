import { readFile } from 'node:fs/promises';

import type { Command } from 'commander';

import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
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

const parseEntries = (raw: string): Array<{ selector: string; value: string }> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError('Invalid JSON for fill-form entries.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Use a valid JSON array of {selector,value}.']
    });
  }

  if (!Array.isArray(parsed)) {
    throw new AppError('fill-form entries must be a JSON array.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Use format: [{"selector":"#a","value":"x"}]']
    });
  }

  return parsed.map((item) => {
    const row = item as { selector?: unknown; value?: unknown };
    if (typeof row.selector !== 'string' || typeof row.value !== 'string') {
      throw new AppError('Each fill-form entry must include string selector/value.', {
        code: ERROR_CODE.VALIDATION_ERROR,
        suggestions: ['Use format: [{"selector":"#a","value":"x"}]']
      });
    }

    return {
      selector: row.selector,
      value: row.value
    };
  });
};

export const registerElementCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const element = root.command('element').description('Element interactions');

  element
    .command('fill')
    .description('Fill input/textarea/contenteditable element')
    .requiredOption('--uid <selector>', 'CSS selector')
    .requiredOption('--value <value>', 'value to fill')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { uid: string; value: string; page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.ELEMENT_FILL, {
        pageId: toPageId(opts.page),
        selector: opts.uid,
        value: opts.value
      });
      await onResponse(response.ok, response);
    });

  element
    .command('fill-form')
    .description('Fill multiple elements from JSON entries')
    .option('--entries <json>', 'JSON array: [{"selector":"#a","value":"x"}]')
    .option('--entries-file <path>', 'path to JSON array file')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { entries?: string; entriesFile?: string; page?: string }) => {
      if (!opts.entries && !opts.entriesFile) {
        throw new AppError('Either --entries or --entries-file is required.', {
          code: ERROR_CODE.VALIDATION_ERROR,
          suggestions: ['Use --entries \'[{"selector":"#email","value":"a@b.com"}]\'']
        });
      }

      let raw = opts.entries ?? '';
      if (opts.entriesFile) {
        raw = await readFile(opts.entriesFile, 'utf8');
      }

      const response = await sendDaemonCommand(getCtx(), IPC_OP.ELEMENT_FILL_FORM, {
        pageId: toPageId(opts.page),
        entries: parseEntries(raw)
      });
      await onResponse(response.ok, response);
    });

  element
    .command('drag')
    .description('Drag an element onto another element')
    .requiredOption('--from <selector>', 'source CSS selector')
    .requiredOption('--to <selector>', 'target CSS selector')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { from: string; to: string; page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.ELEMENT_DRAG, {
        pageId: toPageId(opts.page),
        fromSelector: opts.from,
        toSelector: opts.to
      });
      await onResponse(response.ok, response);
    });

  element
    .command('upload')
    .description('Upload file through a file input')
    .requiredOption('--uid <selector>', 'file input CSS selector')
    .requiredOption('--file <path>', 'local file path')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { uid: string; file: string; page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.ELEMENT_UPLOAD, {
        pageId: toPageId(opts.page),
        selector: opts.uid,
        filePath: opts.file
      });
      await onResponse(response.ok, response);
    });

  element.action(async () => {
    element.outputHelp();
  });
};
