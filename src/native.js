import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { parseISO, fmtShort, fmtMoney } from './util.js';

export const isNative = Capacitor.isNativePlatform();
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0';
const REPO = import.meta.env.VITE_GITHUB_REPO || 'tharun1343/finly';
export const APK_URL = `https://github.com/${REPO}/releases/latest/download/finly.apk`;

/* ---------- system bars ---------- */
export function setBarsStyle(theme){
  if(!isNative) return;
  SystemBars.setStyle({ style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
}

/* ---------- network ---------- */
export async function watchNetwork(cb){
  try{
    const s = await Network.getStatus(); cb(s.connected);
    Network.addListener('networkStatusChange', st => cb(st.connected));
  }catch{
    cb(navigator.onLine);
    addEventListener('online', () => cb(true)); addEventListener('offline', () => cb(false));
  }
}

/* ---------- app lifecycle / back button ---------- */
export function onResume(cb){
  if(isNative) App.addListener('resume', cb);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) cb(); });
}
export function onBack(handler){
  if(!isNative) return;
  App.addListener('backButton', () => { if(!handler()) App.minimizeApp(); });
}

/* ---------- notifications ---------- */
const CHANNEL = 'reminders';
let channelReady = false;
async function ensureChannel(){
  if(!isNative || channelReady) return;
  try{ await LocalNotifications.createChannel({ id:CHANNEL, name:'Payment reminders', description:'Reminders before EMIs, bills and chit rounds are due', importance:4, visibility:1, vibration:true }); }catch{ /* older Android */ }
  channelReady = true;
}
export async function notifyPermission(){
  if(!isNative) return 'unavailable';
  try{ return (await LocalNotifications.checkPermissions()).display; }catch{ return 'unavailable'; }
}
export async function requestNotifyPermission(){
  if(!isNative) return 'unavailable';
  try{ return (await LocalNotifications.requestPermissions()).display; }catch{ return 'denied'; }
}
export function onNotificationTap(cb){
  if(!isNative) return;
  LocalNotifications.addListener('localNotificationActionPerformed', a => cb(a.notification?.extra?.itemId));
}

let schedTimer = null;
/** Rebuild every pending reminder from the current data (cheap: ≤ 64 alarms). */
export function scheduleReminders(build){ clearTimeout(schedTimer); schedTimer = setTimeout(() => doSchedule(build).catch(e => console.warn('Reminder scheduling failed', e)), 800); }
async function doSchedule(build){
  if(!isNative) return;
  const pending = await LocalNotifications.getPending();
  if(pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map(n => ({ id:n.id })) });
  const { enabled, entries } = build();
  if(!enabled || (await notifyPermission()) !== 'granted') return;
  await ensureChannel();
  const now = Date.now(), list = [];
  let id = 1;
  for(const e of entries){
    for(const off of e.offsets){
      const at = parseISO(e.due); at.setDate(at.getDate() - off); at.setHours(9, 0, 0, 0);
      if(at.getTime() <= now + 60000 || at.getTime() - now > 120 * 86400000) continue;
      const when = off === 0 ? 'today' : off === 1 ? 'tomorrow' : `in ${off} days`;
      list.push({ id: id++, channelId:CHANNEL, title: e.chit ? `${e.name} · round ${e.round} ${when}` : `${e.name} due ${when}`,
        body: e.chit ? `${fmtMoney(e.amount)} due on ${fmtShort(e.due)}. Tap to record the round.` : `${fmtMoney(e.amount)} due on ${fmtShort(e.due)}. Tap to mark it paid.`,
        schedule:{ at, allowWhileIdle:true }, isExactNotification:false, extra:{ itemId:e.id }, smallIcon:'ic_stat_finly' });
    }
  }
  list.sort((a, b) => a.schedule.at - b.schedule.at);
  if(list.length) await LocalNotifications.schedule({ notifications: list.slice(0, 64) });
}
export async function cancelAllReminders(){
  if(!isNative) return;
  try{ const p = await LocalNotifications.getPending(); if(p.notifications.length) await LocalNotifications.cancel({ notifications: p.notifications.map(n => ({ id:n.id })) }); }catch{ /* ignore */ }
}

/* ---------- saving exported files ---------- */
const blobToBase64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
/** @returns 'saved' | 'cancelled' */
export async function saveFile(filename, data){
  const blob = data instanceof Blob ? data : new Blob([data], { type: filename.endsWith('.csv') ? 'text/csv;charset=utf-8' : 'application/octet-stream' });
  if(isNative){
    const res = await Filesystem.writeFile({ path:filename, data: await blobToBase64(blob), directory: Directory.Cache });
    try{ await Share.share({ title:filename, files:[res.uri], dialogTitle:'Save or share your export' }); }
    catch(e){ if(/cancel/i.test(String(e?.message || e))) return 'cancelled'; throw e; }
    return 'saved';
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'saved';
}

/* ---------- updates ---------- */
const verNum = v => String(v || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
const newer = (a, b) => { const x = verNum(a), y = verNum(b); for(let i = 0; i < 3; i++){ if((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
export async function checkForUpdate(){
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers:{ Accept:'application/vnd.github+json' } });
  if(!r.ok) throw new Error('update check failed');
  const j = await r.json();
  return { latest: j.tag_name?.replace(/^v/, ''), available: newer(j.tag_name, APP_VERSION) };
}
export function openExternal(url){ window.open(url, '_blank', 'noopener'); }
