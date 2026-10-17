import { afterEach, describe, expect, it, vi } from 'vitest';
import { initQueryConsole } from './query';

function element(dataset: Record<string, string> = {}) {
  const listeners = new Map<string, (event: unknown) => void>();
  return {
    dataset,
    innerHTML: '',
    value: '',
    hidden: false,
    classList: { add: vi.fn(), toggle: vi.fn() },
    setAttribute: vi.fn(),
    focus: vi.fn(),
    textContent: '',
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    dispatch: (type: string, event: unknown = {}) => listeners.get(type)?.(event),
  };
}

async function setup(search = '', countsAvailable = true) {
  const productButton = element({ view: 'products' });
  const stationButton = element({ view: 'stations' });
  const input = element();
  const results = element();
  const right = element();
  const panels = new Map<string, ReturnType<typeof element>>();
  const counts = new Map<string, ReturnType<typeof element>>();
  const buttons = new Map<string, ReturnType<typeof element>>();
  Object.assign(results, {
    querySelector: (selector: string) => {
      const match = selector.match(/data-(stock|count|tid)="([^"]+)"/);
      if (!match || !results.innerHTML.includes(`data-${match[1]}="${match[2]}"`)) return null;
      const map = match[1] === 'stock' ? panels : match[1] === 'count' ? counts : buttons;
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
  vi.stubGlobal('window', {});
  vi.stubGlobal('CSS', { escape: (s: string) => s });
  vi.stubGlobal('location', { search, pathname: '/query/', hash: '' });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
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
    await vi.waitFor(() => expect(right.hidden).toBe(true));
  };
  const action = (selector: string, dataset = {}) => root.dispatch('click', {
    target: { closest: (s: string) => s === selector ? { dataset } : null },
  });
  const locate = async () => {
    action('[data-locate]');
    await vi.waitFor(() => expect(
      results.innerHTML + right.innerHTML,
    ).toContain('已定位'));
  };
  const clickStation = (tid: string) => results.dispatch('click', {
    target: { closest: () => ({ dataset: { tid } }) },
  });
  return { input, results, right, panels, counts, clickStation, action, switchToStations, locate };
}

afterEach(() => vi.unstubAllGlobals());

describe('station accordion', () => {
  it('starts collapsed without fetching station details', async () => {
    const ui = await setup();
    await ui.switchToStations();
    expect(ui.results.innerHTML).not.toContain('aria-expanded="true"');
    expect(vi.mocked(fetch).mock.calls.some(([url]) => /^\/api\/stations\/(?!counts)/.test(String(url))))
      .toBe(false);
  });

  it('sorts by distance without expanding and keeps stock counts visible', async () => {
    const ui = await setup();
    await ui.switchToStations();
    await ui.locate();
    expect(ui.results.innerHTML).toContain('已依距離排序');
    expect(ui.results.innerHTML).toContain('0 m');
    expect(ui.results.innerHTML).toContain('2 款');
    expect(ui.results.innerHTML).toContain('距離未知');
    expect(ui.results.innerHTML).not.toContain('aria-expanded="true"');
    expect(ui.results.innerHTML.indexOf('data-tid="near"')).toBeLessThan(
      ui.results.innerHTML.indexOf('data-tid="far"'),
    );
    expect(ui.results.innerHTML.indexOf('data-tid="far"')).toBeLessThan(
      ui.results.innerHTML.indexOf('data-tid="unknown"'),
    );
  });

  it('uses the existing location when switching from products', async () => {
    const ui = await setup();
    await ui.locate();
    await ui.switchToStations();
    expect(ui.results.innerHTML).toContain('已依距離排序');
    expect(ui.results.innerHTML).not.toContain('aria-expanded="true"');
  });

  it('opens one station, updates its count, and reuses cached stock', async () => {
    const ui = await setup();
    await ui.switchToStations();
    ui.clickStation('near');
    await vi.waitFor(() => expect(ui.panels.get('near')?.innerHTML).toContain('3'));
    expect(ui.counts.get('near')?.textContent).toBe('1 款');
    ui.clickStation('far');
    expect(ui.results.innerHTML.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(ui.results.innerHTML).toContain('data-stock="near" aria-label="近站商品庫存" aria-live="polite" hidden');
    ui.clickStation('far');
    expect(ui.results.innerHTML).not.toContain('aria-expanded="true"');
    ui.clickStation('near');
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/stations/near'))
      .toHaveLength(1));
  });

  it('preserves search while locating and keeps the location control for no results', async () => {
    const ui = await setup();
    await ui.switchToStations();
    ui.input.value = '遠站';
    ui.input.dispatch('input');
    await ui.locate();
    expect(ui.results.innerHTML).not.toContain('data-tid="near"');
    expect(ui.results.innerHTML).toContain('data-tid="far"');
    ui.input.value = '不存在';
    ui.input.dispatch('input');
    expect(ui.results.innerHTML).toContain('找不到符合的站點');
    expect(ui.results.innerHTML).toContain('data-locate');
  });

  it('opens a station deep link automatically', async () => {
    const ui = await setup('?s=near');
    expect(ui.results.innerHTML).toContain('aria-expanded="true"');
    expect(ui.panels.get('near')?.innerHTML).toContain('生乳捲');
  });

  it('shows an inline error and retries without caching failure', async () => {
    const ui = await setup();
    await ui.switchToStations();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    ui.clickStation('near');
    await vi.waitFor(() => expect(ui.panels.get('near')?.innerHTML).toContain('重試'));
    ui.action('[data-retry]');
    await vi.waitFor(() => expect(ui.panels.get('near')?.innerHTML).toContain('生乳捲'));
  });

  it('does not populate a closed station when its response arrives late', async () => {
    const ui = await setup();
    await ui.switchToStations();
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    ui.clickStation('near');
    ui.clickStation('near');
    resolve({ ok: true, json: async () => ({ stock: [] }) } as Response);
    await new Promise((r) => setTimeout(r, 0));
    expect(ui.results.innerHTML).not.toContain('aria-expanded="true"');
    expect(ui.panels.has('near')).toBe(false);
  });

  it('shows unknown counts when the batch endpoint fails', async () => {
    const ui = await setup('', false);
    await ui.switchToStations();
    expect(ui.results.innerHTML).toContain('款數未知');
    expect(ui.results.innerHTML).not.toContain('0 款');
  });

  it('only counts products in stock and handles an empty station', async () => {
    const ui = await setup();
    await ui.switchToStations();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ stock: [{ quantity: 0 }] }),
    } as Response);
    ui.clickStation('near');
    await vi.waitFor(() => expect(ui.panels.get('near')?.innerHTML).toContain('此站點目前無庫存'));
    expect(ui.counts.get('near')?.textContent).toBe('0 款');
  });

  it('can switch from an expanded station product to the product view', async () => {
    const ui = await setup();
    await ui.switchToStations();
    ui.clickStation('near');
    await vi.waitFor(() => expect(ui.panels.get('near')?.innerHTML).toContain('data-pick-product="P"'));
    ui.action('[data-pick-product]', { pickProduct: 'P' });
    await vi.waitFor(() => expect(ui.right.hidden).toBe(false));
    expect(ui.results.innerHTML).toContain('data-code="P"');
  });
});
