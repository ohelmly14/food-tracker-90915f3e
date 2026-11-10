import { db, getSetting, TABLES } from './db';
import type { Food, Recipe, Entry, Macros, Serving } from './lib/types';
import { scale, recipePer100, ymd, activeTarget } from './lib/nutrition';
import { planImport, type RecipePlan, type RecipeFail } from './lib/importer';
import { proposeTargets } from './lib/suggest';
import { barcodeVariants } from './lib/barcode';
import type { OffFood } from './off';

export async function addFood(f: Omit<Food, 'id' | 'createdAt'>, servings: { label: string; grams: number }[] = []): Promise<number> {
  const id = await db.foods.add({ ...f, createdAt: Date.now() } as Food);
  let def: number | undefined;
  for (const [i, s] of servings.entries()) { const sid = await db.servings.add({ foodId: id, label: s.label, grams: s.grams, isDefault: i === 0 }); if (i === 0) def = sid; }
  if (def) await db.foods.update(id, { defaultServingId: def });
  return id;
}
/** Match a scanned code against foods saved as UPC-A or as EAN-13 with a leading zero. */
export async function findByBarcode(code: string): Promise<Food | undefined> {
  for (const c of barcodeVariants(code)) {
    const hit = await db.foods.where('barcode').equals(c).first();
    if (hit) return hit;
  }
  return undefined;
}
export async function saveOffFood(o: OffFood, source: 'barcode' | 'search'): Promise<number> {
  if (o.food.barcode) { const ex = await db.foods.where('barcode').equals(o.food.barcode).first(); if (ex) return ex.id!; }
  return addFood({ ...o.food, source }, o.servingG ? [{ label: o.servingLabel || `${o.servingG} g`, grams: o.servingG }] : []);
}

