/**
 * 亞尼克庫存 — 配色系統
 * 方向（色系：奶霜 / 莓果 / 焦糖）與 模式（亮 / 暗）解耦：
 * 每個色系都有 light 與 dark 兩套底色，品牌色共用。
 */

export type ThemeMode = 'light' | 'dark';
export type ThemeKey = 'cream' | 'berry' | 'caramel';

export interface ThemeDirection {
  key: ThemeKey;
  label: string;
  desc: string;
  defaultMode: ThemeMode;
  brand: string;
  brand2: string;
  swatch: string[];
  shared: Record<string, string>;
  modes: Record<ThemeMode, Record<string, string>>;
}

export const DIRECTIONS: Record<ThemeKey, ThemeDirection> = {
  cream: {
    key: 'cream',
    label: '奶霜',
    desc: '北海道鮮奶油・明亮',
    defaultMode: 'light',
    brand: '#E0A23F',
    brand2: '#E5859E',
    swatch: ['#FBF6EF', '#E0A23F', '#E5859E'],
    shared: {
      '--yt-bleed-a': '#F3B65E',
      '--yt-bleed-b': '#EE9BB4',
      '--yt-on-brand': '#3A2A12',
      '--yt-code-ink': '#2B221B',
    },
    modes: {
      light: {
        '--yt-bg':
          'radial-gradient(1200px 720px at 78% -8%, #FCEBD6 0%, rgba(252,235,214,0) 60%),' +
          'radial-gradient(900px 600px at 4% 8%, #FBE7EC 0%, rgba(251,231,236,0) 55%),' +
          'linear-gradient(180deg, #FBF7F1 0%, #F4ECE1 100%)',
        '--yt-surface': '#FBF7F1',
        '--yt-ink': '#2B221B',
        '--yt-ink-2': 'rgba(43,34,27,0.62)',
        '--yt-ink-3': 'rgba(43,34,27,0.40)',
        '--yt-hairline': 'rgba(43,34,27,0.10)',
      },
      dark: {
        '--yt-bg':
          'radial-gradient(1100px 680px at 80% -10%, rgba(224,162,63,0.30) 0%, rgba(224,162,63,0) 58%),' +
          'radial-gradient(900px 600px at 2% 10%, rgba(229,133,158,0.22) 0%, rgba(229,133,158,0) 55%),' +
          'linear-gradient(180deg, #261B12 0%, #19120C 100%)',
        '--yt-surface': '#241A11',
        '--yt-ink': '#F7ECDC',
        '--yt-ink-2': 'rgba(247,236,220,0.66)',
        '--yt-ink-3': 'rgba(247,236,220,0.42)',
        '--yt-hairline': 'rgba(255,255,255,0.10)',
      },
    },
  },
  berry: {
    key: 'berry',
    label: '莓果寶石',
    desc: 'Ruby 寶石・濃郁',
    defaultMode: 'dark',
    brand: '#FF3F7D',
    brand2: '#B468C9',
    swatch: ['#1A0E16', '#FF3F7D', '#B468C9'],
    shared: {
      '--yt-bleed-a': '#FF3F7D',
      '--yt-bleed-b': '#B468C9',
      '--yt-on-brand': '#ffffff',
      '--yt-code-ink': '#2B1320',
    },
    modes: {
      light: {
        '--yt-bg':
          'radial-gradient(1150px 700px at 82% -8%, #FFD9E6 0%, rgba(255,217,230,0) 58%),' +
          'radial-gradient(880px 600px at 0% 10%, #EFD9F2 0%, rgba(239,217,242,0) 54%),' +
          'linear-gradient(180deg, #FCF1F5 0%, #F5E6EC 100%)',
        '--yt-surface': '#FCF1F5',
        '--yt-ink': '#2A0F1C',
        '--yt-ink-2': 'rgba(42,15,28,0.62)',
        '--yt-ink-3': 'rgba(42,15,28,0.40)',
        '--yt-hairline': 'rgba(42,15,28,0.10)',
      },
      dark: {
        '--yt-bg':
          'radial-gradient(1100px 680px at 82% -10%, rgba(255,63,125,0.42) 0%, rgba(255,63,125,0) 58%),' +
          'radial-gradient(900px 620px at 0% 12%, rgba(180,104,201,0.34) 0%, rgba(180,104,201,0) 55%),' +
          'linear-gradient(180deg, #1B0D16 0%, #120A11 100%)',
        '--yt-surface': '#1B0D16',
        '--yt-ink': '#FBEEF3',
        '--yt-ink-2': 'rgba(251,238,243,0.66)',
        '--yt-ink-3': 'rgba(251,238,243,0.42)',
        '--yt-hairline': 'rgba(255,255,255,0.10)',
      },
    },
  },
  caramel: {
    key: 'caramel',
    label: '焦糖暖陽',
    desc: '烘焙暖調・大地色',
    defaultMode: 'light',
    brand: '#CE7B2C',
    brand2: '#B0492A',
    swatch: ['#F1E2CC', '#CE7B2C', '#B0492A'],
    shared: {
      '--yt-bleed-a': '#E0993E',
      '--yt-bleed-b': '#C0552B',
      '--yt-on-brand': '#ffffff',
      '--yt-code-ink': '#3A2614',
    },
    modes: {
      light: {
        '--yt-bg':
          'radial-gradient(1150px 700px at 80% -6%, #F6D9A8 0%, rgba(246,217,168,0) 58%),' +
          'radial-gradient(880px 600px at 2% 6%, #EFC9A6 0%, rgba(239,201,166,0) 52%),' +
          'linear-gradient(180deg, #F4E6D2 0%, #ECD7BC 100%)',
        '--yt-surface': '#F5E8D5',
        '--yt-ink': '#3A2614',
        '--yt-ink-2': 'rgba(58,38,20,0.64)',
        '--yt-ink-3': 'rgba(58,38,20,0.42)',
        '--yt-hairline': 'rgba(58,38,20,0.12)',
      },
      dark: {
        '--yt-bg':
          'radial-gradient(1100px 680px at 80% -10%, rgba(224,153,62,0.34) 0%, rgba(224,153,62,0) 58%),' +
          'radial-gradient(900px 600px at 2% 10%, rgba(192,85,43,0.26) 0%, rgba(192,85,43,0) 54%),' +
          'linear-gradient(180deg, #271811 0%, #1A1009 100%)',
        '--yt-surface': '#271811',
        '--yt-ink': '#F3E4CF',
        '--yt-ink-2': 'rgba(243,228,207,0.66)',
        '--yt-ink-3': 'rgba(243,228,207,0.42)',
        '--yt-hairline': 'rgba(255,255,255,0.10)',
      },
    },
  },
};

