import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { Food, Macros } from './lib/types';
import { MACRO_KEYS } from './lib/types';
import { parseShortcut, normName } from './lib/parse';
import { recentFoodIds, frequentFoodIds, portionHabit } from './lib/portions';
import { scale } from './lib/nutrition';
import { lookupNotice, normalizeBarcode } from './lib/barcode';
import { offByBarcode, offSearch, type OffFood } from './off';
import { addFood, findByBarcode, logFood, saveOffFood } from './actions';
import { Scanner } from './Scanner';

export const MacroLine = ({ m }: { m: Macros }) => (
  <span className="macros">{Math.round(m.calories)} kcal · P {Math.round(m.protein)} · C {Math.round(m.carbs)} · F {Math.round(m.fat)} · Fi {Math.round(m.fiber)}</span>
);

async function usualPortion(foodId: number) {
  const h = portionHabit(await db.entries.where('foodId').equals(foodId).toArray(), foodId);
  if (h.common) return h.common;
  const f = await db.foods.get(foodId);
  const s = f?.defaultServingId ? await db.servings.get(f.defaultServingId) : undefined;
  return s ? { quantity: 1, servingId: s.id, grams: s.grams } : { quantity: 100, servingId: undefined, grams: 100 };
}
export async function quickLog(foodId: number) { const p = await usualPortion(foodId); await logFood(foodId, p.grams, p.quantity, p.servingId); }

