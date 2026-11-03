import type { Food } from './lib/types';
// Open Food Facts public API. Failures/offline return null/[] so callers fall back to manual entry.
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
async function getJson(url: string, ms = 8000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) return null; return await r.json(); } catch { return null; } finally { clearTimeout(t); }
}
const FIELDS = 'code,product_name,generic_name,brands,nutriments,serving_size,serving_quantity';
export async function offByBarcode(code: string): Promise<OffFood | null> {
  if (!navigator.onLine) return null;
  const j = await getJson(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
  return j?.status === 1 ? map(j.product) : null;
}
export async function offSearch(q: string): Promise<OffFood[]> {
  if (!navigator.onLine || q.trim().length < 3) return [];
  const j = await getJson(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=15&fields=${FIELDS}`);
  return ((j?.products as any[]) || []).map(map).filter((x): x is OffFood => !!x);
}
