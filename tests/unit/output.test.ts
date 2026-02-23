import { describe, expect, it, vi } from 'vitest';

import { writeResponse } from '../../src/interface/cli/output.js';

describe('output rendering', () => {
  it('uses custom text when provided in text mode', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      writeResponse(
        {
          id: 'test',
          ok: true,
          data: { value: 1 },
          meta: { durationMs: 0 },
          text: 'session started\ncontext: ctx_123'
        },
        'text'
      );

      expect(spy).toHaveBeenCalledWith('session started\ncontext: ctx_123\n');
    } finally {
      spy.mockRestore();
    }
  });

  it('strips custom text field in json mode', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      writeResponse(
        {
          id: 'test',
          ok: true,
          data: { value: 1 },
          meta: { durationMs: 0 },
          text: 'hidden in json'
        },
        'json'
      );

      const written = spy.mock.calls[0]?.[0];
      expect(typeof written).toBe('string');
      const parsed = JSON.parse(String(written));
      expect(parsed.ok).toBe(true);
      expect(parsed.text).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
