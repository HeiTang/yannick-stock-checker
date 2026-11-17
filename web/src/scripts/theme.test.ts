import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyDirection, DIRECTIONS, type ThemeKey, type ThemeMode } from './theme';

afterEach(() => vi.unstubAllGlobals());

describe('root theme background', () => {
  it.each(Object.keys(DIRECTIONS).flatMap((key) =>
    ['light', 'dark'].map((mode) => [key as ThemeKey, mode as ThemeMode] as const),
  ))('synchronizes root background and browser color for %s/%s', (key, mode) => {
    const rootStyle = { setProperty: vi.fn(), colorScheme: '' };
    const meta = { setAttribute: vi.fn() };
    vi.stubGlobal('document', { documentElement: { style: rootStyle }, querySelector: () => meta });
    const page = { style: { setProperty: vi.fn() }, classList: { toggle: vi.fn() } };
    applyDirection(page as unknown as HTMLElement, key, { mode });
    const background = DIRECTIONS[key].modes[mode]['--yt-surface'];
    expect(rootStyle.setProperty).toHaveBeenCalledWith('--yt-root-bg', background);
    expect(rootStyle.colorScheme).toBe(mode);
    expect(meta.setAttribute).toHaveBeenCalledWith('content', background);
  });
});
