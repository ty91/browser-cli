import { rm } from 'node:fs/promises';

import { AtomicJsonFile } from './AtomicJsonFile.js';

type PidData = {
  pid: number;
  startedAt: string;
};

export class PidFile {
  public constructor(private readonly filePath: string) {}

  public async read(): Promise<PidData | null> {
    return AtomicJsonFile.read<PidData>(this.filePath);
  }

  public async write(pid: number): Promise<void> {
    await AtomicJsonFile.write(this.filePath, {
      pid,
      startedAt: new Date().toISOString()
    } satisfies PidData);
  }

  public async remove(): Promise<void> {
    await rm(this.filePath, { force: true });
  }

  public async isAlive(): Promise<boolean> {
    const data = await this.read();
    if (!data) {
      return false;
    }

    try {
      process.kill(data.pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
