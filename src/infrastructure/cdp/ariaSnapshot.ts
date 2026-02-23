export type AriaSnapshotTree = {
  text: string;
  nodeCount: number;
};

export type AriaSnapshotNode = {
  role?: string;
  name?: string;
  value?: string | number;
  description?: string;
  url?: string;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  selected?: boolean;
  readonly?: boolean;
  required?: boolean;
  multiline?: boolean;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  level?: number;
  children?: AriaSnapshotNode[];
};

const normalizeInline = (value: string): string => value.replace(/\s+/g, ' ').trim();

const formatQuoted = (value: string): string => `"${normalizeInline(value).replace(/"/g, '\\"')}"`;

const formatValue = (value: string | number | undefined): string | null => {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  const normalized = normalizeInline(value);
  if (!normalized) {
    return null;
  }
  return formatQuoted(normalized);
};

const pushIf = (bucket: string[], enabled: boolean | undefined, label: string): void => {
  if (enabled === true) {
    bucket.push(label);
  }
};

const formatLine = (node: AriaSnapshotNode, ref: number, depth: number): string => {
  const indent = '  '.repeat(depth);
  const parts: string[] = [`- [ref=r${ref}]`, node.role || 'unknown'];
  const annotations: string[] = [];

  if (node.name && normalizeInline(node.name).length > 0) {
    parts.push(formatQuoted(node.name));
  }

  const valueText = formatValue(node.value);
  if (valueText) {
    annotations.push(`value=${valueText}`);
  }

  if (node.description && normalizeInline(node.description).length > 0) {
    annotations.push(`description=${formatQuoted(node.description)}`);
  }

  if (node.url && normalizeInline(node.url).length > 0) {
    annotations.push(`url=${formatQuoted(node.url)}`);
  }

  pushIf(annotations, node.disabled, 'disabled');
  pushIf(annotations, node.expanded, 'expanded');
  pushIf(annotations, node.focused, 'focused');
  pushIf(annotations, node.selected, 'selected');
  pushIf(annotations, node.readonly, 'readonly');
  pushIf(annotations, node.required, 'required');
  pushIf(annotations, node.multiline, 'multiline');

  if (node.checked !== undefined) {
    annotations.push(`checked=${String(node.checked)}`);
  }
  if (node.pressed !== undefined) {
    annotations.push(`pressed=${String(node.pressed)}`);
  }
  if (typeof node.level === 'number') {
    annotations.push(`level=${node.level}`);
  }

  if (annotations.length > 0) {
    parts.push(`(${annotations.join(', ')})`);
  }

  return `${indent}${parts.join(' ')}`;
};

const walk = (node: AriaSnapshotNode, depth: number, refs: { next: number }, lines: string[]): number => {
  const ref = refs.next;
  refs.next += 1;

  lines.push(formatLine(node, ref, depth));

  let count = 1;
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    count += walk(child, depth + 1, refs, lines);
  }

  return count;
};

export const renderAriaSnapshotTree = (root: AriaSnapshotNode | null): AriaSnapshotTree => {
  if (!root) {
    return {
      text: '- (no accessibility nodes)',
      nodeCount: 0
    };
  }

  const lines: string[] = [];
  const nodeCount = walk(root, 0, { next: 1 }, lines);
  return {
    text: lines.join('\n'),
    nodeCount
  };
};
