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
  return { input, results, right, grid, resize, motion, clickProduct, counts, clickStation, action, switchToStations, locate,
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
    const ui = await setup('?p=P');
    const event = (value: string | null, key: string | null = FAVORITES_KEY) =>
      (window as unknown as ReturnType<typeof element>).dispatch('storage', {
        key, newValue: value, storageArea: localStorage,
      });
    event(JSON.stringify([{ view: 'products', id: 'P', name: '生乳捲' }]));
    expect(ui.results.innerHTML).toContain('取消收藏：生乳捲');
    event(null, null);
    expect(ui.results.innerHTML).toContain('加入我的最愛：生乳捲');
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
  it('animates selection and skips an unfinished transition on the next action', async () => {
    const ui = await setup('?s=near', true, new Map(), true);
    const transition = { skipTransition: vi.fn(), ready: Promise.resolve(), finished: new Promise<void>(() => {}) };
    const start = vi.fn((update: () => void) => { update(); return transition; });
    Object.assign(document, { startViewTransition: start });
    ui.clickStation('far');
    expect(start).toHaveBeenCalledTimes(1);
    ui.clickStation('far');
    expect(transition.skipTransition).toHaveBeenCalledOnce();
    expect(ui.right.hidden).toBe(true);
  });

  it('updates immediately when reduced motion is enabled', async () => {
    const ui = await setup('?s=near', true, new Map(), true);
    const start = vi.fn();
    Object.assign(document, { startViewTransition: start });
    ui.motion.matches = true;
    ui.clickStation('far');
    expect(start).not.toHaveBeenCalled();
    expect(ui.results.innerHTML.match(/aria-expanded="true"/g)).toHaveLength(1);
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('遠站'));
  });
});


describe('queued transition updates', () => {
  it('discards a queued animation update after a newer search render', async () => {
    const ui = await setup('?s=near', true, new Map(), true);
    let queued!: () => void;
    Object.assign(document, {
      startViewTransition: (update: () => void) => {
        queued = update;
        return { skipTransition: vi.fn(), ready: Promise.resolve(), finished: new Promise<void>(() => {}) };
      },
    });
    ui.clickStation('far');
    ui.input.value = '站';
    ui.input.dispatch('input');
    vi.mocked(ui.grid.append).mockClear();
    queued();
    expect(ui.grid.append).not.toHaveBeenCalled();
  });

  it('only applies the newest of two queued selection updates', async () => {
    const ui = await setup('?s=near', true, new Map(), true);
    const updates: (() => void)[] = [];
    Object.assign(document, {
      startViewTransition: (update: () => void) => {
        updates.push(update);
        return { skipTransition: vi.fn(), ready: Promise.resolve(), finished: new Promise<void>(() => {}) };
      },
    });
    ui.clickStation('far');
    ui.clickStation('near');
    vi.mocked(ui.grid.append).mockClear();
    updates[0]();
    expect(ui.grid.append).not.toHaveBeenCalled();
    updates[1]();
    expect(ui.grid.append).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(ui.right.innerHTML).toContain('近站'));
  });
});
