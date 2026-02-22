import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class AtomicJsonFile {
  public static async read<T>(filePath: string): Promise<T | null> {
    try {
      const content = await readFile(filePath, 'utf8');
      return JSON.parse(content) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  public static async write(filePath: string, data: unknown): Promise<void> {
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });

    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    const serialized = `${JSON.stringify(data, null, 2)}\n`;

    await writeFile(tempPath, serialized, 'utf8');
    await rename(tempPath, filePath);

    await rm(tempPath, { force: true });
  }
}
