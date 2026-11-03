import type { Macros } from './types';
export interface RecipeLite { id: number; name: string; ingredients: { foodId: number; grams: number; name?: string }[]; perPortion: Macros }
export interface Ranked { recipe: RecipeLite; missing: { foodId: number; grams: number; name?: string }[]; coverage: number; score: number }
/** Rank recipes: fully covered first, then missing 1-2; within group weight by fit to remaining macros. */
export function rankRecipes(recipes: RecipeLite[], onHand: Map<number, number>, remaining: Macros, staples: Set<number> = new Set()): Ranked[] {
  const out: Ranked[] = [];
  for (const r of recipes) {
    if (!r.ingredients.length) continue;
    const missing = r.ingredients.filter((i) => !staples.has(i.foodId) && (onHand.get(i.foodId) || 0) < i.grams);
    if (missing.length > 2) continue;
    const coverage = 1 - missing.length / r.ingredients.length;
    const p = r.perPortion;
    let fit = 0;
    if (remaining.protein > 20) fit += Math.min(p.protein, remaining.protein) / Math.max(p.calories, 1) * 10; // protein density
    if (remaining.fiber > 5) fit += Math.min(p.fiber, remaining.fiber) / 10;
    if (remaining.calories > 0 && p.calories > remaining.calories * 1.2) fit -= 1;
    if (remaining.calories <= 0) fit -= p.calories / 500;
    out.push({ recipe: r, missing, coverage, score: (2 - missing.length) * 100 + fit });
  }
  return out.sort((a, b) => b.score - a.score);
}
