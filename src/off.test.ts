import { afterEach, describe, expect, it, vi } from 'vitest';
import { offByBarcode, offSearch } from './off';

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 404, json: async () => body };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('Open Food Facts barcode lookup', () => {
  it('maps a product, including kilojoules when kcal is missing', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      status: 1,
      product: { code: '3017624010701', product_name: 'Nutella', brands: 'Ferrero, other', nutriments: { energy_100g: 418.4, proteins_100g: 6, carbohydrates_100g: 57.5, fat_100g: 30.9, fiber_100g: 0 }, serving_quantity: '15', serving_size: '15 g' },
    })));
    const hit = await offByBarcode('3017624010701');
    expect(hit.kind).toBe('found');
    if (hit.kind !== 'found') return;
    expect(hit.food.food.name).toBe('Nutella');
    expect(hit.food.food.brand).toBe('Ferrero');
    expect(hit.food.food.calories).toBe(100);
    expect(hit.food.servingG).toBe(15);
  });

  it('tries the EAN-13 form when the UPC-A code is missing', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/036000291452')) return jsonResponse({ status: 0 });
      return jsonResponse({ status: 1, product: { code: '0036000291452', product_name: 'Cola', brands: 'Coke', nutriments: { 'energy-kcal_100g': 42, proteins_100g: 0, carbohydrates_100g: 10, fat_100g: 0, fiber_100g: 0 } } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const hit = await offByBarcode('036000291452');
    expect(hit.kind).toBe('found');
    if (hit.kind === 'found') expect(hit.food.food.barcode).toBe('0036000291452');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says when a product has no usable nutrition', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 1, product: { code: '12345670', product_name: 'Bulk oats', brands: 'Mill' } })));
    const hit = await offByBarcode('12345670');
    expect(hit).toMatchObject({ kind: 'incomplete', name: 'Bulk oats', brand: 'Mill', barcode: '12345670' });
  });

  it('distinguishes not found, offline, and unreachable', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 0, product: null })));
    expect((await offByBarcode('4006381333931')).kind).toBe('missing');

    vi.stubGlobal('navigator', { onLine: false });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await offByBarcode('4006381333931')).kind).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect((await offByBarcode('4006381333931')).kind).toBe('unreachable');
    expect(await offSearch('oats')).toEqual([]);
  });
});
