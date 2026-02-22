import type { Command } from 'commander';

import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
import { sendDaemonCommand, type CommandContext } from './common.js';

const toPositiveInt = (name: string, input?: string): number | undefined => {
  if (!input) {
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

export const registerNetworkCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const network = root.command('network').description('Network request inspection');

  network
    .command('list')
    .description('List network requests')
    .option('--page <id>', 'target page id')
    .option('--limit <n>', 'max requests')
    .option('--method <method>', 'HTTP method filter')
    .action(async (opts: { page?: string; limit?: string; method?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.NETWORK_LIST, {
        pageId: toPositiveInt('page', opts.page),
        limit: toPositiveInt('limit', opts.limit),
        method: opts.method
      });
      await onResponse(response.ok, response);
    });

  network
    .command('get')
    .description('Get a network request by id')
    .requiredOption('--id <id>', 'request id')
    .option('--request-file <path>', 'write request body to file')
    .option('--response-file <path>', 'write response body to file')
    .action(async (opts: { id: string; requestFile?: string; responseFile?: string }) => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.NETWORK_GET, {
        id: toPositiveInt('id', opts.id),
        requestFilePath: opts.requestFile,
        responseFilePath: opts.responseFile
      });
      await onResponse(response.ok, response);
    });

  network.action(async () => {
    throw new AppError('Missing network subcommand.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Run: cdt network --help']
    });
  });
};
