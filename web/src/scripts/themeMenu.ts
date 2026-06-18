/**
 * Theme menu controller — 整合式主題切換器
 * 一顆 Header 按鈕，內含 奶霜 / 莓果 / 焦糖 三色系 × 淺/深模式。
 * 透過 portal 掛到 `.yt-page` 內，避免影響 header 寬度。
 */

import {
  DIRECTIONS,
  applyDirection,
  readSavedTheme,
  writeSavedTheme,
  type ThemeKey,
  type ThemeMode,
} from './theme.ts';
import { icon } from './icon.ts';

function swatchHtml(key: ThemeKey, sz: 'sm' | 'lg' = 'sm'): string {
  const d = DIRECTIONS[key];
  const cls = sz === 'lg' ? 'yt-theme-dot-lg' : 'yt-theme-swatch';
  return `<span class="${cls}" style="background:linear-gradient(135deg, ${d.brand} 0 50%, ${d.brand2} 50% 100%)"></span>`;
}

function modeIcon(mode: ThemeMode, size = 14): string {
  return icon(mode === 'dark' ? 'moon' : 'sun', { size, weight: 'bold' });
}

function chevron(size = 13): string {
  return `<span style="display:inline-flex;opacity:0.6">${icon('caret-down', { size, weight: 'bold' })}</span>`;
}

function check(size = 16): string {
  return `<span style="color:var(--yt-brand);display:inline-flex">${icon('check-circle', { size, weight: 'fill' })}</span>`;
}

export interface ThemeMenuOptions {
  buttonSelector: string;
  page: HTMLElement;
  onChange?: (dir: ThemeKey, mode: ThemeMode) => void;
}

export function initThemeMenu(opts: ThemeMenuOptions): { setDir: (k: ThemeKey) => void } {
  const btn = document.querySelector<HTMLButtonElement>(opts.buttonSelector);
  if (!btn) return { setDir: () => {} };

  let state = readSavedTheme();
  let popup: HTMLDivElement | null = null;
  applyDirection(opts.page, state.dir, { mode: state.mode, glow: 1.2 });
  renderBtn();

  function renderBtn() {
    btn.innerHTML = `
      ${swatchHtml(state.dir)}
      ${modeIcon(state.mode, 15)}
      ${chevron()}
    `;
    btn.setAttribute('aria-expanded', popup ? 'true' : 'false');
  }

  function close() {
    if (!popup) return;
    popup.remove();
    popup = null;
    renderBtn();
    document.removeEventListener('mousedown', onDoc);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
  }

  function onDoc(e: MouseEvent) {
    const target = e.target as Node;
    if (popup && !popup.contains(target) && !btn.contains(target)) close();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  function place() {
    if (!popup) return;
    const r = btn.getBoundingClientRect();
    popup.style.top = Math.round(r.bottom + 10) + 'px';
    popup.style.right = Math.round(window.innerWidth - r.right) + 'px';
  }

  function buildPopup(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'yt-theme-pop';

    const dirRows = Object.values(DIRECTIONS)
      .map((d) => {
        const active = d.key === state.dir ? ' is-active' : '';
        return `
        <button class="yt-theme-row${active}" type="button" data-dir="${d.key}">
          ${swatchHtml(d.key, 'lg')}
          <span class="nm">${d.label}</span>
          <span class="ds">${d.desc}</span>
          ${d.key === state.dir ? check() : ''}
        </button>`;
      })
      .join('');

    el.innerHTML = `
      <div class="yt-theme-cap">主題</div>
      ${dirRows}
      <div class="yt-theme-divider"></div>
      <div class="yt-theme-cap">外觀</div>
      <div class="yt-seg" role="group" aria-label="外觀模式" style="margin-top:2px">
        <button class="yt-seg-btn${state.mode === 'light' ? ' is-active' : ''}" type="button" data-mode="light" aria-pressed="${state.mode === 'light'}">
          ${modeIcon('light')}<span>淺色</span>
        </button>
        <button class="yt-seg-btn${state.mode === 'dark' ? ' is-active' : ''}" type="button" data-mode="dark" aria-pressed="${state.mode === 'dark'}">
          ${modeIcon('dark')}<span>深色</span>
        </button>
      </div>
    `;

    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const dirBtn = target.closest<HTMLButtonElement>('[data-dir]');
      if (dirBtn) {
        const k = dirBtn.dataset.dir as ThemeKey;
        state = { ...state, dir: k };
        applyChange();
        rebuild();
        return;
      }
      const modeBtn = target.closest<HTMLButtonElement>('[data-mode]');
      if (modeBtn) {
        const m = modeBtn.dataset.mode as ThemeMode;
        state = { ...state, mode: m };
        applyChange();
        rebuild();
      }
    });

    return el;
  }

  function rebuild() {
    if (!popup) return;
    const newPop = buildPopup();
    popup.replaceWith(newPop);
    popup = newPop;
    place();
  }

  function applyChange() {
    applyDirection(opts.page, state.dir, { mode: state.mode, glow: 1.2 });
    writeSavedTheme(state);
    renderBtn();
    opts.onChange?.(state.dir, state.mode);
  }

  function open() {
    const host = opts.page;
    popup = buildPopup();
    host.appendChild(popup);
    place();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    renderBtn();
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popup) close();
    else open();
  });

  return {
    setDir(k: ThemeKey) {
      state = { ...state, dir: k };
      applyChange();
    },
  };
}
