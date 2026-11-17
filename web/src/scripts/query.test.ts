import { afterEach, describe, expect, it, vi } from 'vitest';
import { initQueryConsole, type InitOptions } from './query';
import { FAVORITES_KEY } from './favorites';

vi.mock('./queryPanel', () => ({
  patchQueryPart: (target: { innerHTML: string }, html: string) => { target.innerHTML = html; },
}));

function element(dataset: Record<string, string> = {}) {
  const listeners = new Map<string, (event: unknown) => void>();
  return {
    dataset,
    innerHTML: '',
    children: [] as HTMLElement[],
    scrollTop: 0, scrollHeight: 0, clientHeight: 0,
    value: '',
    hidden: false,
    disabled: false,
    title: '',
    classList: { add: vi.fn(), toggle: vi.fn() },
    setAttribute: vi.fn(),
    focus: vi.fn(),
    append: vi.fn(),
    contains: vi.fn(() => true),
    style: { height: '', minHeight: '' },
    getBoundingClientRect: vi.fn(() => ({ height: 500 })),
    animate: vi.fn(() => ({ cancel: vi.fn(), finished: new Promise<void>(() => {}) })),
    querySelector: vi.fn((_selector: string): HTMLElement | null => null),
    after: vi.fn(),
    closest: () => ({ append: vi.fn() }),
    textContent: '',
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    dispatch: (type: string, event: unknown = {}) => listeners.get(type)?.(event),
  };
}

async function setup(search = '', countsAvailable = true, storage = new Map<string, string>(), mobile = false, options: InitOptions = {}, productCodes = ['P']) {
  const productButton = element({ view: 'products' });
  const stationButton = element({ view: 'stations' });
  const input = element();
  const results = element();
  const right = { ...element(), id: 'query-console-details' };
  const detailHead = element();
  const detailRows = element();
  const detailFoot = element();
  const detailPills = { ...element(), scrollLeft: 0, scrollWidth: 0, clientWidth: 0,
    style: { ...element().style, setProperty: vi.fn() } };
  const parts = { '.yt-panel-head': detailHead, '.yt-bpills': detailPills,
    '.yt-srows--scroll': detailRows, '.yt-panel-foot': detailFoot };
  right.querySelector.mockImplementation((selector) => (parts as unknown as Record<string, HTMLElement>)[selector] ?? null);
  Object.defineProperty(right, 'innerHTML', {
    get: () => Object.entries(parts).map(([selector, part]) => `<div class="${selector.slice(1)}"${part.hidden ? ' hidden' : ''}>${part.innerHTML}</div>`).join(''),
    set: () => { for (const [selector, part] of Object.entries(parts)) { part.innerHTML = ''; part.hidden = selector !== '.yt-srows--scroll'; } },
  });
  const grid = element();
  const media = { ...element(), matches: mobile };
  const motion = { ...element(), matches: false };
  const favoritesFilter = element();
  const favoritesStatus = element();
  const favoritesAll = element();
  const allCount = element();
  const favoritesCount = element();
  const locateButton = element();
  const counts = new Map<string, ReturnType<typeof element>>();
  const buttons = new Map<string, ReturnType<typeof element>>();
  Object.assign(results, {
    querySelector: (selector: string) => {
      const match = selector.match(/data-(count|tid|code)="([^"]+)"/);
      if (!match || !results.innerHTML.includes(`data-${match[1]}="${match[2]}"`)) return null;
      const map = match[1] === 'count' ? counts : buttons;
      if (!map.has(match[2])) map.set(match[2], element());
      return map.get(match[2]);
    },
  });
  const root = {
    ...element(),
    querySelectorAll: () => [productButton, stationButton],
    querySelector: (selector: string) =>
      ({
        '.yt-search-input': input,
        '.yt-search-clear': element(),
        '.yt-result-list': results,
        '.yt-console-right': right,
        '.yt-console-grid': grid,
        '[data-favorites-filter]': favoritesFilter,
        '[data-favorites-status]': favoritesStatus,
        '[data-favorites-all]': favoritesAll,
        '[data-all-count]': allCount,
        '[data-favorites-count]': favoritesCount,
        '[data-locate]': locateButton,
      } as Record<string, ReturnType<typeof element>>)[selector],
  };
  const stations = [
    { station_id: 'unknown', station_name: '無座標站', lat: null, lng: null },
    { station_id: 'far', station_name: '遠站', lat: 25.1, lng: 121.5 },
    { station_id: 'near', station_name: '近站', lat: 25, lng: 121.5 },
  ].map((s) => ({ ...s, station_addr: '', branch_code: 'B', branch_name: '分區' }));
  const product = {
    commodity_code: 'P',
    product_name: '生乳捲',
    commodity_name: '原味',
    price: 100,
    available_stations: 3,
  };
  vi.stubGlobal('document', { ...element(), activeElement: null, visibilityState: 'visible', querySelector: () => root });
  vi.stubGlobal('window', { ...element(), setInterval: vi.fn(), innerWidth: mobile ? 402 : 1200, innerHeight: 844, visualViewport: element(),
    matchMedia: (query: string) => query.includes('reduced-motion') ? motion : media });
  vi.stubGlobal('alert', vi.fn());
  vi.stubGlobal('CSS', { escape: (s: string) => s });
  vi.stubGlobal('location', { search, pathname: '/query/', hash: '' });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  vi.stubGlobal('navigator', {
    locks: { request: vi.fn((_name: string, callback: () => void) => Promise.resolve(callback())) },
    geolocation: {
      getCurrentPosition: (success: PositionCallback) =>
        success({ coords: { latitude: 25, longitude: 121.5 } } as GeolocationPosition),
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => {
        if (url === '/api/products') return { products: productCodes.map((code) => ({ ...product, commodity_code: code })), last_updated: '2026-11-17T10:00:00+08:00' };
        if (url === '/api/status') return { last_updated: '2026-11-17T10:00:00+08:00', cache_ttl_seconds: 600 };
        if (url === '/api/stations') return { branches: [{ branch_name: '分區', stations }] };
        if (url === '/api/stations/counts') {
          if (!countsAvailable) throw new Error('Counts unavailable');
          return { counts: { near: { product_count: 2 } }, last_updated: '2026-11-17T10:00:00+08:00' };
        }
        if (url.startsWith('/api/products/')) return { product: { ...product, commodity_code: url.split('/').pop() }, stations: [], total_quantity: 0, last_updated: '2026-11-17T10:00:00+08:00' };
        return { stock: [{ ...product, quantity: 3 }], last_updated: '2026-11-17T10:00:00+08:00' };
      },
    })),
  );
  await initQueryConsole({ persist: Boolean(search), ...options });
  const switchToStations = async () => {
    stationButton.dispatch('click');
    await vi.waitFor(() => expect(right.innerHTML).toContain('生乳捲'));
  };
  const action = (selector: string, dataset = {}) => root.dispatch('click', {
    target: { closest: (s: string) => s === selector ? { dataset } : null },
  });
  const locate = async () => {
    action('[data-locate]');
    await vi.waitFor(() => expect(
      locateButton.title,
    ).toContain('已依距離排序'));
  };
  const clickStation = (tid: string) => results.dispatch('click', {
    target: { closest: (selector: string) => selector === 'button.yt-result' ? { dataset: { tid } } : null },
  });
  const clickProduct = (code: string) => results.dispatch('click', {
    target: { closest: (selector: string) => selector === 'button.yt-result' ? { dataset: { code } } : null },
  });
  const resize = (mobile: boolean) => { media.matches = mobile; media.dispatch('change'); };
  const favorite = (id: string, view = 'products') => results.dispatch('click', {
    target: { closest: (selector: string) => selector === '[data-favorite]'
      ? { dataset: { favorite: id, favoriteView: view } } : null },
  });
  return { root, input, results, right, detailHead, detailPills, detailRows, detailFoot, grid, resize, motion, clickProduct, counts, clickStation, action, switchToStations, locate,
    favorite, favoritesFilter, favoritesStatus, favoritesAll, allCount, favoritesCount, locateButton };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('station master detail', () => {
  it('shows the selected station in the shared result panel, outside the list', async () => {
    const ui = await setup('?s=near');
    expect(ui.right.hidden).toBe(false);
    expect(ui.right.innerHTML).toContain('近站');
    expect(ui.right.innerHTML).toContain('生乳捲');
    expect(ui.results.innerHTML).not.toContain('data-stock=');
    expect(ui.results.innerHTML).not.toContain('aria-expanded=');
  });

  it('sorts by distance and preserves the selected station', async () => {
    const ui = await setup('?s=near');
    await ui.locate();
    expect(ui.locateButton.title).toContain('已依距離排序');
    expect(ui.results.innerHTML).toContain('距離未知');
    expect(ui.results.innerHTML.indexOf('data-tid="near"')).toBeLessThan(
      ui.results.innerHTML.indexOf('data-tid="far"'),
    );
    expect(ui.right.innerHTML).toContain('近站');
  });

  it('keeps a station selected on repeat clicks and reuses cached stock', async () => {
    const ui = await setup('?s=near');
    ui.clickStation('near');
    ui.clickStation('far');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('遠站'));
    ui.clickStation('near');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('近站'));
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/stations/near')).toHaveLength(1);
    expect(ui.counts.get('near')?.textContent).toBe('1 款');
  });

  it('preserves search and leaves the selected details visible when no stations match', async () => {
    const ui = await setup('?s=near');
    ui.input.value = '不存在';
    ui.input.dispatch('input');
    await ui.locate();
    expect(ui.results.innerHTML).toContain('找不到符合的站點');
    expect(ui.locateButton.title).toContain('已依距離排序');
    expect(ui.right.innerHTML).toContain('近站');
  });

  it('shows an error in the shared panel and retries without caching failure', async () => {
    const ui = await setup('?view=stations');
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    ui.clickStation('near');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('重新載入'));
    ui.action('[data-retry]');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('生乳捲'));
  });

  it('ignores a late response for a previously selected station', async () => {
    const ui = await setup('?view=stations');
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    ui.clickStation('near');
    ui.clickStation('far');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('生乳捲'));
    resolve({ ok: true, json: async () => ({ last_updated: '2026-11-17T10:00:00+08:00', stock: [{ product_name: '舊回應', quantity: 1 }] }) } as Response);
    await new Promise((r) => setTimeout(r, 0));
    expect(ui.right.innerHTML).toContain('遠站');
    expect(ui.right.innerHTML).not.toContain('舊回應');
  });

  it('shows unknown counts when summaries fail, and zero after fetching empty stock', async () => {
    const ui = await setup('?view=stations', false);
    expect(ui.results.innerHTML).toContain('款數未知');
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ last_updated: '2026-11-17T10:00:00+08:00', stock: [{ quantity: 0 }] }) } as Response);
    ui.clickStation('near');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('此站點目前無庫存'));
    expect(ui.counts.get('near')?.textContent).toBe('0 款');
  });

  it('can select a product from station details and retain the station on returning', async () => {
    const ui = await setup('?s=near');
    ui.action('[data-pick-product]', { pickProduct: 'P' });
    expect(ui.results.innerHTML).toContain('data-code="P"');
    await ui.switchToStations();
    expect(ui.right.hidden).toBe(false);
    expect(ui.right.innerHTML).toContain('近站');
  });
});

