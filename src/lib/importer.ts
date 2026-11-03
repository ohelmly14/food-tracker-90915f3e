import { MACRO_KEYS, type Macros } from './types';
import { normName } from './parse';

export interface RecipeV1Ingredient { text?: string; name: string; grams: number; barcode?: string | null; nutrition_per_100g?: Partial<Macros> | null }
export interface RecipeV1 {
  schema: 'recipe/v1'; source: string; external_id: string; name: string; portions: number; cooked_weight_g?: number | null;
  ingredients: RecipeV1Ingredient[]; nutrition_per_portion?: Partial<Macros> | null; instructions?: string[]; tags?: string[]; image_url?: string | null;
}
export interface FieldError { path: string; message: string }

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

function checkMacros(v: unknown, path: string, errs: FieldError[]) {
  if (v == null) return;
  if (typeof v !== 'object') { errs.push({ path, message: 'must be an object' }); return; }
  for (const k of MACRO_KEYS) { const x = (v as Record<string, unknown>)[k]; if (x != null && (!isNum(x) || (x as number) < 0)) errs.push({ path: `${path}.${k}`, message: 'must be a non-negative number' }); }
}

export function validateRecipe(r: unknown, prefix = ''): FieldError[] {
  const errs: FieldError[] = [];
  const p = (s: string) => (prefix ? `${prefix}.${s}` : s);
  if (!r || typeof r !== 'object' || Array.isArray(r)) return [{ path: prefix || '(root)', message: 'must be an object' }];
  const o = r as Record<string, unknown>;
  if (o.schema !== 'recipe/v1') errs.push({ path: p('schema'), message: 'must be "recipe/v1"' });
  for (const f of ['source', 'external_id', 'name']) if (!isStr(o[f])) errs.push({ path: p(f), message: 'required non-empty string' });
  if (!isNum(o.portions) || (o.portions as number) <= 0) errs.push({ path: p('portions'), message: 'required positive number' });
  if (o.cooked_weight_g != null && (!isNum(o.cooked_weight_g) || (o.cooked_weight_g as number) <= 0)) errs.push({ path: p('cooked_weight_g'), message: 'must be a positive number' });
  if (!Array.isArray(o.ingredients) || !o.ingredients.length) errs.push({ path: p('ingredients'), message: 'required non-empty array' });
  else o.ingredients.forEach((ing, i) => {
    const ip = p(`ingredients[${i}]`);
    if (!ing || typeof ing !== 'object') { errs.push({ path: ip, message: 'must be an object' }); return; }
    const g = ing as Record<string, unknown>;
    if (!isStr(g.name)) errs.push({ path: `${ip}.name`, message: 'required non-empty string' });
    if (!isNum(g.grams) || (g.grams as number) <= 0) errs.push({ path: `${ip}.grams`, message: 'required positive number' });
    if (g.barcode != null && typeof g.barcode !== 'string') errs.push({ path: `${ip}.barcode`, message: 'must be a string or null' });
    checkMacros(g.nutrition_per_100g, `${ip}.nutrition_per_100g`, errs);
  });
  checkMacros(o.nutrition_per_portion, p('nutrition_per_portion'), errs);
  for (const f of ['instructions', 'tags']) if (o[f] != null && (!Array.isArray(o[f]) || (o[f] as unknown[]).some((x) => typeof x !== 'string'))) errs.push({ path: p(f), message: 'must be an array of strings' });
  if (o.image_url != null && typeof o.image_url !== 'string') errs.push({ path: p('image_url'), message: 'must be a string or null' });
  return errs;
}

export interface ExistingFood { id: number; name: string; barcode?: string }
export type IngredientPlan = { text?: string; grams: number; name: string } & ({ kind: 'existing'; foodId: number } | { kind: 'new'; food: { name: string; barcode?: string } & Macros } | { kind: 'unresolved' });
export interface RecipePlan { ok: true; recipe: RecipeV1; ingredients: IngredientPlan[]; perPortionOverride?: Macros; warnings: string[] }
export interface RecipeFail { ok: false; index: number; name?: string; errors: FieldError[] }

