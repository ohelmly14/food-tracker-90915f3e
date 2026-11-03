import { MACRO_KEYS, type Macros, type Entry, type CookedRecord, type Target } from './types';
import { round1 } from './nutrition';
export interface Proposal { reason: string; proposed: Macros }
/** Weekly-style rule: needs >= 21 distinct logged days in the last 28. Proposes targets only when intake consistently differs from target. */
export function proposeTargets(entries: Pick<Entry, 'date' | keyof Macros>[], cooked: CookedRecord[], target: Target | undefined, today: string): Proposal | null {
  if (!target) return null;
  const start = shift(today, -28);
  const byDay = new Map<string, Macros>();
  for (const e of entries) {
    if (e.date < start || e.date >= today) continue;
    const d = byDay.get(e.date) || { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    for (const k of MACRO_KEYS) d[k] += e[k] || 0;
    byDay.set(e.date, d);
  }
  if (byDay.size < 21) return null;
  const days = [...byDay.values()];
  const avg = {} as Macros;
  for (const k of MACRO_KEYS) avg[k] = round1(days.reduce((a, d) => a + d[k], 0) / days.length);
  const reasons: string[] = [];
  const proposed = { ...target } as Macros;
  const overCal = days.filter((d) => d.calories > target.calories * 1.1).length / days.length;
  const underCal = days.filter((d) => d.calories < target.calories * 0.85).length / days.length;
  if (overCal >= 0.6) { proposed.calories = Math.round((target.calories + avg.calories) / 2 / 10) * 10; reasons.push(`you went over your calorie target on ${Math.round(overCal * 100)}% of the last ${days.length} logged days (avg ${Math.round(avg.calories)} kcal vs ${target.calories}); a halfway target may be more realistic`); }
  else if (underCal >= 0.6) { proposed.calories = Math.round((target.calories + avg.calories) / 2 / 10) * 10; reasons.push(`you were well under your calorie target on ${Math.round(underCal * 100)}% of logged days (avg ${Math.round(avg.calories)} kcal vs ${target.calories})`); }
  if (avg.protein < target.protein * 0.8) { proposed.protein = Math.round((target.protein + avg.protein) / 2); reasons.push(`protein averaged ${Math.round(avg.protein)} g vs a ${target.protein} g target`); }
  if (avg.fiber < target.fiber * 0.7) { proposed.fiber = Math.round((target.fiber + avg.fiber) / 2); reasons.push(`fiber averaged ${Math.round(avg.fiber)} g vs ${target.fiber} g`); }
  const recentCooked = cooked.filter((c) => c.date >= start);
  if (recentCooked.length && reasons.length) reasons.push(`you cooked ${recentCooked.length} recipe batch${recentCooked.length > 1 ? 'es' : ''} in this period`);
  if (!reasons.length) return null;
  return { reason: 'Over the last 4 weeks ' + reasons.join('; ') + '.', proposed };
}
function shift(date: string, n: number) { const [y, m, d] = date.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; }