describe('local favorites', () => {
  it('saves and restores products without changing the query URL', async () => {
    const storage = new Map<string, string>();
    let ui = await setup('?p=P', true, storage);
    vi.mocked(history.replaceState).mockClear();
    ui.favorite('P');
    expect(JSON.parse(storage.get(FAVORITES_KEY)!)).toEqual([
      { view: 'products', id: 'P', name: '生乳捲' },
    ]);
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(ui.results.innerHTML).toContain('取消收藏：生乳捲');
    ui = await setup('?p=P', true, storage);
    ui.favoritesFilter.dispatch('click');
    expect(ui.results.innerHTML).toContain('data-code="P"');
    ui.favorite('P');
    expect(ui.results.innerHTML).toContain('尚無可用收藏');
    expect(storage.get(FAVORITES_KEY)).toBe('[]');
  });

  it('filters stations, preserves search, and opens a favorite normally', async () => {
    const storage = new Map<string, string>();
    let ui = await setup('?view=stations', true, storage);
    ui.favorite('near', 'stations');
    expect(ui.results.innerHTML).not.toContain('aria-expanded=');
    ui = await setup('?view=stations', true, storage);
    ui.favoritesFilter.dispatch('click');
    expect(ui.results.innerHTML).toContain('data-tid="near"');
    expect(ui.results.innerHTML).not.toContain('data-tid="far"');
    ui.clickStation('near');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('生乳捲'));
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/query/?view=stations&s=near');
    ui.input.value = '遠站';
    ui.input.dispatch('input');
    expect(ui.results.innerHTML).toContain('找不到符合的站點');
    ui.input.value = '';
    ui.input.dispatch('input');
    ui.action('[data-pick-product]', { pickProduct: 'P' });
    expect(ui.results.innerHTML).toContain('data-code="P"');
  });

  it('does not add favorites when opening a shared query', async () => {
    const storage = new Map<string, string>();
    const ui = await setup('?s=near', true, storage);
    expect(storage.has(FAVORITES_KEY)).toBe(false);
    expect(ui.results.innerHTML).toContain('加入我的最愛：近站');
  });

  it('retains removed items with escaped names and lets users remove them', async () => {
    const storage = new Map([[FAVORITES_KEY, JSON.stringify([
      { view: 'products', id: 'gone', name: '<舊商品>' },
    ])]]);
    const ui = await setup('?p=P', true, storage);
    ui.favoritesFilter.dispatch('click');
    expect(ui.results.innerHTML).toContain('&lt;舊商品&gt;');
    expect(ui.results.innerHTML).toContain('目前無法查詢');
    expect(ui.favoritesCount.textContent).toBe('1');
    ui.favorite('gone');
    expect(storage.get(FAVORITES_KEY)).toBe('[]');
    expect(ui.results.innerHTML).not.toContain('目前無法查詢');
  });

  it('reports blocked storage without claiming a favorite was saved or removed', async () => {
    const ui = await setup('?p=P');
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('Blocked'); });
    ui.favorite('P');
    expect(ui.favoritesStatus.textContent).toContain('無法儲存收藏');
    expect(ui.results.innerHTML).toContain('加入我的最愛：生乳捲');
    expect(ui.results.innerHTML).not.toContain('取消收藏：生乳捲');
  });

  it('ignores malformed stored data and can save again', async () => {
    const storage = new Map([[FAVORITES_KEY, '{bad']]);
    const ui = await setup('?p=P', true, storage);
    ui.favorite('P');
    expect(JSON.parse(storage.get(FAVORITES_KEY)!)).toHaveLength(1);
  });
});


describe('favorite placement', () => {
  it('uses a colored favorite instead of the product dot without changing selection', async () => {
    const ui = await setup('?p=P');
    expect(ui.results.innerHTML).not.toContain('yt-result-dot');
    expect(ui.results.innerHTML).toContain('--yt-favorite-accent:');
    expect(ui.results.innerHTML.indexOf('data-favorite="P"')).toBeLessThan(
      ui.results.innerHTML.indexOf('生乳捲</span>'),
    );
    ui.favorite('P');
    expect(ui.results.innerHTML).toContain('取消收藏：生乳捲');
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(ui.results.innerHTML).toContain('data-code="P"');
  });

  it('uses the theme-colored favorite instead of the station dot without changing selection', async () => {
    const ui = await setup('?view=stations');
    const star = ui.results.innerHTML.indexOf('data-favorite="near"');
    const count = ui.results.innerHTML.indexOf('data-count="near"');
    const name = ui.results.innerHTML.indexOf('近站</span>');
    expect(ui.results.innerHTML).not.toContain('yt-result-dot');
    expect(ui.results.innerHTML).toContain('--yt-favorite-accent:var(--yt-brand)');
    expect(star).toBeLessThan(name);
    expect(star).toBeGreaterThan(-1);
    expect(star).toBeLessThan(count);
    ui.favorite('near', 'stations');
    expect(ui.results.innerHTML).toContain('取消收藏：近站');
    expect(ui.results.innerHTML).not.toContain('aria-expanded=');
    ui.clickStation('near');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('近站'));
    ui.favorite('near', 'stations');
    expect(ui.right.innerHTML).toContain('近站');
  });
});


