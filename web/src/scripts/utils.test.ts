import { describe, it, expect } from 'vitest';
import { formatTimestamp, escapeHtml } from './utils';

describe('formatTimestamp', () => {
  it('returns "--:--" when serverTime is null', () => {
    expect(formatTimestamp(null)).toBe('--:--');
  });

  it('returns "--:--" when serverTime is empty string', () => {
    expect(formatTimestamp('')).toBe('--:--');
  });

  it('returns "格式錯誤" for an unparseable string', () => {
    expect(formatTimestamp('not-a-date')).toBe('格式錯誤');
  });

  it('displays time derived from the API string — not current local time', () => {
    // Regression: if someone replaces new Date(serverTime) with new Date(),
    // this test will fail because the result won't match a fixed past timestamp.
    const result = formatTimestamp('2026-04-10T06:30:00+08:00');
    expect(result).toBe('06:30');
  });

  it('converts UTC to Asia/Taipei (+08:00 offset)', () => {
    // UTC midnight == 08:00 in Taipei.
    // Catches any regression where timeZone option is removed.
    const result = formatTimestamp('2026-04-10T00:00:00Z');
    expect(result).toBe('08:00');
  });

  it('handles ISO string with explicit +08:00 offset correctly', () => {
    const result = formatTimestamp('2026-04-10T23:59:00+08:00');
    expect(result).toBe('23:59');
  });
});

describe('escapeHtml', () => {
  it('returns empty string for null/undefined input', () => {
    expect(escapeHtml(null as unknown as string)).toBe('');
    expect(escapeHtml(undefined as unknown as string)).toBe('');
  });

  it('passes plain text through unchanged', () => {
    expect(escapeHtml('Hello world')).toBe('Hello world');
  });

  it('escapes &, <, >, ", and \' so attribute interpolation is safe', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(escapeHtml('say "hi"')).toBe('say &quot;hi&quot;');
    expect(escapeHtml("it's fine")).toBe('it&#39;s fine');
  });

  it('escapes & first so already-escaped sequences double-encode safely', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});
