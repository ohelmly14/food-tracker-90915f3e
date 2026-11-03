import Dexie, { type Table } from 'dexie';
import type { Food, Serving, Recipe, Entry, Target, PantryItem, CookedRecord, TargetSuggestion, ShoppingItem, Setting } from './lib/types';

export class DB extends Dexie {
  foods!: Table<Food, number>; servings!: Table<Serving, number>; recipes!: Table<Recipe, number>; entries!: Table<Entry, number>;
  targets!: Table<Target, number>; pantryItems!: Table<PantryItem, number>; cookedRecords!: Table<CookedRecord, number>;
  targetSuggestions!: Table<TargetSuggestion, number>; shopping!: Table<ShoppingItem, number>; settings!: Table<Setting, string>;
  constructor() {
    super('food-tracker');
    this.version(1).stores({
      foods: '++id, name, barcode, source, recipeId, replacesFoodId, createdAt',
      servings: '++id, foodId', recipes: '++id, name, status, [source+externalId], foodId',
      entries: '++id, date, datetime, foodId, recipeId', targets: '++id, startDate', pantryItems: '++id, foodId',
      cookedRecords: '++id, recipeId, date', targetSuggestions: '++id, status, createdAt', shopping: '++id, createdAt', settings: 'key',
    });
  }
}
export const db = new DB();
export const TABLES = ['foods', 'servings', 'recipes', 'entries', 'targets', 'pantryItems', 'cookedRecords', 'targetSuggestions', 'shopping', 'settings'] as const;
export async function getSetting<T>(key: string, def: T): Promise<T> { const s = await db.settings.get(key); return (s?.value as T) ?? def; }
export const setSetting = (key: string, value: unknown) => db.settings.put({ key, value });
