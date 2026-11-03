import { MACRO_KEYS, type Macros } from './types';
import { normName } from './parse';
export interface Drift { key: keyof Macros; recipe: number; packaged: number; pct: number }
/** Relative diff per macro; flags those beyond threshold (fraction, e.g. 0.15). Small absolute values (<1) ignored to avoid noise. */
export function computeDrift(recipe: Macros, packaged: Macros, threshold = 0.15): Drift[] {
  const out: Drift[] = [];
  for (const k of MACRO_KEYS) {
    const a = recipe[k] || 0, b = packaged[k] || 0;
    const base = Math.max(Math.abs(b), Math.abs(a));
    if (base < 1) continue;
    const pct = b === 0 ? 1 : (a - b) / b;
    if (Math.abs(pct) > threshold) out.push({ key: k, recipe: a, packaged: b, pct });
  }
  return out;
}
const tokens = (s: string) => new Set(normName(s).split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !['homemade', 'recipe', 'with', 'and', 'the'].includes(t)));
/** Suggest packaged food a recipe could replace by name/tag token overlap (Jaccard >= 0.5). */
export function suggestReplacement<T extends { id?: number; name: string }>(recipeName: string, tags: string[], packaged: T[]): T | undefined {
  const r = tokens(recipeName + ' ' + tags.join(' '));
  let best: T | undefined, bestScore = 0;
  for (const f of packaged) {
    const p = tokens(f.name); if (!p.size) continue;
    const inter = [...p].filter((t) => r.has(t)).length;
    const score = inter / p.size;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return bestScore >= 0.5 ? best : undefined;
}
