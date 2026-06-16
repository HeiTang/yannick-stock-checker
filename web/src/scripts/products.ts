/**
 * 商品顯示相關工具：accent 配色與 flavor 描述。
 * 設計檔（data.js）有硬編，本實作改用關鍵字推導。
 */

const FLAVOR_ACCENTS: Record<string, string> = {
  原味: '#E6A93C',
  紅寶石: '#E1456B',
  覆盆莓: '#E1456B',
  巧克力: '#8E3551',
  抹茶: '#7FA855',
  巴斯克: '#C57B38',
  起司: '#C57B38',
  盲盒: '#B468C9',
  切片: '#EC7BA0',
  BUBU: '#EC7BA0',
  芒果: '#F5B73B',
  布丁: '#D9A35E',
  蒸: '#D9A35E',
};

export function accentFor(name: string): string {
  for (const [k, v] of Object.entries(FLAVOR_ACCENTS)) {
    if (name.includes(k)) return v;
  }
  return '#E0A23F';
}

export function flavorOf(name: string): string {
  if (name.includes('原味')) return '北海道鮮奶油 · 經典';
  if (name.includes('紅寶石') && name.includes('脆皮')) return '脆皮可可 · 限量';
  if (name.includes('紅寶石')) return 'Ruby 巧克力 × 覆盆莓';
  if (name.includes('抹茶')) return '宇治抹茶 · 微苦回甘';
  if (name.includes('巴斯克') || name.includes('起司')) return '焦香乳酪 · 半熟';
  if (name.includes('盲盒')) return '隨機口味 · 驚喜組';
  if (name.includes('切片') || name.includes('BUBU')) return '三入切片 · 分享組';
  if (name.includes('芒果')) return '夏季限定 · 鮮甜';
  return '亞尼克・每日新鮮';
}

export interface ProductSummary {
  commodity_code: string;
  product_name: string;
  commodity_name: string;
  price: number;
  available_stations: number;
  total_quantity: number;
  lines: string[];
}
