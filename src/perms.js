// First-launch permissions screen (Android app only): notifications, battery, contacts, installing updates.
import { $, $$ } from './util.js';
import { isNative, notifyPermission, requestNotifyPermission, batteryUnrestricted, askBatteryUnrestricted,
  contactsPermission, askContactsPermission, canInstallUpdates, allowInstallUpdates } from './native.js';

const DONE_KEY = 'finly-perms-asked';
export const permsNeeded = () => isNative && !localStorage.getItem(DONE_KEY);

const PERMS = [
  { id:'permNotify', check: async () => (await notifyPermission()) === 'granted', ask: requestNotifyPermission },
  { id:'permBattery', check: batteryUnrestricted, ask: askBatteryUnrestricted },
  { id:'permContacts', check: async () => (await contactsPermission()) === 'granted', ask: askContactsPermission },
  { id:'permInstall', check: canInstallUpdates, ask: allowInstallUpdates }
];

async function refresh(){
  for(const p of PERMS){
    const ok = await p.check(), row = $('#' + p.id), btn = $('.perm-btn', row);
    row.classList.toggle('ok', ok);
    btn.textContent = ok ? 'Allowed' : 'Allow'; btn.disabled = ok;
  }
}

/** Shows the screen and resolves when the person continues. */
export function showPerms(showAuthScreen){
  return new Promise(resolve => {
    showAuthScreen('perms');
    refresh();
    PERMS.forEach(p => { $('.perm-btn', $('#' + p.id)).onclick = async () => { try{ await p.ask(); }catch{ /* ignore */ } refresh(); }; });
    $('#permAll').onclick = async () => {
      for(const p of PERMS){ if(!(await p.check())){ try{ await p.ask(); }catch{ /* ignore */ } } }
      await refresh();
      finish();
    };
    $('#permDone').onclick = finish;
    function finish(){ localStorage.setItem(DONE_KEY, '1'); $$('.perm-btn').forEach(b => { b.onclick = null; }); resolve(); }
  });
}
