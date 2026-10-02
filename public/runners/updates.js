// Runs in the background (Android WorkManager, every few hours) even when Finly is closed.
// Checks GitHub for a newer release and posts one notification per new version.
const REPO = 'tharun1343/finly';
const parts = v => String(v || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
const newer = (a, b) => { const x = parts(a), y = parts(b); for(let i = 0; i < 3; i++){ if((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
const kvGet = k => { try{ const r = CapacitorKV.get(k); return r && typeof r === 'object' ? r.value : r; }catch(e){ return null; } };

addEventListener('checkUpdate', (resolve, reject) => {
  let installed = '';
  try{ installed = CapacitorApp.getInfo().version; }catch(e){ return resolve(); }
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers:{ Accept:'application/vnd.github+json', 'User-Agent':'Finly-Android' } })
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      const latest = j && String(j.tag_name || '').replace(/^v/, '');
      if(latest && newer(latest, installed) && kvGet('notifiedVersion') !== latest){
        CapacitorNotifications.schedule([{ id:900001, channelId:'updates', title:'Finly update available',
          body:`Version ${latest} is ready. Tap to open Finly and update.`, smallIcon:'ic_stat_finly', autoCancel:true }]);
        CapacitorKV.set('notifiedVersion', latest);
      }
      resolve();
    })
    .catch(() => resolve());
});
