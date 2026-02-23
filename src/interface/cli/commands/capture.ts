import type { Command } from 'commander';

import { AppError } from '../../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { writeDiagnostic } from '../output.js';
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

const toPositiveInt = (name: string, input?: string): number | undefined => {
  if (input === undefined) {
    return undefined;
  }

  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(`${name} must be a positive integer.`, {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: [`Use: --${name} 1280`]
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
    .option('--dir <path>', 'optional output directory for generated file name')
    .option('--label <name>', 'optional label in generated file name')
    .option('--full-page', 'capture full page screenshot')
    .option('--format <type>', 'png|jpeg|webp')
    .option('--quality <0-100>', 'jpeg/webp quality')
    .option('--max-width <px>', 'optional max output width')
    .option('--max-height <px>', 'optional max output height')
    .option('--keep <n>', 'artifact retention count (default: 300)')
    .action(
      async (opts: {
        page?: string;
        file?: string;
        dir?: string;
        label?: string;
        fullPage?: boolean;
        format?: 'png' | 'jpeg' | 'webp';
        quality?: string;
        maxWidth?: string;
        maxHeight?: string;
        keep?: string;
      }) => {
        writeDiagnostic('[deprecated] Use "browser screenshot" instead of "browser capture screenshot".');

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
          dirPath: opts.dir,
          label: opts.label,
          fullPage: opts.fullPage,
          format: opts.format,
          quality,
          maxWidth: toPositiveInt('max-width', opts.maxWidth),
          maxHeight: toPositiveInt('max-height', opts.maxHeight),
          keep: toPositiveInt('keep', opts.keep)
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
