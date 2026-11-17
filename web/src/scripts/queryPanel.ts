function key(node: Node): string | null {
  return node.nodeType === 1 ? (node as Element).getAttribute('data-query-key') : null;
}

function reconcile(parent: Node, incoming: Node): void {
  const keyed = new Map(Array.from(parent.childNodes).filter((node) => key(node))
    .map((node) => [key(node), node]));
  let cursor = parent.firstChild;
  for (const next of Array.from(incoming.childNodes)) {
    const candidate = key(next) ? keyed.get(key(next)) : cursor && !key(cursor) ? cursor : undefined;
    if (!candidate || candidate.nodeType !== next.nodeType || candidate.nodeName !== next.nodeName) {
      parent.insertBefore(next.cloneNode(true), cursor);
      continue;
    }
    if (candidate !== cursor) parent.insertBefore(candidate, cursor);
    if (!candidate.isEqualNode(next)) {
      if (candidate.nodeType === 3) candidate.nodeValue = next.nodeValue;
      else if (candidate.nodeType === 1) {
        const current = candidate as Element;
        const source = next as Element;
        for (const attribute of Array.from(current.attributes)) {
          if (!source.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
        }
        for (const attribute of Array.from(source.attributes)) {
          if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
        }
        reconcile(current, source);
      }
    }
    cursor = candidate.nextSibling;
  }
  while (cursor) {
    const next = cursor.nextSibling;
    parent.removeChild(cursor);
    cursor = next;
  }
}

export function patchQueryPart(target: HTMLElement, html: string): void {
  const template = document.createElement('template');
  template.innerHTML = html;
  const focused = document.activeElement as HTMLElement | null;
  const restoreFocus = focused !== null && target.contains(focused);
  reconcile(target, template.content);
  // Moving an existing button can blur it even though the keyed node survives.
  if (restoreFocus && focused.isConnected && target.contains(focused) && document.activeElement !== focused) {
    focused.focus({ preventScroll: true });
  }
}
