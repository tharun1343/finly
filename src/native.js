import { Capacitor, SystemBars, SystemBarsStyle, registerPlugin } from '@capacitor/core';
import { FileOpener } from '@capacitor-community/file-opener';
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
  LocalNotifications.addListener('localNotificationActionPerformed', a => { const x = a.notification?.extra || {}; cb(x.plan ? '__plan:' + x.plan : x.itemId); });
}

/** Exact alarms fire on time even in battery saver; Finly declares USE_EXACT_ALARM so Android grants them. */
async function exactAllowed(){
  try{ return (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted'; }catch{ return false; }
}
/** Reminder slots already handed to Android, so a missed 9 AM slot is only made up once. */
const SLOT_KEY = 'finly-reminder-slots';
function loadSlots(){ try{ return JSON.parse(localStorage.getItem(SLOT_KEY) || '{}'); }catch{ return {}; } }
function saveSlots(m){
  const cutoff = Date.now() - 40 * 86400000;
  for(const k of Object.keys(m)) if(m[k] < cutoff) delete m[k];
  try{ localStorage.setItem(SLOT_KEY, JSON.stringify(m)); }catch{ /* storage full */ }
}
/** Shows a notification a few seconds from now, to check that reminders reach this phone. */
export async function testNotification(){
  if(!isNative) return 'unavailable';
  let p = await notifyPermission();
  if(p !== 'granted') p = await requestNotifyPermission();
  if(p !== 'granted') return 'denied';
  await ensureChannel();
  await LocalNotifications.schedule({ notifications:[{ id:900002, channelId:CHANNEL, title:'Finly reminders are working', body:'You\'ll get reminders like this before your due dates.',
    schedule:{ at:new Date(Date.now() + 5000), allowWhileIdle:true }, isExactNotification: await exactAllowed(), smallIcon:'ic_stat_finly' }] });
  return 'sent';
}

/* ---------- monthly plan: 9 PM on the last day of each month ---------- */
const PLAN_NOTIF_ID = 900003;
export async function schedulePlanNotice(enabled){
  if(!isNative) return;
  try{
    await LocalNotifications.cancel({ notifications:[{ id:PLAN_NOTIF_ID }] });
    if(!enabled || (await notifyPermission()) !== 'granted') return;
    await ensureChannel();
    const now = new Date();
    let at = new Date(now.getFullYear(), now.getMonth() + 1, 0, 21, 0, 0);          // last day of this month, 9 PM
    if(at.getTime() <= now.getTime() + 60000) at = new Date(now.getFullYear(), now.getMonth() + 2, 0, 21, 0, 0);
    const next = new Date(at.getFullYear(), at.getMonth() + 1, 1);
    const key = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    const month = next.toLocaleDateString('en-IN', { month:'long' });
    await LocalNotifications.schedule({ notifications:[{ id:PLAN_NOTIF_ID, channelId:CHANNEL, title:`Your ${month} plan is ready`,
      body:'Tap to see what\'s due next month and share it on WhatsApp.', schedule:{ at, allowWhileIdle:true }, isExactNotification: await exactAllowed(),
      smallIcon:'ic_stat_finly', extra:{ plan:key } }] });
  }catch(e){ console.warn('Plan reminder failed', e); }
}

let schedTimer = null;
/** Rebuild every pending reminder from the current data (cheap: ≤ 64 alarms). */
export function scheduleReminders(build){ clearTimeout(schedTimer); schedTimer = setTimeout(() => doSchedule(build).catch(e => console.warn('Reminder scheduling failed', e)), 800); }
async function doSchedule(build){
  if(!isNative) return;
  const pending = (await LocalNotifications.getPending()).notifications.filter(n => n.id !== UPDATE_NOTIF_ID && n.id !== 900002 && n.id !== PLAN_NOTIF_ID);
  if(pending.length) await LocalNotifications.cancel({ notifications: pending.map(n => ({ id:n.id })) });
  const { enabled, entries } = build();
  if(!enabled || (await notifyPermission()) !== 'granted') return;
  await ensureChannel();
  const exact = await exactAllowed(), slots = loadSlots();
  const now = Date.now(), list = [], today = new Date(); today.setHours(0, 0, 0, 0);
  let id = 1;
  for(const e of entries){
    const dueEnd = parseISO(e.due); dueEnd.setHours(23, 59, 0, 0);
    if(dueEnd.getTime() < now) continue;   // never remind after the due date
    for(const off of e.offsets){
      let at = parseISO(e.due); at.setDate(at.getDate() - off); at.setHours(9, 0, 0, 0);
      const key = `${e.id}|${e.due}|${off}`;
      if(at.getTime() <= now + 60000){
        // Today's 9 AM slot already passed and was never scheduled (e.g. added after 9 AM): remind shortly instead.
        const slotDay = new Date(at); slotDay.setHours(0, 0, 0, 0);
        if(slotDay.getTime() !== today.getTime() || slots[key]) continue;
        at = new Date(now + 90000);
      }
      if(at.getTime() - now > 120 * 86400000) continue;
      slots[key] = at.getTime();
      const when = off === 0 ? 'today' : off === 1 ? 'tomorrow' : `in ${off} days`;
      list.push({ id: id++, channelId:CHANNEL, title: e.chit ? `${e.name} · round ${e.round} ${when}` : `${e.name} due ${when}`,
        body: `${fmtMoney(e.amount)} due on ${fmtShort(e.due)}. ${e.chit ? 'Tap to record the round.' : e.lend ? 'Tap to record the payment.' : 'Tap to mark it paid.'}`,
        schedule:{ at, allowWhileIdle:true }, isExactNotification:exact, extra:{ itemId:e.id }, smallIcon:'ic_stat_finly' });
    }
  }
  saveSlots(slots);
  list.sort((a, b) => a.schedule.at - b.schedule.at);
  if(list.length) await LocalNotifications.schedule({ notifications: list.slice(0, 64) });
}
/* ---------- update notifications ---------- */
// Same id and channel as the background check (public/runners/updates.js), so one version never shows twice.
const UPDATE_NOTIF_ID = 900001;
export async function prepareUpdateChannel(){
  if(!isNative) return;
  try{ await LocalNotifications.createChannel({ id:'updates', name:'App updates', description:'When a new version of Finly is ready', importance:3, visibility:1 }); }catch{ /* older Android */ }
}
/** Posts "update available" once per version. */
export async function notifyUpdate(version){
  if(!isNative || !version) return;
  const key = 'finly-update-notified-' + version;
  if(localStorage.getItem(key) || (await notifyPermission()) !== 'granted') return;
  await prepareUpdateChannel();
  await LocalNotifications.schedule({ notifications:[{ id:UPDATE_NOTIF_ID, channelId:'updates', title:'Finly update available',
    body:`Version ${version} is ready. Tap to open Finly and update.`, smallIcon:'ic_stat_finly', isExactNotification:false, extra:{ update:true } }] });
  localStorage.setItem(key, '1');
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
  const latest = j.tag_name?.replace(/^v/, '');
  const available = newer(latest, APP_VERSION);
  return { latest, available, required: available && verNum(latest)[0] > verNum(APP_VERSION)[0] };
}
export function openExternal(url){ window.open(url, '_blank', 'noopener'); }

/* ---------- Finly's own Android helpers (android/.../FinlySystemPlugin.java) ---------- */
const System = registerPlugin('FinlySystem');
const safe = async (fn, fallback) => { if(!isNative) return fallback; try{ return await fn(); }catch{ return fallback; } };
export const batteryUnrestricted = () => safe(async () => (await System.batteryStatus()).unrestricted, true);
export const askBatteryUnrestricted = () => safe(async () => (await System.requestBatteryExemption()).unrestricted, false);
export const canInstallUpdates = () => safe(async () => (await System.installStatus()).allowed, false);
export const allowInstallUpdates = () => safe(async () => (await System.openInstallSettings()).allowed, false);
export const contactsPermission = () => safe(async () => (await System.checkPermissions()).contacts, 'denied');
export const askContactsPermission = () => safe(async () => (await System.requestPermissions({ permissions:['contacts'] })).contacts, 'denied');
/** Opens the phone's contact list. Resolves { name, phones:[{ number, label, primary }] }, or null if cancelled. */
export async function pickContact(){
  if(!isNative) return null;
  const r = await System.pickContact();
  return r.cancelled ? null : r;
}
export const setLauncherIcon = name => safe(() => System.setLauncherIcon({ name }), null);
export const deviceInfo = () => safe(() => System.deviceInfo(), null);

/**
 * Downloads the update, then installs it inside the app.
 * onProgress(p, phase): p is 0–1, phase is 'download' or 'install'. onResult(status) gets
 * 'confirm' (Android asked the user to confirm), 'failed' or 'success'. Android 12+ needs no confirm screen.
 */
export async function downloadAndInstall(url, onProgress, onResult){
  const subs = [];
  try{
    subs.push(await Filesystem.addListener('progress', p => { if(p.contentLength > 0) onProgress(Math.min(1, p.bytes / p.contentLength), 'download'); }));
    await Filesystem.downloadFile({ url, path:'finly-update.apk', directory: Directory.Cache, progress:true, recursive:true });
    onProgress(1, 'download');
    const { uri } = await Filesystem.getUri({ path:'finly-update.apk', directory: Directory.Cache });
    onProgress(0, 'install');
    try{
      subs.push(await System.addListener('installProgress', e => onProgress(e.progress, 'install')));
      subs.push(await System.addListener('installResult', e => onResult && onResult(e.status, e.message)));
      await System.installUpdate({ path: uri });
    }catch(e){
      // older builds of the native helper, or PackageInstaller refused: fall back to Android's installer screen
      console.warn('In-app install failed, opening installer', e);
      await FileOpener.open({ filePath: uri, contentType:'application/vnd.android.package-archive', openWithDefault:true });
      onResult && onResult('confirm');
    }
  } finally { setTimeout(() => subs.forEach(h => h?.remove()), 120000); }
}
export const reliabilityStatus = () => safe(() => System.reliabilityStatus(), null);
export const openAppSettings = () => safe(() => System.openAppSettings(), null);
export const openNotificationSettings = () => safe(() => System.openNotificationSettings(), null);

/** Saves an image straight to the phone's gallery (Pictures/Finly), without the share sheet. */
export async function saveToGallery(name, blob){
  const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  return System.saveImage({ base64, name });
}
