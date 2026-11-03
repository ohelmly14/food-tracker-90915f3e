import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting } from './db';
import type { Recipe, Food, Macros } from './lib/types';
import { recipePer100, perPortion, scale } from './lib/nutrition';
import { computeDrift, suggestReplacement } from './lib/drift';
import { parseInput, SAMPLE_RECIPE, type FieldError } from './lib/importer';
import { saveRecipe, deleteRecipe, setRecipeStatus, importRecipes, type ImportResult } from './actions';
import { FoodPicker, MacroLine, LogSheet } from './Add';

export function RecipesScreen({ go }: { go: (r: string) => void }) {
  const recipes = useLiveQuery(() => db.recipes.toArray(), []) || [];
  const inbox = recipes.filter((r) => r.status === 'inbox');
  return (
    <section>
      <div className="row"><h2 className="grow">Recipes</h2><button onClick={() => go('recipe/new')}>+ New</button><button className="ghost" onClick={() => go('import')}>Import</button></div>
      {inbox.length > 0 && <><h3>Imported inbox ({inbox.length})</h3><ul className="list">{inbox.map((r) => (
        <li key={r.id}><div className="grow" onClick={() => go('recipe/' + r.id)}><b>{r.name}</b><br /><small>from {r.source} · {r.ingredients.length} ingredients</small></div>
          <button className="small" onClick={() => setRecipeStatus(r.id!, 'approved')}>Approve</button>
          <button className="small ghost" onClick={() => confirm('Delete this imported recipe?') && deleteRecipe(r.id!)}>✕</button></li>))}</ul></>}
      <h3>My recipes</h3>
      <ul className="list">{recipes.filter((r) => r.status === 'approved').map((r) => <li key={r.id} onClick={() => go('recipe/' + r.id)}><b className="grow">{r.name}</b><small>{r.portions} portions</small></li>)}
        {!recipes.some((r) => r.status === 'approved') && <li className="empty">No recipes yet.</li>}</ul>
    </section>
  );
}

