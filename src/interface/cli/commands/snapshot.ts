import type { Command } from 'commander';

import { IPC_OP } from '../../../infrastructure/ipc/protocol.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../../shared/errors/ErrorCode.js';
import { sendDaemonCommand, type CommandContext } from './common.js';

const SNAPSHOT_MAX_LINES = 1_500;
const TRUNCATED_SUFFIX = ' ... [truncated]';

type SnapshotPage = {
  id: number;
  url: string;
  title: string;
  selected: boolean;
};

type SnapshotPayload = {
  format: 'aria-ref-like';
  tree: string;
  nodeCount: number;
  capturedAt: string;
};

type SnapshotAriaData = {
  page: SnapshotPage;
  snapshot: SnapshotPayload;
};

type SnapshotTextResult = {
  text: string;
  truncated: boolean;
  totalLines: number;
  outputLines: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

const parseSnapshotAriaData = (input: unknown): SnapshotAriaData => {
  if (!isRecord(input) || !isRecord(input.page) || !isRecord(input.snapshot)) {
    throw new AppError('Daemon returned malformed snapshot payload.', {
      code: ERROR_CODE.IPC_PROTOCOL_ERROR,
      suggestions: ['Retry once.', 'If this issue repeats, restart daemon: browser daemon restart']
    });
  }

  const page = input.page;
  const snapshot = input.snapshot;
  if (
    !isInteger(page.id) ||
    typeof page.url !== 'string' ||
    typeof page.title !== 'string' ||
    typeof page.selected !== 'boolean' ||
    snapshot.format !== 'aria-ref-like' ||
    typeof snapshot.tree !== 'string' ||
    !isInteger(snapshot.nodeCount) ||
    typeof snapshot.capturedAt !== 'string'
  ) {
    throw new AppError('Daemon returned malformed snapshot fields.', {
      code: ERROR_CODE.IPC_PROTOCOL_ERROR,
      suggestions: ['Retry once.', 'If this issue repeats, restart daemon: browser daemon restart']
    });
  }

  return {
    page: {
      id: page.id,
      url: page.url,
      title: page.title,
      selected: page.selected
    },
    snapshot: {
      format: snapshot.format,
      tree: snapshot.tree,
      nodeCount: snapshot.nodeCount,
      capturedAt: snapshot.capturedAt
    }
  };
};

export const buildSnapshotText = (data: SnapshotAriaData): string =>
  ['snapshot (do-not-commit)', `url: ${data.page.url}`, `title: ${data.page.title}`, '', data.snapshot.tree].join('\n');

export const applySnapshotLineLimit = (text: string, maxLines = SNAPSHOT_MAX_LINES): SnapshotTextResult => {
  if (!Number.isInteger(maxLines) || maxLines <= 0) {
    throw new AppError('snapshot max line limit must be a positive integer.', {
      code: ERROR_CODE.INTERNAL_ERROR
    });
  }

  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (lines.length <= maxLines) {
    return {
      text: normalized,
      truncated: false,
      totalLines: lines.length,
      outputLines: lines.length
    };
  }

  const output = lines.slice(0, maxLines);
  output[maxLines - 1] = `${output[maxLines - 1]}${TRUNCATED_SUFFIX}`;
  return {
    text: output.join('\n'),
    truncated: true,
    totalLines: lines.length,
    outputLines: output.length
  };
};

export const registerSnapshotCommand = (
  root: Command,
  getCtx: () => CommandContext,
  onResponse: (ok: boolean, response: unknown) => Promise<void>
): void => {
  root
    .command('snapshot')
    .description('Print LLM-friendly accessibility snapshot for selected tab')
    .option('--describe', 'Show command schema and examples')
    .action(async (opts: { describe?: boolean }) => {
      if (opts.describe) {
        await onResponse(true, {
          command: 'snapshot',
          payload: {},
          examples: ['browser snapshot', 'browser snapshot --output json']
        });
        return;
      }

      const response = await sendDaemonCommand(getCtx(), IPC_OP.SNAPSHOT_ARIA, {});
      if (!response.ok) {
        await onResponse(false, response);
        return;
      }

      const data = parseSnapshotAriaData(response.data);
      const limited = applySnapshotLineLimit(buildSnapshotText(data));
      await onResponse(true, {
        ...response,
        data: {
          page: data.page,
          snapshot: {
            format: data.snapshot.format,
            text: limited.text,
            nodeCount: data.snapshot.nodeCount,
            capturedAt: data.snapshot.capturedAt,
            truncated: limited.truncated,
            totalLines: limited.totalLines,
            outputLines: limited.outputLines
          }
        },
        text: limited.text
      });
    });
};
