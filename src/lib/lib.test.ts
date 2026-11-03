import { describe, it, expect } from 'vitest';
import { scale, sum, recipePer100, perPortion, activeTarget, addDays } from './nutrition';
import { portionHabit, recentFoodIds, frequentFoodIds } from './portions';
import { parseShortcut } from './parse';
import { planImport, validateRecipe, parseInput, SAMPLE_RECIPE } from './importer';
import { rankRecipes } from './pantry';
import { computeDrift, suggestReplacement } from './drift';
import { proposeTargets } from './suggest';

const M = (calories: number, protein = 0, carbs = 0, fat = 0, fiber = 0) => ({ calories, protein, carbs, fat, fiber });

describe('nutrition', () => {
  it('scales and sums', () => {
    expect(scale(M(200, 10), 150)).toEqual(M(300, 15));
    expect(sum([M(1, 1), M(2, 2)])).toEqual(M(3, 3));
  });
  it('recipe per 100g uses cooked weight', () => {
    const p = recipePer100([{ per100: M(100, 10), grams: 500 }, { per100: M(50), grams: 500 }], 500);
    expect(p.calories).toBe(150); expect(p.protein).toBe(10);
    expect(perPortion(p, 500, 5).calories).toBe(150);
  });
  it('active target is latest startDate <= date', () => {
    const t = [{ startDate: '2026-01-01', ...M(2000) }, { startDate: '2026-06-01', ...M(1800) }, { startDate: '2027-01-01', ...M(1500) }];
    expect(activeTarget(t, '2026-11-02')!.calories).toBe(1800);
    expect(activeTarget(t, '2025-01-01')).toBeUndefined();
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('portions', () => {
  const e = [
    { foodId: 1, quantity: 1, servingId: 5, grams: 30, datetime: 1 },
    { foodId: 1, quantity: 2, servingId: 5, grams: 60, datetime: 2 },
    { foodId: 1, quantity: 1, servingId: 5, grams: 30, datetime: 3 },
    { foodId: 2, quantity: 100, grams: 100, datetime: 4 },
  ];
  it('most common and last', () => {
    const h = portionHabit(e, 1);
    expect(h.common).toEqual({ quantity: 1, servingId: 5, grams: 30 });
    expect(h.last[0].quantity).toBe(1);
    expect(h.last).toHaveLength(3);
    expect(portionHabit(e, 9).common).toBeUndefined();
  });
  it('recent and frequent', () => {
    expect(recentFoodIds(e)).toEqual([2, 1]);
    expect(frequentFoodIds(e)).toEqual([1, 2]);
  });
});

describe('shortcut parsing', () => {
  it('parses', () => {
    expect(parseShortcut('200 chicken')).toEqual({ grams: 200, query: 'chicken' });
    expect(parseShortcut('150g greek yogurt')).toEqual({ grams: 150, query: 'greek yogurt' });
    expect(parseShortcut('rice 80 g')).toEqual({ grams: 80, query: 'rice' });
    expect(parseShortcut('banana')).toEqual({ query: 'banana' });
    expect(parseShortcut('7up')).toEqual({ query: '7up' });
  });
});

describe('importer', () => {
  it('accepts the sample', () => { expect(validateRecipe(SAMPLE_RECIPE)).toEqual([]); });
  it('reports per-field errors', () => {
    const errs = validateRecipe({ schema: 'x', name: '', portions: 0, ingredients: [{ grams: -1 }] });
    const paths = errs.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['schema', 'source', 'external_id', 'name', 'portions', 'ingredients[0].name', 'ingredients[0].grams']));
  });
  it('matches by barcode, then name, else creates', () => {
    const r = { ...SAMPLE_RECIPE, ingredients: [
      { name: 'Whatever', grams: 10, barcode: '123' },
      { name: '  onion ', grams: 20 },
      { name: 'New thing', grams: 30, nutrition_per_100g: { calories: 10 } },
    ] };
    const [plan] = planImport([r], [{ id: 7, name: 'X', barcode: '123' }, { id: 8, name: 'Onion' }]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ingredients.map((i) => i.kind)).toEqual(['existing', 'existing', 'new']);
    expect((plan.ingredients[0] as { foodId: number }).foodId).toBe(7);
    expect((plan.ingredients[1] as { foodId: number }).foodId).toBe(8);
  });
  it('falls back to per-portion, else errors', () => {
    const r = { ...SAMPLE_RECIPE, ingredients: [{ name: 'Mystery', grams: 10 }] };
    const [a] = planImport([r], []);
    expect(a.ok && a.perPortionOverride?.calories).toBe(420);
    const [b] = planImport([{ ...r, nutrition_per_portion: null }], []);
    expect(b.ok).toBe(false);
  });
  it('handles arrays and bad JSON', () => {
    expect(parseInput('[1,2]').items).toHaveLength(2);
    expect(parseInput('{').error).toBeTruthy();
    const res = planImport([SAMPLE_RECIPE, {}], []);
    expect(res[0].ok).toBe(true); expect(res[1].ok).toBe(false);
  });
});

describe('pantry scoring', () => {
  const rec = (id: number, ings: number[], p: number) => ({ id, name: 'r' + id, ingredients: ings.map((f) => ({ foodId: f, grams: 100 })), perPortion: M(400, p) });
  it('full coverage first, drops >2 missing, protein weighted', () => {
    const on = new Map([[1, 500], [2, 500]]);
    const out = rankRecipes([rec(1, [1, 3], 40), rec(2, [1, 2], 10), rec(3, [1, 2], 40), rec(4, [3, 4, 5], 50)], on, M(1000, 80));
    expect(out.map((r) => r.recipe.id)).toEqual([3, 2, 1]);
    expect(out[2].missing.map((m) => m.foodId)).toEqual([3]);
  });
  it('staples count as on hand', () => {
    const out = rankRecipes([rec(1, [9], 10)], new Map(), M(500), new Set([9]));
    expect(out[0].missing).toEqual([]);
  });
});

describe('drift', () => {
  it('flags beyond threshold', () => {
    const d = computeDrift(M(130, 10, 20, 5, 0.2), M(100, 10, 21, 5, 0));
    expect(d.map((x) => x.key)).toEqual(['calories']);
    expect(computeDrift(M(130), M(100), 0.35)).toEqual([]);
  });
  it('suggests replacement by name', () => {
    const f = [{ id: 1, name: 'Granola bar' }, { id: 2, name: 'Peanut butter' }];
    expect(suggestReplacement('Homemade peanut butter', [], f)?.id).toBe(2);
    expect(suggestReplacement('Chili', [], f)).toBeUndefined();
  });
});

describe('target suggestions', () => {
  const target = { startDate: '2026-01-01', ...M(2000, 150, 200, 70, 30) };
  const days = (n: number, m: ReturnType<typeof M>) => Array.from({ length: n }, (_, i) => ({ date: addDays('2026-11-02', -1 - i), ...m }));
  it('needs 21 days', () => { expect(proposeTargets(days(10, M(2600, 150, 0, 0, 30)), [], target, '2026-11-02')).toBeNull(); });
  it('proposes when consistently over', () => {
    const p = proposeTargets(days(25, M(2600, 150, 0, 0, 30)), [], target, '2026-11-02');
    expect(p?.proposed.calories).toBe(2300); expect(p?.reason).toMatch(/over your calorie target/);
  });
  it('no suggestion when on track', () => { expect(proposeTargets(days(25, M(2000, 150, 0, 0, 30)), [], target, '2026-11-02')).toBeNull(); });
});
