export interface Favorite {
  view: 'products' | 'stations';
  id: string;
  name: string;
}

export const FAVORITES_KEY = 'ytm.favorites';

export function parseFavorites(raw: string | null): Favorite[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Favorite =>
      item !== null && typeof item === 'object' &&
      (item.view === 'products' || item.view === 'stations') &&
      typeof item.id === 'string' && item.id.length > 0 &&
      typeof item.name === 'string' && item.name.length > 0,
    ).filter((item, index, items) =>
      items.findIndex((other) => other.view === item.view && other.id === item.id) === index,
    );
  } catch {
    return [];
  }
}
