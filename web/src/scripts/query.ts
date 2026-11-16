/**
 * 亞尼克・庫存雷達 — 快速查詢 console
 * 雙視角（商品 ⇄ 站點）查詢、深連結 + localStorage 記憶、分區篩選、定位排序。
 */

import { accentFor, flavorOf, type ProductSummary } from './products.ts';
import { icon, type IconName } from './icon.ts';
import { escapeHtml } from './utils.ts';
import { track } from './analytics.ts';
import { GEOLOCATION_OPTIONS } from '../config.ts';
import { FAVORITES_KEY, parseFavorites, type Favorite } from './favorites.ts';

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
  lat?: number | null;
  lng?: number | null;
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
}

const STORAGE_KEY = 'ytm.query';

const STAR_PATH = 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z';

function emptyState(title: string, description: string, symbol: IconName | 'favorite' = 'info', retry = false): string {
  const visual = symbol === 'favorite'
    ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="${STAR_PATH}" /></svg>`
    : icon(symbol, { size: 24 });
  return `<div class="yt-empty" role="status">
    <span class="yt-empty-icon">${visual}</span>
    <div class="yt-empty-title">${escapeHtml(title)}</div>
    <p class="yt-empty-description">${escapeHtml(description)}</p>
    ${retry ? '<button class="yt-empty-action" type="button" data-retry>重新載入</button>' : ''}
  </div>`;
}

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
  let allStations: (StationSummary & { distanceKm?: number })[] = [];
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
    root.innerHTML = emptyState('無法載入資料', '連線可能暫時中斷，請稍後重新整理。');
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
    root.innerHTML = emptyState('目前沒有可用資料', '稍後再來看看商品與站點庫存。', 'cards');
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
  };

  let hasDeepLink = false;
  if (persist) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.view === 'stations' || saved.view === 'products') initial.view = saved.view;
        if (saved.product && products.some((p) => p.commodity_code === saved.product)) {
          initial.pickedProduct = saved.product;
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
        hasDeepLink = true;
        initial.pickedProduct = m.commodity_code;
        initial.view = 'products';
      }
    }
    const s = u.get('s');
    if (s) {
      const m = allStations.find((x) => x.station_id === s || x.station_name.includes(s));
      if (m) {
        hasDeepLink = true;
        initial.pickedStation = m.station_id;
        initial.view = 'stations';
      }
    }
  }

  const state: QueryState = { ...initial };
  let userPos: { lat: number; lng: number } | null = null;
  let isLocating = false;

  let favorites: Favorite[] = [];
  try {
    favorites = parseFavorites(localStorage.getItem(FAVORITES_KEY));
  } catch {
    /* Storage may be blocked; saving reports an error below. */
  }
  let favoritesOnly = false;
  const mobileLayout = window.matchMedia('(max-width: 940px)');
  let mobileExpanded = hasDeepLink;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let contentAnimation: Animation | undefined;
  let renderedView = state.view;
  let renderRevision = 0;

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
        <div class="yt-list-head">
          <div class="yt-list-filter" role="group" aria-label="清單篩選與定位">
            <button class="yt-filter-btn" type="button" data-favorites-all aria-pressed="true">全部 <span class="yt-filter-count" data-all-count></span></button>
            <button class="yt-filter-btn" type="button" data-favorites-filter aria-pressed="false">我的最愛 <span class="yt-filter-count" data-favorites-count></span></button>
            <button class="yt-locate-btn yt-locate-btn--icon" type="button" data-locate></button>
          </div>
        </div>
        <div class="yt-feedback" data-favorites-status role="status" aria-live="polite"></div>
        <div class="yt-result-list" role="group" aria-label="搜尋結果"></div>
      </div>
      <div class="yt-console-right" id="${escapeHtml(root.id || 'query-console')}-details" role="region" aria-label="查詢結果" aria-live="polite"></div>
    </div>

  `;

  const $segBtns = consoleEl.querySelectorAll<HTMLButtonElement>('[data-view]');
  const $input = consoleEl.querySelector<HTMLInputElement>('.yt-search-input')!;
  const $clear = consoleEl.querySelector<HTMLButtonElement>('.yt-search-clear')!;
  const $resultList = consoleEl.querySelector<HTMLElement>('.yt-result-list')!;
  const $grid = consoleEl.querySelector<HTMLElement>('.yt-console-grid')!;
  const $right = consoleEl.querySelector<HTMLElement>('.yt-console-right')!;
  const $favoritesFilter = consoleEl.querySelector<HTMLButtonElement>('[data-favorites-filter]')!;
  const $favoritesAll = consoleEl.querySelector<HTMLButtonElement>('[data-favorites-all]')!;
  const $allCount = consoleEl.querySelector<HTMLElement>('[data-all-count]')!;
  const $favoritesCount = consoleEl.querySelector<HTMLElement>('[data-favorites-count]')!;
  const $locate = consoleEl.querySelector<HTMLButtonElement>('[data-locate]')!;
  const $favoritesStatus = consoleEl.querySelector<HTMLElement>('[data-favorites-status]')!;

  let resizePanel: ((fromHeight?: number) => void) | undefined;
  let resetPanelHeight: (() => void) | undefined;
  let panelHeightReady = false;
  if (typeof ResizeObserver === 'function' && typeof consoleEl.animate === 'function') {
    let previousHeight: number | undefined;
    let heightAnimation: Animation | undefined;
    const resetHeight = () => {
      heightAnimation?.cancel();
      heightAnimation = undefined;
      previousHeight = undefined;
      panelHeightReady = false;
      consoleEl.style.height = '';
      consoleEl.classList.toggle('is-resizing', false);
    };
    resetPanelHeight = resetHeight;
    resizePanel = (fromOverride?: number) => {
      const style = getComputedStyle(consoleEl);
      const nextHeight = Math.max(parseFloat(style.minHeight) || 0,
        $grid.getBoundingClientRect().height +
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth),
      );
      if (fromOverride === undefined && heightAnimation && nextHeight === previousHeight) return;
      const fromHeight = fromOverride ?? (heightAnimation ? consoleEl.getBoundingClientRect().height : previousHeight);
      previousHeight = nextHeight;
      panelHeightReady = true;
      if (!mobileLayout.matches || reducedMotion.matches) {
        resetHeight();
        previousHeight = nextHeight;
        return;
      }
      if (fromHeight === undefined || Math.abs(nextHeight - fromHeight) < 1) {
        heightAnimation?.cancel();
        heightAnimation = undefined;
        consoleEl.style.height = '';
        consoleEl.classList.toggle('is-resizing', false);
        return;
      }
      heightAnimation?.cancel();
      consoleEl.style.height = `${nextHeight}px`;
      consoleEl.classList.toggle('is-resizing', true);
      const animation = consoleEl.animate([
        { height: `${fromHeight}px` }, { height: `${nextHeight}px` },
      ], { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      heightAnimation = animation;
      void animation.finished.then(() => {
        if (heightAnimation !== animation) return;
        heightAnimation = undefined;
        consoleEl.style.height = '';
        consoleEl.classList.toggle('is-resizing', false);
      }).catch(() => {});
    };
    const observer = new ResizeObserver(() => resizePanel?.());
    observer.observe($grid);
    mobileLayout.addEventListener('change', resetHeight);
    reducedMotion.addEventListener('change', resetHeight);
  }

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
      if (state.pickedStation) u.set('s', state.pickedStation);
      else u.delete('s');
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

  function isFavorite(view: ViewMode, id: string): boolean {
    return favorites.some((f) => f.view === view && f.id === id);
  }

  function favoriteButton(view: ViewMode, id: string, name: string): string {
    const saved = isFavorite(view, id);
    const label = `${saved ? '取消收藏' : '加入我的最愛'}：${name}`;
    return `<button class="yt-favorite" type="button" style="--yt-favorite-accent:${view === 'products' ? accentFor(name) : 'var(--yt-brand)'}" data-favorite="${escapeHtml(id)}"
      data-favorite-view="${view}" aria-pressed="${saved}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="${STAR_PATH}"/></svg>
    </button>`;
  }

  function emptyMessage(kind: string): string {
    return favoritesOnly && !state.keyword.trim()
      ? emptyState('尚無可用收藏', '點左側星號，將常查的商品或站點收進來。', 'favorite')
      : emptyState(`找不到符合的${kind}`, kind === '商品'
        ? '試試其他名稱、口味或商品代碼。' : '試試其他站名、地址或分區。', 'magnifying-glass');
  }

  function unavailableFavorites(): Favorite[] {
    const kw = state.keyword.trim().toLowerCase();
    return favorites.filter((f) => f.view === state.view &&
      f.name.toLowerCase().includes(kw) && (f.view === 'products'
        ? !products.some((p) => p.commodity_code === f.id)
        : !stationById.has(f.id)));
  }

  function renderUnavailableFavorites() {
    if (!favoritesOnly) return;
    const missing = unavailableFavorites();
    if (missing.length === 0) return;
    $resultList.innerHTML += missing.map((f) => `<div class="yt-result-row">
      <div class="yt-result"><span class="yt-result-text">
        <span class="yt-result-name">${escapeHtml(f.name)}</span>
        <span class="yt-result-flavor">目前無法查詢</span>
      </span></div>${favoriteButton(f.view, f.id, f.name)}</div>`).join('');
  }

  function filteredProducts(onlyFavorites = favoritesOnly): ProductSummary[] {
    const kw = state.keyword.trim().toLowerCase();
    const list = onlyFavorites ? products.filter((p) => isFavorite('products', p.commodity_code)) : products;
    if (!kw) return list;
    return list.filter((p) =>
      (p.product_name + p.commodity_name + p.commodity_code).toLowerCase().includes(kw),
    );
  }

  function filteredStations(onlyFavorites = favoritesOnly) {
    const kw = state.keyword.trim().toLowerCase();
    let list = !kw
      ? allStations.slice()
      : allStations.filter((s) =>
          (s.station_name + s.station_addr + s.branch_name).toLowerCase().includes(kw),
        );
    if (onlyFavorites) list = list.filter((s) => isFavorite('stations', s.station_id));
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
    $favoritesFilter.setAttribute('aria-pressed', String(favoritesOnly));
    $favoritesFilter.classList.toggle('is-active', favoritesOnly);
    $favoritesAll.setAttribute('aria-pressed', String(!favoritesOnly));
    $favoritesAll.classList.toggle('is-active', !favoritesOnly);
    $allCount.textContent = String(state.view === 'products'
      ? filteredProducts(false).length : filteredStations(false).length);
    $favoritesCount.textContent = String(state.view === 'products'
      ? filteredProducts(true).length + unavailableFavorites().length
      : filteredStations(true).length + unavailableFavorites().length);
    $locate.disabled = isLocating;
    $locate.classList.toggle('is-active', state.located);
    $locate.setAttribute('aria-pressed', String(state.located));
    $locate.setAttribute('aria-busy', String(isLocating));
    $locate.title = isLocating ? '定位中…'
      : state.located ? '已依距離排序（直線距離），點擊關閉定位' : '定位並依距離排序';
    $locate.setAttribute('aria-label', $locate.title);
    $locate.innerHTML = isLocating
      ? '<svg class="yt-location-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="40 18" /></svg>'
      : icon('map-pin', { size: 18, weight: state.located ? 'fill' : 'bold' });
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

  function selectionAria(active: boolean): string {
    return mobileLayout.matches
      ? `aria-expanded="${active}" aria-controls="${escapeHtml($right.id)}"`
      : `aria-pressed="${active}"`;
  }

  function placeDetails(): boolean {
    if (!mobileLayout.matches) {
      $right.hidden = false;
      return true;
    }
    const selector = state.view === 'products'
      ? `[data-code="${CSS.escape(state.pickedProduct)}"]`
      : `[data-tid="${CSS.escape(state.pickedStation)}"]`;
    const selected = $resultList.querySelector<HTMLButtonElement>(selector);
    $right.hidden = !mobileExpanded || !selected;
    if (!$right.hidden) selected?.closest('.yt-query-item')?.append($right);
    return !$right.hidden;
  }

  function renderResultList() {
    if (state.view === 'products') {
      const matches = filteredProducts();
      if (matches.length === 0) {
        $resultList.innerHTML = emptyMessage('商品');
        return;
      }
      $resultList.innerHTML = matches
        .map((p) => {
          const active = p.commodity_code === state.pickedProduct && (!mobileLayout.matches || mobileExpanded) ? ' is-active' : '';
          return `
          <div class="yt-query-item">
          <div class="yt-result yt-choice${active}">
          <button class="yt-result yt-choice-trigger" type="button" data-code="${escapeHtml(p.commodity_code)}"
                  aria-label="${escapeHtml(p.product_name)}" ${selectionAria(Boolean(active))}></button>
            ${favoriteButton('products', p.commodity_code, p.product_name)}
            <span class="yt-result-text">
              <span class="yt-result-name">${escapeHtml(p.product_name)}</span>
              <span class="yt-result-flavor">${escapeHtml(flavorOf(p.product_name))}</span>
            </span>
            <span class="yt-result-count">${p.available_stations} 站</span>
            <span class="yt-choice-caret" aria-hidden="true"></span>
          </div>
          </div>`;
        })
        .join('');
    } else {
      const matches = filteredStations();
      const cards = matches
        .map((s) => {
          const active = s.station_id === state.pickedStation && (!mobileLayout.matches || mobileExpanded) ? ' is-active' : '';
          // Prefer fetched stock over batch counts; omitted batch entries have no stock.
          // A fetched-but-empty station shows "0 款" (filtered on quantity > 0).
          // `!== undefined` already covers `0` correctly, so a single check is enough.
          const cached = stationDetailCache.get(s.station_id);
          let countLabel: string;
          if (cached !== undefined) {
            countLabel = `${cached.filter((r) => r.quantity > 0).length} 款`;
          } else if (stationCounts[s.station_id] !== undefined) {
            countLabel = `${stationCounts[s.station_id]} 款`;
          } else {
            countLabel = cData?.counts ? '0 款' : '款數未知';
          }
          const distance = state.located
            ? (s.distanceKm != null ? formatDistance(s.distanceKm) : '距離未知')
            : '';
          return `
          <div class="yt-station-card yt-query-item">
          <div class="yt-result yt-choice${active}">
          <button class="yt-result yt-choice-trigger" type="button" data-tid="${escapeHtml(s.station_id)}"
                  aria-label="${escapeHtml(s.station_name)}，${escapeHtml(s.station_addr)}"
                  ${selectionAria(Boolean(active))}></button>
            ${favoriteButton('stations', s.station_id, s.station_name)}
            <span class="yt-result-text">
              <span class="yt-result-name">${escapeHtml(s.station_name)}</span>
              <span class="yt-result-flavor">${escapeHtml(s.branch_name)}</span>
              <span class="yt-result-flavor">${escapeHtml(s.station_addr)}</span>
            </span>
            <span class="yt-station-summary">
              ${distance ? `<span class="yt-result-count">${distance}</span>` : ''}
              <span class="yt-result-count" data-count="${escapeHtml(s.station_id)}">${countLabel}</span>
            </span>
            <span class="yt-choice-caret" aria-hidden="true"></span>
          </div>
          </div>`;
        })
        .join('');
      $resultList.innerHTML = matches.length === 0
        ? emptyMessage('站點') : cards;
    }
  }

  function updateBranchFades(pills: HTMLElement): void {
    const maxScroll = Math.max(0, pills.scrollWidth - pills.clientWidth);
    pills.style.setProperty('--yt-fade-left', pills.scrollLeft > 1 ? '24px' : '0px');
    pills.style.setProperty('--yt-fade-right', pills.scrollLeft < maxScroll - 1 ? '24px' : '0px');
  }

  function revealSelectedBranch(pills: HTMLElement): void {
    const active = pills.querySelector<HTMLElement>('.yt-bpill.is-active');
    if (active && pills.clientWidth > 0) {
      const maxScroll = Math.max(0, pills.scrollWidth - pills.clientWidth);
      pills.scrollLeft = Math.min(maxScroll, Math.max(0,
        active.offsetLeft - (pills.clientWidth - active.offsetWidth) / 2,
      ));
    }
    updateBranchFades(pills);
  }

  async function renderRightProduct() {
    const product = products.find((p) => p.commodity_code === state.pickedProduct) ?? products[0];
    const expectedView = state.view;
    const expectedCode = product.commodity_code;
    $right.innerHTML = emptyState('載入庫存中…', '正在取得目前庫存，請稍候。', 'cards');
    const detail = await loadProductDetail(product.commodity_code);
    // Guard against stale render: user may have switched view/product
    // between dispatch and await resolution.
    if (state.view !== expectedView || state.pickedProduct !== expectedCode) return;
    if (!detail) {
      $right.innerHTML = emptyState('無法載入商品資料', '連線可能暫時中斷，再試一次看看。', 'info', true);
      return;
    }
    const stationsRaw = detail.stations.filter((s) => s.quantity > 0).map((s) => {
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
        const count = b === 'all' ? stationsRaw.length : stationsRaw.filter((s) => s.branch_name === b).length;
        return `<button class="yt-bpill${active}" type="button" data-branch="${escapeHtml(b)}" aria-pressed="${state.branch === b}">
          <span>${escapeHtml(label)}</span><span class="yt-bpill-count">${count}</span>
        </button>`;
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
      </div>
      <div class="yt-bpills">${branchPills}</div>
      <div class="yt-srows yt-srows--scroll">
        ${stationsShown.length === 0
          ? emptyState('此分區暫無現貨', '換個分區，看看其他站點的庫存。', 'map-pin')
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
    if (mobileLayout.matches) {
      const pills = $right.querySelector<HTMLElement>('.yt-bpills');
      if (pills) {
        pills.addEventListener('scroll', () => updateBranchFades(pills), { passive: true });
        revealSelectedBranch(pills);
      }
    }
  }

  async function renderStationStock() {
    const tid = state.pickedStation;
    const station = stationById.get(tid);
    if (!station) return;
    const heading = `<div class="yt-panel-head"><div style="min-width:0">
      <div class="yt-panel-title">${escapeHtml(station.station_name)}</div>
      <div class="yt-panel-sub">${escapeHtml(station.station_addr)}</div>
    </div></div>`;
    $right.innerHTML = heading + emptyState('載入庫存中…', '正在取得目前庫存，請稍候。', 'cards');
    const rows = await loadStationDetail(tid);
    if (state.view !== 'stations' || state.pickedStation !== tid) return;
    if (!rows) {
      $right.innerHTML = heading + emptyState('無法載入站點資料', '連線可能暫時中斷，再試一次看看。', 'info', true);
      return;
    }
    const inStock = rows.filter((r) => r.quantity > 0).sort((a, b) => b.quantity - a.quantity);
    const count = $resultList.querySelector<HTMLElement>(`[data-count="${CSS.escape(tid)}"]`);
    if (count) count.textContent = `${inStock.length} 款`;
    $right.innerHTML = `${heading}
      <div class="yt-srows yt-srows--scroll">
        ${inStock.length === 0
          ? emptyState('此站點目前無庫存', '換個站點看看，或稍後再來查詢。', 'cards')
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
    `;
  }

  async function renderAll() {
    contentAnimation?.cancel();
    contentAnimation = undefined;
    renderedView = state.view;
    const fromHeight = panelHeightReady && mobileLayout.matches && !reducedMotion.matches
      ? consoleEl.getBoundingClientRect().height : undefined;
    if (fromHeight !== undefined) {
      consoleEl.style.height = `${fromHeight}px`;
      consoleEl.classList.toggle('is-resizing', true);
    }
    renderRevision++;
    // Preserve the shared panel before replacing the mobile list markup.
    $grid.append($right);
    renderSeg();
    renderResultList();
    renderUnavailableFavorites();
    $clear.hidden = state.keyword === '';
    const details = placeDetails()
      ? state.view === 'products' ? renderRightProduct() : renderStationStock()
      : undefined;
    if (fromHeight !== undefined) resizePanel?.(fromHeight);
    await details;
  }

  function fadeContent(target: HTMLElement): void {
    if (reducedMotion.matches || typeof target.animate !== 'function') return;
    contentAnimation?.cancel();
    contentAnimation = target.animate([{ opacity: 0.55 }, { opacity: 1 }], {
      duration: 160, easing: 'ease-out',
    });
  }

  function renderWithMotion(afterRender?: () => void): void {
    const viewChanged = renderedView !== state.view;
    if (viewChanged) resetPanelHeight?.();
    const pending = renderAll();
    const revision = renderRevision;
    afterRender?.();
    if (viewChanged) fadeContent($grid);
    void pending.then(() => {
      if (revision !== renderRevision || viewChanged || $right.hidden) return;
      fadeContent($right);
    });
  }

  // ---- Event handlers ----
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    contentAnimation?.cancel();
    contentAnimation = undefined;
  });
  window.addEventListener('resize', () => {
    if (!mobileLayout.matches) return;
    const pills = $right.querySelector<HTMLElement>('.yt-bpills');
    if (pills) revealSelectedBranch(pills);
  });
  mobileLayout.addEventListener('change', () => { renderAll(); });
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== localStorage || (event.key !== FAVORITES_KEY && event.key !== null)) return;
    try {
      favorites = parseFavorites(localStorage.getItem(FAVORITES_KEY));
    } catch {
      $favoritesStatus.classList.toggle('is-error', true);
      $favoritesStatus.textContent = '無法讀取收藏，請確認瀏覽器允許儲存網站資料。';
      return;
    }
    renderAll();
  });
  $favoritesFilter.addEventListener('click', () => {
    favoritesOnly = true;
    renderWithMotion();
  });
  $favoritesAll.addEventListener('click', () => {
    favoritesOnly = false;
    renderWithMotion();
  });
  $segBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view as ViewMode;
      if (v === state.view) return;
      state.view = v;
      mobileExpanded = false;
      track('button_click', { button_name: `view_${v}`, button_area: 'query' });
      state.keyword = '';
      $input.value = '';
      persistState();
      renderWithMotion();
    });
  });

  $input.addEventListener('input', () => {
    state.keyword = $input.value;
    renderAll();
  });
  $clear.addEventListener('click', () => {
    state.keyword = '';
    $input.value = '';
    $input.focus();
    renderAll();
  });

  $resultList.addEventListener('click', async (e) => {
    const favorite = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-favorite]');
    if (favorite) {
      const id = favorite.dataset.favorite!;
      const view = favorite.dataset.favoriteView;
      if (view !== 'products' && view !== 'stations') return;
      // Keep the clicked action even if another tab changes storage while we wait.
      const remove = isFavorite(view, id);
      if (!navigator.locks) {
        $favoritesStatus.classList.toggle('is-error', true);
        $favoritesStatus.textContent = '此瀏覽器不支援安全儲存收藏，請更新瀏覽器後再試。';
        return;
      }
      try {
        await navigator.locks.request(FAVORITES_KEY, () => {
          let latest: Favorite[];
          try {
            latest = parseFavorites(localStorage.getItem(FAVORITES_KEY));
          } catch {
            $favoritesStatus.classList.toggle('is-error', true);
            $favoritesStatus.textContent = '無法讀取收藏，請確認瀏覽器允許儲存網站資料。';
            return;
          }
          const name = view === 'products'
            ? products.find((p) => p.commodity_code === id)?.product_name
            : stationById.get(id)?.station_name;
          if (!remove && !name) return;
          const next: Favorite[] = remove
            ? latest.filter((f) => f.view !== view || f.id !== id)
            : latest.some((f) => f.view === view && f.id === id) ? latest : [...latest, { view, id, name: name! }];
          try {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
          } catch {
            $favoritesStatus.classList.toggle('is-error', true);
            $favoritesStatus.textContent = '無法儲存收藏，請確認瀏覽器允許儲存網站資料。';
            return;
          }
          favorites = next;
          $favoritesStatus.classList.toggle('is-error', false);
          $favoritesStatus.textContent = remove ? '已取消收藏' : '已加入我的最愛';
          renderAll();
          const selector = `[data-favorite="${CSS.escape(id)}"]`;
          const nextFocus = $resultList.querySelector<HTMLButtonElement>(selector) ?? $favoritesFilter;
          nextFocus.focus({ preventScroll: true });
        });
      } catch {
        $favoritesStatus.classList.toggle('is-error', true);
        $favoritesStatus.textContent = '無法儲存收藏，請稍後再試。';
      }
      return;
    }
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button.yt-result');
    if (!btn) return;
    const code = btn.dataset.code;
    const tid = btn.dataset.tid;
    const sameSelection = code ? code === state.pickedProduct : tid === state.pickedStation;
    if (!mobileLayout.matches && sameSelection) return;
    if (code || tid !== state.pickedStation) {
      track('query_completed', {
        query_type: code ? 'product' : 'station',
        query_item_id: code ?? tid ?? '',
        query_source: 'result_list',
        used_search: Boolean(state.keyword.trim()),
      });
    }
    mobileExpanded = mobileLayout.matches ? !sameSelection || !mobileExpanded : true;
    if (code) state.pickedProduct = code;
    if (tid) state.pickedStation = tid;
    persistState();
    renderWithMotion(() => {
      const selectedId = code ?? tid;
      if (selectedId) {
        const selector = code ? `[data-code="${CSS.escape(selectedId)}"]` : `[data-tid="${CSS.escape(selectedId)}"]`;
        $resultList.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true });
      }
    });
  });

  consoleEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-retry]')) {
      renderAll();
      return;
    }
    const pill = target.closest<HTMLButtonElement>('.yt-bpill');
    if (pill) {
      state.branch = pill.dataset.branch ?? 'all';
      renderWithMotion();
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
      if (code) {
        track('query_completed', {
          query_type: 'product',
          query_item_id: code,
          query_source: 'station_detail',
          used_search: false,
        });
        pickProductInternal(code);
      }
    }
  });

  function pickProductInternal(code: string): void {
    if (!products.some((p) => p.commodity_code === code)) return;
    state.view = 'products';
    mobileExpanded = true;
    if (!isFavorite('products', code)) favoritesOnly = false;
    state.keyword = '';
    state.pickedProduct = code;
    $input.value = '';
    persistState();
    renderWithMotion();
  }

  function toggleLocate() {
    if (state.located) {
      track('button_click', { button_name: 'location_disable', button_area: 'query' });
      state.located = false;
      userPos = null;
      persistState();
      renderAll();
      return;
    }
    if (!('geolocation' in navigator)) {
      track('location_result', { location_success: false, location_reason: 'unsupported' });
      alert('此瀏覽器不支援定位');
      return;
    }
    track('button_click', { button_name: 'location_enable', button_area: 'query' });
    isLocating = true;
    renderAll();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.located = true;
        isLocating = false;
        track('location_result', { location_success: true });
        persistState();
        renderAll();
      },
      () => {
        isLocating = false;
        track('location_result', {
          location_success: false,
          location_reason: 'denied_or_unavailable',
        });
        alert('無法取得定位');
        renderAll();
      },
      GEOLOCATION_OPTIONS,
    );
  }

  // ---- Initial render ----
  $input.value = state.keyword;
  await renderAll();

  return {
    pickProduct: pickProductInternal,
  };
}
