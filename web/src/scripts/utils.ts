/**
 * Pure utility functions — no DOM dependencies, fully unit-testable.
 */

/**
 * Formats a server-returned ISO 8601 timestamp string for display.
 * Always renders in Asia/Taipei timezone regardless of browser locale.
 *
 * @param serverTime - ISO 8601 string from the API (e.g. "2026-04-10T14:30:00+08:00"), or null
 * @returns HH:mm string in Asia/Taipei time, "--:--" if null, "格式錯誤" if unparseable
 */
export function formatTimestamp(serverTime: string | null): string {
  if (!serverTime) return '--:--';

  const date = new Date(serverTime);
  if (isNaN(date.getTime())) return '格式錯誤';

  return date.toLocaleTimeString('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Taipei',
  });
}
