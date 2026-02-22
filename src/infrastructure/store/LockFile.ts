import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../shared/errors/ErrorCode.js';

type LockPayload = {
  pid: number;
  createdAt: string;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export class LockFile {
  public constructor(private readonly filePath: string) {}

  public async acquire(timeoutMs = 2000): Promise<() => Promise<void>> {
    const startedAt = Date.now();

    await mkdir(path.dirname(this.filePath), { recursive: true });

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const handle = await open(this.filePath, 'wx');
        await handle.writeFile(
          `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() } satisfies LockPayload)}\n`
        );
        await handle.close();

        return async () => {
          await rm(this.filePath, { force: true });
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }

        await this.cleanupIfStale();
        await sleep(50);
      }
    }

    throw new AppError('Context lock acquisition timed out.', {
      code: ERROR_CODE.CONTEXT_LOCK_TIMEOUT,
      details: { filePath: this.filePath, timeoutMs },
      suggestions: ['Retry this command.', 'If contention persists, stop stale session and retry.']
    });
  }

  public async forceRemove(): Promise<void> {
    await rm(this.filePath, { force: true });
  }

  private async cleanupIfStale(): Promise<void> {
    try {
      const text = await readFile(this.filePath, 'utf8');
      const payload = JSON.parse(text) as LockPayload;
      if (!isProcessAlive(payload.pid)) {
        await rm(this.filePath, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await rm(this.filePath, { force: true });
      }
    }
  }
}
