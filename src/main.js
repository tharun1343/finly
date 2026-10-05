import './styles.css';
import { $ } from './util.js';
import { supabase, storedUser, loadStore, store, commitState, runSync, clearStore, signOut, setOnline } from './data.js';
import { initToasts, initSheets, initNumeric, initInfo, initDateFields, toast, closeAllSheets } from './ui.js';
import { initAuth, showAuth, showOnboarding, authBack, prefillSignin } from './auth.js';
import { startApp, applySettings, handleBack, openItemFromNotification, onResumeApp, swatchesHTML, preflightUpdate } from './app.js';
import { unsubscribeLive } from './cloud.js';
import { isNative, watchNetwork, onResume, onBack, onNotificationTap, requestNotifyPermission, cancelAllReminders } from './native.js';
import { permsNeeded, showPerms } from './perms.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let current = null, appStarted = false, loggingOut = false, pendingNotif = null;

function hideBoot(){ const b = $('#boot'); if(!b || b.classList.contains('gone')) return; b.classList.add('gone'); setTimeout(() => b.remove(), 400); }
function resetLook(){ const r = document.documentElement; r.removeAttribute('style'); r.dataset.theme = 'dark'; r.dataset.text = 'md'; }

async function enter(u){
  current = u; appStarted = false;
  loadStore(u.id);
  applySettings();
  if(!store.state.settings.onboarded && navigator.onLine){
    await Promise.race([runSync(), sleep(8000)]);   // existing account on a new phone: pull data first
  }
  if(!store.state.settings.onboarded){
    showOnboarding({
      name: store.state.settings.name || u.name,
      swatches: swatchesHTML,
      palette: store.state.settings.palette,
      onPalette: p => { store.state.settings.palette = p; applySettings(); },
      onDone: async ({ name, income, notify }) => {
        commitState(s => Object.assign(s.settings, { name, income, alertsOn: notify, onboarded:true }));
        if(isNative && notify) await requestNotifyPermission();
        launch();
      }
    });
    hideBoot();
    return;
  }
  launch();
}
function launch(){
  startApp(current, { logout });
  appStarted = true;
  hideBoot();
  if(pendingNotif){ const id = pendingNotif; pendingNotif = null; setTimeout(() => openItemFromNotification(id), 500); }
}

async function logout(sessionExpired, reason){
  closeAllSheets();
  if(sessionExpired && reason !== 'revoked'){
    prefillSignin(current?.email, 'Your session expired. Sign in again to keep syncing — nothing on this phone was lost.');
    appStarted = false;
    showAuth('signin');
    return;
  }
  loggingOut = true;
  unsubscribeLive();
  const id = current?.id;
  await cancelAllReminders();
  await signOut();
  if(id) clearStore(id);
  current = null; appStarted = false; loggingOut = false;
  resetLook(); prefillSignin('', '');
  showAuth('welcome');
  if(reason === 'revoked') toast({ type:'warning', title:'Signed out from another device', body:'This device was removed from your account, and its Finly data was cleared.', ms:8000 });
  else toast({ type:'success', title:'Logged out' });
}

/** Paint the loading screen in the last-used palette straight away. */
function paintBootLogo(){
  try{
    const logo = localStorage.getItem('finly-logo'), bg = localStorage.getItem('finly-boot-bg');
    if(logo) document.querySelectorAll('.brand-mark img').forEach(i => { i.src = logo; });
    if(bg){ document.documentElement.style.background = bg; document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg); }
  }catch{ /* private mode */ }
}
paintBootLogo();

function boot(){
  initToasts(); initSheets(); initNumeric(); initInfo(); initDateFields();
  // Web version (incl. iPhone home-screen app): keep working offline after the first visit.
  if(!isNative && import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  if(!supabase){
    $('#boot').innerHTML = '<p style="max-width:280px;text-align:center;color:var(--text-dim);line-height:1.6">This build is missing its server settings. Please install the latest version of Finly.</p>';
    return;
  }
  initAuth({ onVerified: u => enter(u) });
  supabase.auth.onAuthStateChange(event => { if(event === 'SIGNED_OUT' && current && !loggingOut) logout(true); });
  watchNetwork(online => setOnline(online));
  onResume(() => { if(appStarted) onResumeApp(); });
  onBack(() => (appStarted ? handleBack() : authBack()));
  onNotificationTap(id => { if(appStarted) openItemFromNotification(id); else pendingNotif = id; });

  // check for an update before opening, so it appears immediately (at most a 3 s wait on the splash)
  const ready = isNative && navigator.onLine ? Promise.race([preflightUpdate(), sleep(3000)]) : Promise.resolve();
  ready.then(openApp);
}
function openApp(){
  const u = storedUser();
  if(u) enter(u);
  else if(permsNeeded()){ hideBoot(); showPerms(showAuth).then(() => showAuth('welcome')); }
  else { showAuth('welcome'); hideBoot(); }
}
boot();