const fullMacros = (m: Partial<Macros>): Macros => ({ calories: m.calories || 0, protein: m.protein || 0, carbs: m.carbs || 0, fat: m.fat || 0, fiber: m.fiber || 0 });

export function parseInput(text: string): { items: unknown[]; error?: string } {
  try { const v = JSON.parse(text); return { items: Array.isArray(v) ? v : [v] }; } catch (e) { return { items: [], error: 'Invalid JSON: ' + (e as Error).message }; }
}

/** Pure plan: validates and matches each ingredient (barcode, then normalized name, else new imported food from supplied nutrition). */
export function planImport(items: unknown[], foods: ExistingFood[]): (RecipePlan | RecipeFail)[] {
  const byBarcode = new Map(foods.filter((f) => f.barcode).map((f) => [f.barcode!, f.id]));
  const byName = new Map(foods.map((f) => [normName(f.name), f.id]));
  return items.map((raw, index) => {
    const prefix = items.length > 1 ? `[${index}]` : '';
    const errors = validateRecipe(raw, prefix);
    const name = (raw as { name?: string })?.name;
    if (errors.length) return { ok: false, index, name, errors };
    const r = raw as RecipeV1;
    const warnings: string[] = [];
    const ingredients: IngredientPlan[] = r.ingredients.map((g) => {
      const base = { text: g.text, grams: g.grams, name: g.name };
      if (g.barcode && byBarcode.has(g.barcode)) return { ...base, kind: 'existing', foodId: byBarcode.get(g.barcode)! };
      const n = byName.get(normName(g.name));
      if (n != null) return { ...base, kind: 'existing', foodId: n };
      if (g.nutrition_per_100g) return { ...base, kind: 'new', food: { name: g.name.trim(), barcode: g.barcode || undefined, ...fullMacros(g.nutrition_per_100g) } };
      return { ...base, kind: 'unresolved' };
    });
    const unresolved = ingredients.filter((i) => i.kind === 'unresolved');
    let perPortionOverride: Macros | undefined;
    if (unresolved.length) {
      if (r.nutrition_per_portion) { perPortionOverride = fullMacros(r.nutrition_per_portion); warnings.push(`No nutrition for ${unresolved.map((u) => u.name).join(', ')}; using nutrition_per_portion.`); }
      else return { ok: false, index, name, errors: unresolved.map((u) => ({ path: `${prefix ? prefix + '.' : ''}ingredients[${ingredients.indexOf(u)}].nutrition_per_100g`, message: `"${u.name}" has no matching food and no nutrition; add nutrition_per_100g or nutrition_per_portion` })) };
    }
    return { ok: true, recipe: r, ingredients, perPortionOverride, warnings };
  });
}

export const SAMPLE_RECIPE: RecipeV1 = {
  schema: 'recipe/v1', source: 'cook-bot', external_id: 'chili-2026-11-02', name: 'Turkey chili', portions: 6, cooked_weight_g: 1800,
  ingredients: [
    { text: '500 g ground turkey', name: 'Ground turkey, 93% lean', grams: 500, barcode: null, nutrition_per_100g: { calories: 150, protein: 21, carbs: 0, fat: 7, fiber: 0 } },
    { text: '2 cans kidney beans, drained', name: 'Kidney beans, canned, drained', grams: 480, barcode: null, nutrition_per_100g: { calories: 127, protein: 8.7, carbs: 22.8, fat: 0.5, fiber: 6.4 } },
    { text: '1 can crushed tomatoes', name: 'Crushed tomatoes, canned', grams: 800, barcode: null, nutrition_per_100g: { calories: 32, protein: 1.6, carbs: 7, fat: 0.3, fiber: 1.9 } },
    { text: '1 onion', name: 'Onion', grams: 150, barcode: null, nutrition_per_100g: { calories: 40, protein: 1.1, carbs: 9.3, fat: 0.1, fiber: 1.7 } },
  ],
  nutrition_per_portion: { calories: 420, protein: 38, carbs: 35, fat: 12, fiber: 9 },
  instructions: ['Brown the turkey with the onion.', 'Add beans and tomatoes, simmer 30 minutes.'], tags: ['dinner'], image_url: null,
};
