import { barcodeVariants } from './lib/barcode';
import type { Food } from './lib/types';
// Open Food Facts public API. Search failures return []. Barcode lookup returns a status so the UI can explain a miss.
export interface OffFood { food: Omit<Food, 'id' | 'createdAt' | 'source'>; servingG?: number; servingLabel?: string }
function map(p: any): OffFood | null {
  const n = p?.nutriments; if (!p || !n) return null;
  const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] != null ? n['energy_100g'] / 4.184 : undefined);
  if (kcal == null) return null;
  const num = (v: unknown) => Math.round((Number(v) || 0) * 10) / 10;
  return {
    food: { name: p.product_name || p.generic_name || 'Unnamed product', brand: (p.brands || '').split(',')[0]?.trim() || undefined, barcode: p.code,
      calories: num(kcal), protein: num(n.proteins_100g), carbs: num(n.carbohydrates_100g), fat: num(n.fat_100g), fiber: num(n.fiber_100g) },
    servingG: Number(p.serving_quantity) || undefined, servingLabel: p.serving_size || undefined,
  };
}
async function fetchJson(url: string, ms = 8000): Promise<{ json: any } | { error: 'http' | 'network' }> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) return { error: 'http' };
    return { json: await r.json() };
  } catch { return { error: 'network' }; }
  finally { clearTimeout(t); }
}
const FIELDS = 'code,product_name,generic_name,brands,nutriments,serving_size,serving_quantity';

export type OffLookup =
  | { kind: 'found'; food: OffFood }
  | { kind: 'incomplete'; name: string; brand?: string; barcode: string }
  | { kind: 'missing' }
  | { kind: 'offline' }
  | { kind: 'unreachable' };

/** Look up a retail barcode. Tries UPC-A and the leading-zero EAN-13 form. A product with no calories is `incomplete`, not missing. */
export async function offByBarcode(code: string): Promise<OffLookup> {
  const codes = barcodeVariants(code);
  if (!codes.length) return { kind: 'missing' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'offline' };
  for (const c of codes) {
    const res = await fetchJson(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(c)}.json?fields=${FIELDS}`, 6000);
    if ('error' in res) {
      if (res.error === 'network') return { kind: 'unreachable' };
      continue;
    }
    const product = res.json?.status === 1 ? res.json.product : null;
    if (!product) continue;
    const food = map(product);
    if (food) return { kind: 'found', food };
    const name = String(product.product_name || product.generic_name || '').trim();
    const brand = String(product.brands || '').split(',')[0]?.trim() || undefined;
    return { kind: 'incomplete', name, brand, barcode: String(product.code || c) };
  }
  return { kind: 'missing' };
}
export async function offSearch(q: string): Promise<OffFood[]> {
  if ((typeof navigator !== 'undefined' && navigator.onLine === false) || q.trim().length < 3) return [];
  const res = await fetchJson(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=15&fields=${FIELDS}`);
  if ('error' in res) return [];
  return ((res.json?.products as any[]) || []).map(map).filter((x): x is OffFood => !!x);
}
