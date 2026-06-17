/**
 * 亞尼克・庫存雷達 — 快速查詢 console
 * 雙視角（商品 ⇄ 站點）查詢、深連結 + localStorage 記憶、分區篩選、定位排序。
 */

import { accentFor, flavorOf, type ProductSummary } from './products.ts';
import { icon } from './icon.ts';
import { escapeHtml } from './utils.ts';

interface StationInfo {
  station_id: string;
  station_name: string;
  station_addr: string;
  branch_name: string;
  quantity: number;
}

interface ProductDetail {
  product: {
    commodity_code: string;
    product_name: string;
    commodity_name: string;
    price: number;
  };
  stations: StationInfo[];
  total_quantity: number;
}

interface StationSummary {
  station_id: string;
  station_name: string;
  station_addr: string;
  branch_code: string;
  branch_name: string;
}

interface BranchGroup {
  branch_code: string;
  branch_name: string;
  stations: StationSummary[];
}

interface StationProductRow {
  commodity_code: string;
  product_name: string;
  commodity_name: string;
  price: number;
  quantity: number;
}

type ViewMode = 'products' | 'stations';

interface QueryState {
  view: ViewMode;
  keyword: string;
  pickedProduct: string;
  pickedStation: string;
  located: boolean;
  branch: string;
  focused: boolean;
}

