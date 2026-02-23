import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildScreenshotFilePath,
  buildScreenshotFilename,
  formatScreenshotTimestamp,
  generateLowerAlnumSuffix
} from '../../src/interface/cli/commands/screenshot.js';

describe('screenshot command helpers', () => {
  it('formats timestamp with filesystem-safe separators', () => {
    const date = new Date('2026-02-23T02:14:08.258Z');
    expect(formatScreenshotTimestamp(date)).toBe('2026-02-23T02-14-08-258Z');
  });

  it('builds screenshot filename in expected format', () => {
    const date = new Date('2026-02-23T02:14:08.258Z');
    const filename = buildScreenshotFilename(date, '6uqmfp');
    expect(filename).toBe('screenshot-2026-02-23T02-14-08-258Z-6uqmfp.jpg');
  });

  it('builds screenshot path under screenshots directory', () => {
    const date = new Date('2026-02-23T02:14:08.258Z');
    const actual = buildScreenshotFilePath('/tmp/browser-home', date, '6uqmfp');
    const expected = path.join('/tmp/browser-home', 'screenshots', 'screenshot-2026-02-23T02-14-08-258Z-6uqmfp.jpg');
    expect(actual).toBe(expected);
  });

  it('generates lowercase alphanumeric suffix', () => {
    const suffix = generateLowerAlnumSuffix(6);
    expect(suffix).toMatch(/^[a-z0-9]{6}$/);
  });
});
