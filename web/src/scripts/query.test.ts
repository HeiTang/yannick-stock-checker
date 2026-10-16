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
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    dispatch: (type: string, event: unknown = {}) => listeners.get(type)?.(event),
  };
}

async function setup() {
  const productButton = element({ view: 'products' });
  const stationButton = element({ view: 'stations' });
  const input = element();
  const results = element();
  const right = element();
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
        if (url === '/api/stations/counts') return { counts: {} };
        if (url === '/api/products/P') return { product, stations: [], total_quantity: 0 };
        return { stock: [] };
      },
    })),
  );
  await initQueryConsole({ persist: false });
  const settle = () => vi.waitFor(() => expect(right.innerHTML).not.toBe(''));
  const switchToStations = async () => {
    right.innerHTML = '';
    stationButton.dispatch('click');
    await settle();
  };
  const locate = async () => {
    right.innerHTML = '';
    right.dispatch('click', {
      target: { closest: (selector: string) => (selector === '[data-locate]' ? {} : null) },
    });
    await settle();
  };
  return { input, results, right, switchToStations, locate };
}

afterEach(() => vi.unstubAllGlobals());

describe('station location selection', () => {
  it('selects the closest station and sorts results, leaving missing coordinates last', async () => {
    const ui = await setup();
    await ui.switchToStations();
    await ui.locate();
    expect(ui.right.innerHTML).toContain('yt-panel-title">近站');
    expect(ui.right.innerHTML).toContain('0 m');
    expect(ui.results.innerHTML.indexOf('data-tid="near"')).toBeLessThan(
      ui.results.innerHTML.indexOf('data-tid="far"'),
    );
    expect(ui.results.innerHTML.indexOf('data-tid="far"')).toBeLessThan(
      ui.results.innerHTML.indexOf('data-tid="unknown"'),
    );
  });

  it('uses the existing location when switching from products to stations', async () => {
    const ui = await setup();
    await ui.locate();
    await ui.switchToStations();
    expect(ui.right.innerHTML).toContain('yt-panel-title">近站');
  });

  it('keeps the search filter when selecting the nearest matching station', async () => {
    const ui = await setup();
    await ui.switchToStations();
    ui.input.value = '遠站';
    ui.input.dispatch('input');
    await ui.locate();
    expect(ui.right.innerHTML).toContain('yt-panel-title">遠站');
    expect(ui.results.innerHTML).not.toContain('data-tid="near"');
  });

  it('retains the selected station when the search has no matches', async () => {
    const ui = await setup();
    await ui.switchToStations();
    ui.input.value = '不存在';
    ui.input.dispatch('input');
    await ui.locate();
    expect(ui.right.innerHTML).toContain('yt-panel-title">無座標站');
    expect(ui.results.innerHTML).toContain('找不到符合的站點');
  });
});
