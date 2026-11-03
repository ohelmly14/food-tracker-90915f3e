import { MACRO_KEYS, type Macros, type Target } from './types';
export const zero = (): Macros => ({ calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
export const round1 = (n: number) => Math.round(n * 10) / 10;
export function scale(per100: Macros, grams: number): Macros {
  const m = zero();
  for (const k of MACRO_KEYS) m[k] = round1(((per100[k] || 0) * grams) / 100);
  return m;
}
export function sum(list: Macros[]): Macros {
  const m = zero();
  for (const x of list) for (const k of MACRO_KEYS) m[k] += x[k] || 0;
  for (const k of MACRO_KEYS) m[k] = round1(m[k]);
  return m;
}
/** per-100g of a recipe from its ingredient totals and cooked weight (falls back to raw weight sum). */
export function recipePer100(ings: { per100: Macros; grams: number }[], cookedWeightG?: number): Macros {
  const total = sum(ings.map((i) => scale(i.per100, i.grams)));
  const w = cookedWeightG && cookedWeightG > 0 ? cookedWeightG : ings.reduce((a, i) => a + i.grams, 0);
  return w > 0 ? scale(total, 10000 / w) : zero();
}
export function perPortion(per100: Macros, cookedWeightG: number, portions: number): Macros {
  return scale(per100, portions > 0 ? cookedWeightG / portions : 0);
}
export function activeTarget(targets: Target[], date: string): Target | undefined {
  return targets.filter((t) => t.startDate <= date).sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
}
export function ymd(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}
