import type { Command } from 'commander';

import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
import { sendDaemonCommand, type CommandContext } from './common.js';

const parseViewport = (input?: string):
  | {
      width: number;
      height: number;
    }
  | undefined => {
  if (!input) {
    return undefined;
  }

  const [widthRaw, heightRaw] = input.toLowerCase().split('x');
  const width = Number(widthRaw);
  const height = Number(heightRaw);

  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new AppError('viewport must be WIDTHxHEIGHT (e.g. 1280x720).', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Use: --viewport 1280x720']
    });
  }

  return {
    width,
    height
  };
};

const parseGeolocation = (input?: string):
  | {
      latitude: number;
      longitude: number;
    }
  | undefined => {
  if (!input) {
    return undefined;
  }

  const [latRaw, lonRaw] = input.split(',').map((item) => item.trim());
  const latitude = Number(latRaw);
  const longitude = Number(lonRaw);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new AppError('geolocation must be LAT,LON (e.g. 37.7749,-122.4194).', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Use: --geolocation 37.7749,-122.4194']
    });
  }

  return {
    latitude,
    longitude
  };
};

export const registerEmulationCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  const emulation = root.command('emulation').description('Emulation controls');

  emulation
    .command('set')
    .description('Apply emulation settings')
    .option('--viewport <WxH>', 'viewport size like 1280x720')
    .option('--user-agent <ua>', 'custom user-agent string')
    .option('--network <profile>', 'Slow 3G | Fast 3G | Slow 4G | Fast 4G')
    .option('--geolocation <lat,lon>', 'geolocation coordinates')
    .action(
      async (opts: { viewport?: string; userAgent?: string; network?: string; geolocation?: string }) => {
        const response = await sendDaemonCommand(getCtx(), IPC_OP.EMULATION_SET, {
          viewport: parseViewport(opts.viewport),
          userAgent: opts.userAgent,
          networkProfile: opts.network,
          geolocation: parseGeolocation(opts.geolocation)
        });
        await onResponse(response.ok, response);
      }
    );

  emulation
    .command('reset')
    .description('Reset emulation settings to defaults')
    .action(async () => {
      const response = await sendDaemonCommand(getCtx(), IPC_OP.EMULATION_RESET, {});
      await onResponse(response.ok, response);
    });

  emulation.action(async () => {
    throw new AppError('Missing emulation subcommand.', {
      code: ERROR_CODE.VALIDATION_ERROR,
      suggestions: ['Run: cdt emulation --help']
    });
  });
};
