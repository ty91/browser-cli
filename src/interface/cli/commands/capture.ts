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

export const registerCaptureCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const capture = root.command('capture').description('Capture page artifacts');

  capture
    .command('snapshot')
    .description('Capture HTML snapshot from target page')
    .option('--page <id>', 'target page id (default: current page)')
    .action(async (opts: { page?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.CAPTURE_SNAPSHOT, {
        pageId: toPageId(opts.page)
      });
      await onResponse(response.ok, response);
    });

  capture
    .command('screenshot')
    .description('Capture screenshot from target page')
    .option('--page <id>', 'target page id (default: current page)')
    .option('--file <path>', 'optional output file path')
    .option('--full-page', 'capture full page screenshot')
    .option('--format <type>', 'png|jpeg|webp')
    .option('--quality <0-100>', 'jpeg/webp quality')
    .action(
      async (opts: {
        page?: string;
        file?: string;
        fullPage?: boolean;
        format?: 'png' | 'jpeg' | 'webp';
        quality?: string;
      }) => {
        const quality = opts.quality ? Number(opts.quality) : undefined;
        if (quality !== undefined && (!Number.isInteger(quality) || quality < 0 || quality > 100)) {
          throw new AppError('quality must be an integer in range 0-100.', {
            code: ERROR_CODE.VALIDATION_ERROR,
            suggestions: ['Use values like --quality 80']
          });
        }

        const response = await sendDaemonCommand(getCtx(), IPC_OP.CAPTURE_SCREENSHOT, {
          pageId: toPageId(opts.page),
          filePath: opts.file,
          fullPage: opts.fullPage,
          format: opts.format,
          quality
        });
        await onResponse(response.ok, response);
      }
    );

  capture.action(async () => {
    throw new AppError('Missing capture subcommand.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Run: cdt capture --help']
    });
  });
};
