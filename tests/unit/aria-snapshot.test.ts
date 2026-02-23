import { describe, expect, it } from 'vitest';

import { renderAriaSnapshotTree } from '../../src/infrastructure/cdp/ariaSnapshot.js';

describe('aria snapshot rendering', () => {
  it('renders placeholder when accessibility tree is empty', () => {
    const rendered = renderAriaSnapshotTree(null);
    expect(rendered.nodeCount).toBe(0);
    expect(rendered.text).toContain('no accessibility nodes');
  });

  it('renders nested nodes with ref markers and annotations', () => {
    const rendered = renderAriaSnapshotTree({
      role: 'RootWebArea',
      name: 'Checkout',
      children: [
        {
          role: 'button',
          name: 'Submit',
          disabled: true
        },
        {
          role: 'heading',
          name: 'Summary',
          level: 2
        }
      ]
    });

    expect(rendered.nodeCount).toBe(3);
    expect(rendered.text).toContain('[ref=r1] RootWebArea "Checkout"');
    expect(rendered.text).toContain('[ref=r2] button "Submit" (disabled)');
    expect(rendered.text).toContain('[ref=r3] heading "Summary" (level=2)');
  });
});
