import { describe, expect, it } from 'vitest';

import { ERROR_CODE } from '../../src/shared/errors/ErrorCode.js';
import { findTabByIndex, parseTabIndex, toTabsView } from '../../src/interface/cli/commands/tab.js';

describe('tab command helpers', () => {
  it('parses positive tab index', () => {
    expect(parseTabIndex('2')).toBe(2);
  });

  it('rejects invalid tab index', () => {
    try {
      parseTabIndex('0');
      throw new Error('expected parseTabIndex to throw');
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        expect((error as { code?: string }).code).toBe(ERROR_CODE.VALIDATION_ERROR);
        return;
      }
      throw error;
    }
  });

  it('builds tabs view with 1-based indexes and selectedIndex', () => {
    const view = toTabsView(
      [
        { id: 10, url: 'https://a.test', title: 'A', selected: false },
        { id: 20, url: 'https://b.test', title: 'B', selected: false }
      ],
      20
    );

    expect(view.tabs.map((tab) => tab.index)).toEqual([1, 2]);
    expect(view.selectedIndex).toBe(2);
    expect(view.tabs[1]?.selected).toBe(true);
  });

  it('returns tab by index and fails when index is out of range', () => {
    const tabs = [
      { index: 1, id: 1, url: 'about:blank', title: '', selected: true },
      { index: 2, id: 2, url: 'https://example.com', title: 'Example', selected: false }
    ];

    expect(findTabByIndex(tabs, 2).id).toBe(2);

    try {
      findTabByIndex(tabs, 3);
      throw new Error('expected findTabByIndex to throw');
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        expect((error as { code?: string }).code).toBe(ERROR_CODE.PAGE_NOT_FOUND);
        return;
      }
      throw error;
    }
  });
});
