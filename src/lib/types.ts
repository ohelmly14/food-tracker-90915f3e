export interface Macros { calories: number; protein: number; carbs: number; fat: number; fiber: number }
export const MACRO_KEYS: (keyof Macros)[] = ['calories', 'protein', 'carbs', 'fat', 'fiber'];
export type FoodSource = 'mine' | 'barcode' | 'imported' | 'search' | 'recipe';
export interface Food extends Macros {
  id?: number; name: string; brand?: string; barcode?: string; source: FoodSource;
  createdAt: number; defaultServingId?: number; importedFlag?: boolean;
  replacesFoodId?: number; recipeId?: number; hidden?: number; // hidden=1 when recipe in inbox
  replacesConfirmed?: boolean;
}
export interface Serving { id?: number; foodId: number; label: string; grams: number; isDefault?: boolean }
export interface Ingredient { foodId: number; grams: number; text?: string }
export interface Recipe {
  id?: number; name: string; portions: number; cookedWeightG: number; ingredients: Ingredient[];
  instructions: string[]; tags: string[]; imageUrl?: string; source: string; externalId: string;
  status: 'approved' | 'inbox'; createdAt: number; foodId?: number; perPortionOverride?: Macros;
}
export interface Entry extends Macros {
  id?: number; datetime: number; date: string; mealSlot?: string; foodId: number; recipeId?: number;
  servingId?: number; quantity: number; grams: number; name: string;
}
export interface Target extends Macros { id?: number; startDate: string }
export interface PantryItem { id?: number; foodId: number; gramsOnHand: number; expiry?: string; isStaple?: boolean }
export interface CookedRecord { id?: number; recipeId: number; date: string; portionsMade: number; portionsEaten: number; notes?: string }
export interface TargetSuggestion { id?: number; createdAt: number; reason: string; proposed: Macros; status: 'pending' | 'accepted' | 'dismissed' }
export interface ShoppingItem { id?: number; name: string; foodId?: number; done?: boolean; createdAt: number }
export interface Setting { key: string; value: unknown }
