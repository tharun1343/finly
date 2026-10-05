// Server features added in 2.0 (supabase/v2.sql): devices, WhatsApp number, shared ledger entries.
// Every call fails soft: if the server hasn't been updated yet, callers get { missing:true }.
import { supabase } from './data.js';
import { uid } from './util.js';
import { isNative, deviceInfo } from './native.js';

const missingFn = e => /function .* does not exist|Could not find the function|relation .* does not exist|PGRST202|42883|42P01/i.test(String(e?.message || e?.code || e));
async function rpc(name, args){
  const { data, error } = await supabase.rpc(name, args);
  if(error){ if(missingFn(error)) return { missing:true }; throw error; }
  return { data };
}

/* ---------- this device ---------- */
const DEV_KEY = 'finly-device-id';
export function deviceId(){
  let id = localStorage.getItem(DEV_KEY);
  if(!id){ id = 'd' + uid() + uid().slice(0, 6); localStorage.setItem(DEV_KEY, id); }
  return id;
}
function browserName(){
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Computer';
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}
/** Approximate city from the internet connection (no GPS). */
async function approxCity(){
  try{
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 4000);
    const r = await fetch('https://ipwho.is/?fields=success,city,region', { signal: ctl.signal });
    const j = await r.json();
    return j.success ? [j.city, j.region].filter(Boolean).join(', ') : '';
  }catch{ return ''; }
}

/** Registers this device. Returns { revoked } when another device removed this one. */
export async function registerDevice(){
  if(!navigator.onLine) return {};
  const info = isNative ? await deviceInfo() : null;
  const name = info?.name || browserName(), platform = info?.os || (isNative ? 'Android' : 'Web');
  const r = await rpc('register_device', { p_id: deviceId(), p_name: name, p_platform: platform, p_city: await approxCity() });
  if(r.missing) return { missing:true };
  const d = r.data || {};
  if(d.is_new && d.others > 0) supabase.functions.invoke('signin-alert', { body:{ deviceId: deviceId() } }).catch(() => {});
  return { revoked: !!d.revoked };
}
export async function listDevices(){
  const { data, error } = await supabase.from('devices').select('id,name,platform,city,created_at,last_seen,revoked').order('last_seen', { ascending:false });
  if(error){ if(missingFn(error)) return { missing:true }; throw error; }
  return { data };
}
export const revokeDevice = id => rpc('revoke_device', { p_id:id });
export const forgetDevice = id => rpc('forget_device', { p_id:id });

/* ---------- WhatsApp number ---------- */
export const PHONE_RE = /^\+[1-9][0-9]{7,14}$/;
/** "98765 43210" → "+919876543210". Numbers without a country code are taken as Indian. */
export function normPhone(raw){
  let s = String(raw || '').replace(/[^\d+]/g, '');
  if(s.startsWith('00')) s = '+' + s.slice(2);
  if(!s.startsWith('+')){
    if(s.length === 11 && s.startsWith('0')) s = s.slice(1);
    if(s.length === 12 && s.startsWith('91')) s = '+' + s;
    else if(s.length === 10) s = '+91' + s;
    else s = '+' + s;
  }
  return s;
}
export const fmtPhone = p => /^\+91\d{10}$/.test(p || '') ? `+91 ${p.slice(3, 8)} ${p.slice(8)}` : (p || '');
export async function saveProfile(phone, name){
  try{ return await rpc('save_profile', { p_phone:phone, p_name:name || '' }); }
  catch(e){ if(/phone_taken/.test(String(e?.message))) return { taken:true }; throw e; }
}

/* ---------- shared ledger ---------- */
export async function fetchShares(){
  const { data, error } = await supabase.from('ledger_shares').select('*').neq('status', 'removed');
  if(error){ if(missingFn(error)) return { missing:true }; throw error; }
  return { data };
}
export const shareUpsert = (id, phone, ownerName, data) => rpc('share_upsert', { p_id:id, p_phone:phone, p_owner_name:ownerName, p_data:data });
export const shareRespond = (id, accept) => rpc('share_respond', { p_id:id, p_accept:accept });
export const shareAddPayment = (id, payment) => rpc('share_add_payment', { p_id:id, p_payment:payment });
export const shareRemove = id => rpc('share_remove', { p_id:id });

/* ---------- live updates: requests, data from other devices and device removal arrive instantly ---------- */
let liveChannel = null;
/** handlers: { shares(), records(), devices() }. Needs supabase/v2-4-realtime.sql; silently does nothing without it. */
export function subscribeLive(userId, handlers){
  unsubscribeLive();
  if(!userId || typeof supabase.channel !== 'function') return;
  try{
    liveChannel = supabase.channel('finly-live-' + userId)
      .on('postgres_changes', { event:'*', schema:'public', table:'ledger_shares' }, () => handlers.shares())
      .on('postgres_changes', { event:'*', schema:'public', table:'records', filter:`user_id=eq.${userId}` }, () => handlers.records())
      .on('postgres_changes', { event:'*', schema:'public', table:'devices', filter:`user_id=eq.${userId}` }, () => handlers.devices())
      .subscribe();
  }catch(e){ console.warn('Live updates unavailable', e); }
}
export function unsubscribeLive(){ if(liveChannel){ try{ supabase.removeChannel(liveChannel); }catch{ /* ignore */ } liveChannel = null; } }
