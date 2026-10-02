// City / state from an Indian PIN code (India Post's free public API).
import { titleCase } from './banks.js';

export const PIN_RE = /^[1-9]\d{5}$/;
const cache = new Map();
/** @returns {Promise<{city, state, areas:string[]} | null>} null = unknown PIN; throws when offline. */
export async function lookupPin(pin){
  if(!PIN_RE.test(pin)) return null;
  if(cache.has(pin)) return cache.get(pin);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 9000);
  try{
    const r = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal:ctl.signal });
    if(!r.ok) throw new Error('lookup failed');
    const j = (await r.json())?.[0];
    const pos = j?.Status === 'Success' ? j.PostOffice || [] : [];
    if(!pos.length){ cache.set(pin, null); return null; }
    const res = { city: titleCase(pos[0].District), state: titleCase(pos[0].State), areas: [...new Set(pos.map(p => titleCase(p.Name)))] };
    cache.set(pin, res);
    return res;
  } finally { clearTimeout(t); }
}

/** Whole years between an ISO birth date and today. */
export function ageFrom(dob, today = new Date()){
  if(!dob) return null;
  const [y, m, d] = dob.split('-').map(Number);
  let a = today.getFullYear() - y;
  if(today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) a--;
  return a >= 0 && a < 130 ? a : null;
}
