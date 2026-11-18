import { describe, expect, it } from 'vitest';
import { GET } from '../pages/robots.txt';

describe('inventory crawler policy', () => {
  it.each([
    ['/api/products', true],
    ['/api/products/CODE1', true],
    ['/api/stations', true],
    ['/api/stations/counts', true],
    ['/api/stations/S001', true],
    ['/api/status', true],
    ['/api/refresh', false],
    ['/api/status/refresh', false],
  ])('allows %s: %s', async (path, allowed) => {
    const response = await GET({ site: new URL('https://example.test/') } as Parameters<typeof GET>[0]);
    const body = await response.text();
    // Google chooses the longest matching path, with Allow winning a tie.
    const rules = [...body.matchAll(/^(Allow|Disallow): (.+)$/gm)]
      .filter(([, , rule]) => rule.endsWith('$')
        ? path === rule.slice(0, -1) : path.startsWith(rule))
      .sort((a, b) => b[2].length - a[2].length || Number(b[1] === 'Allow') - Number(a[1] === 'Allow'));
    expect(rules[0]?.[1] === 'Allow').toBe(allowed);
  });
});
