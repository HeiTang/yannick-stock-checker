import { describe, it, expect } from 'vitest';
import { formatTimestamp } from './utils';

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
