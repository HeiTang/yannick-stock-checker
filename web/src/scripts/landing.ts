/**
 * Landing 頁 hydration：靜態 markup 由 index.astro SSR，這裡只負責
 *   1. 主題切換 (theme menu)
 *   2. data-nav 平滑捲動
 *   3. QueryConsole 同步成功 → 更新 hero 數字與商品牆
 *   4. 商品牆點擊 → QueryConsole.pickProduct
 */

import { accentFor, flavorOf, type ProductSummary } from './products.ts';
import { initQueryConsole, type QueryHandle, type InventoryStatus } from './query.ts';
import { initThemeMenu } from './themeMenu.ts';
import { formatTimestamp, escapeHtml } from './utils.ts';
import { rollSwirlSvg } from './svg.ts';
import { icon } from './icon.ts';
import { track } from './analytics.ts';


function smoothNavTo(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 84;
  window.scrollTo({ top, behavior: 'smooth' });
}

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

export interface LandingOptions {
  shellSelector?: string;
  pageSelector?: string;
}

let initialized = false;

export async function initLanding(opts: LandingOptions = {}): Promise<void> {
  if (initialized) return;
  const shell = document.querySelector<HTMLElement>(opts.shellSelector ?? '#yt-shell');
  const page = document.querySelector<HTMLElement>(opts.pageSelector ?? '#yt-page');
  if (!shell || !page) return;
  initialized = true;

  // Delegate [data-nav] clicks on the shell so the listener is scoped to
  // landing markup. The idempotency guard above prevents repeat-binding
  // if the module is ever re-initialized (HMR, accidental double call).
  shell.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const tracked = target.closest<HTMLElement>('[data-track]')?.dataset.track;
    if (tracked) track('button_click', { button_name: tracked, button_area: 'api' });
    const btn = target.closest<HTMLElement>('[data-nav]');
    const navId = btn?.dataset.nav;
    if (!navId) return;
    track('button_click', {
      button_name: navId,
      button_area: btn.closest('.yt-hero-cta') ? 'hero' : 'navigation',
    });
    e.preventDefault();
    smoothNavTo(navId);
  });

  initThemeMenu({ buttonSelector: '#yt-theme-btn', page });

  let queryHandle: QueryHandle = { pickProduct() {} };
  const queryInitPromise = initQueryConsole({
    rootSelector: '#query-console',
    persist: true,
    lean: false,
    sectionSub: document.querySelector<HTMLElement>('#query [data-section-sub]'),
    onUpdate: renderHeroAndWall,
  }).then((h) => {
    queryHandle = h;
  });

  await queryInitPromise;
  bindWallClicks(() => queryHandle);
}

function renderHeroAndWall(status: InventoryStatus, products: ProductSummary[]): void {
  setText('hero-inventory', status.total_stock_items.toLocaleString('zh-TW'));
  setText('hero-updated', formatTimestamp(status.last_updated));
  setText('updated-at', formatTimestamp(status.last_updated));
  setText('stat-products', String(status.product_count));
  setText('stat-stations', String(status.station_count));
  setText('stat-inventory', status.total_stock_items.toLocaleString('zh-TW'));
  setText('api-cache-ttl', `${status.cache_ttl_seconds}s`);

  const top = [...products]
    .sort((a, b) => b.available_stations - a.available_stations)
    .slice(0, 3);
  const topEl = document.getElementById('hero-top-products');
  if (topEl) {
    topEl.innerHTML = top
      .map(
        (p) => `
        <div class="yt-hero-row">
          <span class="yt-hero-row-dot" style="background:${accentFor(p.product_name)}"></span>
          <span class="yt-hero-row-name">${escapeHtml(p.product_name)}</span>
          <span class="yt-hero-row-stat">${p.available_stations} 站</span>
        </div>`,
      )
      .join('');
  }

  const wallEl = document.getElementById('wall-grid');
  if (wallEl) {
    const focused = document.activeElement as HTMLElement | null;
    const focusedCode = focused && wallEl.contains(focused)
      ? focused.closest<HTMLElement>('.yt-prod')?.dataset.code : undefined;
    wallEl.innerHTML = products
      .map((p) => {
        const accent = accentFor(p.product_name);
        return `
      <button class="yt-prod" type="button" data-code="${escapeHtml(p.commodity_code)}"
              style="--pc:${accent}">
        <div class="yt-prod-top">
          <div class="yt-prod-emblem">${rollSwirlSvg(64, accent, '#fff')}</div>
          <span class="yt-prod-badge">${p.available_stations} 站有貨</span>
        </div>
        <div class="yt-prod-body">
          <h3 class="yt-prod-name">${escapeHtml(p.product_name)}</h3>
          <p class="yt-prod-flavor">${escapeHtml(flavorOf(p.product_name))}</p>
          <div class="yt-prod-meta">
            <span class="yt-prod-price">$${p.price.toLocaleString('zh-TW')}</span>
            <span class="yt-prod-total">總庫存 <strong>${p.total_quantity.toLocaleString('zh-TW')}</strong> 條</span>
          </div>
          <div class="yt-prod-foot">
            <span class="yt-prod-code">#${escapeHtml(p.commodity_code)}</span>
            <span class="yt-prod-go">查站點 ${icon('caret-right', { size: 14, weight: 'bold' })}</span>
          </div>
        </div>
      </button>`;
      })
      .join('');
    if (focusedCode) {
      const preferred = wallEl.querySelector<HTMLElement>(`[data-code="${CSS.escape(focusedCode)}"]`);
      const headerBottom = document.querySelector('.yt-header')?.getBoundingClientRect().bottom ?? 0;
      const candidates = [preferred, ...Array.from(wallEl.querySelectorAll<HTMLElement>('.yt-prod'))];
      const nextFocus = candidates.find((card) => {
        if (!card) return false;
        const bounds = card.getBoundingClientRect();
        return bounds.width > 0 && bounds.bottom > headerBottom && bounds.top < window.innerHeight;
      }) ?? document.querySelector<HTMLElement>('.yt-quick a[href="/query/"]');
      nextFocus?.focus({ preventScroll: true });
    }
  }
}

function bindWallClicks(handleGetter: () => QueryHandle): void {
  const wallEl = document.getElementById('wall-grid');
  if (!wallEl) return;
  wallEl.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const card = target.closest<HTMLElement>('.yt-prod');
    if (!card) return;
    const code = card.dataset.code;
    if (!code) return;
    track('query_completed', {
      query_type: 'product',
      query_item_id: code,
      query_source: 'product_wall',
      used_search: false,
    });
    handleGetter().pickProduct(code);
    smoothNavTo('query');
  });
}
