import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { FoodPicker, MacroLine } from './Add';
import { rankRecipes } from './lib/pantry';
import { perPortion, sum, activeTarget, ymd } from './lib/nutrition';
import { MACRO_KEYS, type Macros } from './lib/types';
import { recipeMacros } from './actions';

export function PantryScreen({ go }: { go: (r: string) => void }) {
  const items = useLiveQuery(() => db.pantryItems.toArray(), []) || [];
  const foods = useLiveQuery(() => db.foods.toArray(), []) || [];
  const shopping = useLiveQuery(() => db.shopping.orderBy('createdAt').toArray(), []) || [];
  const ranked = useLiveQuery(async () => {
    const recipes = await db.recipes.where('status').equals('approved').toArray();
    const fm = new Map((await db.foods.toArray()).map((f) => [f.id!, f]));
    const lite = await Promise.all(recipes.map(async (r) => ({ id: r.id!, name: r.name, ingredients: r.ingredients.map((i) => ({ ...i, name: fm.get(i.foodId)?.name })), perPortion: perPortion(await recipeMacros(r), r.cookedWeightG, r.portions) })));
    const pantry = await db.pantryItems.toArray();
    const onHand = new Map<number, number>(); for (const p of pantry) onHand.set(p.foodId, (onHand.get(p.foodId) || 0) + p.gramsOnHand);
    const staples = new Set(pantry.filter((p) => p.isStaple).map((p) => p.foodId));
    const today = ymd(); const t = activeTarget(await db.targets.toArray(), today);
    const eaten = sum(await db.entries.where('date').equals(today).toArray());
    const remaining = {} as Macros; for (const k of MACRO_KEYS) remaining[k] = t ? t[k] - eaten[k] : 0;
    return rankRecipes(lite, onHand, remaining, staples);
  }, [items]) || [];
  const [adding, setAdding] = useState(false);
  const fm = new Map(foods.map((f) => [f.id!, f]));
  const today = ymd();
  return (
    <section>
      <div className="row"><h2 className="grow">Pantry</h2><button onClick={() => setAdding(true)}>+ Add / scan</button></div>
      <ul className="list">{items.map((p) => (
        <li key={p.id}><div className="grow"><b>{fm.get(p.foodId)?.name}</b>{p.expiry && <small className={p.expiry < today ? 'warn' : ''}> · exp {p.expiry}</small>}</div>
          <input className="w80" type="number" value={p.gramsOnHand} onChange={(e) => db.pantryItems.update(p.id!, { gramsOnHand: Math.max(0, +e.target.value) })} />g
          <input type="date" className="w130" value={p.expiry || ''} onChange={(e) => db.pantryItems.update(p.id!, { expiry: e.target.value || undefined })} />
          <label className="inline"><input type="checkbox" checked={!!p.isStaple} onChange={(e) => db.pantryItems.update(p.id!, { isStaple: e.target.checked })} />staple</label>
          <button className="ghost" onClick={() => db.pantryItems.delete(p.id!)}>✕</button></li>))}
        {!items.length && <li className="empty">Pantry is empty.</li>}</ul>
      <h3>Cook something</h3>
      <ul className="list">{ranked.slice(0, 10).map((r) => (
        <li key={r.recipe.id} className="col"><div className="row"><b className="grow" onClick={() => go('recipe/' + r.recipe.id)}>{r.recipe.name}</b><small>{r.missing.length ? `missing ${r.missing.length}` : 'all on hand'}</small></div>
          <small><MacroLine m={r.recipe.perPortion} /> per portion</small>
          {r.missing.map((m) => <div key={m.foodId} className="row"><small className="grow">Need {m.name} ({m.grams} g)</small><button className="small" onClick={() => db.shopping.add({ name: m.name || 'item', foodId: m.foodId, createdAt: Date.now() })}>+ list</button></div>)}
        </li>))}{!ranked.length && <li className="empty">No approved recipe is covered (or missing ≤ 2 items) by your pantry.</li>}</ul>
      <h3>Shopping list</h3>
      <ul className="list">{shopping.map((s) => <li key={s.id}><label className="grow inline"><input type="checkbox" checked={!!s.done} onChange={(e) => db.shopping.update(s.id!, { done: e.target.checked })} /> <span className={s.done ? 'done' : ''}>{s.name}</span></label><button className="ghost" onClick={() => db.shopping.delete(s.id!)}>✕</button></li>)}
        {!shopping.length && <li className="empty">Empty.</li>}</ul>
      <ShopAdd />
      {adding && <div className="modal"><div className="sheet"><FoodPicker allowRecipes={false} onPick={async (fid, g) => { await db.pantryItems.add({ foodId: fid, gramsOnHand: g || 500 }); setAdding(false); }} /><button className="ghost" onClick={() => setAdding(false)}>Close</button></div></div>}
    </section>
  );
}
function ShopAdd() { const [t, setT] = useState(''); return <form className="row" onSubmit={(e) => { e.preventDefault(); if (t.trim()) db.shopping.add({ name: t.trim(), createdAt: Date.now() }); setT(''); }}><input className="grow" value={t} onChange={(e) => setT(e.target.value)} placeholder="Add item" /><button>Add</button></form>; }
