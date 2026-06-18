/**
 * Landing 頁 hydration：靜態 markup 由 index.astro SSR，這裡只負責
 *   1. 主題切換 (theme menu)
 *   2. data-nav 平滑捲動
 *   3. fetch /api/status + /api/products → 填 hero 數字與商品牆
 *   4. 商品牆點擊 → QueryConsole.pickProduct
 */

import { accentFor, flavorOf, type ProductSummary } from './products.ts';
import { initQueryConsole, type QueryHandle } from './query.ts';
import { initThemeMenu } from './themeMenu.ts';
import { formatTimestamp, escapeHtml } from './utils.ts';
import { rollSwirlSvg } from './svg.ts';
import { icon } from './icon.ts';

interface StatusResponse {
  last_updated: string | null;
  station_count: number;
  product_count: number;
  total_stock_items: number;
}

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

export async function initLanding(opts: LandingOptions = {}): Promise<void> {
  const shell = document.querySelector<HTMLElement>(opts.shellSelector ?? '#yt-shell');
  const page = document.querySelector<HTMLElement>(opts.pageSelector ?? '#yt-page');
  if (!shell || !page) return;

  // Delegate [data-nav] clicks on the shell, not document — keeps the handler
  // scoped to landing markup and prevents double-binding on re-init.
  shell.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest<HTMLElement>('[data-nav]');
    if (!btn) return;
    e.preventDefault();
    smoothNavTo(btn.dataset.nav!);
  });

  initThemeMenu({ buttonSelector: '#yt-theme-btn', page });

  let queryHandle: QueryHandle = { pickProduct() {} };
  const queryInitPromise = initQueryConsole({
    rootSelector: '#query-console',
    persist: true,
    lean: false,
    sectionHead: { kicker: '互動查詢', title: '雙視角查庫存，一次找對' },
  }).then((h) => {
    queryHandle = h;
  });

  await Promise.all([queryInitPromise, loadHeroAndWall()]);
  bindWallClicks(() => queryHandle);
}

async function loadHeroAndWall(): Promise<void> {
  try {
    const [statusRes, prodRes] = await Promise.all([
      fetch('/api/status'),
      fetch('/api/products'),
    ]);
    if (!statusRes.ok || !prodRes.ok) {
      throw new Error(`API error: status=${statusRes.status} products=${prodRes.status}`);
    }
    const status = (await statusRes.json()) as StatusResponse;
    const prodData = await prodRes.json();
    const products: ProductSummary[] = prodData.products ?? [];

    setText('hero-inventory', status.total_stock_items.toLocaleString('zh-TW'));
    setText('hero-updated', formatTimestamp(status.last_updated));
    setText('updated-at', formatTimestamp(status.last_updated));
    setText('stat-products', String(status.product_count));
    setText('stat-stations', String(status.station_count));
    setText('stat-inventory', status.total_stock_items.toLocaleString('zh-TW'));

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
      wallEl.innerHTML = products
        .map((p) => {
          const accent = accentFor(p.product_name);
          return `
        <button class="yt-prod" type="button" data-code="${escapeHtml(p.commodity_code)}"
                style="--pc:${accent}" aria-label="${escapeHtml(p.product_name)} 查全台站點">
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
    }
  } catch {
    // graceful: leave placeholders as-is
  }
}

function bindWallClicks(handleGetter: () => QueryHandle): void {
  const wallEl = document.getElementById('wall-grid');
  if (!wallEl) return;
  wallEl.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.yt-prod');
    if (!card) return;
    const code = card.dataset.code;
    if (!code) return;
    handleGetter().pickProduct(code);
    smoothNavTo('query');
  });
}