describe('shared query toolbar', () => {
  it('updates list counts and uses explicit all/favorites filters', async () => {
    const ui = await setup('?view=stations');
    expect(ui.allCount.textContent).toBe('3');
    ui.favorite('near', 'stations');
    ui.favoritesFilter.dispatch('click');
    expect(ui.favoritesCount.textContent).toBe('1');
    expect(ui.allCount.textContent).toBe('3');
    ui.favoritesFilter.dispatch('click');
    expect(ui.favoritesCount.textContent).toBe('1');
    expect(ui.allCount.textContent).toBe('3');
    ui.favoritesAll.dispatch('click');
    expect(ui.allCount.textContent).toBe('3');
    ui.input.value = '遠站';
    ui.input.dispatch('input');
    expect(ui.allCount.textContent).toBe('1');
    expect(ui.favoritesCount.textContent).toBe('0');
  });

  it('keeps location in one shared control across both views', async () => {
    const ui = await setup('?p=P');
    expect(ui.allCount.textContent).toBe('1');
    await ui.locate();
    await ui.switchToStations();
    expect(ui.locateButton.title).toContain('已依距離排序');
    expect(ui.results.innerHTML).not.toContain('data-locate');
    expect(ui.right.innerHTML).not.toContain('data-locate');
    ui.action('[data-locate]');
    expect(ui.locateButton.title).toBe('定位並依距離排序');
  });
});


describe('mobile accordion', () => {
  it('starts collapsed without a deep link and stars do not expand results', async () => {
    const ui = await setup('', true, new Map(), true);
    expect(ui.right.hidden).toBe(true);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/products/P')).toBe(false);
    ui.favorite('P');
    expect(ui.right.hidden).toBe(true);
    ui.clickProduct('P');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('生乳捲'));
    expect(ui.right.hidden).toBe(false);
    expect(ui.results.innerHTML.match(/aria-expanded="true"/g)).toHaveLength(1);
    ui.favorite('P');
    expect(ui.right.hidden).toBe(false);
    ui.clickProduct('P');
    expect(ui.right.hidden).toBe(true);
    expect(ui.results.innerHTML).not.toContain('aria-expanded="true"');
  });

  it('opens deep links and allows one station at a time', async () => {
    const ui = await setup('?s=near', true, new Map(), true);
    expect(ui.right.hidden).toBe(false);
    expect(ui.right.innerHTML).toContain('近站');
    ui.clickStation('far');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('遠站'));
    expect(ui.results.innerHTML.match(/aria-expanded="true"/g)).toHaveLength(1);
    ui.clickStation('far');
    expect(ui.right.hidden).toBe(true);
    ui.resize(false);
    expect(ui.right.hidden).toBe(false);
    expect(ui.results.innerHTML).not.toContain('aria-expanded=');
    expect(ui.grid.append).toHaveBeenCalledWith(ui.right);
    ui.resize(true);
    expect(ui.right.hidden).toBe(true);
  });
});


describe('location icon states', () => {
  it('shows a busy spinner, then the active icon, and can turn location off', async () => {
    const ui = await setup('?view=stations');
    let success!: PositionCallback;
    vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation((callback) => { success = callback; });
    const idleIcon = ui.locateButton.innerHTML;
    expect(ui.locateButton.title).toBe('定位並依距離排序');
    ui.action('[data-locate]');
    expect(ui.locateButton.disabled).toBe(true);
    expect(ui.locateButton.innerHTML).toContain('yt-location-spinner');
    expect(ui.locateButton.setAttribute).toHaveBeenCalledWith('aria-busy', 'true');
    success({ coords: { latitude: 25, longitude: 121.5 } } as GeolocationPosition);
    expect(ui.locateButton.disabled).toBe(false);
    expect(ui.locateButton.innerHTML).not.toContain('yt-location-spinner');
    expect(ui.locateButton.innerHTML).not.toBe(idleIcon);
    expect(ui.locateButton.setAttribute).toHaveBeenCalledWith('aria-pressed', 'true');
    ui.action('[data-locate]');
    expect(ui.locateButton.innerHTML).toBe(idleIcon);
  });

  it('restores the idle icon after location fails', async () => {
    const ui = await setup('?view=stations');
    let failure!: PositionErrorCallback;
    vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation((_callback, onError) => { failure = onError!; });
    ui.action('[data-locate]');
    failure({ code: 1 } as GeolocationPositionError);
    expect(ui.locateButton.disabled).toBe(false);
    expect(ui.locateButton.title).toBe('定位並依距離排序');
    expect(ui.locateButton.innerHTML).not.toContain('yt-location-spinner');
    expect(alert).toHaveBeenCalledWith('無法取得定位');
  });
});


describe('review regressions', () => {
  it('keeps favorites saved by another tab before writing', async () => {
    const storage = new Map<string, string>();
    const ui = await setup('?p=P', true, storage);
    const other = { view: 'stations', id: 'near', name: '近站' };
    storage.set(FAVORITES_KEY, JSON.stringify([other]));
    ui.favorite('P');
    expect(JSON.parse(storage.get(FAVORITES_KEY)!)).toEqual([
      other, { view: 'products', id: 'P', name: '生乳捲' },
    ]);
  });

  it('updates favorites when another tab changes or clears storage', async () => {
    const storage = new Map<string, string>();
    const ui = await setup('?p=P', true, storage);
    const event = (value: string | null, key: string | null = FAVORITES_KEY) => {
      if (value === null) storage.delete(FAVORITES_KEY);
      else storage.set(FAVORITES_KEY, value);
      (window as unknown as ReturnType<typeof element>).dispatch('storage', {
        key, newValue: value, storageArea: localStorage,
      });
    };
    event(JSON.stringify([{ view: 'products', id: 'P', name: '生乳捲' }]));
    expect(ui.results.innerHTML).toContain('取消收藏：生乳捲');
    event(null, null);
    expect(ui.results.innerHTML).toContain('加入我的最愛：生乳捲');
  });

  it('reads the latest stored favorites instead of replaying an older storage event', async () => {
    const storage = new Map<string, string>();
    const ui = await setup('?p=P', true, storage);
    const olderValue = JSON.stringify([{ view: 'stations', id: 'near', name: '近站' }]);
    storage.set(FAVORITES_KEY, olderValue);
    ui.favorite('P');
    (window as unknown as ReturnType<typeof element>).dispatch('storage', {
      key: FAVORITES_KEY, newValue: olderValue, storageArea: localStorage,
    });
    expect(JSON.parse(storage.get(FAVORITES_KEY)!)).toHaveLength(2);
    expect(ui.results.innerHTML).toContain('取消收藏：生乳捲');
  });

  it('reads and writes only inside the shared lock and preserves queued tab updates', async () => {
    const storage = new Map<string, string>();
    const firstTab = await setup('?p=P', true, storage);
    const secondTab = await setup('?view=stations', true, storage);
    const pending: Array<() => void> = [];
    const request = vi.fn((_name: string, callback: () => void) => new Promise<void>((resolve) => {
      pending.push(() => { callback(); resolve(); });
    }));
    Object.assign(navigator, { locks: { request } });
    const read = vi.spyOn(localStorage, 'getItem');
    firstTab.favorite('P');
    secondTab.favorite('near', 'stations');
    expect(request.mock.calls.map(([name]) => name)).toEqual([FAVORITES_KEY, FAVORITES_KEY]);
    expect(read).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    // Another writer finishes before either queued tab acquires the lock.
    const other = { view: 'stations', id: 'far', name: '遠站' };
    storage.set(FAVORITES_KEY, JSON.stringify([other]));
    pending.shift()!();
    pending.shift()!();
    expect(JSON.parse(storage.get(FAVORITES_KEY)!)).toEqual([
      other, { view: 'products', id: 'P', name: '生乳捲' },
      { view: 'stations', id: 'near', name: '近站' },
    ]);
    await Promise.resolve();
  });

  it.each([
    { view: 'products', id: 'P', name: '生乳捲', remove: false },
    { view: 'products', id: 'P', name: '生乳捲', remove: true },
    { view: 'stations', id: 'near', name: '近站', remove: false },
    { view: 'stations', id: 'near', name: '近站', remove: true },
  ])('preserves concurrent intent for $view with remove=$remove', async ({ view, id, name, remove }) => {
    const item = { view, id, name };
    const other = { view: 'stations', id: 'far', name: '遠站' };
    const storage = new Map([[FAVORITES_KEY, JSON.stringify([other, ...(remove ? [item] : [])])]]);
    const query = view === 'products' ? '?p=P' : '?s=near';
    const first = await setup(query, true, storage);
    const second = await setup(query, true, storage);
    const pending: Array<() => void> = [];
    Object.assign(navigator, { locks: {
      request: (_name: string, callback: () => void) => new Promise<void>((resolve) => {
        pending.push(() => { callback(); resolve(); });
      }),
    } });
    first.favorite(id, view);
    second.favorite(id, view);
    expect(pending).toHaveLength(2);
    pending.shift()!();
    pending.shift()!();
    expect(JSON.parse(storage.get(FAVORITES_KEY)!)).toEqual(remove ? [other] : [other, item]);
    const label = `${remove ? '加入我的最愛' : '取消收藏'}：${name}`;
    expect(first.results.innerHTML).toContain(label);
    expect(second.results.innerHTML).toContain(label);
    expect(second.favoritesStatus.textContent).toBe(remove ? '已取消收藏' : '已加入我的最愛');
    await Promise.resolve();
  });

  it.each([false, true])('preserves click intent when retrying a failed write, remove=%s', async (remove) => {
    const item = { view: 'products', id: 'P', name: '生乳捲' };
    const other = { view: 'stations', id: 'far', name: '遠站' };
    const storage = new Map([[FAVORITES_KEY, JSON.stringify([other, ...(remove ? [item] : [])])]]);
    const ui = await setup('?p=P', true, storage);
    // Another tab updates storage before its event reaches this tab.
    const latest = [other, ...(remove ? [] : [item])];
    storage.set(FAVORITES_KEY, JSON.stringify(latest));
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => { throw new Error('Write denied'); });
    ui.favorite('P');
    expect(ui.favoritesStatus.textContent).toContain('無法儲存收藏');
    const originalLabel = remove ? '取消收藏：生乳捲' : '加入我的最愛：生乳捲';
    expect(ui.results.innerHTML).toContain(originalLabel);
    expect(JSON.parse(storage.get(FAVORITES_KEY)!)).toEqual(latest);
    ui.favorite('P');
    expect(JSON.parse(storage.get(FAVORITES_KEY)!)).toEqual(remove ? [other] : [other, item]);
    expect(ui.results.innerHTML).toContain(remove ? '加入我的最愛：生乳捲' : '取消收藏：生乳捲');
    expect(ui.favoritesStatus.textContent).toBe(remove ? '已取消收藏' : '已加入我的最愛');
  });

  it('preserves the visible favorites when storage cannot be read during synchronization', async () => {
    const ui = await setup('?p=P');
    ui.favorite('P');
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    (window as unknown as ReturnType<typeof element>).dispatch('storage', {
      key: FAVORITES_KEY, newValue: null, storageArea: localStorage,
    });
    expect(ui.results.innerHTML).toContain('取消收藏：生乳捲');
    expect(ui.favoritesStatus.textContent).toContain('無法讀取收藏');
  });

  it('reports lock failures without writing an unlocked snapshot', async () => {
    const ui = await setup('?p=P');
    Object.assign(navigator, { locks: { request: vi.fn().mockRejectedValue(new Error('Unavailable')) } });
    ui.favorite('P');
    await vi.waitFor(() => expect(ui.favoritesStatus.textContent).toContain('無法儲存收藏'));
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(ui.results.innerHTML).toContain('加入我的最愛：生乳捲');
  });

  it('does not risk overwriting favorites when Web Locks is unavailable', async () => {
    const ui = await setup('?p=P');
    Object.assign(navigator, { locks: undefined });
    ui.favorite('P');
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(ui.favoritesStatus.textContent).toContain('不支援安全儲存收藏');
  });

  it('does not show station content while a product response is pending', async () => {
    const ui = await setup('?s=near');
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    ui.action('[data-pick-product]', { pickProduct: 'P' });
    expect(ui.detailRows.innerHTML).toBe('');
    expect(ui.right.innerHTML).not.toContain('近站');
    resolve({ ok: true, json: async () => ({ last_updated: '2026-11-17T10:00:00+08:00', product: { commodity_code: 'P', product_name: '生乳捲' }, stations: [] }) } as Response);
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('個站點仍有現貨'));
  });
});


