/**
 * 亞尼克・庫存雷達 — Landing 頁邏輯
 * Hero 即時快照、Stats、商品牆，並把 ProductWall 點選轉成 QueryConsole.pickProduct。
 */

import { accentFor, flavorOf, type ProductSummary } from './products.ts';
import { initQueryConsole, type QueryHandle } from './query.ts';
import { initThemeMenu } from './themeMenu.ts';
import { formatTimestamp } from './utils.ts';
import { rollSwirlSvg, brandMarkSvg } from './svg.ts';
import { icon } from './icon.ts';

interface StatusResponse {
  last_updated: string | null;
  station_count: number;
  product_count: number;
  total_stock_items: number;
}

function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const brandMark = brandMarkSvg;

function smoothNavTo(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 84;
  window.scrollTo({ top, behavior: 'smooth' });
}

export interface LandingOptions {
  shellSelector?: string;
  pageSelector?: string;
}

export async function initLanding(opts: LandingOptions = {}): Promise<void> {
  const shell = document.querySelector<HTMLElement>(opts.shellSelector ?? '#yt-shell');
  const page = document.querySelector<HTMLElement>(opts.pageSelector ?? '#yt-page');
  if (!shell || !page) return;

  // ---- Header ----
  const header = document.createElement('header');
  header.className = 'yt-header';
  header.innerHTML = `
    <div class="yt-header-bar">
      <div style="display:flex;align-items:center;gap:11px;min-width:0">
        ${brandMark(38)}
        <div style="line-height:1.12;min-width:0">
          <div class="yt-wordmark">亞尼克・庫存雷達</div>
          <div class="yt-wordmark-sub">非官方查詢工具</div>
        </div>
      </div>
      <nav class="yt-nav">
        <button class="yt-navlink" data-nav="wall" type="button">商品牆</button>
        <button class="yt-navlink" data-nav="query" type="button">查詢</button>
        <button class="yt-navlink" data-nav="api" type="button">API</button>
      </nav>
      <div style="flex:1"></div>
      <div class="yt-updated">
        <span class="yt-pulse"></span>
        <span>即時 <span id="updated-at">--:--</span></span>
      </div>
      <div class="yt-quick">
        <a href="/query" aria-label="快速查詢">
          ${icon('magnifying-glass', { size: 15, weight: 'bold' })}
          <span>快速查詢</span>
        </a>
      </div>
      <div class="yt-theme">
        <button class="yt-theme-btn" id="yt-theme-btn" type="button"
                aria-haspopup="true" aria-expanded="false" aria-label="主題與外觀" title="主題與外觀"></button>
      </div>
    </div>
  `;
  shell.appendChild(header);

  // ---- Hero (placeholder; populated after API loads) ----
  const heroSection = document.createElement('section');
  heroSection.className = 'yt-hero';
  heroSection.innerHTML = `
    <div class="yt-bleed" aria-hidden="true">
      <span class="yt-bleed-a"></span>
      <span class="yt-bleed-b"></span>
    </div>
    <div class="yt-hero-grid">
      <div class="yt-hero-copy">
        <div class="yt-eyebrow">
          <span class="yt-eyebrow-dot"></span>
          <span>非官方 · 全台 YTM 生乳捲庫存</span>
        </div>
        <h1 class="yt-h1">哪裡<br><span class="yt-h1-accent">還有貨</span>？</h1>
        <p class="yt-lede">以商品為核心、即時反查全台仍有現貨的 YTM 站點。開啟定位，依距離排序，先看最近能買到的生乳捲。</p>
        <div class="yt-hero-cta">
          <button class="yt-btn yt-btn--primary" data-nav="query" type="button">
            ${icon('magnifying-glass', { size: 16, weight: 'bold' })}<span>開始查庫存</span>
          </button>
          <button class="yt-btn yt-btn--glass" data-nav="wall" type="button">
            ${icon('cards', { size: 16, weight: 'bold' })}<span>看商品牆</span>
          </button>
        </div>
        <div class="yt-hero-meta">
          <span>台北捷運</span><span class="yt-dot"></span>
          <span>高雄捷運</span><span class="yt-dot"></span>
          <span>門市據點</span>
        </div>
      </div>
      <div class="yt-hero-visual">
        <div class="yt-hero-card">
          <div class="yt-hero-card-head">
            <div>
              <div class="yt-hero-card-kicker">即時庫存快照</div>
              <div class="yt-hero-card-time">最後更新 <span id="hero-updated">--:--</span></div>
            </div>
            <span class="yt-badge-soft">即時</span>
          </div>
          <div class="yt-hero-swirl">
            ${rollSwirlSvg(132)}
            <div>
              <div class="yt-hero-bignum-v" id="hero-inventory">—</div>
              <div class="yt-hero-bignum-l">條生乳捲・全台在庫</div>
            </div>
          </div>
          <div class="yt-hero-list" id="hero-top-products"></div>
        </div>
      </div>
    </div>
    <div class="yt-stats">
      <div class="yt-stat">
        <div class="yt-stat-top">${icon('cards', { size: 16, weight: 'bold' })}<span>有貨商品</span></div>
        <div class="yt-stat-num"><span id="stat-products">—</span><span class="yt-stat-suffix">款</span></div>
      </div>
      <div class="yt-stat">
        <div class="yt-stat-top">${icon('map-pin', { size: 16, weight: 'bold' })}<span>可查站點</span></div>
        <div class="yt-stat-num"><span id="stat-stations">—</span><span class="yt-stat-suffix">處</span></div>
      </div>
      <div class="yt-stat">
        <div class="yt-stat-top">${icon('barcode', { size: 16, weight: 'bold' })}<span>全台總庫存</span></div>
        <div class="yt-stat-num"><span id="stat-inventory">—</span><span class="yt-stat-suffix">條</span></div>
      </div>
    </div>
  `;
  shell.appendChild(heroSection);

  // ---- Query section (mount point) ----
  const querySection = document.createElement('section');
  querySection.className = 'yt-section';
  querySection.id = 'query';
  querySection.innerHTML = `<div id="query-console"></div>`;
  shell.appendChild(querySection);

  // ---- Product wall section (mount point) ----
  const wallSection = document.createElement('section');
  wallSection.className = 'yt-section';
  wallSection.id = 'wall';
  wallSection.innerHTML = `
    <div class="yt-section-head">
      <div>
        <div class="yt-kicker">商品牆</div>
        <h2 class="yt-h2">今天哪一款生乳捲在線上</h2>
      </div>
      <p class="yt-section-sub">原味、紅寶石覆盆莓、抹茶到限定盲盒 — 點任一款即可反查全台站點。</p>
    </div>
    <div class="yt-wall-grid" id="wall-grid"></div>
  `;
  shell.appendChild(wallSection);

  // ---- API section ----
  const apiSection = document.createElement('section');
  apiSection.className = 'yt-section';
  apiSection.id = 'api';
  const endpoints = [
    { m: 'GET', path: '/api/products', desc: '所有商品清單與總庫存' },
    { m: 'GET', path: '/api/products/{code}', desc: '單一商品可購買的站點' },
    { m: 'GET', path: '/api/stations', desc: '列出所有站點' },
    { m: 'GET', path: '/api/stations/{tid}', desc: '單一站點的庫存內容' },
    { m: 'POST', path: '/api/refresh', desc: '手動刷新快取與聚合' },
    { m: 'GET', path: '/api/status', desc: '系統狀態與更新時間' },
  ];
  apiSection.innerHTML = `
    <div class="yt-api-grid">
      <div class="yt-api-copy">
        <div class="yt-kicker">For Developers</div>
        <h2 class="yt-h2">網站與 API 並行提供</h2>
        <p class="yt-section-sub" style="max-width:40ch">同一個服務入口同時提供網頁查詢與 JSON API，可整合到自建工具、通知流程或資料分析。內建快取、限流與重試，兼顧速度與來源友善度。</p>
        <div class="yt-api-feats">
          <div class="yt-api-feat"><span class="yt-api-feat-dot"></span>快取 600s</div>
          <div class="yt-api-feat"><span class="yt-api-feat-dot"></span>限流保護</div>
          <div class="yt-api-feat"><span class="yt-api-feat-dot"></span>自動重試</div>
        </div>
        <div class="yt-api-cta">
          <a class="yt-btn yt-btn--primary" href="/docs" target="_blank" rel="noopener">
            ${icon('link', { size: 16, weight: 'bold' })}<span>查看 API 文件</span>
          </a>
          <a class="yt-btn yt-btn--glass" href="https://github.com/HeiTang/yannick-stock-checker" target="_blank" rel="noopener">
            ${icon('github-logo', { size: 16, weight: 'bold' })}<span>GitHub</span>
          </a>
        </div>
      </div>
      <div class="yt-api-card">
        <div class="yt-api-card-bar">
          <span class="yt-tl" style="background:#FF5F57"></span>
          <span class="yt-tl" style="background:#FEBC2E"></span>
          <span class="yt-tl" style="background:#28C840"></span>
          <span class="yt-api-host">${escapeHtml(location.host || 'yannick.purr.tw')}</span>
        </div>
        <div class="yt-api-rows">
          ${endpoints
            .map(
              (e) => `
            <div class="yt-api-row">
              <span class="yt-method" data-m="${e.m}">${e.m}</span>
              <code class="yt-path">${escapeHtml(e.path)}</code>
              <span class="yt-api-desc">${escapeHtml(e.desc)}</span>
            </div>`,
            )
            .join('')}
        </div>
      </div>
    </div>
  `;
  shell.appendChild(apiSection);

  // ---- Footer ----
  const footer = document.createElement('footer');
  footer.className = 'yt-footer';
  footer.innerHTML = `
    <div class="yt-footer-card">
      <div class="yt-footer-top">
        <div style="display:flex;align-items:center;gap:12px">
          ${brandMark(40)}
          <div style="line-height:1.2">
            <div class="yt-wordmark">亞尼克・庫存雷達</div>
            <div class="yt-wordmark-sub">以商品為核心，快速定位現貨站點</div>
          </div>
        </div>
        <nav class="yt-footer-links">
          <a href="#wall">商品牆</a>
          <a href="#query">查詢</a>
          <a href="/docs" target="_blank" rel="noopener">API 文件</a>
          <a href="https://github.com/HeiTang/yannick-stock-checker" target="_blank" rel="noopener">GitHub</a>
        </nav>
      </div>
      <div class="yt-footer-rule"></div>
      <div class="yt-footer-bottom">
        <span>本專案為非官方工具，與亞尼克無官方關聯；相關商標權利屬原權利人所有。</span>
        <span>MIT License · © ${new Date().getFullYear()}</span>
      </div>
    </div>
  `;
  shell.appendChild(footer);

  // ---- Wire smooth nav ----
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>('[data-nav]');
    if (btn) {
      e.preventDefault();
      smoothNavTo(btn.dataset.nav!);
    }
  });

  // ---- Init theme menu ----
  initThemeMenu({ buttonSelector: '#yt-theme-btn', page });

  // ---- Init query console + load data in parallel ----
  let queryHandle: QueryHandle = { pickProduct() {} };
  const queryInitPromise = initQueryConsole({
    rootSelector: '#query-console',
    persist: true,
    lean: false,
    sectionHead: {
      kicker: '互動查詢',
      title: '雙視角查庫存，一次找對',
    },
  }).then((h) => {
    queryHandle = h;
  });

  // ---- Load API data in parallel ----
  await Promise.all([queryInitPromise, loadHeroAndWall(queryHandle)]);
  // queryHandle may have been replaced after initial wall render; re-bind wall click
  bindWallClicks(() => queryHandle);
}

