import { describe, expect, it } from 'vitest';

import { applySnapshotLineLimit, buildSnapshotText } from '../../src/interface/cli/commands/snapshot.js';

describe('snapshot command helpers', () => {
  it('builds snapshot text with page metadata and raw body', () => {
    const text = buildSnapshotText({
      page: {
        id: 1,
        url: 'https://example.com',
        title: 'Example Domain',
        selected: true
      },
      snapshot: {
        format: 'playwright-aria',
        raw: '- generic [ref=s1e1]:\n  - heading "Example Domain" [level=1]',
        nodeCount: 1,
        capturedAt: '2026-02-23T11:00:00.000Z'
      }
    });

    expect(text).not.toContain('snapshot (do-not-commit)');
    expect(text.startsWith('url: https://example.com')).toBe(true);
    expect(text).toContain('url: https://example.com');
    expect(text).toContain('title: Example Domain');
    expect(text).toContain('heading "Example Domain"');
  });

  it('does not truncate when text has 1500 lines or fewer', () => {
    const text = new Array(1500).fill(0).map((_, index) => `line-${index + 1}`).join('\n');
    const limited = applySnapshotLineLimit(text);

    expect(limited.truncated).toBe(false);
    expect(limited.totalLines).toBe(1500);
    expect(limited.outputLines).toBe(1500);
    expect(limited.text.split('\n').length).toBe(1500);
  });

  it('truncates when text has more than 1500 lines', () => {
    const text = new Array(1502).fill(0).map((_, index) => `line-${index + 1}`).join('\n');
    const limited = applySnapshotLineLimit(text);
    const lines = limited.text.split('\n');

    expect(limited.truncated).toBe(true);
    expect(limited.totalLines).toBe(1502);
    expect(limited.outputLines).toBe(1500);
    expect(lines.length).toBe(1500);
    expect(lines[1499]).toContain('line-1500');
    expect(lines[1499]).toContain('[truncated]');
  });

  it('throws for invalid line limit', () => {
    expect(() => applySnapshotLineLimit('x', 0)).toThrow();
  });
});