describe('query transitions', () => {
  it.each(['products', 'stations'] as const)('reopens cached %s without a loading placeholder', async (view) => {
    const ui = await setup(view === 'products' ? '?view=products' : '?s=near', true, new Map(), true);
    const toggle = () => view === 'products' ? ui.clickProduct('P') : ui.clickStation('near');
    if (view === 'products') {
      toggle();
      await vi.waitFor(() => expect(ui.right.innerHTML).toContain('個站點仍有現貨'));
    }
    toggle();
    expect(ui.right.hidden).toBe(true);
    let html = ui.detailRows.innerHTML;
    const writes: string[] = [];
    Object.defineProperty(ui.detailRows, 'innerHTML', {
      get: () => html,
      set: (value: string) => { writes.push(value); html = value; },
    });
    toggle();
    await vi.waitFor(() => expect(writes.length).toBeGreaterThan(0));
    expect(writes.every((value) => !value.includes('載入庫存中'))).toBe(true);
    expect(ui.right.style.minHeight).toBe('');
    expect(ui.right.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false');
    expect(ui.right.animate).not.toHaveBeenCalled();
  });

  it.each([true, false])('reserves loading space and releases it on completion (ok=%s)', async (ok) => {
    const ui = await setup('?s=near', true, new Map(), true);
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    ui.clickStation('far');
    expect(ui.detailRows.style.minHeight).toBe('120px');
    expect(ui.right.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'true');
    expect(ui.detailRows.innerHTML).toBe('');
    resolve({ ok, json: async () => ({ last_updated: '2026-11-17T10:00:00+08:00', stock: [] }) } as Response);
    await vi.waitFor(() => expect(ui.right.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false'));
    expect(ui.right.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false');
    expect(ui.right.innerHTML).not.toContain('載入庫存中');
  });

  it.each((['products', 'stations'] as const).flatMap((view) =>
    (['rotation', 'breakpoint-first', 'resize-first', 'desktop-to-mobile', 'toolbar'] as const).map((change) => [view, change] as const),
  ))('invalidates loading height only for layout changes in %s (%s)', async (view, change) => {
    const ui = await setup('?s=near', true, new Map(), change !== 'desktop-to-mobile');
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((r) => { resolve = r; }));
    if (view === 'products') ui.action('[data-pick-product]', { pickProduct: 'P' });
    else ui.clickStation('far');
    expect(ui.detailRows.style.minHeight).toBe('120px');
    // Clearing the reservation must happen before measuring the new layout.
    ui.right.getBoundingClientRect.mockImplementation(() => ({
      height: parseFloat(ui.right.style.minHeight) || 120,
    }));
    const browserWindow = window as unknown as ReturnType<typeof element>;
    if (change === 'toolbar') {
      Object.assign(window, { innerHeight: 730 });
      (window.visualViewport as unknown as ReturnType<typeof element>).dispatch('resize');
      browserWindow.dispatch('resize');
      expect(ui.detailRows.style.minHeight).toBe('120px');
    } else {
      Object.assign(window, { innerWidth: change === 'rotation' ? 874 : change === 'desktop-to-mobile' ? 402 : 1200 });
      if (change === 'breakpoint-first') ui.resize(false);
      if (change === 'desktop-to-mobile') ui.resize(true);
      browserWindow.dispatch('resize');
      if (change === 'resize-first') ui.resize(false);
      expect(ui.right.style.minHeight).toBe('');
      expect(ui.detailRows.style.minHeight).toBe('120px');
    }
    expect(ui.right.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'true');
    expect(ui.detailRows.innerHTML).toBe('');
    resolve({ ok: true, json: async () => view === 'products'
      ? { stations: [], total_quantity: 0, last_updated: '2026-11-17T10:00:00+08:00' }
      : { stock: [], last_updated: '2026-11-17T10:00:00+08:00' } } as Response);
    await vi.waitFor(() => expect(ui.right.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false'));
    expect(ui.right.innerHTML).not.toContain('載入庫存中');
    expect(ui.right.style.minHeight).toBe('');
  });

  it('updates selections without dimming the result', async () => {
    const ui = await setup('?s=near');
    ui.clickStation('far');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('遠站'));
    ui.clickStation('near');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('近站'));
    expect(ui.right.animate).not.toHaveBeenCalled();
    expect(ui.grid.animate).not.toHaveBeenCalled();
  });

  it('updates immediately without opacity effects when reduced motion is enabled', async () => {
    const ui = await setup('?s=near', true, new Map(), true);
    ui.motion.matches = true;
    ui.clickStation('far');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('遠站'));
    expect(ui.right.animate).not.toHaveBeenCalled();
    expect(ui.grid.animate).not.toHaveBeenCalled();
  });

  it('does not animate an old response over the latest selection', async () => {
    const ui = await setup('?view=stations');
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    ui.clickStation('far');
    ui.clickStation('near');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('近站'));
    resolve({ ok: true, json: async () => ({ last_updated: '2026-11-17T10:00:00+08:00', stock: [] }) } as Response);
    await new Promise((r) => setTimeout(r, 0));
    expect(ui.right.innerHTML).toContain('近站');
    expect(ui.right.animate).not.toHaveBeenCalled();
  });
});

describe('branch stock counts', () => {
  it('counts stocked stations rather than quantities, retains zero, and ignores the active filter', async () => {
    const ui = await setup('?s=near');
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        last_updated: '2026-11-17T10:00:00+08:00',
        product: { commodity_code: 'P', product_name: '生乳捲' },
        stations: [
          { station_id: 'near', station_name: '近站', branch_name: '分區', quantity: 5 },
          { station_id: 'far', station_name: '遠站', branch_name: '分區', quantity: 0 },
          { station_id: 'other', station_name: '其他站', branch_name: '其他', quantity: 2 },
        ],
      }),
    } as Response);
    ui.action('[data-pick-product]', { pickProduct: 'P' });
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('yt-bpill-count'));
    const counts = () => [...ui.right.innerHTML.matchAll(/data-branch="([^"]+)"[^>]*>\s*<span>[^<]+<\/span><span class="yt-bpill-count">(\d+)<\/span>/g)]
      .map((m) => [m[1], Number(m[2])]);
    expect(counts()).toEqual([['all', 2], ['分區', 1]]);
    ui.action('.yt-bpill', { branch: '分區' });
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('yt-bpill-count'));
    expect(counts()).toEqual([['all', 2], ['分區', 1]]);
    expect(ui.right.innerHTML).not.toContain('遠站');
  });

  it('keeps a branch with no stocked stations visible', async () => {
    const ui = await setup('?p=P');
    expect(ui.right.innerHTML).toContain('data-branch="分區"');
    expect(ui.right.innerHTML).toMatch(/data-branch="分區"[^>]*>\s*<span>分區<\/span><span class="yt-bpill-count">0<\/span>/);
  });
});


