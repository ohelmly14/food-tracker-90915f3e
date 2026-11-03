import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, setSetting } from './db';
import { MACRO_KEYS, type Entry, type Macros } from './lib/types';
import { activeTarget, sum, ymd, addDays, round1 } from './lib/nutrition';
import { computeDrift } from './lib/drift';
import { AddScreen, MacroLine } from './Add';
import { RecipesScreen, RecipeBuilder, ImportScreen } from './Recipes';
import { PantryScreen } from './Pantry';
import { copyDay, relogEntry, runDailyJobs, exportAll, restoreAll, wipeAll, loadSampleData } from './actions';

const useRoute = () => {
  const get = () => location.hash.replace(/^#\/?/, '') || 'today';
  const [r, setR] = useState(get());
  useEffect(() => { const f = () => setR(get()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return [r, (to: string) => { location.hash = '/' + to; }] as const;
};
const UNITS: Record<keyof Macros, string> = { calories: 'kcal', protein: 'g', carbs: 'g', fat: 'g', fiber: 'g' };

export default function App() {
  const [route, go] = useRoute();
  useEffect(() => { runDailyJobs(); }, []);
  const pending = useLiveQuery(() => db.targetSuggestions.where('status').equals('pending').count(), []) || 0;
  const inbox = useLiveQuery(() => db.recipes.where('status').equals('inbox').count(), []) || 0;
  const [path, query] = route.split('?');
  const params = new URLSearchParams(query || '');
  let screen;
  if (path === 'add') screen = <AddScreen go={go} />;
  else if (path === 'recipes') screen = <RecipesScreen go={go} />;
  else if (path.startsWith('recipe/')) { const id = path.slice(7); screen = <RecipeBuilder key={id} id={id === 'new' ? undefined : +id} go={go} />; }
  else if (path === 'import') screen = <ImportScreen data={params.get('data') || undefined} go={go} />;
  else if (path === 'pantry') screen = <PantryScreen go={go} />;
  else if (path === 'insights') screen = <Insights go={go} />;
  else if (path === 'history') screen = <History />;
  else if (path === 'settings') screen = <Settings />;
  else screen = <Today go={go} />;
  const nav: [string, string][] = [['today', 'Today'], ['add', 'Add'], ['recipes', 'Recipes' + (inbox ? ` (${inbox})` : '')], ['pantry', 'Pantry'], ['insights', 'Insights' + (pending ? ' •' : '')], ['history', 'History'], ['settings', 'Settings']];
  return (
    <div className="app">
      <nav>{nav.map(([k, l]) => <a key={k} href={'#/' + k} className={path === k || (k === 'recipes' && path.startsWith('recipe')) ? 'on' : ''}>{l}</a>)}</nav>
      <main>{screen}</main>
    </div>
  );
}

function Bars({ total, target }: { total: Macros; target?: Macros }) {
  return <div className="bars">{MACRO_KEYS.map((k) => {
    const t = target?.[k] || 0; const pct = t ? Math.min(100, (total[k] / t) * 100) : 0;
    return <div key={k} className="bar"><div className="barlabel"><span>{k}</span><span>{Math.round(total[k])}{t ? ` / ${t}` : ''} {UNITS[k]}</span></div><div className="track"><div className={'fill' + (t && total[k] > t ? ' over' : '')} style={{ width: pct + '%' }} /></div></div>;
  })}{!target && <p className="hint">No target set. <a href="#/settings">Set targets</a></p>}</div>;
}

function Today({ go }: { go: (r: string) => void }) {
  const [date, setDate] = useState(ymd());
  const entries = useLiveQuery(() => db.entries.where('date').equals(date).sortBy('datetime'), [date]) || [];
  const targets = useLiveQuery(() => db.targets.toArray(), []) || [];
  const [edit, setEdit] = useState<Entry | null>(null);
  const [msg, setMsg] = useState('');
  const total = sum(entries);
  const slots = [...new Set(entries.map((e) => e.mealSlot || 'other'))];
  const flash = (s: string) => { setMsg(s); setTimeout(() => setMsg(''), 2000); };
  return (
    <section>
      <div className="row"><button className="ghost" onClick={() => setDate(addDays(date, -1))}>‹</button><h2 className="grow center">{date === ymd() ? 'Today' : date}</h2><button className="ghost" onClick={() => setDate(addDays(date, 1))}>›</button></div>
      <Bars total={total} target={activeTarget(targets, date)} />
      <button className="add" onClick={() => go('add')}>+ Add food</button>
      <div className="row wrap">
        <button className="ghost" onClick={async () => { await copyDay(addDays(date, -1), date); flash('Copied yesterday'); }}>Copy yesterday</button>
        {date !== ymd() && entries.length > 0 && <button className="ghost" onClick={async () => { await copyDay(date, ymd()); flash('Copied to today'); }}>Copy this day to today</button>}
      </div>
      {slots.map((s) => (
        <div key={s}><div className="row"><h4 className="grow">{s}</h4><small><MacroLine m={sum(entries.filter((e) => (e.mealSlot || 'other') === s))} /></small>
          <button className="small ghost" title="Log this meal again today" onClick={async () => { for (const e of entries.filter((x) => (x.mealSlot || 'other') === s)) await relogEntry({ ...e, mealSlot: s }); flash('Repeated ' + s); }}>↻ repeat</button></div>
          <ul className="list">{entries.filter((e) => (e.mealSlot || 'other') === s).map((e) => (
            <li key={e.id} onClick={() => setEdit(e)}><div className="grow"><b>{e.name}</b> <small>{round1(e.grams)} g</small><br /><small><MacroLine m={e} /></small></div>
              <button className="ghost" title="Delete" onClick={(ev) => { ev.stopPropagation(); db.entries.delete(e.id!); }}>✕</button></li>))}</ul></div>))}
      {!entries.length && <p className="empty">Nothing logged.</p>}
      {edit && <EditEntry e={edit} onDone={() => setEdit(null)} />}
      {msg && <div className="toast">{msg}</div>}
    </section>
  );
}

function EditEntry({ e, onDone }: { e: Entry; onDone: () => void }) {
  const [g, setG] = useState(e.grams);
  const f = g / (e.grams || 1);
  const scaled = Object.fromEntries(MACRO_KEYS.map((k) => [k, round1(e[k] * f)])) as unknown as Macros;
  return <div className="modal"><div className="sheet form">
    <h3>{e.name}</h3>
    <label>Grams<input type="number" inputMode="decimal" value={g} onChange={(x) => setG(+x.target.value)} /></label>
    <label>Meal<select defaultValue={e.mealSlot} onChange={(x) => db.entries.update(e.id!, { mealSlot: x.target.value })}>{['breakfast', 'lunch', 'dinner', 'snack'].map((s) => <option key={s}>{s}</option>)}</select></label>
    <p><MacroLine m={scaled} /></p>
    <div className="row wrap">
      <button onClick={async () => { await db.entries.update(e.id!, { grams: g, quantity: round1(e.quantity * f), ...scaled }); onDone(); }}>Save</button>
      <button className="ghost" onClick={async () => { await relogEntry(e); onDone(); }}>Log again today</button>
      <button className="ghost" onClick={async () => { await db.entries.delete(e.id!); onDone(); }}>Delete</button>
      <button className="ghost" onClick={onDone}>Close</button>
    </div>
    <p className="hint">Nutrition was saved at log time; editing the food later won't change this entry.</p>
  </div></div>;
}

function Insights({ go }: { go: (r: string) => void }) {
  const sugg = useLiveQuery(() => db.targetSuggestions.orderBy('createdAt').reverse().toArray(), []) || [];
  const threshold = useLiveQuery(() => getSetting('driftThreshold', 15), []) ?? 15;
  const drifts = useLiveQuery(async () => {
    const foods = await db.foods.toArray(); const fm = new Map(foods.map((f) => [f.id!, f]));
    return foods.filter((f) => f.recipeId && f.replacesFoodId && fm.get(f.replacesFoodId)).map((f) => ({ f, p: fm.get(f.replacesFoodId!)!, d: computeDrift(f, fm.get(f.replacesFoodId!)!, threshold / 100) })).filter((x) => x.d.length);
  }, [threshold]) || [];
  return (
    <section>
      <h2>Insights</h2>
      <h3>Target suggestions</h3>
      <p className="hint">Checked at most once a day on app open; needs about 3 weeks of logs. Targets never change unless you accept.</p>
      <ul className="list">{sugg.map((s) => <li key={s.id} className="col">
        <p>{s.reason}</p><small>Proposed: <MacroLine m={s.proposed} /></small>
        {s.status === 'pending' ? <div className="row">
          <button className="small" onClick={async () => { await db.targets.add({ startDate: ymd(), ...pick(s.proposed) }); await db.targetSuggestions.update(s.id!, { status: 'accepted' }); }}>Accept (starts today)</button>
          <button className="small ghost" onClick={() => db.targetSuggestions.update(s.id!, { status: 'dismissed' })}>Dismiss</button></div> : <small>{s.status}</small>}
      </li>)}{!sugg.length && <li className="empty">No suggestions yet.</li>}</ul>
      <button className="ghost small" onClick={async () => { await setSetting('lastSuggestRun', ''); await runDailyJobs(); }}>Check now</button>
      <h3>Recipe drift</h3>
      <ul className="list">{drifts.map(({ f, p, d }) => <li key={f.id} className="col" onClick={() => go('recipe/' + f.recipeId)}>
        <b>{f.name} vs {p.name}</b><small>{d.map((x) => `${x.key}: ${x.recipe} vs ${x.packaged} per 100 g (${x.pct > 0 ? '+' : ''}${Math.round(x.pct * 100)}%)`).join(' · ')}</small></li>)}
        {!drifts.length && <li className="empty">No linked recipe differs by more than {threshold}%.</li>}</ul>
    </section>
  );
}
const pick = (m: Macros): Macros => ({ calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, fiber: m.fiber });

function History() {
  const entries = useLiveQuery(() => db.entries.where('date').aboveOrEqual(addDays(ymd(), -29)).toArray(), []) || [];
  const targets = useLiveQuery(() => db.targets.toArray(), []) || [];
  const days = Array.from({ length: 30 }, (_, i) => addDays(ymd(), i - 29));
  const totals = days.map((d) => ({ d, m: sum(entries.filter((e) => e.date === d)) }));
  const last7 = totals.slice(-7).filter((t) => t.m.calories > 0);
  const avg = {} as Macros; for (const k of MACRO_KEYS) avg[k] = last7.length ? last7.reduce((a, t) => a + t.m[k], 0) / last7.length : 0;
  const max = Math.max(1, ...totals.map((t) => t.m.calories), activeTarget(targets, ymd())?.calories || 0);
  const W = 300, H = 100, x = (i: number) => (i / 29) * W, y = (v: number) => H - (v / max) * H;
  const tgt = activeTarget(targets, ymd());
  return (
    <section>
      <h2>History</h2>
      <div className="card"><b>7-day average</b> ({last7.length} logged days): <MacroLine m={avg} /></div>
      <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} className="chart">
        {tgt && <line x1={0} x2={W} y1={y(tgt.calories)} y2={y(tgt.calories)} className="tline" />}
        <polyline fill="none" className="cline" points={totals.map((t, i) => `${x(i)},${y(t.m.calories)}`).join(' ')} />
        {totals.map((t, i) => <circle key={i} cx={x(i)} cy={y(t.m.calories)} r={1.8} className="dot" />)}
      </svg>
      <p className="hint">Calories, last 30 days{tgt ? ' (dashed = current target)' : ''}.</p>
      <ul className="list">{[...totals].reverse().filter((t) => t.m.calories > 0).map((t) => <li key={t.d}><b className="grow">{t.d}</b><small><MacroLine m={t.m} /></small></li>)}</ul>
    </section>
  );
}

function Settings() {
  const targets = useLiveQuery(() => db.targets.orderBy('startDate').reverse().toArray(), []) || [];
  const threshold = useLiveQuery(() => getSetting('driftThreshold', 15), []) ?? 15;
  const auto = useLiveQuery(() => getSetting<Record<string, boolean>>('autoApprove', {}), []) || {};
  const sources = useLiveQuery(async () => [...new Set((await db.recipes.toArray()).map((r) => r.source).filter((s) => s !== 'mine'))], []) || [];
  const cur = activeTarget(targets, ymd());
  const [t, setT] = useState<Macros & { startDate: string } | null>(null);
  const [newSrc, setNewSrc] = useState('');
  const form = t ?? { startDate: ymd(), calories: cur?.calories ?? 2000, protein: cur?.protein ?? 120, carbs: cur?.carbs ?? 220, fat: cur?.fat ?? 70, fiber: cur?.fiber ?? 30 };
  const allSources = [...new Set([...sources, ...Object.keys(auto), 'cook-bot'])];
  async function download() {
    const blob = new Blob([JSON.stringify(await exportAll(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `food-tracker-backup-${ymd()}.json`; a.click();
  }
  return (
    <section>
      <h2>Settings</h2>
      <p className="warn">Your data lives only on this device (in this browser's storage). There is no account or sync. Export a backup regularly; clearing site data or losing the device deletes it.</p>
      <h3>Targets</h3>
      <div className="grid5">{MACRO_KEYS.map((k) => <label key={k}>{k}<input type="number" value={form[k]} onChange={(e) => setT({ ...form, [k]: +e.target.value })} /></label>)}</div>
      <div className="row"><label>Start date<input type="date" value={form.startDate} onChange={(e) => setT({ ...form, startDate: e.target.value })} /></label>
        <button onClick={async () => { await db.targets.add({ ...form }); setT(null); }}>Save targets</button></div>
      <ul className="list">{targets.map((x) => <li key={x.id}><small className="grow">from {x.startDate}: <MacroLine m={x} /></small><button className="ghost" onClick={() => db.targets.delete(x.id!)}>✕</button></li>)}</ul>
      <h3>Drift threshold</h3>
      <label className="row">Flag differences above <input className="w80" type="number" value={threshold} onChange={(e) => setSetting('driftThreshold', Math.max(1, +e.target.value))} /> %</label>
      <h3>Auto-approve imports by source</h3>
      {allSources.map((s) => <label key={s} className="inline"><input type="checkbox" checked={!!auto[s]} onChange={(e) => setSetting('autoApprove', { ...auto, [s]: e.target.checked })} /> {s}</label>)}
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (newSrc.trim()) setSetting('autoApprove', { ...auto, [newSrc.trim()]: true }); setNewSrc(''); }}><input placeholder="source name" value={newSrc} onChange={(e) => setNewSrc(e.target.value)} /><button>Add source</button></form>
      <h3>Data</h3>
      <div className="row wrap">
        <button onClick={download}>Export all data (JSON)</button>
        <label className="button ghost">Restore backup<input hidden type="file" accept=".json" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (!confirm('Replace ALL current data with this backup?')) return; try { await restoreAll(JSON.parse(await f.text())); alert('Restored'); } catch (err) { alert('Restore failed: ' + (err as Error).message); } }} /></label>
        <button className="danger" onClick={async () => { if (confirm('Delete ALL data on this device? This cannot be undone.') && confirm('Really wipe everything?')) { await wipeAll(); alert('Wiped'); } }}>Wipe all data</button>
      </div>
      <h3>Sample data</h3>
      <button className="ghost" onClick={async () => { if (confirm('Add SAMPLE foods, a sample recipe, pantry items and two sample entries today? They are labeled (SAMPLE).')) { await loadSampleData(); alert('Sample data loaded'); } }}>Load sample data (clearly labeled SAMPLE)</button>
      <p className="hint">Recipe import format: see docs/recipe-v1.md in the repo, or download the sample on the Import screen.</p>
    </section>
  );
}