export async function logFood(foodId: number, grams: number, quantity: number, servingId?: number, date = ymd(), mealSlot?: string): Promise<number> {
  const f = await db.foods.get(foodId); if (!f) throw new Error('food missing');
  const m = scale(f, grams);
  const e: Entry = { datetime: Date.now(), date, mealSlot: mealSlot || slotNow(), foodId, recipeId: f.recipeId, servingId, quantity, grams, name: f.name, ...m };
  const id = await db.entries.add(e);
  if (f.recipeId) await onRecipeLogged(f.recipeId, grams, date);
  return id;
}
export function slotNow(d = new Date()) { const h = d.getHours(); return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack'; }

/** Recipe logged: update today's cooked record; on first log of the day subtract one batch of ingredients from pantry (clamped at 0). */
async function onRecipeLogged(recipeId: number, grams: number, date: string) {
  const r = await db.recipes.get(recipeId); if (!r) return;
  const portionG = r.cookedWeightG / r.portions; const eaten = grams / portionG;
  const rec = await db.cookedRecords.where({ recipeId }).filter((c) => c.date === date).first();
  if (rec) { await db.cookedRecords.update(rec.id!, { portionsEaten: Math.round((rec.portionsEaten + eaten) * 100) / 100 }); return; }
  await db.cookedRecords.add({ recipeId, date, portionsMade: r.portions, portionsEaten: Math.round(eaten * 100) / 100 });
  for (const ing of r.ingredients) {
    let need = ing.grams;
    for (const p of await db.pantryItems.where('foodId').equals(ing.foodId).toArray()) {
      if (need <= 0) break; const take = Math.min(p.gramsOnHand, need); need -= take;
      await db.pantryItems.update(p.id!, { gramsOnHand: Math.max(0, p.gramsOnHand - take) });
    }
  }
}

export async function recipeMacros(r: Recipe): Promise<Macros> {
  if (r.perPortionOverride) return scale(r.perPortionOverride, 10000 / (r.cookedWeightG / r.portions));
  const foods = await db.foods.bulkGet(r.ingredients.map((i) => i.foodId));
  return recipePer100(r.ingredients.map((i, k) => ({ per100: foods[k] || { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }, grams: i.grams })), r.cookedWeightG);
}
/** Save a recipe and keep its linked food row (per-100g + "1 portion" serving) in sync so it logs like any food. */
export async function saveRecipe(r: Recipe): Promise<number> {
  if (!r.cookedWeightG) r.cookedWeightG = r.ingredients.reduce((a, i) => a + i.grams, 0);
  const id = r.id ? (await db.recipes.put(r), r.id) : await db.recipes.add(r);
  const per100 = await recipeMacros(r);
  const fields = { name: r.name, source: 'recipe' as const, recipeId: id, hidden: r.status === 'inbox' ? 1 : 0, ...per100 };
  let foodId = r.foodId;
  const existing = foodId ? await db.foods.get(foodId) : undefined;
  if (existing) await db.foods.update(foodId!, fields);
  else { foodId = await db.foods.add({ ...fields, createdAt: Date.now() } as Food); await db.recipes.update(id, { foodId }); }
  const portionG = Math.round((r.cookedWeightG / r.portions) * 10) / 10;
  const sv = await db.servings.where('foodId').equals(foodId!).first();
  if (sv) await db.servings.update(sv.id!, { grams: portionG, label: '1 portion' });
  else { const sid = await db.servings.add({ foodId: foodId!, label: '1 portion', grams: portionG, isDefault: true }); await db.foods.update(foodId!, { defaultServingId: sid }); }
  return id;
}
export async function deleteRecipe(id: number) { const r = await db.recipes.get(id); if (r?.foodId) await db.foods.update(r.foodId, { hidden: 1 }); await db.recipes.delete(id); }
export async function setRecipeStatus(id: number, status: Recipe['status']) { const r = await db.recipes.get(id); if (r) await saveRecipe({ ...r, status }); }

export interface ImportResult { created: number; updated: number; failures: RecipeFail[]; warnings: string[] }
export async function importRecipes(items: unknown[]): Promise<ImportResult> {
  const foods = (await db.foods.toArray()).filter((f) => !f.recipeId && !(f.importedFlag && !f.calories)).map((f) => ({ id: f.id!, name: f.name, barcode: f.barcode }));
  const plans = planImport(items, foods);
  const auto = await getSetting<Record<string, boolean>>('autoApprove', {});
  const res: ImportResult = { created: 0, updated: 0, failures: [], warnings: [] };
  for (const p of plans) {
    if (!p.ok) { res.failures.push(p); continue; }
    await applyPlan(p, auto, res);
  }
  return res;
}
async function applyPlan(p: RecipePlan, auto: Record<string, boolean>, res: ImportResult) {
  const r = p.recipe; const ings = [];
  for (const i of p.ingredients) {
    let foodId: number;
    if (i.kind === 'existing') foodId = i.foodId;
    else if (i.kind === 'new') {
      const again = await db.foods.filter((f) => !f.recipeId && f.name.toLowerCase().trim() === i.food.name.toLowerCase()).first(); // dedupe within batch
      foodId = again?.id ?? (await addFood({ ...i.food, source: 'imported', importedFlag: true }));
    } else foodId = (await addFood({ name: i.name, source: 'imported', importedFlag: true, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }));
    ings.push({ foodId, grams: i.grams, text: i.text });
  }
  const existing = await db.recipes.where('[source+externalId]').equals([r.source, r.external_id]).first();
  const totalRaw = ings.reduce((a, i) => a + i.grams, 0);
  const rec: Recipe = {
    ...(existing || {}), name: r.name, portions: r.portions, cookedWeightG: r.cooked_weight_g || totalRaw, ingredients: ings,
    instructions: r.instructions || [], tags: r.tags || [], imageUrl: r.image_url || undefined, source: r.source, externalId: r.external_id,
    status: existing?.status === 'approved' || auto[r.source] ? 'approved' : 'inbox', createdAt: existing?.createdAt || Date.now(), perPortionOverride: p.perPortionOverride,
  };
  await saveRecipe(rec);
  if (existing) res.updated++; else res.created++;
  res.warnings.push(...p.warnings.map((w) => `${r.name}: ${w}`));
}


export async function copyDay(from: string, to = ymd(), slot?: string) {
  const list = await db.entries.where('date').equals(from).toArray();
  for (const e of list.filter((x) => !slot || x.mealSlot === slot)) {
    const { id: _id, ...rest } = e; void _id;
    await db.entries.add({ ...rest, date: to, datetime: Date.now() });
  }
}
export async function relogEntry(e: Entry, to = ymd()) { const { id: _id, ...rest } = e; void _id; await db.entries.add({ ...rest, date: to, datetime: Date.now(), mealSlot: slotNow() }); }

export async function runDailyJobs() {
  const today = ymd();
  if ((await getSetting('lastSuggestRun', '')) === today) return;
  await db.settings.put({ key: 'lastSuggestRun', value: today });
  if (await db.targetSuggestions.where('status').equals('pending').count()) return;
  const t = activeTarget(await db.targets.toArray(), today);
  const p = proposeTargets(await db.entries.toArray(), await db.cookedRecords.toArray(), t, today);
  if (p) await db.targetSuggestions.add({ createdAt: Date.now(), reason: p.reason, proposed: p.proposed, status: 'pending' });
}

export async function exportAll() { const out: Record<string, unknown> = { app: 'food-tracker', version: 1, exportedAt: new Date().toISOString() }; for (const t of TABLES) out[t] = await db.table(t).toArray(); return out; }
export async function restoreAll(data: Record<string, unknown>) {
  if (data.app !== 'food-tracker') throw new Error('Not a food-tracker backup');
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => { for (const t of TABLES) { await db.table(t).clear(); if (Array.isArray(data[t])) await db.table(t).bulkAdd(data[t] as object[]); } });
}
export async function wipeAll() { await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => { for (const t of TABLES) await db.table(t).clear(); }); }