describe('mobile branch strip', () => {
  it('scrolls the selected branch into the strip without scrolling the page', async () => {
    const ui = await setup('?s=near', true, new Map(), true);
    const strip = Object.assign(ui.detailPills, {
      style: { setProperty: vi.fn() },
      scrollLeft: 0,
      scrollWidth: 400,
      clientWidth: 200,
      querySelector: () => ({ offsetLeft: 190, offsetWidth: 70 }),
    });
    vi.mocked(ui.right.querySelector).mockReturnValue(strip as unknown as HTMLElement);
    ui.action('[data-pick-product]', { pickProduct: 'P' });
    await vi.waitFor(() => expect(strip.scrollLeft).toBe(125));
    expect(strip.style.setProperty).toHaveBeenCalledWith('--yt-fade-left', '24px');
    expect(strip.style.setProperty).toHaveBeenCalledWith('--yt-fade-right', '24px');
    strip.scrollLeft = 0;
    strip.dispatch('scroll');
    expect(strip.style.setProperty).toHaveBeenLastCalledWith('--yt-fade-right', '24px');
    expect(strip.style.setProperty).toHaveBeenCalledWith('--yt-fade-left', '0px');
    strip.scrollLeft = 200;
    strip.dispatch('scroll');
    expect(strip.style.setProperty).toHaveBeenLastCalledWith('--yt-fade-right', '0px');
    strip.scrollWidth = 100;
    strip.scrollLeft = 0;
    strip.dispatch('scroll');
    expect(strip.style.setProperty.mock.calls.slice(-2)).toEqual([
      ['--yt-fade-left', '0px'], ['--yt-fade-right', '0px'],
    ]);
  });
});


describe('mobile panel height motion', () => {
  it('updates mobile accordions without creating snapshot transitions', async () => {
    const ui = await setup('?s=near', true, new Map(), true);
    const start = vi.fn();
    Object.assign(document, { startViewTransition: start });
    ui.clickStation('near');
    expect(start).not.toHaveBeenCalled();
    expect(ui.right.hidden).toBe(true);
  });
});


describe('real panel sizing', () => {
  it('does not animate thousands of pixels and cancels height on viewport changes', async () => {
    let resized!: () => void;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback; }
      observe() {}
    });
    vi.stubGlobal('getComputedStyle', () => ({
      paddingTop: '18px', paddingBottom: '18px', borderTopWidth: '1px', borderBottomWidth: '1px',
    }));
    const ui = await setup('?s=near', true, new Map(), true);
    resized();
    ui.grid.getBoundingClientRect.mockReturnValue({ height: 4000 });
    resized();
    expect(ui.root.animate).not.toHaveBeenCalled();
    expect(ui.root.style.height).toBe('');
    ui.grid.getBoundingClientRect.mockReturnValue({ height: 3800 });
    resized();
    const animation = ui.root.animate.mock.results[0].value;
    const viewport = window.visualViewport as unknown as ReturnType<typeof element>;
    viewport.dispatch('resize');
    expect(animation.cancel).toHaveBeenCalledOnce();
    expect(ui.root.style.height).toBe('');
  });

  it('animates the live height, retargets an interrupted resize, and clears fixed height for reduced motion', async () => {
    let resized!: () => void;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback; }
      observe() {}
    });
    vi.stubGlobal('getComputedStyle', () => ({
      paddingTop: '18px', paddingBottom: '18px', borderTopWidth: '1px', borderBottomWidth: '1px',
    }));
    const ui = await setup('?s=near', true, new Map(), true);
    resized();
    ui.grid.getBoundingClientRect.mockReturnValue({ height: 200 });
    resized();
    expect(ui.root.style.height).toBe('238px');
    expect(ui.root.animate).toHaveBeenLastCalledWith([
      { height: '538px' }, { height: '238px' },
    ], expect.objectContaining({ duration: 240 }));
    const first = ui.root.animate.mock.results[0].value;
    ui.root.getBoundingClientRect.mockReturnValue({ height: 400 });
    ui.grid.getBoundingClientRect.mockReturnValue({ height: 100 });
    resized();
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(ui.root.animate).toHaveBeenLastCalledWith([
      { height: '400px' }, { height: '138px' },
    ], expect.any(Object));
    const second = ui.root.animate.mock.results[1].value;
    ui.grid.getBoundingClientRect.mockReturnValue({ height: 362 });
    resized();
    expect(second.cancel).toHaveBeenCalledOnce();
    expect(ui.root.style.height).toBe('');
    ui.motion.matches = true;
    ui.motion.dispatch('change');
    resized();
    expect(ui.root.animate).toHaveBeenCalledTimes(2);
  });
});


describe('live content motion controls', () => {
  it('does not replay an effect for an already selected desktop station', async () => {
    const ui = await setup('?s=near');
    ui.clickStation('near');
    expect(ui.right.animate).not.toHaveBeenCalled();
    ui.clickStation('far');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('遠站'));
    ui.motion.matches = true;
    ui.motion.dispatch('change');
    expect(ui.right.animate).not.toHaveBeenCalled();
  });
});


describe('mobile panel minimum height', () => {
  it('never targets a height below the responsive minimum during a collapse', async () => {
    let resized!: () => void;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback; }
      observe() {}
    });
    vi.stubGlobal('getComputedStyle', () => ({
      minHeight: '480px', paddingTop: '18px', paddingBottom: '18px',
      borderTopWidth: '1px', borderBottomWidth: '1px',
    }));
    const ui = await setup('?s=near', true, new Map(), true);
    resized();
    ui.grid.getBoundingClientRect.mockReturnValue({ height: 200 });
    resized();
    expect(ui.root.style.height).toBe('480px');
    expect(ui.root.animate).toHaveBeenLastCalledWith([
      { height: '538px' }, { height: '480px' },
    ], expect.objectContaining({ duration: 240 }));
  });
});

