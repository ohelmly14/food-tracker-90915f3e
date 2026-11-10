import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { addFood, findByBarcode, logFood, saveRecipe, importRecipes, exportAll, restoreAll, wipeAll, copyDay } from './actions';
import { SAMPLE_RECIPE } from './lib/importer';
import { ymd, addDays } from './lib/nutrition';

beforeEach(async () => { await wipeAll(); });

describe('db actions (fake IndexedDB)', () => {
  it('entries keep saved nutrition after food edit', async () => {
    const id = await addFood({ name: 'Oats', source: 'mine', calories: 400, protein: 10, carbs: 60, fat: 7, fiber: 10 });
    await logFood(id, 50, 50);
    await db.foods.update(id, { calories: 1000 });
    expect((await db.entries.toArray())[0].calories).toBe(200);
  });
  it('recipe logs per portion, records cooked, subtracts pantry clamped at 0', async () => {
    const a = await addFood({ name: 'A', source: 'mine', calories: 100, protein: 10, carbs: 0, fat: 0, fiber: 0 });
    await db.pantryItems.add({ foodId: a, gramsOnHand: 300 });
    const rid = await saveRecipe({ name: 'R', portions: 2, cookedWeightG: 400, ingredients: [{ foodId: a, grams: 500 }], instructions: [], tags: [], source: 'mine', externalId: 'x', status: 'approved', createdAt: 0 });
    const r = (await db.recipes.get(rid))!;
    const food = (await db.foods.get(r.foodId!))!;
    expect(food.calories).toBe(125);
    await logFood(food.id!, 200, 1);
    expect((await db.entries.toArray())[0].calories).toBe(250);
    expect((await db.pantryItems.toArray())[0].gramsOnHand).toBe(0);
    const c = await db.cookedRecords.toArray();
    expect(c).toHaveLength(1); expect(c[0].portionsEaten).toBe(1);
  });
  it('import is idempotent and lands in inbox', async () => {
    const r1 = await importRecipes([SAMPLE_RECIPE]);
    expect(r1.created).toBe(1);
    const r2 = await importRecipes([{ ...SAMPLE_RECIPE, portions: 4 }]);
    expect(r2.updated).toBe(1);
    const all = await db.recipes.toArray();
    expect(all).toHaveLength(1); expect(all[0].portions).toBe(4); expect(all[0].status).toBe('inbox');
    expect(await db.foods.filter((f) => !!f.importedFlag).count()).toBe(4);
    expect((await db.foods.get(all[0].foodId!))!.hidden).toBe(1);
  });
  it('finds a barcode saved as EAN-13 when the scan is UPC-A', async () => {
    const id = await addFood({ name: 'Cola', source: 'barcode', barcode: '0036000291452', calories: 42, protein: 0, carbs: 10, fat: 0, fiber: 0 });
    expect((await findByBarcode('036000291452'))?.id).toBe(id);
    expect((await findByBarcode('0036000291452'))?.id).toBe(id);
    expect(await findByBarcode('0000000000000')).toBeUndefined();
  });
  it('copy yesterday, export and restore', async () => {
    const id = await addFood({ name: 'X', source: 'mine', calories: 100, protein: 0, carbs: 0, fat: 0, fiber: 0 });
    await logFood(id, 100, 100, undefined, addDays(ymd(), -1));
    await copyDay(addDays(ymd(), -1));
    expect(await db.entries.where('date').equals(ymd()).count()).toBe(1);
    const dump = JSON.parse(JSON.stringify(await exportAll()));
    await wipeAll(); expect(await db.foods.count()).toBe(0);
    await restoreAll(dump); expect(await db.entries.count()).toBe(2);
  });
});
