import type { Command } from 'commander';

import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { sendDaemonCommand, type CommandContext } from './common.js';

export const parseHeadless = (opts: { headless?: boolean; headed?: boolean }): boolean => {
  if (opts.headed) {
    return false;
  }
  return opts.headless === true;
};

const formatPageValue = (value: unknown): string => {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? String(value) : 'none';
};

const formatStartText = (data: unknown): string => {
  const payload = (data ?? {}) as {
    reused?: boolean;
    context?: { contextKeyHash?: string };
    runtime?: { selectedPageId?: number | null };
    session?: { currentPageId?: number | null };
  };

  const page = payload.runtime?.selectedPageId ?? payload.session?.currentPageId ?? null;
  return [
    payload.reused === true ? 'session reused' : 'session started',
    `context: ${payload.context?.contextKeyHash ?? '-'}`,
    `page: ${formatPageValue(page)}`
  ].join('\n');
};

const formatStatusText = (data: unknown): string => {
  const payload = (data ?? {}) as {
    context?: { contextKeyHash?: string };
    session?: { status?: string; currentPageId?: number | null };
    runtime?: { selectedPageId?: number | null };
  };
  const status = typeof payload.session?.status === 'string' ? payload.session.status : 'unknown';
  const page = payload.runtime?.selectedPageId ?? payload.session?.currentPageId ?? null;

  return [`session ${status}`, `context: ${payload.context?.contextKeyHash ?? '-'}`, `page: ${formatPageValue(page)}`].join('\n');
};

const formatStopText = (data: unknown): string => {
  const payload = (data ?? {}) as {
    context?: { contextKeyHash?: string };
  };

  return ['session stopped', `context: ${payload.context?.contextKeyHash ?? '-'}`].join('\n');
};

export const registerSessionCommands = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  root
    .command('start')
    .description('Start or reuse current context session')
    .option('--headless', 'Run in headless mode')
    .option('--headed', 'Run in headed mode')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { headless?: boolean; headed?: boolean; describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'start',
          payload: { headless: 'boolean (default: false)' },
          examples: ['browser start', 'browser start --headless --share-group qa']
        });
        return;
      }

      const ctx = getCtx();
      const response = await sendDaemonCommand(ctx, IPC_OP.SESSION_START, {
        headless: parseHeadless(opts)
      });
      if (!response.ok) {
        await onResponse(false, response);
        return;
      }

      await onResponse(true, { ...response, text: formatStartText(response.data) });
    });

  root
    .command('status')
    .description('Get session status for current context')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'status',
          payload: {},
          examples: ['browser status --output json']
        });
        return;
      }

      const ctx = getCtx();
      const response = await sendDaemonCommand(ctx, IPC_OP.SESSION_STATUS, {});
      if (!response.ok) {
        await onResponse(false, response);
        return;
      }

      await onResponse(true, { ...response, text: formatStatusText(response.data) });
    });

  root
    .command('stop')
    .description('Stop current context session')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'stop',
          payload: {},
          examples: ['browser stop --output json']
        });
        return;
      }

      const ctx = getCtx();
      const response = await sendDaemonCommand(ctx, IPC_OP.SESSION_STOP, {});
      if (!response.ok) {
        await onResponse(false, response);
        return;
      }

      await onResponse(true, { ...response, text: formatStopText(response.data) });
    });
};
