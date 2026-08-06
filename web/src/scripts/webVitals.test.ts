import { describe, expect, it } from 'vitest';
import { describeLcpElement } from './webVitals';

function element(tagName: string, id = '', className: string | null = null) {
  return {
    tagName,
    id,
    getAttribute: (name: string) => (name === 'class' ? className : null),
  } as unknown as Element;
}

describe('describeLcpElement', () => {
  it('uses a stable id before a class name', () => {
    expect(describeLcpElement(element('H1', 'hero-title', 'yt-h1'))).toBe('h1#hero-title');
  });

  it('uses the first safe class name without sending page text', () => {
    expect(describeLcpElement(element('DIV', '', 'yt-hero-card is-live'))).toBe('div.yt-hero-card');
  });

  it('falls back safely when the LCP entry has no element', () => {
    expect(describeLcpElement(null)).toBe('unknown');
  });
});