export interface ThemeState {
  dir: ThemeKey;
  mode: ThemeMode;
}

export const THEME_STORAGE_KEY = 'ytm.theme';

export function themeVars(dir: ThemeDirection, mode: ThemeMode): Record<string, string> {
  return {
    ...dir.shared,
    ...dir.modes[mode],
    '--yt-brand': dir.brand,
    '--yt-brand-2': dir.brand2,
    '--yt-glow': '1.2',
    '--tint': dir.brand,
    '--tint-pressed': dir.brand2,
    '--glow-color': dir.brand,
    '--yt-root-bg': dir.modes[mode]['--yt-surface'],
  };
}

export function readTheme(): ThemeState {
  const { ytDir, ytMode } = document.documentElement.dataset;
  const dir = ytDir && Object.hasOwn(DIRECTIONS, ytDir) ? (ytDir as ThemeKey) : 'cream';
  const mode = ytMode === 'light' || ytMode === 'dark' ? ytMode : DIRECTIONS[dir].defaultMode;
  return { dir, mode };
}

export function applyTheme({ dir, mode }: ThemeState): void {
  document.documentElement.dataset.ytDir = dir;
  document.documentElement.dataset.ytMode = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', DIRECTIONS[dir].modes[mode]['--yt-surface']);
}

export function writeSavedTheme(state: ThemeState): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  const u = new URLSearchParams(location.search);
  u.set('dir', state.dir);
  u.set('mode', state.mode);
  history.replaceState(null, '', location.pathname + '?' + u.toString() + location.hash);
}