const UPDATED_VERSION = '2026-11-17T10:10:00+08:00';
function updatedInventory(version = UPDATED_VERSION) {
  const product = { commodity_code: 'P', product_name: '新版生乳捲', commodity_name: '原味', price: 100,
    available_stations: 1, total_quantity: 7, lines: ['新版分區'] };
  const station = { station_id: 'near', station_name: '新版近站', station_addr: '新版地址',
    branch_code: 'B', branch_name: '新版分區', lat: 25, lng: 121.5 };
  return (url: string) => {
    if (url === '/api/status') return { last_updated: version, station_count: 2, product_count: 1,
      total_stock_items: 7, cache_ttl_seconds: 600 };
    if (url === '/api/products') return { products: [product], last_updated: version };
    if (url === '/api/stations') return { branches: [{ branch_name: '新版分區', stations: [station,
      { ...station, station_id: 'far', station_name: '新版遠站' }] }] };
    if (url === '/api/stations/counts') return { counts: { near: { product_count: 7 }, far: { product_count: 7 } }, last_updated: version };
    if (url.startsWith('/api/products/')) return { product, stations: [{ ...station, quantity: 7 }],
      total_quantity: 7, last_updated: version };
    return { stock: [{ ...product, quantity: 7 }], last_updated: version };
  };
}
function response(data: unknown): Response {
  return { ok: true, json: async () => data } as Response;
}
function foreground(): void {
  (window as unknown as ReturnType<typeof element>).dispatch('focus');
}

describe('inventory version synchronization', () => {
  it('polls every five minutes, skips hidden tabs, and does not republish an unchanged version', async () => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    expect(window.setInterval).toHaveBeenCalledWith(expect.any(Function), 300_000);
    expect(onUpdate).toHaveBeenCalledOnce();
    const previous = ui.right.innerHTML;
    const calls = vi.mocked(fetch).mock.calls.length;
    Object.assign(document, { visibilityState: 'hidden' });
    foreground();
    expect(fetch).toHaveBeenCalledTimes(calls);
    Object.assign(document, { visibilityState: 'visible' });
    (document as unknown as ReturnType<typeof element>).dispatch('visibilitychange');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(calls + 2));
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(ui.right.innerHTML).toBe(previous);
  });

  it.each(['products', 'stations'] as const)('commits %s summaries and detail together without a loading placeholder', async (view) => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    if (view === 'products') {
      ui.action('[data-pick-product]', { pickProduct: 'P' });
      await vi.waitFor(() => expect(ui.right.innerHTML).toContain('個站點仍有現貨'));
    }
    const previous = ui.right.innerHTML;
    const payload = updatedInventory();
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(async (url) => {
      const path = String(url);
      if (path === (view === 'products' ? '/api/products/P' : '/api/stations/near')) {
        return new Promise<Response>((r) => { resolve = r; });
      }
      return response(payload(path));
    });
    foreground();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    expect(ui.right.innerHTML).toBe(previous);
    expect(onUpdate).toHaveBeenCalledOnce();
    let html = ui.detailRows.innerHTML;
    const writes: string[] = [];
    Object.defineProperty(ui.detailRows, 'innerHTML', { get: () => html,
      set: (value: string) => { writes.push(value); html = value; } });
    resolve(response(payload(view === 'products' ? '/api/products/P' : '/api/stations/near')));
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(ui.right.innerHTML).toContain('新版');
    expect(ui.results.innerHTML).toContain(view === 'products' ? '新版生乳捲' : '新版近站');
    expect(writes.every((value) => !value.includes('載入庫存中'))).toBe(true);
    expect(ui.right.style.minHeight).toBe('');
    expect(ui.right.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false');
    expect(onUpdate.mock.lastCall?.[0].last_updated).toBe(UPDATED_VERSION);
  });

  it('invalidates unselected cached details after a version change', async () => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    ui.clickStation('far');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('遠站'));
    vi.mocked(fetch).mockImplementation(async (url) => response(updatedInventory()(String(url))));
    foreground();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/stations/near').length;
    ui.clickStation('near');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('新版生乳捲'));
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/stations/near')).toHaveLength(calls + 1);
  });

  it.each(['/api/status', '/api/stations/counts', '/api/stations/near'])('retains the displayed version on %s failure and retries', async (failedPath) => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    const previous = ui.right.innerHTML;
    const previousList = ui.results.innerHTML;
    let failed = true;
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url) === failedPath && failed) throw new Error('offline');
      return response(updatedInventory()(String(url)));
    });
    foreground();
    await new Promise((r) => setTimeout(r, 0));
    expect(ui.right.innerHTML).toBe(previous);
    expect(ui.results.innerHTML).toBe(previousList);
    expect(onUpdate).toHaveBeenCalledOnce();
    failed = false;
    foreground();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(ui.right.innerHTML).toContain('新版生乳捲');
  });

  it('rejects mixed backend versions without publishing a new timestamp', async () => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    const previous = ui.right.innerHTML;
    vi.mocked(fetch).mockImplementation(async (url) => response(updatedInventory(
      String(url) === '/api/stations/near' ? '2026-11-17T10:20:00+08:00' : UPDATED_VERSION,
    )(String(url))));
    foreground();
    await new Promise((r) => setTimeout(r, 0));
    expect(ui.right.innerHTML).toBe(previous);
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('follows a selection changed while the background detail is pending', async () => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    let resolve!: (value: Response) => void;
    let held = false;
    vi.mocked(fetch).mockImplementation(async (url) => {
      const path = String(url);
      if (path === '/api/stations/near' && !held) {
        held = true;
        return new Promise<Response>((r) => { resolve = r; });
      }
      return response(updatedInventory()(path));
    });
    foreground();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    ui.clickStation('far');
    resolve(response(updatedInventory()('/api/stations/near')));
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(ui.right.innerHTML).toContain('新版遠站');
    expect(ui.right.innerHTML).not.toContain('新版近站');
  });

  it('prevents an old in-flight response from repopulating the refreshed cache', async () => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    ui.clickStation('far');
    vi.mocked(fetch).mockImplementation(async (url) => response(updatedInventory()(String(url))));
    foreground();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    resolve(response({ stock: [], last_updated: '2026-11-17T10:00:00+08:00' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(ui.right.innerHTML).toContain('新版生乳捲');
    ui.clickStation('near');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('新版近站'));
    ui.clickStation('far');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('新版生乳捲'));
    expect(ui.right.innerHTML).toContain('新版遠站');
  });

  it('handles products and stations removed by a new empty snapshot', async () => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    vi.mocked(fetch).mockImplementation(async (url) => {
      const path = String(url);
      const data = path === '/api/products' ? { products: [], last_updated: UPDATED_VERSION }
        : path === '/api/stations' ? { branches: [] }
        : path === '/api/stations/counts' ? { counts: {}, last_updated: UPDATED_VERSION }
        : updatedInventory()(path);
      return response(data);
    });
    foreground();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(ui.right.innerHTML).toContain('目前沒有可用站點');
    ui.action('[data-pick-product]', { pickProduct: 'P' });
    expect(ui.right.innerHTML).toContain('目前沒有可用站點');
  });
});