/** Unified search: my foods (and recipe foods) first, then Open Food Facts; Recent/Frequent/Recipes tabs; scan. */
export function FoodPicker({ onPick, quick, allowRecipes = true }: { onPick: (foodId: number, grams?: number) => void; quick?: boolean; allowRecipes?: boolean }) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'recent' | 'frequent' | 'recipes'>('recent');
  const [off, setOff] = useState<OffFood[] | null>(null);
  const [offState, setOffState] = useState('');
  const [scan, setScan] = useState(false);
  const [draft, setDraft] = useState<{ initial: Partial<Food>; notice?: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const foods = useLiveQuery(() => db.foods.toArray(), []) || [];
  const entries = useLiveQuery(() => db.entries.orderBy('datetime').reverse().limit(500).toArray(), []) || [];
  const visible = foods.filter((f) => !f.hidden && (allowRecipes || !f.recipeId));
  const byId = new Map(visible.map((f) => [f.id!, f]));
  const { grams, query } = parseShortcut(q);
  const local = useMemo(() => {
    const toks = normName(query).split(' ').filter(Boolean);
    if (!toks.length) return [];
    return visible.filter((f) => { const n = normName(`${f.name} ${f.brand || ''}`); return toks.every((t) => n.includes(t)); }).slice(0, 30);
  }, [query, foods]); // eslint-disable-line
  useEffect(() => {
    setOff(null); setOffState('');
    if (query.length < 3) return;
    if (!navigator.onLine) { setOffState('Offline: showing only your foods.'); return; }
    const t = setTimeout(async () => { setOffState('Searching Open Food Facts…'); const r = await offSearch(query); setOff(r); setOffState(r.length ? '' : 'No online results (or Open Food Facts unreachable).'); }, 600);
    return () => clearTimeout(t);
  }, [query]);
  const list: Food[] = query ? local : tab === 'recent' ? recentFoodIds(entries).map((i) => byId.get(i)!).filter(Boolean)
    : tab === 'frequent' ? frequentFoodIds(entries).map((i) => byId.get(i)!).filter(Boolean) : visible.filter((f) => f.recipeId);
  const flash = (s: string) => { setToast(s); setTimeout(() => setToast(''), 1800); };
  async function onCode(code: string) {
    setScan(false);
    const digits = code.replace(/\D/g, '');
    const canonical = normalizeBarcode(code) ?? (digits || code.trim());
    if (!canonical) return;
    const localMatch = await findByBarcode(canonical);
    if (localMatch?.id) return onPick(localMatch.id);
    setBusy('Looking up ' + canonical + '…');
    const hit = await offByBarcode(canonical);
    setBusy('');
    if (hit.kind === 'found') return onPick(await saveOffFood(hit.food, 'barcode'));
    const initial: Partial<Food> = { barcode: hit.kind === 'incomplete' && hit.barcode ? hit.barcode : canonical, source: 'barcode' };
    if (hit.kind === 'incomplete') {
      if (hit.name) initial.name = hit.name;
      if (hit.brand) initial.brand = hit.brand;
    }
    setDraft({ initial, notice: lookupNotice(hit.kind, canonical, hit.kind === 'incomplete' ? hit.name : undefined) });
  }
  return (
    <div>
      <div className="row">
        <input autoFocus className="grow" placeholder='Search or "200 chicken"' value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={() => setScan(true)} title="Scan barcode">▥ Scan</button>
      </div>
      {grams && <p className="hint">Will use {grams} g</p>}
      {!query && <div className="tabs">{(['recent', 'frequent', ...(allowRecipes ? ['recipes'] : [])] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t as typeof tab)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>}
      <ul className="list">
        {list.map((f) => (
          <li key={f.id} onClick={() => onPick(f.id!, grams)}>
            <div className="grow"><b>{f.name}</b>{f.brand && <small> · {f.brand}</small>}{f.recipeId && <small className="tag">recipe</small>}<br /><small><MacroLine m={f} /> /100g</small></div>
            {quick && <button className="small" onClick={async (e) => { e.stopPropagation(); if (grams) await logFood(f.id!, grams, grams); else await quickLog(f.id!); flash('Logged ' + f.name); }}>+ usual</button>}
          </li>
        ))}
        {!list.length && !query && <li className="empty">Nothing here yet. Search, scan, or add a food.</li>}
        {query && <li className="empty" onClick={() => setDraft({ initial: { name: query } })}>+ Create “{query}” as my food</li>}
      </ul>
      {query && <>
        <h4>Open Food Facts</h4>{offState && <p className="hint">{offState}</p>}
        <ul className="list">{(off || []).map((o, i) => (
          <li key={i} onClick={async () => onPick(await saveOffFood(o, 'search'), grams)}>
            <div className="grow"><b>{o.food.name}</b>{o.food.brand && <small> · {o.food.brand}</small>}<br /><small><MacroLine m={o.food} /> /100g</small></div>
          </li>))}</ul>
      </>}
      {busy && <p className="hint" role="status">{busy}</p>}
      {scan && <Scanner onResult={onCode} onClose={() => setScan(false)} />}
      {draft && <div className="modal"><div className="sheet"><FoodForm initial={draft.initial} notice={draft.notice} onDone={(id) => { setDraft(null); if (id) onPick(id); }} /></div></div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export function FoodForm({ initial, onDone, notice }: { initial: Partial<Food>; onDone: (id?: number) => void; notice?: string }) {
  const [f, setF] = useState<Partial<Food>>({ source: 'mine', calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, ...initial });
  const existingServ = useLiveQuery(() => (initial.id ? db.servings.where('foodId').equals(initial.id).toArray() : Promise.resolve([] as { id?: number; label: string; grams: number }[])), [initial.id]);
  const [servs, setServs] = useState<{ id?: number; label: string; grams: number }[] | null>(null);
  const sv = servs ?? existingServ ?? [];
  const set = (k: keyof Food, v: unknown) => setF({ ...f, [k]: v });
  async function save() {
    if (!f.name?.trim()) return alert('Name required');
    const clean = { name: f.name.trim(), brand: f.brand || undefined, barcode: f.barcode || undefined, source: f.source!, calories: +f.calories! || 0, protein: +f.protein! || 0, carbs: +f.carbs! || 0, fat: +f.fat! || 0, fiber: +f.fiber! || 0 };
    const valid = sv.filter((s) => s.label && s.grams > 0);
    if (!initial.id) return onDone(await addFood(clean, valid));
    await db.foods.update(initial.id, clean);
    const keep = valid.filter((s) => s.id).map((s) => s.id!);
    await db.servings.where('foodId').equals(initial.id).filter((s) => !keep.includes(s.id!)).delete();
    for (const s of valid) s.id ? await db.servings.update(s.id, { label: s.label, grams: s.grams }) : await db.servings.add({ foodId: initial.id, label: s.label, grams: s.grams });
    const first = await db.servings.where('foodId').equals(initial.id).first();
    await db.foods.update(initial.id, { defaultServingId: first?.id });
    onDone(initial.id);
  }
  return (
    <div className="form">
      <h3>{initial.id ? 'Edit food' : notice ? 'Save this barcode' : 'New food'}</h3>
      {notice && <p className="card">{notice}</p>}
      <label>Name<input value={f.name || ''} onChange={(e) => set('name', e.target.value)} /></label>
      <div className="row"><label>Brand<input value={f.brand || ''} onChange={(e) => set('brand', e.target.value)} /></label>
        <label>Barcode<input value={f.barcode || ''} onChange={(e) => set('barcode', e.target.value)} /></label></div>
      <p className="hint">Per 100 g</p>
      <div className="grid5">{MACRO_KEYS.map((k) => <label key={k}>{k}<input type="number" inputMode="decimal" value={f[k] ?? 0} onChange={(e) => set(k, e.target.value)} /></label>)}</div>
      <p className="hint">Servings (first is default)</p>
      {sv.map((s, i) => (
        <div className="row" key={i}>
          <input placeholder="label e.g. 1 cup" value={s.label} onChange={(e) => setServs(sv.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <input type="number" placeholder="grams" value={s.grams || ''} onChange={(e) => setServs(sv.map((x, j) => (j === i ? { ...x, grams: +e.target.value } : x)))} />
          <button className="ghost" onClick={() => setServs(sv.filter((_, j) => j !== i))}>✕</button>
        </div>))}
      <button className="ghost" onClick={() => setServs([...sv, { label: '', grams: 0 }])}>+ serving</button>
      <div className="row"><button onClick={save}>Save</button><button className="ghost" onClick={() => onDone()}>Cancel</button></div>
    </div>
  );
}

/** Food detail / log sheet: pick serving, quantity, live macros. */
export function LogSheet({ foodId, grams: initGrams, onDone }: { foodId: number; grams?: number; onDone: () => void }) {
  const food = useLiveQuery(() => db.foods.get(foodId), [foodId]);
  const servings = useLiveQuery(() => db.servings.where('foodId').equals(foodId).toArray(), [foodId]) || [];
  const [servingId, setServingId] = useState<number | undefined>();
  const [qty, setQty] = useState<number>(100);
  const [ready, setReady] = useState(false);
  const [edit, setEdit] = useState(false);
  const [habit, setHabit] = useState<{ quantity: number; servingId?: number }[]>([]);
  useEffect(() => { (async () => {
    const h = portionHabit(await db.entries.where('foodId').equals(foodId).toArray(), foodId);
    setHabit(h.last);
    if (initGrams) { setServingId(undefined); setQty(initGrams); }
    else { const u = await usualPortion(foodId); setServingId(u.servingId); setQty(u.quantity); }
    setReady(true);
  })(); }, [foodId, initGrams]);
  if (!food || !ready) return null;
  const sv = servings.find((s) => s.id === servingId);
  const grams = sv ? sv.grams * qty : qty;
  const m = scale(food, grams);
  if (edit) return <FoodForm initial={food} onDone={() => setEdit(false)} />;
  return (
    <div className="form">
      <h3>{food.name}</h3>{food.brand && <small>{food.brand}</small>}
      <p className="hint"><MacroLine m={food} /> per 100 g</p>
      <div className="row">
        <input type="number" inputMode="decimal" step="any" value={qty} onChange={(e) => setQty(+e.target.value)} />
        <select value={servingId ?? ''} onChange={(e) => { const id = e.target.value ? +e.target.value : undefined; setServingId(id); setQty(id ? 1 : 100); }}>
          <option value="">grams</option>{servings.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.grams} g)</option>)}
        </select>
      </div>
      {habit.length > 0 && <div className="chips">Recent: {habit.map((h, i) => <button key={i} className="chip" onClick={() => { setServingId(h.servingId); setQty(h.quantity); }}>{h.quantity} {servings.find((s) => s.id === h.servingId)?.label || 'g'}</button>)}</div>}
      <p className="big"><MacroLine m={m} /> <small>({Math.round(grams)} g)</small></p>
      <div className="row">
        <button onClick={async () => { await logFood(foodId, grams, qty, servingId); onDone(); }}>Log</button>
        {!food.recipeId && <button className="ghost" onClick={() => setEdit(true)}>Edit food</button>}
        <button className="ghost" onClick={onDone}>Close</button>
      </div>
    </div>
  );
}

export function AddScreen({ go }: { go: (r: string) => void }) {
  const [pick, setPick] = useState<{ id: number; grams?: number } | null>(null);
  return (
    <section>
      <h2>Add food</h2>
      <FoodPicker quick onPick={(id, grams) => setPick({ id, grams })} />
      {pick && <div className="modal"><div className="sheet"><LogSheet foodId={pick.id} grams={pick.grams} onDone={() => { setPick(null); go('today'); }} /></div></div>}
    </section>
  );
}
