import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InitOptions, InventoryStatus } from './query';
import type { ProductSummary } from './products';

const query = vi.hoisted(() => ({ options: undefined as InitOptions | undefined }));
vi.mock('./query', () => ({
  initQueryConsole: vi.fn(async (options: InitOptions) => {
    query.options = options;
    return { pickProduct: vi.fn() };
  }),
}));
vi.mock('./themeMenu', () => ({ initThemeMenu: vi.fn() }));

beforeEach(() => { vi.resetModules(); query.options = undefined; });
afterEach(() => vi.unstubAllGlobals());

describe('homepage product wall focus fallback', () => {
  it.each(['retained', 'removed', 'empty', 'outside', 'offscreen', 'removed-offscreen'] as const)('keeps keyboard focus usable when the wall is %s', async (scenario) => {
    const oldCard = { closest: () => ({ dataset: { code: 'P5' } }) };
    const originalCard = { focus: vi.fn(), getBoundingClientRect: () => ({ top: scenario === 'offscreen' ? -500 : 100, bottom: scenario === 'offscreen' ? -300 : 200, width: 200 }) };
    const remainingCard = { focus: vi.fn(), getBoundingClientRect: () => ({ top: scenario.endsWith('offscreen') ? -500 : 100, bottom: scenario.endsWith('offscreen') ? -300 : 200, width: 200 }) };
    const queryEntry = { focus: vi.fn() };
    const wall = {
      innerHTML: '', addEventListener: vi.fn(), contains: () => scenario !== 'outside',
      querySelectorAll: () => scenario === 'empty' ? [] : [remainingCard],
      querySelector: (selector: string) => selector === '[data-code="P5"]'
        ? scenario === 'retained' || scenario === 'offscreen' ? originalCard : null
        : selector === '.yt-prod' && scenario !== 'empty' ? remainingCard : null,
    };
    const shell = { addEventListener: vi.fn() };
    const page = {};
    vi.stubGlobal('document', {
      activeElement: oldCard,
      getElementById: (id: string) => id === 'wall-grid' ? wall : null,
      querySelector: (selector: string) => selector === '#yt-shell' ? shell
        : selector === '#yt-page' ? page
        : selector === '.yt-quick a[href="/query/"]' ? queryEntry : null,
    });
    vi.stubGlobal('window', { innerHeight: 800 });
    vi.stubGlobal('CSS', { escape: (value: string) => value });
    const { initLanding } = await import('./landing');
    await initLanding();
    const product: ProductSummary = { commodity_code: scenario === 'retained' ? 'P5' : 'P1',
      product_name: '生乳捲', commodity_name: '原味', price: 100, available_stations: 1,
      total_quantity: 1, lines: [] };
    const status: InventoryStatus = { last_updated: '2026-11-17T10:10:00+08:00',
      station_count: 1, product_count: 1, total_stock_items: 1, cache_ttl_seconds: 600 };
    query.options?.onUpdate?.(status, scenario === 'empty' ? [] : [product]);
    const expected = scenario === 'retained' ? originalCard : scenario === 'removed' ? remainingCard : queryEntry;
    if (scenario === 'outside') {
      expect(originalCard.focus).not.toHaveBeenCalled();
      expect(remainingCard.focus).not.toHaveBeenCalled();
      expect(queryEntry.focus).not.toHaveBeenCalled();
    } else {
      expect(expected.focus).toHaveBeenCalledWith({ preventScroll: true });
    }
  });
});