describe('inventory synchronization ordering', () => {
  it('coalesces simultaneous polls and retries products if backend refresh completes between requests', async () => {
    const onUpdate = vi.fn();
    await setup('?s=near', true, new Map(), false, { onUpdate });
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    const calls = vi.mocked(fetch).mock.calls.length;
    foreground();
    foreground();
    expect(fetch).toHaveBeenCalledTimes(calls + 1);
    vi.mocked(fetch).mockImplementation(async (url) => response(updatedInventory()(String(url))));
    resolve(response(updatedInventory('2026-11-17T10:00:00+08:00')('/api/products')));
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(onUpdate.mock.lastCall?.[0].last_updated).toBe(UPDATED_VERSION);
  });

  it('does not regress to an older backend instance version', async () => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    const before = ui.right.innerHTML;
    vi.mocked(fetch).mockImplementation(async (url) => response(updatedInventory('2026-11-17T09:50:00+08:00')(String(url))));
    foreground();
    await new Promise((r) => setTimeout(r, 0));
    expect(ui.right.innerHTML).toBe(before);
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('prevents an old product request from overwriting the new version', async () => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    ui.action('[data-pick-product]', { pickProduct: 'P' });
    vi.mocked(fetch).mockImplementation(async (url) => response(updatedInventory()(String(url))));
    foreground();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    resolve(response({ stations: [], total_quantity: 0 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(ui.right.innerHTML).toContain('<strong>7</strong>');
    expect(ui.right.innerHTML).not.toContain('此分區暫無現貨');
  });
});

describe('review regressions: detail versions and interaction state', () => {
  it.each(['products', 'stations'] as const)('rejects old %s details after a version commit and allows a clean retry', async (view) => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    vi.mocked(fetch).mockImplementation(async (url) => response(updatedInventory()(String(url))));
    foreground();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    const path = view === 'products' ? '/api/products/P' : '/api/stations/far';
    let old = true;
    let detailRequests = 0;
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url) === path) {
        detailRequests++;
        return response(updatedInventory(old ? '2026-11-17T10:00:00+08:00' : UPDATED_VERSION)(path));
      }
      return response(updatedInventory()(String(url)));
    });
    if (view === 'products') ui.action('[data-pick-product]', { pickProduct: 'P' });
    else ui.clickStation('far');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('無法載入'));
    expect(detailRequests).toBeLessThanOrEqual(3);
    expect(ui.right.style.minHeight).toBe('');
    expect(ui.right.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false');
    old = false;
    const before = detailRequests;
    ui.action('[data-retry]');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain(view === 'products' ? '<strong>7</strong>' : '新版生乳捲'));
    expect(detailRequests).toBe(before + 1);
  });

  it.each(['products', 'stations'] as const)('reconciles a newer %s detail with summaries before displaying it', async (view) => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    vi.mocked(fetch).mockImplementation(async (url) => response(updatedInventory()(String(url))));
    if (view === 'products') ui.action('[data-pick-product]', { pickProduct: 'P' });
    else ui.clickStation('far');
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(ui.results.innerHTML).toContain(view === 'products' ? '新版生乳捲' : '新版遠站');
    expect(ui.right.innerHTML).toContain(view === 'products' ? '<strong>7</strong>' : '新版生乳捲');
    expect(onUpdate.mock.lastCall?.[0].last_updated).toBe(UPDATED_VERSION);
  });

  it.each(['products', 'stations'] as const)('recovers from one mismatched %s response without caching it', async (view) => {
    const ui = await setup('?s=near');
    const path = view === 'products' ? '/api/products/P' : '/api/stations/far';
    let first = true;
    vi.mocked(fetch).mockImplementation(async (url) => {
      const version = String(url) === path && first ? '2026-11-17T09:50:00+08:00' : '2026-11-17T10:00:00+08:00';
      if (String(url) === path) first = false;
      return response(updatedInventory(version)(String(url)));
    });
    if (view === 'products') ui.action('[data-pick-product]', { pickProduct: 'P' });
    else ui.clickStation('far');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain(view === 'products' ? '<strong>7</strong>' : '新版生乳捲'));
    const requests = vi.mocked(fetch).mock.calls.filter(([url]) => url === path).length;
    if (view === 'products') ui.action('[data-pick-product]', { pickProduct: 'P' });
    else { ui.clickStation('near'); ui.clickStation('far'); }
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === path)).toHaveLength(requests);
  });

  it.each(['products', 'stations'] as const)('does not accept a %s response without last_updated', async (view) => {
    const ui = await setup('?s=near');
    const path = view === 'products' ? '/api/products/P' : '/api/stations/far';
    vi.mocked(fetch).mockImplementation(async (url) => {
      const data = updatedInventory('2026-11-17T10:00:00+08:00')(String(url));
      if (String(url) === path) return response({ ...data, last_updated: undefined });
      return response(data);
    });
    if (view === 'products') ui.action('[data-pick-product]', { pickProduct: 'P' });
    else ui.clickStation('far');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('無法載入'));
  });

  it.each([true, false])('restores the detail product button or falls back when removed (exists=%s)', async (exists) => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    Object.assign(document, { activeElement: { dataset: { pickProduct: 'P' } } });
    const nextButton = element();
    const original = ui.root.querySelector;
    vi.spyOn(ui.root, 'querySelector').mockImplementation((selector) => selector === '[data-pick-product="P"]'
      ? exists ? nextButton : null : original(selector));
    vi.mocked(fetch).mockImplementation(async (url) => response(updatedInventory()(String(url))));
    foreground();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(exists ? nextButton.focus : ui.input.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('does not steal focus from a homepage product card outside the console', async () => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    Object.assign(document, { activeElement: { dataset: { code: 'P' } } });
    ui.root.contains.mockReturnValue(false);
    const queryButton = element();
    const original = ui.root.querySelector;
    vi.spyOn(ui.root, 'querySelector').mockImplementation((selector) => selector === '[data-code="P"]' ? queryButton : original(selector));
    vi.mocked(fetch).mockImplementation(async (url) => response(updatedInventory()(String(url))));
    foreground();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(ui.input.focus).not.toHaveBeenCalled();
    expect(queryButton.focus).not.toHaveBeenCalled();
  });

  it.each([1000, 600])('preserves and clamps the same detail scroll position (scrollHeight=%s)', async (scrollHeight) => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    const previousList = { scrollTop: 500, children: [], getBoundingClientRect: () => ({ top: 0, bottom: 400 }) };
    const nextList = { children: [], getBoundingClientRect: () => ({ top: 0, bottom: 400 }), scrollTop: 0, scrollHeight, clientHeight: 400 };
    let reads = 0;
    ui.right.querySelector.mockImplementation((selector) => selector === '.yt-srows--scroll'
      ? (++reads === 1 ? previousList : nextList) as unknown as HTMLElement : null);
    vi.mocked(fetch).mockImplementation(async (url) => response(updatedInventory()(String(url))));
    foreground();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(nextList.scrollTop).toBe(Math.min(500, scrollHeight - 400));
  });

  it('does not carry scroll position to a replacement selection', async () => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    const nextList = { children: [], getBoundingClientRect: () => ({ top: 0, bottom: 400 }), scrollTop: 0, scrollHeight: 1000, clientHeight: 400 };
    ui.right.querySelector.mockImplementation((selector) => selector === '.yt-srows--scroll' ? nextList as unknown as HTMLElement : null);
    vi.mocked(fetch).mockImplementation(async (url) => {
      const data = updatedInventory()(String(url));
      if (String(url) === '/api/stations') return response({ branches: [{ branch_name: '新版分區', stations: [
        { station_id: 'far', station_name: '新版遠站', station_addr: '', branch_name: '新版分區' },
      ] }] });
      return response(data);
    });
    foreground();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(nextList.scrollTop).toBe(0);
  });
});

describe('joined synchronization regressions', () => {
  it.each(['products', 'stations'] as const)('waits for the ongoing pass and selected %s continuation before using a retry', async (view) => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    let releaseOriginal!: (value: Response) => void;
    let releaseSelected!: (value: Response) => void;
    let heldOriginal = false;
    let selectedCalls = 0;
    const selectedPath = view === 'products' ? '/api/products/P' : '/api/stations/far';
    vi.mocked(fetch).mockImplementation(async (url) => {
      const path = String(url);
      if (path === '/api/stations/near' && !heldOriginal) {
        heldOriginal = true;
        return new Promise<Response>((r) => { releaseOriginal = r; });
      }
      if (path === selectedPath && ++selectedCalls === 2) {
        return new Promise<Response>((r) => { releaseSelected = r; });
      }
      return response(updatedInventory()(path));
    });
    foreground();
    await vi.waitFor(() => expect(releaseOriginal).toBeTypeOf('function'));
    if (view === 'products') ui.action('[data-pick-product]', { pickProduct: 'P' });
    else ui.clickStation('far');
    await vi.waitFor(() => expect(selectedCalls).toBe(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(ui.detailRows.innerHTML).toBe('');
    expect(ui.right.innerHTML).not.toContain('無法載入');
    releaseOriginal(response(updatedInventory()('/api/stations/near')));
    await vi.waitFor(() => expect(releaseSelected).toBeTypeOf('function'));
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(ui.right.innerHTML).not.toContain('無法載入');
    releaseSelected(response(updatedInventory()(selectedPath)));
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(ui.right.innerHTML).toContain(view === 'products' ? '<strong>7</strong>' : '新版遠站');
    expect(selectedCalls).toBe(2);
  });

  it('waits through multiple selection continuations and only commits the final selection', async () => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    let releaseNear!: (value: Response) => void;
    let releaseFar!: (value: Response) => void;
    let nearCalls = 0;
    let farCalls = 0;
    vi.mocked(fetch).mockImplementation(async (url) => {
      const path = String(url);
      if (path === '/api/stations/near' && ++nearCalls === 1) return new Promise<Response>((r) => { releaseNear = r; });
      if (path === '/api/stations/far' && ++farCalls === 2) return new Promise<Response>((r) => { releaseFar = r; });
      return response(updatedInventory()(path));
    });
    foreground();
    await vi.waitFor(() => expect(releaseNear).toBeTypeOf('function'));
    ui.clickStation('far');
    await vi.waitFor(() => expect(farCalls).toBe(1));
    releaseNear(response(updatedInventory()('/api/stations/near')));
    await vi.waitFor(() => expect(releaseFar).toBeTypeOf('function'));
    ui.action('[data-pick-product]', { pickProduct: 'P' });
    await new Promise((r) => setTimeout(r, 0));
    expect(ui.right.innerHTML).not.toContain('無法載入');
    expect(onUpdate).toHaveBeenCalledOnce();
    releaseFar(response(updatedInventory()('/api/stations/far')));
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(ui.right.innerHTML).toContain('<strong>7</strong>');
    expect(ui.right.innerHTML).not.toContain('無法載入');
  });

  it('releases a failed shared synchronization and permits an explicit retry without an automatic loop', async () => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    let fail = true;
    let detailCalls = 0;
    vi.mocked(fetch).mockImplementation(async (url) => {
      const path = String(url);
      if (path === '/api/stations/counts' && fail) throw new Error('offline');
      if (path === '/api/stations/far') detailCalls++;
      return response(updatedInventory()(path));
    });
    ui.clickStation('far');
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('無法載入'));
    const settled = detailCalls;
    await new Promise((r) => setTimeout(r, 0));
    expect(detailCalls).toBe(settled);
    expect(detailCalls).toBe(2);
    fail = false;
    ui.action('[data-retry]');
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(ui.right.innerHTML).toContain('新版遠站');
  });
});

