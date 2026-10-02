import { createClient } from '@supabase/supabase-js';
import { clone } from './util.js';

const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const AUTH_KEY = 'finly-auth';

export let supabase = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY, {
  auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:false, storageKey:AUTH_KEY }
}) : null;
if(import.meta.env.DEV && !supabase){ supabase = (await import('./dev-mock.js')).createMockClient(AUTH_KEY); }

/* ---------------- auth ---------------- */
export function storedUser(){
  try{
    const raw = localStorage.getItem(AUTH_KEY);
    const s = raw && JSON.parse(raw);
    let u = s && (s.user || s.currentSession?.user);
    if(!u){ const ru = localStorage.getItem(AUTH_KEY + '-user'); u = ru && JSON.parse(ru)?.user; }
    return u ? { id:u.id, email:u.email, name:u.user_metadata?.name || '' } : null;
  }catch{ return null; }
}

export class AuthFailure extends Error { constructor(kind, msg){ super(msg); this.kind = kind; } }
function classify(err){
  const msg = String(err?.message || err || ''), status = Number(err?.status) || 0;
  if(!navigator.onLine || (!status && /fetch|network|load failed/i.test(msg))) return new AuthFailure('offline', 'You\'re offline. Connect to the internet and try again.');
  if(status === 429 || /rate limit|too many/i.test(msg)) return new AuthFailure('rate', 'Too many requests. Please wait a minute and try again.');
  if(/sending .*email|smtp|mail/i.test(msg)) return new AuthFailure('server', 'We couldn\'t send the code email. The app\'s email service needs attention — please try again later.');
  if(status >= 500 || !status) return new AuthFailure('server', `The server couldn't be reached properly (${status || 'no response'}). Please try again in a minute.`);
  if(err?.code === 'otp_expired' || /expired|invalid/i.test(msg)) return new AuthFailure('invalid', 'That code is wrong or has expired.');
  return new AuthFailure('other', msg || 'Something went wrong. Please try again.');
}
export async function sendCode(email, name){
  try{
    const { error } = await supabase.auth.signInWithOtp({ email, options:{ shouldCreateUser:true, data: name ? { name } : undefined } });
    if(error) throw error;
  }catch(e){ throw classify(e); }
}
export async function verifyCode(email, token){
  try{
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type:'email' });
    if(error) throw error;
    const u = data.user || data.session?.user;
    return { id:u.id, email:u.email, name:u.user_metadata?.name || '' };
  }catch(e){ throw classify(e); }
}
export async function signOut(){
  try{ await supabase.auth.signOut({ scope:'local' }); }catch{ /* offline: local sign-out below still applies */ }
  localStorage.removeItem(AUTH_KEY); localStorage.removeItem(AUTH_KEY + '-user');
}

/* ---------------- local store ---------------- */
export const DEFAULT_SETTINGS = { name:'', income:null, theme:'dark', text:'md', alertsOn:true, palette:'sapphire', onboarded:false, banks:[] };
const defaultCats = () => [
  { id:'emi', name:'EMI', emoji:'🏦', kind:'bill', ci:0, reminders:[1], _u:0 },
  { id:'chit', name:'Chit Fund', emoji:'🤝', kind:'chit', ci:1, reminders:[1], builtin:true, _u:0 },
  { id:'household', name:'Household', emoji:'🏠', kind:'bill', ci:2, reminders:[1], optional:true, _u:0 },
  { id:'recharge', name:'Recharges', emoji:'📶', kind:'bill', ci:3, reminders:[1], _u:0 },
  GOLD_LOAN()];
const GOLD_LOAN = () => ({ id:'goldloan', name:'Gold Loan', emoji:'🪙', kind:'bill', ci:4, reminders:[1], _u:0 });

export const store = { uid:null, state:null, meta:null };
const dataKey = id => `finly:data:${id}`;

export function loadStore(id){
  store.uid = id;
  let saved = null;
  try{ saved = JSON.parse(localStorage.getItem(dataKey(id)) || 'null'); }catch{ saved = null; }
  store.state = saved?.state || { settings:{ ...DEFAULT_SETTINGS, _u:0 }, cats:defaultCats(), items:[] };
  store.state.settings = { ...DEFAULT_SETTINGS, ...store.state.settings };
  store.meta = saved?.meta || { dirty:{}, cursor:null, lastSync:0 };
  store.meta.fileDeletes ||= [];
  store.meta.migrations ||= [];
  if(!store.meta.migrations.includes('goldloan')){
    if(!store.state.cats.some(c => c.id === 'goldloan')) store.state.cats.push(GOLD_LOAN());
    store.meta.migrations.push('goldloan');
    saveStore();
  }
}
export function queueFileDelete(path){ if(path && store.meta && !store.meta.fileDeletes.some(d => d.p === path)){ store.meta.fileDeletes.push({ p:path, t:Date.now() }); saveStore(); } }
export function clearFileDelete(path){ if(!store.meta) return; store.meta.fileDeletes = store.meta.fileDeletes.filter(d => d.p !== path); saveStore(); }
/** Paths queued for removal long enough ago that an Undo can no longer bring them back. */
export const dueFileDeletes = () => (store.meta?.fileDeletes || []).filter(d => Date.now() - d.t > 15000).map(d => d.p);
let afterSyncHook = null;
export const onAfterSync = fn => { afterSyncHook = fn; };
export function saveStore(){
  if(!store.uid) return;
  try{ localStorage.setItem(dataKey(store.uid), JSON.stringify({ state:store.state, meta:store.meta })); }
  catch(e){ console.error('Could not save locally', e); }
}
export function clearStore(id){ localStorage.removeItem(dataKey(id)); store.uid = null; store.state = null; store.meta = null; }
export const pendingCount = () => store.meta ? Object.keys(store.meta.dirty).length : 0;

