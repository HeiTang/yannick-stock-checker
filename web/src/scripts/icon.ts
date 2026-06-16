/**
 * Phosphor icon helper.
 * Phosphor 用兩個 class 分開 weight 與 name：
 *   regular: `ph ph-foo`
 *   bold:    `ph-bold ph-foo`
 *   fill:    `ph-fill ph-foo`
 * 之前寫成合併 `ph-bold-foo` 全部失效。
 */
export type IconWeight = 'regular' | 'bold' | 'fill';

export function icon(name: string, opts: { size?: number; weight?: IconWeight } = {}): string {
  const size = opts.size ?? 16;
  const weight = opts.weight ?? 'regular';
  const weightCls = weight === 'regular' ? 'ph' : `ph-${weight}`;
  return `<i class="${weightCls} ph-${name}" aria-hidden="true" style="font-size:${size}px;line-height:1;display:inline-flex"></i>`;
}
