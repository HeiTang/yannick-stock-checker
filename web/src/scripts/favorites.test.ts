import { describe, expect, it } from 'vitest';
import { parseFavorites } from './favorites';

describe('parseFavorites', () => {
  it('rejects malformed JSON and non-array values', () => {
    for (const raw of [null, '{bad', 'null', '{}', '1', '"test"']) {
      expect(parseFavorites(raw)).toEqual([]);
    }
  });

  it('validates entries and deduplicates within each view', () => {
    const product = { view: 'products', id: 'P', name: '原味' };
    const station = { view: 'stations', id: 'P', name: '近站' };
    expect(parseFavorites(JSON.stringify([
      null, false, 1, 'bad', {}, { ...product, view: 'other' },
      { ...product, id: '' }, { ...product, name: 1 },
      product, product, station,
    ]))).toEqual([product, station]);
  });
});
