import { afterEach, describe, expect, it, vi } from 'vitest';
import { initQueryConsole } from './query';
import { FAVORITES_KEY } from './favorites';

function element(dataset: Record<string, string> = {}) {
  const listeners = new Map<string, (event: unknown) => void>();
  return {
    dataset,
    innerHTML: '',
    value: '',
    hidden: false,
    disabled: false,
    title: '',
    classList: { add: vi.fn(), toggle: vi.fn() },
    setAttribute: vi.fn(),
    focus: vi.fn(),
    append: vi.fn(),
    style: { height: '' },
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

async function setup(search = '', countsAvailable = true, storage = new Map<string, string>(), mobile = false) {
  const productButton = element({ view: 'products' });
  const stationButton = element({ view: 'stations' });
  const input = element();
  const results = element();
  const right = { ...element(), id: 'query-console-details' };
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
  vi.stubGlobal('document', { querySelector: () => root });
  vi.stubGlobal('window', { ...element(), matchMedia: (query: string) => query.includes('reduced-motion') ? motion : media });
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
        if (url === '/api/products') return { products: [product] };
        if (url === '/api/stations') return { branches: [{ branch_name: '分區', stations }] };
        if (url === '/api/stations/counts') {
          if (!countsAvailable) throw new Error('Counts unavailable');
          return { counts: { near: { product_count: 2 } } };
        }
        if (url === '/api/products/P') return { product, stations: [], total_quantity: 0 };
        return { stock: [{ ...product, quantity: 3 }] };
      },
    })),
  );
  await initQueryConsole({ persist: Boolean(search) });
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
  return { root, input, results, right, grid, resize, motion, clickProduct, counts, clickStation, action, switchToStations, locate,
    favorite, favoritesFilter, favoritesStatus, favoritesAll, allCount, favoritesCount, locateButton };
}

afterEach(() => vi.unstubAllGlobals());

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
    resolve({ ok: true, json: async () => ({ stock: [{ product_name: '舊回應', quantity: 1 }] }) } as Response);
    await new Promise((r) => setTimeout(r, 0));
    expect(ui.right.innerHTML).toContain('遠站');
    expect(ui.right.innerHTML).not.toContain('舊回應');
  });

  it('shows unknown counts when summaries fail, and zero after fetching empty stock', async () => {
    const ui = await setup('?view=stations', false);
    expect(ui.results.innerHTML).toContain('款數未知');
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ stock: [{ quantity: 0 }] }) } as Response);
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
    expect(ui.right.innerHTML).toContain('近站');
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
    expect(ui.right.innerHTML).toContain('載入庫存中');
    expect(ui.right.innerHTML).not.toContain('近站');
    resolve({ ok: true, json: async () => ({ product: { commodity_code: 'P', product_name: '生乳捲' }, stations: [] }) } as Response);
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('個站點仍有現貨'));
  });
});


describe('query transitions', () => {
  it('fades the live result and cancels the previous effect on a new selection', async () => {
    const ui = await setup('?s=near');
    ui.clickStation('far');
    await vi.waitFor(() => expect(ui.right.animate).toHaveBeenCalledOnce());
    const previous = ui.right.animate.mock.results[0].value;
    ui.clickStation('near');
    expect(previous.cancel).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('近站'));
    expect(ui.right.animate).toHaveBeenLastCalledWith([
      { opacity: 0.55 }, { opacity: 1 },
    ], { duration: 160, easing: 'ease-out' });
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
    await vi.waitFor(() => expect(ui.right.animate).toHaveBeenCalledOnce());
    resolve({ ok: true, json: async () => ({ stock: [] }) } as Response);
    await new Promise((r) => setTimeout(r, 0));
    expect(ui.right.innerHTML).toContain('近站');
    expect(ui.right.animate).toHaveBeenCalledOnce();
  });
});

describe('branch stock counts', () => {
  it('counts stocked stations rather than quantities, retains zero, and ignores the active filter', async () => {
    const ui = await setup('?s=near');
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
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
    const strip = {
      ...element(),
      style: { setProperty: vi.fn() },
      scrollLeft: 0,
      scrollWidth: 400,
      clientWidth: 200,
      querySelector: () => ({ offsetLeft: 190, offsetWidth: 70 }),
    };
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
    await vi.waitFor(() => expect(ui.right.animate).toHaveBeenCalledOnce());
    const animation = ui.right.animate.mock.results[0].value;
    ui.motion.matches = true;
    ui.motion.dispatch('change');
    expect(animation.cancel).toHaveBeenCalledOnce();
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