export function RecipeBuilder({ id, go }: { id?: number; go: (r: string) => void }) {
  const [r, setR] = useState<Recipe | null>(null);
  const [adding, setAdding] = useState(false);
  const [logging, setLogging] = useState(false);
  const foods = useLiveQuery(() => db.foods.toArray(), []) || [];
  const threshold = useLiveQuery(() => getSetting('driftThreshold', 15), []) ?? 15;
  useEffect(() => { (async () => setR(id ? (await db.recipes.get(id)) || null : { name: '', portions: 4, cookedWeightG: 0, ingredients: [], instructions: [], tags: [], source: 'mine', externalId: 'mine-' + Date.now(), status: 'approved', createdAt: Date.now() }))(); }, [id]);
  if (!r) return <p>Loading…</p>;
  const fm = new Map(foods.map((f) => [f.id!, f]));
  const raw = r.ingredients.reduce((a, i) => a + i.grams, 0);
  const cw = r.cookedWeightG || raw;
  const per100: Macros = r.perPortionOverride ? scale(r.perPortionOverride, 10000 / (cw / r.portions)) : recipePer100(r.ingredients.map((i) => ({ per100: fm.get(i.foodId) || scale({ calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }, 0), grams: i.grams })), cw);
  const pp = perPortion(per100, cw, r.portions);
  const linked = r.foodId ? fm.get(r.foodId) : undefined;
  const packaged = foods.filter((f) => !f.recipeId && f.source !== 'mine' || (f.source === 'mine' && f.brand));
  const replaces = linked?.replacesFoodId ? fm.get(linked.replacesFoodId) : undefined;
  const suggestion = linked && !linked.replacesConfirmed ? suggestReplacement(r.name, r.tags, packaged.filter((f) => !r.ingredients.some((i) => i.foodId === f.id))) : undefined;
  const drift = replaces ? computeDrift(per100, replaces, threshold / 100) : [];
  const upd = (p: Partial<Recipe>) => setR({ ...r, ...p });
  async function save() { if (!r!.name.trim()) return alert('Name required'); if (!r!.ingredients.length) return alert('Add at least one ingredient'); const nid = await saveRecipe({ ...r!, cookedWeightG: r!.cookedWeightG || raw }); go('recipe/' + nid); setR(await db.recipes.get(nid) || null); }
  return (
    <section>
      <button className="ghost" onClick={() => go('recipes')}>‹ Recipes</button>
      {r.status === 'inbox' && <p className="warn">Imported from {r.source}; awaiting approval. <button className="small" onClick={async () => { await setRecipeStatus(r.id!, 'approved'); upd({ status: 'approved' }); }}>Approve</button></p>}
      <label>Name<input value={r.name} onChange={(e) => upd({ name: e.target.value })} /></label>
      <div className="row">
        <label>Portions<input type="number" value={r.portions} onChange={(e) => upd({ portions: Math.max(1, +e.target.value) })} /></label>
        <label>Cooked weight (g)<input type="number" placeholder={String(raw)} value={r.cookedWeightG || ''} onChange={(e) => upd({ cookedWeightG: +e.target.value })} /></label>
      </div>
      <label>Tags (comma separated)<input value={r.tags.join(', ')} onChange={(e) => upd({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></label>
      <h3>Ingredients</h3>
      <ul className="list">{r.ingredients.map((i, k) => (
        <li key={k}><div className="grow">{fm.get(i.foodId)?.name || '?'}{i.text && <><br /><small>{i.text}</small></>}</div>
          <input className="w80" type="number" value={i.grams} onChange={(e) => upd({ ingredients: r.ingredients.map((x, j) => (j === k ? { ...x, grams: +e.target.value } : x)) })} />g
          <button className="ghost" onClick={() => upd({ ingredients: r.ingredients.filter((_, j) => j !== k) })}>✕</button></li>))}</ul>
      <button className="ghost" onClick={() => setAdding(true)}>+ Ingredient (search or scan)</button>
      {r.perPortionOverride && <p className="hint">Nutrition uses the importer's per-portion values (some ingredients had none).</p>}
      <div className="card"><b>Per portion</b> ({Math.round(cw / r.portions)} g): <MacroLine m={pp} /><br /><small>Per 100 g: <MacroLine m={per100} /></small></div>
      {drift.length > 0 && <div className="warn">Drift vs {replaces!.name}: {drift.map((d) => `${d.key} ${d.recipe} vs ${d.packaged} (${d.pct > 0 ? '+' : ''}${Math.round(d.pct * 100)}%)`).join('; ')}. Informational only.</div>}
      {replaces && !drift.length && <p className="hint">Replaces {replaces.name}: within {threshold}%.</p>}
      {suggestion && <div className="card">Does this recipe replace <b>{suggestion.name}</b>? <button className="small" onClick={() => db.foods.update(linked!.id!, { replacesFoodId: suggestion.id, replacesConfirmed: true })}>Yes, link</button><button className="small ghost" onClick={() => db.foods.update(linked!.id!, { replacesConfirmed: true })}>No</button></div>}
      {linked && <label>Replaces packaged food<select value={linked.replacesFoodId ?? ''} onChange={(e) => db.foods.update(linked.id!, { replacesFoodId: e.target.value ? +e.target.value : undefined, replacesConfirmed: true })}><option value="">(none)</option>{packaged.map((f) => <option key={f.id} value={f.id}>{f.name}{f.brand ? ' · ' + f.brand : ''}</option>)}</select></label>}
      <h3>Instructions</h3>
      <textarea rows={4} value={r.instructions.join('\n')} onChange={(e) => upd({ instructions: e.target.value.split('\n') })} />
      <div className="row"><button onClick={save}>Save</button>{r.foodId && r.status === 'approved' && <button className="ghost" onClick={() => setLogging(true)}>Log this</button>}
        {r.id && <button className="ghost" onClick={async () => { if (confirm('Delete recipe?')) { await deleteRecipe(r.id!); go('recipes'); } }}>Delete</button>}</div>
      {adding && <div className="modal"><div className="sheet"><FoodPicker allowRecipes={false} onPick={(fid, g) => { upd({ ingredients: [...r.ingredients, { foodId: fid, grams: g || 100 }] }); setAdding(false); }} /><button className="ghost" onClick={() => setAdding(false)}>Close</button></div></div>}
      {logging && r.foodId && <div className="modal"><div className="sheet"><LogSheet foodId={r.foodId} onDone={() => setLogging(false)} /></div></div>}
    </section>
  );
}

function b64urlDecode(s: string) { const b = s.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4)); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); }

export function ImportScreen({ data, go }: { data?: string; go: (r: string) => void }) {
  const [text, setText] = useState('');
  const [res, setRes] = useState<ImportResult | null>(null);
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  useEffect(() => { if (data) { try { setText(b64urlDecode(data)); } catch { setErr('Could not decode the import link data (expected base64url JSON).'); } } }, [data]);
  async function run(t = text) {
    setErr(''); setRes(null);
    const { items, error } = parseInput(t); if (error) return setErr(error);
    setRes(await importRecipes(items));
  }
  async function file(f?: File) { if (!f) return; const t = await f.text(); setText(t); run(t); }
  const sampleHref = URL.createObjectURL(new Blob([JSON.stringify(SAMPLE_RECIPE, null, 2)], { type: 'application/json' }));
  return (
    <section onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); file(e.dataTransfer.files[0]); }} className={drag ? 'drag' : ''}>
      <h2>Import recipes (recipe/v1)</h2>
      <p className="hint">Paste JSON (one recipe or an array), choose a .json file, or drop it here. Imports land in the Imported inbox unless the source is auto-approved in Settings. Re-importing the same source + external_id updates it.</p>
      <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"schema":"recipe/v1", ...}' />
      <div className="row"><button onClick={() => run()}>Import</button><input type="file" accept=".json,application/json" onChange={(e) => file(e.target.files?.[0])} /></div>
      <p><a href={sampleHref} download="recipe-v1-sample.json">Download sample recipe-v1 file</a> · <button className="ghost small" onClick={() => setText(JSON.stringify(SAMPLE_RECIPE, null, 2))}>Paste sample</button></p>
      {err && <p className="warn">{err}</p>}
      {res && <div className="card">
        <p>Created {res.created}, updated {res.updated}, failed {res.failures.length}.</p>
        {res.warnings.map((w, i) => <p key={i} className="hint">{w}</p>)}
        {res.failures.map((f) => <div key={f.index} className="warn"><b>Recipe {f.index + 1}{f.name ? ` (${f.name})` : ''}</b><ul>{f.errors.map((e: FieldError, i) => <li key={i}><code>{e.path}</code>: {e.message}</li>)}</ul></div>)}
        {(res.created + res.updated > 0) && <button onClick={() => go('recipes')}>Go to recipes</button>}
      </div>}
    </section>
  );
}
export type { Food };