const sig = r => JSON.stringify(r, (k, v) => (k === '_u' ? undefined : v));
function mark(col, id, deleted, u){ store.meta.dirty[col + ':' + id] = { u, del: !!deleted }; }

/** Compare two states, stamp changed records and queue them for upload. */
export function recordChanges(prev, next){
  const now = Date.now();
  for(const col of ['cats', 'items']){
    const pm = new Map(prev[col].map(r => [r.id, r]));
    const nm = new Set();
    for(const r of next[col]){
      nm.add(r.id);
      const p = pm.get(r.id);
      if(!p || sig(p) !== sig(r)){ r._u = now; mark(col, r.id, false, now); }
    }
    for(const id of pm.keys()) if(!nm.has(id)) mark(col, id, true, now);
  }
  if(sig(prev.settings) !== sig(next.settings)){ next.settings._u = now; mark('settings', 'main', false, now); }
}

export function commitState(mutate){
  const prev = clone(store.state);
  mutate(store.state);
  recordChanges(prev, store.state);
  saveStore();
  scheduleSync();
}
export function replaceState(next){
  const prev = clone(store.state);
  store.state = next;
  recordChanges(prev, store.state);
  saveStore();
  scheduleSync();
}

/* ---------------- sync ---------------- */
let online = typeof navigator === 'undefined' ? true : navigator.onLine;
let running = false, rerun = false, timer = null, lastError = null;
const listeners = new Set();
export const onSyncStatus = fn => { listeners.add(fn); return () => listeners.delete(fn); };
let appliedCb = () => {};
export const onRemoteChanges = fn => { appliedCb = fn; };
export function syncStatus(){
  return { online, running, pending: pendingCount(), lastSync: store.meta?.lastSync || 0, error: lastError };
}
const emit = () => listeners.forEach(fn => fn(syncStatus()));
export function setOnline(v){ const was = online; online = v; emit(); if(v && !was) scheduleSync(300); }
export function scheduleSync(delay = 1200){ clearTimeout(timer); timer = setTimeout(runSync, delay); emit(); }

const isNetErr = e => /fetch|network|Failed to fetch|Load failed|timeout/i.test(String(e?.message || e)) || e?.name === 'AuthRetryableFetchError';
const PAGE = 500;

export async function runSync(){
  if(!store.uid || !supabase) return;
  if(running){ rerun = true; return; }
  if(!online){ emit(); return; }
  running = true; lastError = null; emit();
  let changed = false;
  try{
    const { data:{ session } } = await supabase.auth.getSession();
    if(!session) throw Object.assign(new Error('Signed out'), { auth:true });
    if(session.user.id !== store.uid) throw Object.assign(new Error('Account mismatch'), { auth:true });

    const keys = Object.keys(store.meta.dirty);
    for(let i = 0; i < keys.length; i += 200){
      const batch = keys.slice(i, i + 200).map(k => {
        const d = store.meta.dirty[k], [col, ...rest] = k.split(':'), id = rest.join(':');
        let data = {};
        if(!d.del){
          data = col === 'settings' ? store.state.settings : (store.state[col].find(r => r.id === id) || {});
          data = JSON.parse(sig(data));
        }
        return { key:k, stamp:d.u, row:{ user_id:store.uid, collection:col, id, data, deleted: !!d.del, client_updated_at: new Date(d.u).toISOString() } };
      });
      const { error } = await supabase.from('records').upsert(batch.map(b => b.row), { onConflict:'user_id,collection,id' });
      if(error) throw error;
      batch.forEach(b => { if(store.meta.dirty[b.key]?.u === b.stamp) delete store.meta.dirty[b.key]; });
      saveStore();
    }

    let cursor = store.meta.cursor || '1970-01-01T00:00:00Z';
    for(;;){
      const { data, error } = await supabase.from('records')
        .select('collection,id,data,deleted,client_updated_at,server_updated_at')
        .gt('server_updated_at', cursor).order('server_updated_at', { ascending:true }).limit(PAGE);
      if(error) throw error;
      for(const r of data) if(applyRemote(r)) changed = true;
      if(data.length) cursor = data[data.length - 1].server_updated_at;
      if(data.length < PAGE) break;
    }
    store.meta.cursor = cursor;
    store.meta.lastSync = Date.now();
    saveStore();
    if(afterSyncHook) setTimeout(afterSyncHook, 0);
  }catch(e){
    lastError = e?.auth ? 'auth' : isNetErr(e) ? 'network' : (e?.message || 'error');
    if(lastError === 'network') online = navigator.onLine;
    console.warn('Sync failed:', e);
  }finally{
    running = false; emit();
    if(changed) appliedCb();
    if(rerun){ rerun = false; scheduleSync(200); }
  }
}

function applyRemote(r){
  const key = r.collection + ':' + r.id, ru = Date.parse(r.client_updated_at);
  const d = store.meta.dirty[key];
  if(d && d.u >= ru) return false;
  if(d) delete store.meta.dirty[key];
  const st = store.state;
  if(r.collection === 'settings'){
    if(r.deleted || (st.settings._u && st.settings._u >= ru)) return false;
    st.settings = { ...DEFAULT_SETTINGS, ...r.data, _u:ru };
    return true;
  }
  const arr = st[r.collection]; if(!arr) return false;
  const i = arr.findIndex(x => x.id === r.id), local = arr[i];
  if(local && local._u && local._u >= ru) return false;
  if(r.deleted){ if(i > -1){ arr.splice(i, 1); return true; } return false; }
  const rec = { ...r.data, id:r.id, _u:ru };
  if(i > -1) arr[i] = rec; else arr.push(rec);
  return true;
}
