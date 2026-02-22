import { describe, expect, it } from 'vitest';

import { parseHeadless } from '../../src/interface/cli/commands/session.js';

describe('session start option parsing', () => {
  it('defaults to headed mode', () => {
    expect(parseHeadless({})).toBe(false);
  });

  it('enables headless when requested', () => {
    expect(parseHeadless({ headless: true })).toBe(true);
  });

  it('keeps headed when --headed is explicit', () => {
    expect(parseHeadless({ headless: true, headed: true })).toBe(false);
  });
});
