import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchQueryPart } from './queryPanel';

// The query state tests mock rendering; these tests exercise reconciliation itself.
class TestNode {
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  values = new Map<string, string>();
  focus = vi.fn(() => { document.activeElement = this; });
  constructor(public nodeName: string, public nodeType = 1, public nodeValue: string | null = null) {}
  get firstChild(): TestNode | null { return this.childNodes[0] ?? null; }
  get nextSibling(): TestNode | null {
    return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;
  }
  get attributes() { return [...this.values].map(([name, value]) => ({ name, value })); }
  get isConnected(): boolean { return this.parentNode !== null || this.nodeName === 'ROOT'; }
  getAttribute(name: string) { return this.values.get(name) ?? null; }
  hasAttribute(name: string) { return this.values.has(name); }
  setAttribute(name: string, value: string) { this.values.set(name, value); }
  removeAttribute(name: string) { this.values.delete(name); }
  contains(node: TestNode | null): boolean { return this === node || this.childNodes.some((child) => child.contains(node)); }
  removeChild(node: TestNode) {
    if (node.contains(document.activeElement)) document.activeElement = null;
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
  }
  insertBefore(node: TestNode, cursor: TestNode | null) {
    node.parentNode?.removeChild(node);
    this.childNodes.splice(cursor ? this.childNodes.indexOf(cursor) : this.childNodes.length, 0, node);
    node.parentNode = this;
  }
  cloneNode(deep: boolean): TestNode {
    const copy = new TestNode(this.nodeName, this.nodeType, this.nodeValue);
    copy.values = new Map(this.values);
    if (deep) for (const child of this.childNodes) copy.insertBefore(child.cloneNode(true), null);
    return copy;
  }
  isEqualNode(other: TestNode): boolean {
    return this.nodeName === other.nodeName && this.nodeType === other.nodeType && this.nodeValue === other.nodeValue
      && JSON.stringify(this.attributes) === JSON.stringify(other.attributes)
      && this.childNodes.length === other.childNodes.length
      && this.childNodes.every((child, index) => child.isEqualNode(other.childNodes[index]));
  }
}
let document: { activeElement: TestNode | null };
const text = (value: string) => new TestNode('#text', 3, value);
function element(name: string, key: string | null, ...children: TestNode[]): TestNode {
  const node = new TestNode(name);
  if (key) node.setAttribute('data-query-key', key);
  for (const child of children) node.insertBefore(child, null);
  return node;
}
function render(target: TestNode, source: TestNode, focused: TestNode | null = null): void {
  document = { activeElement: focused };
  vi.stubGlobal('document', { ...document, get activeElement() { return document.activeElement; },
    createElement: () => ({ innerHTML: '', content: source }) });
  patchQueryPart(target as unknown as HTMLElement, 'test markup');
}
afterEach(() => vi.unstubAllGlobals());

describe('persistent query panel DOM', () => {
  it('changes quantity text without replacing the row, quantity node or focused button', () => {
    document = { activeElement: null };
    const quantity = text('1');
    const strong = element('STRONG', null, quantity);
    const row = element('BUTTON', 'product:P1', strong);
    row.setAttribute('aria-label', 'old name');
    const target = element('ROOT', null, row);
    const next = element('BUTTON', 'product:P1', element('STRONG', null, text('9')));
    next.setAttribute('aria-label', 'new name');
    render(target, element('ROOT', null, next), row);
    expect(target.firstChild).toBe(row);
    expect(row.firstChild).toBe(strong);
    expect(strong.firstChild).toBe(quantity);
    expect(quantity.nodeValue).toBe('9');
    expect(row.getAttribute('aria-label')).toBe('new name');
    expect(row.focus).not.toHaveBeenCalled();
  });

  it('reuses keyed rows when reordering, adds/removes rows, and restores a surviving moved focus', () => {
    document = { activeElement: null };
    const a = element('BUTTON', 'A', text('a'));
    const b = element('BUTTON', 'B', text('b'));
    const c = element('BUTTON', 'C', text('c'));
    const target = element('ROOT', null, a, b, c);
    render(target, element('ROOT', null, element('BUTTON', 'B', text('b')), element('BUTTON', 'A', text('a')), element('BUTTON', 'D', text('d'))), b);
    expect(target.childNodes.slice(0, 2)).toEqual([b, a]);
    expect(target.childNodes.map((node) => node.getAttribute('data-query-key'))).toEqual(['B', 'A', 'D']);
    expect(c.parentNode).toBeNull();
    expect(b.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('does not mutate equal nodes or attributes', () => {
    document = { activeElement: null };
    const row = element('DIV', 'station:S1', text('same'));
    const target = element('ROOT', null, row);
    const insert = vi.spyOn(target, 'insertBefore');
    const set = vi.spyOn(row, 'setAttribute');
    render(target, target.cloneNode(true));
    expect(insert).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(target.firstChild).toBe(row);
  });

  it('inserts optional distance before the retained quantity and removes it again', () => {
    document = { activeElement: null };
    const quantity = element('DIV', 'quantity', text('9'));
    const target = element('ROOT', null, quantity);
    render(target, element('ROOT', null, element('DIV', 'distance', text('200m')), element('DIV', 'quantity', text('9'))));
    expect(target.childNodes[1]).toBe(quantity);
    render(target, element('ROOT', null, element('DIV', 'quantity', text('9'))));
    expect(target.firstChild).toBe(quantity);
    expect(target.childNodes).toHaveLength(1);
  });

  it('replaces a changed node type and removes obsolete attributes without reusing an incompatible element', () => {
    document = { activeElement: null };
    const row = element('BUTTON', 'item', text('old'));
    const target = element('ROOT', null, row);
    render(target, element('ROOT', null, element('DIV', 'item', text('new'))), row);
    expect(target.firstChild?.nodeName).toBe('DIV');
    expect(row.parentNode).toBeNull();
    expect(row.focus).not.toHaveBeenCalled();
    target.firstChild!.setAttribute('aria-label', 'obsolete');
    render(target, element('ROOT', null, element('DIV', 'item', text('new'))));
    expect(target.firstChild!.hasAttribute('aria-label')).toBe(false);
  });
});
