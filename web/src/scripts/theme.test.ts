import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, DIRECTIONS, readTheme, themeVars, type ThemeKey, type ThemeMode } from './theme';

afterEach(() => vi.unstubAllGlobals());

describe('root theme background', () => {
  it.each(Object.keys(DIRECTIONS).flatMap((key) =>
    ['light', 'dark'].map((mode) => [key as ThemeKey, mode as ThemeMode] as const),
  ))('synchronizes root background and browser color for %s/%s', (key, mode) => {
    const dataset = {};
    const meta = { setAttribute: vi.fn() };
    vi.stubGlobal('document', { documentElement: { dataset }, querySelector: () => meta });
    applyTheme({ dir: key, mode });
    const background = DIRECTIONS[key].modes[mode]['--yt-surface'];
    expect(themeVars(DIRECTIONS[key], mode)['--yt-root-bg']).toBe(background);
    expect(readTheme()).toEqual({ dir: key, mode });
    expect(meta.setAttribute).toHaveBeenCalledWith('content', background);
  });
});
