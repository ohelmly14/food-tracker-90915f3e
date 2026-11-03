import type { Entry } from './types';
export interface Habit { last: { quantity: number; servingId?: number; grams: number }[]; common?: { quantity: number; servingId?: number; grams: number } }
/** Derive portion habits for a food from its entries (newest first). */
export function portionHabit(entries: Pick<Entry, 'foodId' | 'quantity' | 'servingId' | 'grams' | 'datetime'>[], foodId: number, n = 5): Habit {
  const mine = entries.filter((e) => e.foodId === foodId).sort((a, b) => b.datetime - a.datetime);
  const last = mine.slice(0, n).map((e) => ({ quantity: e.quantity, servingId: e.servingId, grams: e.grams }));
  const counts = new Map<string, { c: number; v: Habit['last'][0]; latest: number }>();
  for (const e of mine.slice(0, 20)) {
    const key = `${e.servingId ?? 'g'}:${e.quantity}`;
    const cur = counts.get(key);
    if (cur) cur.c++; else counts.set(key, { c: 1, v: { quantity: e.quantity, servingId: e.servingId, grams: e.grams }, latest: e.datetime });
  }
  const common = [...counts.values()].sort((a, b) => b.c - a.c || b.latest - a.latest)[0]?.v;
  return { last, common };
}
export function recentFoodIds(entries: Pick<Entry, 'foodId' | 'datetime'>[], n = 15): number[] {
  const seen: number[] = [];
  for (const e of [...entries].sort((a, b) => b.datetime - a.datetime)) { if (!seen.includes(e.foodId)) seen.push(e.foodId); if (seen.length >= n) break; }
  return seen;
}
export function frequentFoodIds(entries: Pick<Entry, 'foodId'>[], n = 15): number[] {
  const c = new Map<number, number>();
  for (const e of entries) c.set(e.foodId, (c.get(e.foodId) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
}
