/**
 * 共用 SVG：生乳捲漩渦（Roll Swirl）— 品牌裝飾圖形。
 * 數學產生 5 圈螺旋路徑，奶霜色徑向漸層底 + 雙描邊。
 */

export function rollSwirlSvg(
  size: number,
  a: string = 'var(--yt-brand)',
  b: string = 'var(--yt-brand-2)',
  idSuffix: string = '',
): string {
  const turns = 5;
  const cx = 50;
  const cy = 50;
  const pts: string[] = [];
  for (let i = 0; i <= turns * 60; i += 1) {
    const t = i / 60;
    const ang = t * Math.PI * 2;
    const r = 4 + t * 8.0;
    pts.push(`${(cx + Math.cos(ang) * r).toFixed(2)} ${(cy + Math.sin(ang) * r).toFixed(2)}`);
  }
  const d = 'M ' + pts.join(' L ');
  const gid = `rsg-${size}-${idSuffix || Math.random().toString(36).slice(2, 7)}`;
  return `
    <svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true" style="display:block">
      <defs>
        <radialGradient id="${gid}" cx="40%" cy="35%" r="75%">
          <stop offset="0%" stop-color="#FFFDF8"/>
          <stop offset="55%" stop-color="#FFF6EC"/>
          <stop offset="100%" stop-color="#F6E6D2"/>
        </radialGradient>
      </defs>
      <circle cx="${cx}" cy="${cy}" r="46" fill="url(#${gid})"/>
      <circle cx="${cx}" cy="${cy}" r="46" fill="none" stroke="${a}" stroke-opacity="0.25" stroke-width="1.4"/>
      <path d="${d}" fill="none" stroke="${a}" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>
      <path d="${d}" fill="none" stroke="${b}" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="1.6 4.4" opacity="0.95"/>
      <circle cx="${cx}" cy="${cy}" r="4.4" fill="${b}"/>
    </svg>
  `;
}

export function brandMarkSvg(size: number): string {
  return `<div class="yt-logo" style="width:${size}px;height:${size}px">${rollSwirlSvg(size)}</div>`;
}