export async function loadSampleData() {
  const d = ymd();
  if (!(await db.targets.count())) await db.targets.add({ startDate: '2000-01-01', calories: 2000, protein: 140, carbs: 200, fat: 70, fiber: 30 });
  const oats = await addFood({ name: 'Rolled oats (SAMPLE)', source: 'mine', calories: 379, protein: 13, carbs: 68, fat: 6.5, fiber: 10 }, [{ label: '1/2 cup', grams: 40 }]);
  const yog = await addFood({ name: 'Greek yogurt 2% (SAMPLE)', source: 'mine', calories: 73, protein: 10, carbs: 4, fat: 2, fiber: 0 }, [{ label: '1 cup', grams: 227 }]);
  const chk = await addFood({ name: 'Chicken breast, cooked (SAMPLE)', source: 'mine', calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0 });
  const rice = await addFood({ name: 'White rice, cooked (SAMPLE)', source: 'mine', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4 }, [{ label: '1 cup', grams: 158 }]);
  await db.pantryItems.bulkAdd([{ foodId: chk, gramsOnHand: 600 }, { foodId: rice, gramsOnHand: 1000, isStaple: true }, { foodId: oats, gramsOnHand: 500 }]);
  await saveRecipe({ name: 'Chicken rice bowl (SAMPLE)', portions: 2, cookedWeightG: 700, ingredients: [{ foodId: chk, grams: 300 }, { foodId: rice, grams: 400 }], instructions: ['Combine.'], tags: ['lunch'], source: 'mine', externalId: 'sample-' + Date.now(), status: 'approved', createdAt: Date.now() });
  await logFood(oats, 40, 1, (await db.servings.where('foodId').equals(oats).first())?.id, d, 'breakfast');
  await logFood(yog, 227, 1, (await db.servings.where('foodId').equals(yog).first())?.id, d, 'breakfast');
}
export type { Serving };
