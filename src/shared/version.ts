import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_VERSION = '0.1.0';

type PackageManifest = {
  version?: unknown;
};

const resolveCliVersion = (): string => {
  try {
    const thisFilePath = fileURLToPath(import.meta.url);
    const rootDir = path.resolve(path.dirname(thisFilePath), '../..');
    const packagePath = path.join(rootDir, 'package.json');
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as PackageManifest;

    return typeof manifest.version === 'string' && manifest.version.trim().length > 0
      ? manifest.version
      : DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
};

export const CLI_VERSION = resolveCliVersion();