describe('loading feedback does not flash for fast requests', () => {
  it.each(['products', 'stations'] as const)('never inserts a loading message for a fast uncached %s response', async (view) => {
    const ui = await setup('?s=near');
    vi.useFakeTimers();
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    let html = ui.detailRows.innerHTML;
    const writes: string[] = [];
    Object.defineProperty(ui.detailRows, 'innerHTML', { get: () => html,
      set: (value: string) => { writes.push(value); html = value; } });
    if (view === 'products') ui.action('[data-pick-product]', { pickProduct: 'P' });
    else ui.clickStation('far');
    await vi.advanceTimersByTimeAsync(100);
    expect(ui.detailRows.innerHTML).toBe('');
    expect(ui.right.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'true');
    resolve(response(updatedInventory('2026-11-17T10:00:00+08:00')(view === 'products' ? '/api/products/P' : '/api/stations/far')));
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.right.innerHTML).toContain(view === 'products' ? '<strong>7</strong>' : '新版生乳捲');
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes.some((value) => value.includes('載入庫存中'))).toBe(false);
    expect(ui.right.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false');
  });

  it.each((['products', 'stations'] as const).flatMap((view) =>
    [true, false].map((ok) => [view, ok] as const),
  ))('shows delayed feedback for slow %s and clears it on completion (ok=%s)', async (view, ok) => {
    const ui = await setup('?s=near');
    vi.useFakeTimers();
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    if (view === 'products') ui.action('[data-pick-product]', { pickProduct: 'P' });
    else ui.clickStation('far');
    await vi.advanceTimersByTimeAsync(199);
    expect(ui.right.innerHTML).not.toContain('載入庫存中');
    await vi.advanceTimersByTimeAsync(1);
    expect(ui.right.innerHTML).toContain('載入庫存中');
    resolve(ok ? response(updatedInventory('2026-11-17T10:00:00+08:00')(view === 'products' ? '/api/products/P' : '/api/stations/far'))
      : { ok: false } as Response);
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.right.innerHTML).not.toContain('載入庫存中');
    expect(ui.right.innerHTML).toContain(ok ? view === 'products' ? '<strong>7</strong>' : '新版生乳捲' : '無法載入');
    expect(ui.right.style.minHeight).toBe('');
    expect(ui.right.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false');
  });

  it.each(['products', 'stations'] as const)('does not let a pending %s timer replace the latest selection', async (view) => {
    const ui = await setup('?s=near');
    vi.useFakeTimers();
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    if (view === 'products') ui.action('[data-pick-product]', { pickProduct: 'P' });
    else ui.clickStation('far');
    await vi.advanceTimersByTimeAsync(100);
    if (view === 'products') ui.switchToStations();
    else ui.clickStation('near');
    await vi.advanceTimersByTimeAsync(500);
    expect(ui.right.innerHTML).toContain('近站');
    expect(ui.right.innerHTML).not.toContain('載入庫存中');
    resolve(response(updatedInventory('2026-11-17T10:00:00+08:00')(view === 'products' ? '/api/products/P' : '/api/stations/far')));
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.right.innerHTML).toContain('近站');
    expect(ui.right.innerHTML).not.toContain('載入庫存中');
  });
});

describe('reading anchor during background reconciliation', () => {
  it.each([true, false])('keeps the visible row position when rows above it reorder (internal=%s)', async (internal) => {
    const onUpdate = vi.fn();
    const ui = await setup('?s=near', true, new Map(), false, { onUpdate });
    const row = { hasAttribute: () => true,
      getBoundingClientRect: vi.fn().mockReturnValueOnce({ top: 100, bottom: 150 })
        .mockReturnValueOnce({ top: 100, bottom: 150 }).mockReturnValue({ top: 300, bottom: 350 }) };
    const previousList = { children: [row], scrollTop: internal ? 300 : 0,
      scrollHeight: internal ? 2000 : 400, clientHeight: 400,
      getBoundingClientRect: () => ({ top: internal ? 0 : -200, bottom: 400 }) };
    const nextList = { scrollTop: internal ? 300 : 0, scrollHeight: 2000, clientHeight: 400,
      contains: () => true, getBoundingClientRect: () => ({ top: 0, bottom: 400 }) };
    let reads = 0;
    ui.right.querySelector.mockImplementation((selector) => selector === '.yt-srows--scroll'
      ? (++reads === 1 ? previousList : nextList) as unknown as HTMLElement : null);
    Object.assign(window, { scrollY: 900, scrollTo: vi.fn() });
    vi.mocked(fetch).mockImplementation(async (url) => response(updatedInventory()(String(url))));
    foreground();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    if (internal) expect(nextList.scrollTop).toBe(500);
    else expect(window.scrollTo).toHaveBeenCalledWith({ top: 1100, behavior: 'auto' });
  });
});

describe('persistent panel selection and pending feedback', () => {
  it('resets scrolling when switching between cached products without another detail request', async () => {
    const ui = await setup('?p=P', true, new Map(), false, {}, ['P', 'Q']);
    ui.clickProduct('Q');
    await vi.waitFor(() => expect(ui.right.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false'));
    ui.clickProduct('P');
    await vi.waitFor(() => expect(ui.right.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false'));
    ui.detailRows.scrollTop = 300;
    const requests = vi.mocked(fetch).mock.calls.length;
    ui.clickProduct('Q');
    await vi.waitFor(() => expect(ui.right.setAttribute).toHaveBeenLastCalledWith('aria-busy', 'false'));
    expect(ui.detailRows.scrollTop).toBe(0);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(requests);
  });

  it.each(['products', 'stations'] as const)('retains visible pending %s feedback across breakpoints', async (view) => {
    const ui = await setup('?s=near');
    vi.useFakeTimers();
    vi.mocked(fetch).mockReturnValue(new Promise<Response>(() => {}));
    if (view === 'products') ui.action('[data-pick-product]', { pickProduct: 'P' });
    else ui.clickStation('far');
    await vi.advanceTimersByTimeAsync(200);
    const feedback = ui.detailRows.innerHTML;
    expect(feedback).toContain('載入庫存中');
    let html = feedback;
    const writes: string[] = [];
    Object.defineProperty(ui.detailRows, 'innerHTML', { get: () => html,
      set: (value: string) => { writes.push(value); html = value; } });
    ui.resize(true);
    expect(ui.detailRows.innerHTML).toBe(feedback);
    await vi.advanceTimersByTimeAsync(50);
    ui.resize(false);
    expect(ui.detailRows.innerHTML).toBe(feedback);
    await vi.advanceTimersByTimeAsync(200);
    expect(writes.every((value) => value === feedback)).toBe(true);
  });

  it.each(['products', 'stations'] as const)('keeps the original %s feedback deadline before a breakpoint', async (view) => {
    const ui = await setup('?s=near');
    vi.useFakeTimers();
    vi.mocked(fetch).mockReturnValue(new Promise<Response>(() => {}));
    if (view === 'products') ui.action('[data-pick-product]', { pickProduct: 'P' });
    else ui.clickStation('far');
    await vi.advanceTimersByTimeAsync(150);
    ui.resize(true);
    await vi.advanceTimersByTimeAsync(49);
    expect(ui.detailRows.innerHTML).not.toContain('載入庫存中');
    await vi.advanceTimersByTimeAsync(1);
    expect(ui.detailRows.innerHTML).toContain('載入庫存中');
  });
});