async function loadHeroAndWall(_initialHandle: QueryHandle): Promise<void> {
  try {
    const [statusRes, prodRes] = await Promise.all([
      fetch('/api/status'),
      fetch('/api/products'),
    ]);
    const status = (await statusRes.json()) as StatusResponse;
    const prodData = await prodRes.json();
    const products: ProductSummary[] = prodData.products ?? [];

    // Hero: status numbers
    setText('hero-inventory', status.total_stock_items.toLocaleString('zh-TW'));
    setText('hero-updated', formatTimestamp(status.last_updated));
    setText('updated-at', formatTimestamp(status.last_updated));
    setText('stat-products', String(status.product_count));
    setText('stat-stations', String(status.station_count));
    setText('stat-inventory', status.total_stock_items.toLocaleString('zh-TW'));

    // Hero: top 3 products (by available_stations desc)
    const top = [...products].sort((a, b) => b.available_stations - a.available_stations).slice(0, 3);
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

    // Product wall
    const wallEl = document.getElementById('wall-grid');
    if (wallEl) {
      wallEl.innerHTML = products
        .map((p) => {
          const accent = accentFor(p.product_name);
          return `
        <div class="yt-prod" data-code="${escapeHtml(p.commodity_code)}" style="--pc:${accent}">
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
        </div>`;
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

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