const STORAGE_KEY = 'ytm.query';

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDistance(km: number | null | undefined): string {
  if (km == null) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

export interface InitOptions {
  rootSelector?: string;
  persist?: boolean;
  lean?: boolean;
  sectionHead?: { kicker: string; title: string };
}

const VIEW_SUBS: Record<ViewMode, string> = {
  products: '商品視角：搜尋商品、開啟定位依距離找最近的取貨站點。',
  stations: '站點視角：搜尋你常去的站點，直接看它現在還有哪些生乳捲。',
};

export interface QueryHandle {
  pickProduct(code: string): void;
}

export async function initQueryConsole(opts: InitOptions = {}): Promise<QueryHandle> {
  const root = document.querySelector<HTMLElement>(opts.rootSelector ?? '#query-console');
  if (!root) return { pickProduct() {} };

  const persist = opts.persist ?? true;
  const lean = opts.lean ?? true;

  let products: ProductSummary[] = [];
  let branches: BranchGroup[] = [];
  let allStations: (StationSummary & { lat?: number; lng?: number; distanceKm?: number })[] = [];
  const productDetailCache = new Map<string, ProductDetail>();
  const stationDetailCache = new Map<string, StationProductRow[]>();

  // ---- Load initial data ----
  // Counts are best-effort: kick off the fetch in parallel but catch errors
  // so a failure on this endpoint cannot abort the page-critical
  // products + stations load.
  const countsPromise = fetch('/api/stations/counts')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  let stationCounts: Record<string, number> = {};
  try {
    const [pRes, sRes] = await Promise.all([
      fetch('/api/products'),
      fetch('/api/stations'),
    ]);
    if (!pRes.ok || !sRes.ok) {
      throw new Error(`API error: products=${pRes.status} stations=${sRes.status}`);
    }
    const pData = await pRes.json();
    const sData = await sRes.json();
    products = (pData.products ?? []) as ProductSummary[];
    branches = (sData.branches ?? []) as BranchGroup[];
    allStations = branches.flatMap((b) =>
      b.stations.map((s) => ({ ...s, branch_name: b.branch_name })),
    );
  } catch {
    root.innerHTML = `<div class="yt-empty">無法載入資料，請稍後再試。</div>`;
    return { pickProduct() {} };
  }

  // Now resolve the best-effort counts; a null payload here is silently ignored.
  const cData = (await countsPromise) as {
    counts: Record<string, { product_count: number; total_quantity: number }>;
  } | null;
  if (cData?.counts) {
    stationCounts = Object.fromEntries(
      Object.entries(cData.counts).map(([tid, info]) => [tid, info.product_count]),
    );
  }

  if (products.length === 0 || allStations.length === 0) {
    root.innerHTML = `<div class="yt-empty">目前沒有可用資料。</div>`;
    return { pickProduct() {} };
  }

  const allBranchNames = Array.from(new Set(allStations.map((s) => s.branch_name)));
  const stationById = new Map(allStations.map((s) => [s.station_id, s]));

  // ---- Initial state (URL + localStorage memory) ----
  const initial: QueryState = {
    view: 'products',
    keyword: '',
    pickedProduct: products[0].commodity_code,
    pickedStation: allStations[0].station_id,
    located: false,
    branch: 'all',
    focused: false,
  };

  if (persist) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.view === 'stations' || saved.view === 'products') initial.view = saved.view;
        if (saved.product && products.some((p) => p.commodity_code === saved.product)) {
          initial.pickedProduct = saved.product;
        }
        if (saved.station && allStations.some((s) => s.station_id === saved.station)) {
          initial.pickedStation = saved.station;
        }
        // Intentionally do not restore `located`: userPos is not persisted,
        // restoring "located=true" would show stale label without distance data.
      }
    } catch {
      /* ignore */
    }
    const u = new URLSearchParams(location.search);
    const vw = u.get('view');
    if (vw === 'stations' || vw === 'products') initial.view = vw;
    const p = u.get('p');
    if (p) {
      const m = products.find((x) => x.commodity_code === p || x.product_name.includes(p));
      if (m) {
        initial.pickedProduct = m.commodity_code;
        initial.view = 'products';
      }
    }
    const s = u.get('s');
    if (s) {
      const m = allStations.find((x) => x.station_id === s || x.station_name.includes(s));
      if (m) {
        initial.pickedStation = m.station_id;
        initial.view = 'stations';
      }
    }
  }

  const state: QueryState = { ...initial };
  let userPos: { lat: number; lng: number } | null = null;
  let isLocating = false;

  // ---- DOM ----
  let consoleEl: HTMLElement = root;
  let $sectionSub: HTMLElement | null = null;
  if (!lean && opts.sectionHead) {
    root.innerHTML = `
      <div class="yt-section-head">
        <div>
          <div class="yt-kicker">${escapeHtml(opts.sectionHead.kicker)}</div>
          <h2 class="yt-h2">${escapeHtml(opts.sectionHead.title)}</h2>
        </div>
        <p class="yt-section-sub" data-section-sub></p>
      </div>
      <div class="yt-console"></div>
    `;
    consoleEl = root.querySelector<HTMLElement>('.yt-console')!;
    $sectionSub = root.querySelector<HTMLElement>('[data-section-sub]');
  } else {
    root.classList.add('yt-console');
    if (lean) root.classList.add('yt-console--lean');
    consoleEl = root;
  }

  consoleEl.innerHTML = `
    <div class="yt-console-grid">
      <div class="yt-console-left">
        <div class="yt-seg" role="group" aria-label="查詢視角">
          <button class="yt-seg-btn" data-view="products" type="button" aria-pressed="false">
            ${icon('cards', { size: 15, weight: 'bold' })}<span>商品視角</span>
          </button>
          <button class="yt-seg-btn" data-view="stations" type="button" aria-pressed="false">
            ${icon('map-pin', { size: 15, weight: 'bold' })}<span>站點視角</span>
          </button>
        </div>
        <div class="yt-search">
          ${icon('magnifying-glass', { size: 18, weight: 'bold' })}
          <input class="yt-search-input" type="text" aria-label="搜尋" />
          <button class="yt-search-clear" type="button" aria-label="清除" hidden>
            ${icon('x', { size: 14, weight: 'bold' })}
          </button>
        </div>
        <div class="yt-result-list yt-collapsible" role="group" aria-label="搜尋結果"></div>
      </div>
      <div class="yt-console-right"></div>
    </div>
  `;

  const $segBtns = consoleEl.querySelectorAll<HTMLButtonElement>('.yt-seg-btn');
  const $input = consoleEl.querySelector<HTMLInputElement>('.yt-search-input')!;
  const $clear = consoleEl.querySelector<HTMLButtonElement>('.yt-search-clear')!;
  const $resultList = consoleEl.querySelector<HTMLElement>('.yt-result-list')!;
  const $right = consoleEl.querySelector<HTMLElement>('.yt-console-right')!;

  // ---- Helpers ----
  const persistState = () => {
    if (!persist) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          view: state.view,
          product: state.pickedProduct,
          station: state.pickedStation,
          // located omitted on purpose — see initial-state restore
        }),
      );
    } catch {
      /* ignore */
    }
    const u = new URLSearchParams(location.search);
    u.set('view', state.view);
    if (state.view === 'products') {
      u.set('p', state.pickedProduct);
      u.delete('s');
    } else {
      u.set('s', state.pickedStation);
      u.delete('p');
    }
    history.replaceState(null, '', location.pathname + '?' + u.toString() + location.hash);
  };

  async function loadProductDetail(code: string): Promise<ProductDetail | null> {
    if (productDetailCache.has(code)) return productDetailCache.get(code)!;
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(code)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as ProductDetail;
      productDetailCache.set(code, data);
      return data;
    } catch {
      return null;
    }
  }

  async function loadStationDetail(tid: string): Promise<StationProductRow[] | null> {
    if (stationDetailCache.has(tid)) return stationDetailCache.get(tid)!;
    try {
      const res = await fetch(`/api/stations/${encodeURIComponent(tid)}`);
      if (!res.ok) return null;
      const data = await res.json();
      const rows = (data.stock ?? data.products ?? []) as StationProductRow[];
      stationDetailCache.set(tid, rows);
      return rows;
    } catch {
      return null;
    }
  }

  function filteredProducts(): ProductSummary[] {
    const kw = state.keyword.trim().toLowerCase();
    if (!kw) return products;
    return products.filter((p) =>
      (p.product_name + p.commodity_name + p.commodity_code).toLowerCase().includes(kw),
    );
  }

  function filteredStations() {
    const kw = state.keyword.trim().toLowerCase();
    let list = !kw
      ? allStations.slice()
      : allStations.filter((s) =>
          (s.station_name + s.station_addr + s.branch_name).toLowerCase().includes(kw),
        );
    if (state.located && userPos) {
      list = list
        .map((s) => {
          if (s.lat == null || s.lng == null) return { ...s, distanceKm: undefined };
          return { ...s, distanceKm: haversineKm(userPos!, { lat: s.lat, lng: s.lng }) };
        })
        .sort((a, b) => {
          if (a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm;
          if (a.distanceKm != null) return -1;
          if (b.distanceKm != null) return 1;
          return 0;
        });
    }
    return list;
  }

  // ---- Render functions ----
  function renderSeg() {
    $segBtns.forEach((btn) => {
      const isActive = btn.dataset.view === state.view;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
    $input.placeholder =
      state.view === 'products'
        ? '搜尋生乳捲、抹茶、巴斯克、商品代碼…'
        : '搜尋龍山寺、巨蛋、門市、地址或分區…';
    if ($sectionSub) $sectionSub.textContent = VIEW_SUBS[state.view];
  }

  function renderResultList() {
    if (state.view === 'products') {
      const matches = filteredProducts();
      if (matches.length === 0) {
        $resultList.innerHTML = `<div class="yt-empty">找不到符合的商品</div>`;
        return;
      }
      $resultList.innerHTML = matches
        .map((p) => {
          const active = p.commodity_code === state.pickedProduct ? ' is-active' : '';
          return `
          <button class="yt-result${active}" type="button" data-code="${escapeHtml(p.commodity_code)}">
            <span class="yt-result-dot" style="background:${accentFor(p.product_name)}"></span>
            <span class="yt-result-text">
              <span class="yt-result-name">${escapeHtml(p.product_name)}</span>
              <span class="yt-result-flavor">${escapeHtml(flavorOf(p.product_name))}</span>
            </span>
            <span class="yt-result-count">${p.available_stations} 站</span>
          </button>`;
        })
        .join('');
    } else {
      const matches = filteredStations();
      if (matches.length === 0) {
        $resultList.innerHTML = `<div class="yt-empty">找不到符合的站點</div>`;
        return;
      }
      $resultList.innerHTML = matches
        .map((s) => {
          const active = s.station_id === state.pickedStation ? ' is-active' : '';
          // Prefer the freshest source: detail-cache (post-click) > batch counts > "·".
          // A fetched-but-empty station shows "0 款" (filtered on quantity > 0).
          // `!== undefined` already covers `0` correctly, so a single check is enough.
          const cached = stationDetailCache.get(s.station_id);
          let countLabel: string;
          if (cached !== undefined) {
            countLabel = `${cached.filter((r) => r.quantity > 0).length} 款`;
          } else if (stationCounts[s.station_id] !== undefined) {
            countLabel = `${stationCounts[s.station_id]} 款`;
          } else {
            countLabel = '·';
          }
          const right =
            state.located && s.distanceKm != null ? formatDistance(s.distanceKm) : countLabel;
          return `
          <button class="yt-result${active}" type="button" data-tid="${escapeHtml(s.station_id)}">
            <span class="yt-result-dot" style="background:var(--yt-brand)"></span>
            <span class="yt-result-text">
              <span class="yt-result-name">${escapeHtml(s.station_name)}</span>
              <span class="yt-result-flavor">${escapeHtml(s.branch_name)}</span>
            </span>
            <span class="yt-result-count">${right}</span>
          </button>`;
        })
        .join('');
    }
  }

  async function renderRightProduct() {
    const product = products.find((p) => p.commodity_code === state.pickedProduct) ?? products[0];
    const expectedView = state.view;
    const expectedCode = product.commodity_code;
    const detail = await loadProductDetail(product.commodity_code);
    // Guard against stale render: user may have switched view/product
    // between dispatch and await resolution.
    if (state.view !== expectedView || state.pickedProduct !== expectedCode) return;
    if (!detail) {
      $right.innerHTML = `<div class="yt-empty">無法載入商品資料</div>`;
      return;
    }
    const stationsRaw = detail.stations.map((s) => {
      const meta = stationById.get(s.station_id);
      return {
        ...s,
        lat: meta?.lat,
        lng: meta?.lng,
        distanceKm:
          state.located && userPos && meta?.lat != null && meta?.lng != null
            ? haversineKm(userPos, { lat: meta.lat, lng: meta.lng })
            : null,
      };
    });
    const sorted = [...stationsRaw].sort((a, b) => {
      if (state.located && a.distanceKm != null && b.distanceKm != null)
        return a.distanceKm - b.distanceKm;
      return b.quantity - a.quantity;
    });
    const stationsShown = sorted.filter(
      (s) => state.branch === 'all' || s.branch_name === state.branch,
    );
    const branchPills = ['all', ...allBranchNames]
      .map((b) => {
        const active = state.branch === b ? ' is-active' : '';
        const label = b === 'all' ? '全部' : b.replace('據點', '');
        return `<button class="yt-bpill${active}" type="button" data-branch="${escapeHtml(b)}">${escapeHtml(label)}</button>`;
      })
      .join('');
    const subText = state.located
      ? '已依距離排序 · ' + (userPos ? '使用裝置定位' : '無定位資料')
      : `${stationsShown.length} 個站點仍有現貨`;

    $right.innerHTML = `
      <div class="yt-panel-head">
        <div style="min-width:0">
          <div class="yt-panel-title">${escapeHtml(product.product_name)}</div>
          <div class="yt-panel-sub">${escapeHtml(subText)}</div>
        </div>
        <button class="yt-locate-btn${state.located ? ' is-active' : ''}" type="button"
                data-locate ${isLocating ? 'disabled' : ''}>
          ${icon('map-pin', { size: 15, weight: state.located ? 'fill' : 'bold' })}
          <span>${isLocating ? '定位中…' : state.located ? '已定位' : '開啟定位'}</span>
        </button>
      </div>
      <div class="yt-bpills">${branchPills}</div>
      <div class="yt-srows yt-srows--scroll">
        ${stationsShown.length === 0
          ? `<div class="yt-empty">此分區暫無現貨</div>`
          : stationsShown
              .map(
                (s) => `
        <div class="yt-srow">
          <div class="yt-srow-photo">${icon('map-pin', { size: 18, weight: 'fill' })}</div>
          <div class="yt-srow-meta">
            <div class="yt-srow-branch">${escapeHtml(s.branch_name)}</div>
            <div class="yt-srow-name">${escapeHtml(s.station_name)}</div>
            <div class="yt-srow-addr">${escapeHtml(s.station_addr)}</div>
          </div>
          <div class="yt-srow-right">
            ${
              state.located && s.distanceKm != null
                ? `<div class="yt-srow-dist">${formatDistance(s.distanceKm)}</div>`
                : ''
            }
            <div class="yt-srow-qty"><strong>${s.quantity}</strong> 條</div>
          </div>
        </div>`,
              )
              .join('')}
      </div>
      <div class="yt-panel-foot">
        ${icon('info', { size: 14, weight: 'regular' })}
        <span>${stationsShown.length} 個有貨站點 · 可滾動瀏覽</span>
      </div>
    `;
  }

  async function renderRightStation() {
    const station = stationById.get(state.pickedStation) ?? allStations[0];
    const expectedView = state.view;
    const expectedId = station.station_id;
    const rows = await loadStationDetail(station.station_id);
    // Guard against stale render: user may have switched view/station
    // between dispatch and await resolution.
    if (state.view !== expectedView || state.pickedStation !== expectedId) return;
    if (!rows) {
      $right.innerHTML = `<div class="yt-empty">無法載入站點資料</div>`;
      return;
    }
    const inStock = rows.filter((r) => r.quantity > 0).sort((a, b) => b.quantity - a.quantity);
    const stationDist =
      state.located && userPos && station.lat != null && station.lng != null
        ? haversineKm(userPos, { lat: station.lat, lng: station.lng })
        : null;
    const subBits = [
      `${inStock.length} 款在庫`,
      station.branch_name,
      stationDist != null ? formatDistance(stationDist) : '',
    ].filter(Boolean);

    $right.innerHTML = `
      <div class="yt-panel-head">
        <div style="min-width:0">
          <div class="yt-panel-title">${escapeHtml(station.station_name)}</div>
          <div class="yt-panel-sub">${escapeHtml(subBits.join(' · '))}</div>
        </div>
        <button class="yt-locate-btn${state.located ? ' is-active' : ''}" type="button"
                data-locate ${isLocating ? 'disabled' : ''}>
          ${icon('map-pin', { size: 15, weight: state.located ? 'fill' : 'bold' })}
          <span>${isLocating ? '定位中…' : state.located ? '已定位' : '開啟定位'}</span>
        </button>
      </div>
      <div class="yt-srows yt-srows--scroll">
        ${inStock.length === 0
          ? `<div class="yt-empty">此站點目前無庫存</div>`
          : inStock
              .map((p) => {
                const accent = accentFor(p.product_name);
                return `
        <button class="yt-srow yt-srow--clickable" type="button"
                data-pick-product="${escapeHtml(p.commodity_code)}"
                aria-label="${escapeHtml(p.product_name)} 查全台分布">
          <div class="yt-srow-photo" style="background:color-mix(in srgb, ${accent} 18%, transparent)">
            <span class="yt-srow-emoji-dot" style="background:${accent}"></span>
          </div>
          <div class="yt-srow-meta">
            <div class="yt-srow-branch">$${p.price.toLocaleString('zh-TW')}</div>
            <div class="yt-srow-name">${escapeHtml(p.product_name)}</div>
            <div class="yt-srow-addr">${escapeHtml(flavorOf(p.product_name))}</div>
          </div>
          <div class="yt-srow-right">
            <div class="yt-srow-dist">${p.quantity}</div>
            <div class="yt-srow-qty">條在庫</div>
          </div>
        </button>`;
              })
              .join('')}
      </div>
      <div class="yt-panel-foot">
        ${icon('info', { size: 14, weight: 'regular' })}
        <span>此站共 ${inStock.length} 款生乳捲現貨 · 點擊商品可看全台分布</span>
      </div>
    `;
  }

  function renderCollapsible() {
    const open = state.focused || state.keyword !== '';
    $resultList.classList.toggle('is-open', open);
  }

  async function renderAll() {
    renderSeg();
    renderResultList();
    renderCollapsible();
    if (state.view === 'products') {
      await renderRightProduct();
    } else {
      await renderRightStation();
    }
    $clear.hidden = state.keyword === '';
  }

  // ---- Event handlers ----
  $segBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view as ViewMode;
      if (v === state.view) return;
      state.view = v;
      state.keyword = '';
      $input.value = '';
      persistState();
      renderAll();
    });
  });

  $input.addEventListener('input', () => {
    state.keyword = $input.value;
    renderResultList();
    renderCollapsible();
    $clear.hidden = state.keyword === '';
  });
  $input.addEventListener('focus', () => {
    state.focused = true;
    renderCollapsible();
  });
  $input.addEventListener('blur', () => {
    setTimeout(() => {
      state.focused = false;
      renderCollapsible();
    }, 160);
  });
  $clear.addEventListener('click', () => {
    state.keyword = '';
    $input.value = '';
    $input.focus();
    renderResultList();
    renderCollapsible();
    $clear.hidden = true;
  });

  $resultList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button.yt-result');
    if (!btn) return;
    const code = btn.dataset.code;
    const tid = btn.dataset.tid;
    if (code) state.pickedProduct = code;
    if (tid) state.pickedStation = tid;
    state.focused = false;
    persistState();
    renderAll();
  });

  $right.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const pill = target.closest<HTMLButtonElement>('.yt-bpill');
    if (pill) {
      state.branch = pill.dataset.branch ?? 'all';
      renderRightProduct();
      return;
    }
    const locBtn = target.closest<HTMLButtonElement>('[data-locate]');
    if (locBtn && !isLocating) {
      toggleLocate();
      return;
    }
    const pickBtn = target.closest<HTMLButtonElement>('[data-pick-product]');
    if (pickBtn) {
      const code = pickBtn.dataset.pickProduct;
      if (code) pickProductInternal(code);
    }
  });

  function pickProductInternal(code: string): void {
    if (!products.some((p) => p.commodity_code === code)) return;
    state.view = 'products';
    state.keyword = '';
    state.pickedProduct = code;
    $input.value = '';
    persistState();
    renderAll();
  }

  function toggleLocate() {
    if (state.located) {
      state.located = false;
      userPos = null;
      persistState();
      renderAll();
      return;
    }
    if (!('geolocation' in navigator)) {
      alert('此瀏覽器不支援定位');
      return;
    }
    isLocating = true;
    renderAll();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.located = true;
        isLocating = false;
        persistState();
        renderAll();
      },
      () => {
        isLocating = false;
        alert('無法取得定位');
        renderAll();
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  }

  // ---- Initial render ----
  $input.value = state.keyword;
  await renderAll();

  return {
    pickProduct: pickProductInternal,
  };
}

