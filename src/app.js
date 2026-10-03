import { $, $$, esc, ICON, T, refreshToday, parseISO, toISO, addDays, addMonths, dayNum, diffDays, fmtDate, fmtShort, fmtMonth, fmtMoney, round2, uid, clone, num, isInt, reduceMotion, ago } from './util.js';
import { PALETTES, TOKEN_MAP, paletteVars, swatchStyle, palKey, isPitch } from './palettes.js';
import { store, commitState, replaceState, onSyncStatus, syncStatus, scheduleSync, runSync, onRemoteChanges, pendingCount, queueFileDelete, clearFileDelete, dueFileDeletes, onAfterSync } from './data.js';
import { MAX_FILES, prepareFile, putLocal, thumbUrl, openAttachment, openBlob, syncFiles, FileError } from './files.js';
import { toast, layoutFab, openSheet, closeSheet, confirmBox, setInvalid, showAlert, clearForm, scrollToError, setBusy, bindSwitch, setSwitch, isOn,
  moveThumb, bindSeg, moveAllThumbs, openStack, setNum, bindNumeric, enhanceSelect, setSelect, setSelectIcons, makeReminderPicker, remSummary, withTransition, flip, handleBackInOverlays, footShadow, fmtNumInput } from './ui.js';
import { isNative, APP_VERSION, APK_URL, setBarsStyle, scheduleReminders, notifyPermission, requestNotifyPermission, saveFile, checkForUpdate, openExternal, notifyUpdate, prepareUpdateChannel, testNotification,
  canInstallUpdates, allowInstallUpdates, downloadAndInstall, pickContact, setLauncherIcon, schedulePlanNotice } from './native.js';
import { paymentRows, summaryRow, buildCsv, buildPdf } from './export.js';
import { lendState, lendDue, splitPayment, rateLabel } from './ledger.js';
import { registerDevice, listDevices, revokeDevice, forgetDevice, deviceId, normPhone, fmtPhone, PHONE_RE, saveProfile as saveRemoteProfile, fetchShares, shareUpsert, shareRespond, shareAddPayment, shareRemove } from './cloud.js';
import { logoColors, logoSVG } from './logo.js';
import { BANK_GROUPS, OTHER_BANK, findBank, bankFromIfsc, shortName, IFSC_RE, maskAcct, bankBadgeHTML, bankColor, lookupIfsc } from './banks.js';
import { PIN_RE, lookupPin, ageFrom } from './places.js';
import { E3D, AVATARS, e3dCode } from './e3d-list.js';

const st = () => store.state;
let user = { id:'', email:'', name:'' };
let onLogout = () => {};

/* ================================================================
   DERIVED DATA
================================================================ */
const cat = id => st().cats.find(c => c.id === id);
const findItem = id => st().items.find(i => i.id === id);
const activeItems = () => st().items.filter(i => i.status === 'active' && i.kind !== 'lend');
const closedItems = () => st().items.filter(i => i.status === 'closed' && i.kind !== 'lend').sort((a, b) => dayNum(b.closedOn) - dayNum(a.closedOn));
/* Ledger entries (money lent or borrowed) live with the other items but are kept out of EMI/chit totals. */
const lends = () => st().items.filter(i => i.kind === 'lend').concat(sharedLends());
const activeLends = () => lends().filter(i => i.status === 'active');
const lendWho = it => it.dir === 'lent' ? `Collect from ${it.person}` : `Repay ${it.person}`;
/** Round r's date. Once a chit has an anchor (a round's actual date), later rounds follow it instead of the start date. */
const roundDate = (c, r) => c.anchorRound && c.anchorDate && r > c.anchorRound
  ? addMonths(c.anchorDate, (r - c.anchorRound) * c.interval, parseISO(c.anchorDate).getDate())
  : addMonths(c.start, (r - 1) * c.interval, parseISO(c.start).getDate());
const effReminders = it => it.reminders ?? (cat(it.catId)?.reminders ?? [1]);
const ev = it => it.every || 1;
const PER = { 1:'month', 3:'quarter', 6:'6 months', 12:'year' };
const perLabel = n => PER[n] || `${n} months`;
const announced = it => it.kind === 'chit' && it.nextDate && it.nextDateRound === it.roundsDone + 1;
const nextDue = it => it.kind === 'chit' ? (announced(it) ? it.nextDate : roundDate(it, it.roundsDone + 1)) : it.due;
const fileCount = it => (it.files || []).length;
const bankTagHTML = it => { const b = it.bankId && (store.state.settings.banks || []).find(x => x.id === it.bankId); return b ? `<span class="bank-tag">${bankBadgeHTML(b.name, 'xs')}${esc(shortName(b.name))} ${maskAcct(b.acct)}</span>` : ''; };
const clipHTML = it => fileCount(it) ? `<button class="clip-badge" data-act="files" aria-label="${fileCount(it)} documents"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>${fileCount(it)}</button>` : '';
const alertWindow = it => Math.max(7, ...effReminders(it));
const paidRecently = it => it.kind === 'bill' && !!it.lastPaid && diffDays(T, it.due) > alertWindow(it);
const itemPaid = it => it.kind === 'chit' ? it.paidIn : it.paid;
const itemRemaining = it => it.status !== 'active' ? 0 : it.kind === 'chit' ? (it.taken ? it.installment * (it.members - it.roundsDone) : 0) : (it.ongoing ? 0 : it.amount * it.tenureLeft);
const catColor = c => { const cs = PALETTES[palKey(st().settings.palette)].cats, col = cs[((c?.ci ?? 0) % cs.length + cs.length) % cs.length];
  return st().settings.theme === 'light' ? `color-mix(in srgb, ${col} 68%, #1d2233)` : col; };
const subOf = it => it?.subId ? (cat(it.catId)?.subs || []).find(x => x.id === it.subId) : null;
const catLabel = it => { const c = cat(it.catId), sb = subOf(it); return [c?.name, sb?.name].filter(Boolean).join(' · '); };
const displayName = () => st().settings.name || user.name || (user.email || '').split('@')[0] || 'there';

function histDesc(h, mf, rich){
  const b = s => rich ? `<b>${s}</b>` : s;
  return h.type === 'agent' ? 'Agent\'s round — no auction'
    : h.type === 'commission' ? `Got commission ${b(mf(h.share))}${h.bid != null ? ` (bid ${mf(h.bid)})` : ''}`
    : h.type === 'taken' ? `${b('Took the pot')} — bid ${mf(h.bid)}, received ${mf(h.received)}`
    : h.type === 'last' ? b('Final round — pot came to you') : h.type === 'opening' ? `Opening balance for rounds 1–${h.round}` : 'Paid in full';
}
const lateNote = (h, mf) => h.lateFee ? ` · late fee ${mf(h.lateFee)}` : '';
const exportHelpers = { cat, catLabel, itemPaid, itemRemaining, nextDue, histDesc };

function computeAlerts(){
  if(!st().settings.alertsOn) return [];
  const out = [];
  for(const it of activeItems()){
    const due = nextDue(it), d = diffDays(T, due), offs = effReminders(it);
    if(d < 0){ out.push({ it, due, d }); continue; }   // overdue: always shown until it's marked paid
    if(!offs.length || paidRecently(it)) continue;
    if(d <= Math.max(...offs)) out.push({ it, due, d });
  }
  for(const it of activeLends()){
    const due = lendDue(it); if(!due) continue;
    const d = diffDays(T, due); if(d < 0 || d <= Math.max(...(it.reminders ?? [1]))) out.push({ it, due, d });
  }
  return out.sort((a, b) => a.d - b.d);
}
function reminderPlan(){
  const lendEntries = activeLends().filter(lendDue).map(it => ({ id:it.id, name:lendWho(it), due:lendDue(it), offsets:it.reminders ?? [1],
    amount: lendState(it, lendDue(it)).outstanding, lend:true }));
  return { enabled: st().settings.alertsOn, entries: activeItems().map(it => ({ id:it.id, name:it.name, due:nextDue(it), offsets:effReminders(it),
    amount: it.kind === 'chit' ? it.installment : it.amount, chit: it.kind === 'chit', round: it.kind === 'chit' ? it.roundsDone + 1 : null })).concat(lendEntries) };
}

function totals(){
  let loanDebt = 0, loanPaid = 0, chitDebt = 0, monthly = 0, savings = 0, commission = 0, savingComm = 0, takenCount = 0, savingCount = 0, lastEnd = null;
  const byCat = {};
  for(const it of activeItems()){
    const m = it.kind === 'chit' ? it.installment / it.interval : it.amount / ev(it);
    monthly += m; byCat[it.catId] = (byCat[it.catId] || 0) + m;
    if(it.kind === 'bill'){
      if(!it.ongoing){ loanDebt += it.amount * it.tenureLeft; loanPaid += it.paid;
        const end = addMonths(it.due, (it.tenureLeft - 1) * ev(it), it.anchorDay); if(!lastEnd || dayNum(end) > dayNum(lastEnd)) lastEnd = end; }
    } else {
      commission += it.commission;
      if(it.taken){ const rem = it.installment * (it.members - it.roundsDone); chitDebt += rem; takenCount++;
        const end = roundDate(it, it.members); if(!lastEnd || dayNum(end) > dayNum(lastEnd)) lastEnd = end; }
      else { savings += it.paidIn; savingCount++; savingComm += it.commission; }
    }
  }
  return { debt: loanDebt + chitDebt, loanDebt, loanPaid, chitDebt, monthly, savings, commission, savingComm, takenCount, savingCount, lastEnd, byCat,
           repaidPct: (loanPaid + loanDebt) ? Math.round(loanPaid / (loanPaid + loanDebt) * 100) : 0 };
}

/* ================================================================
   CHANGES
================================================================ */
function afterChange(){ render(); scheduleReminders(reminderPlan); }
function commit(mutate, toastOpts){
  const snap = clone(st());
  commitState(mutate);
  afterChange();
  if(toastOpts) toast({ ...toastOpts, undo: toastOpts.noUndo ? null : () => { replaceState(snap); applySettings(); afterChange(); } });
}
function setSetting(patch){ commit(() => Object.assign(st().settings, patch)); applySettings(); }

/* ================================================================
   RENDER
================================================================ */
const seen = new Set(), prevPct = {}, lastNum = {};
let filter = 'all', sortMode = 'due', page = 'home', byView = 'active';

const HAS3D = new Set(Object.keys(E3D).map(e3dCode));
/** A bundled 3D image for the emoji when we have one, else the plain emoji. */
const e3d = (emoji, cls = '') => emoji && HAS3D.has(e3dCode(emoji)) ? `<img class="e3d ${cls}" src="./e3d/${e3dCode(emoji)}.webp" alt="" draggable="false">` : esc(emoji || '');
function glyphHTML(c, it){ const sb = subOf(it); if(sb?.emoji) return e3d(sb.emoji); return c && c.emoji ? e3d(c.emoji) : `<span class="glyph-letter">${esc((c?.name || '?').charAt(0).toUpperCase())}</span>`; }
function countTo(el, key, to){
  const from = lastNum[key] ?? 0; lastNum[key] = to;
  if(from === to || document.hidden || reduceMotion()){ el.textContent = fmtMoney(to); return; }
  const t0 = performance.now(), dur = 750;
  const step = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmtMoney(Math.round(from + (to - from) * e)); if(p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function enterCls(id){ if(seen.has(id)) return ''; seen.add(id); return 'enter'; }
function barHTML(id, pct, color){ const from = prevPct[id] ?? 0; prevPct[id] = pct; return `<div class="track"><div class="bar" data-pct="${pct}" style="width:${from}%${color ? ';background:' + color : ''}"></div></div>`; }
function flushBars(){
  const apply = () => $$('.bar[data-pct]').forEach(b => { b.style.width = b.dataset.pct + '%'; b.removeAttribute('data-pct'); });
  if(document.hidden) return apply();
  requestAnimationFrame(() => requestAnimationFrame(apply));
}

function billStatus(it){
  const d = diffDays(T, it.due);
  if(d < 0) return { cls:'due', label:'Overdue', urgent:true, text:`Was due ${fmtDate(it.due)} · ${-d} day${d === -1 ? '' : 's'} ago` };
  if(paidRecently(it)) return { cls:'ok', label:'Paid ' + fmtShort(it.lastPaid), text:`Next due ${fmtDate(it.due)}` };
  if(d === 0) return { cls:'due', label:'Due today', urgent:true, text:fmtDate(it.due) };
  if(d === 1) return { cls:'due', label:'Due tomorrow', urgent:true, text:fmtDate(it.due) };
  if(d <= 7) return { cls:'soon', label:`Due in ${d} days`, text:fmtDate(it.due) };
  return { cls:'ok', label:'Upcoming', text:`Due ${fmtDate(it.due)}` };
}
function billCard(it, i){
  const c = cat(it.catId), st_ = billStatus(it);
  const pct = it.ongoing ? 0 : Math.round((it.tenureTotal - it.tenureLeft) / it.tenureTotal * 100);
  const unit = ev(it) === 1 ? 'months' : 'payments';
  const middle = it.ongoing
    ? `<div class="recurring">${ICON.repeat}Repeats every ${ev(it) === 1 ? 'month' : perLabel(ev(it))} · no end date</div>`
    : `<div class="progress-row"><div class="progress-labels"><span>Tenure <b>${it.tenureLeft} of ${it.tenureTotal} ${unit} left</b></span><span>${pct}%</span></div>${barHTML(it.id, pct)}</div>`;
  const figs = it.ongoing
    ? `<div class="fig"><span class="fig-label">Paid so far</span><span class="fig-value">${fmtMoney(it.paid)}</span></div><div class="fig"><span class="fig-label">Last paid</span><span class="fig-value">${it.lastPaid ? fmtShort(it.lastPaid) : '—'}</span></div>`
    : `<div class="fig"><span class="fig-label">Paid</span><span class="fig-value">${fmtMoney(it.paid)}</span></div><div class="fig"><span class="fig-label">Left</span><span class="fig-value">${fmtMoney(it.amount * it.tenureLeft)}</span></div>`;
  const recent = paidRecently(it);
  return `<article class="item-card ${enterCls(it.id)}" data-id="${it.id}" style="--accent:${catColor(c)};--i:${i}">
    <div class="ic-top"><div class="ic-id"><div class="glyph">${glyphHTML(c, it)}</div><div style="min-width:0"><div class="ic-name">${esc(it.name)}</div>
      <div class="ic-meta"><span class="badge ${st_.cls}">${st_.label}</span><span class="due-text ${st_.urgent ? 'urgent' : ''}">${st_.text}</span>${bankTagHTML(it)}${clipHTML(it)}</div></div></div>
      <div class="ic-amt"><div class="amt">${fmtMoney(it.amount)}</div><div class="per">/ ${perLabel(ev(it))}</div></div></div>
    ${middle}
    <div class="ic-foot"><div class="figs">${figs}</div><div class="actions">
      <button class="round-btn ghost" data-act="edit" aria-label="Edit ${esc(it.name)}">${ICON.edit}</button>
      <button class="pay-btn ${recent ? 'paid' : ''}" data-act="pay" aria-label="${recent ? 'Paid this cycle' : 'Mark as paid'}">${ICON.check}<span>${recent ? 'Paid' : 'Mark as paid'}</span></button></div></div>
  </article>`;
}
function chitCompact(it, i){
  const c = cat('chit'), r = it.roundsDone + 1, due = nextDue(it), d = diffDays(T, due);
  const pct = Math.round(it.roundsDone / it.members * 100), taken = !!it.taken, urgent = d <= 1;
  const dueTxt = d < 0 ? `Round ${r} was ${fmtDate(due)}` : d === 0 ? `Round ${r} · today` : d === 1 ? `Round ${r} · tomorrow` : `Round ${r} · ${fmtDate(due)}`;
  return `<article class="item-card ${enterCls(it.id)}" data-id="${it.id}" style="--accent:${taken ? 'var(--rose)' : catColor(c)};--i:${i}">
    <div class="ic-top"><div class="ic-id"><div class="glyph" style="--accent:${catColor(c)}">${glyphHTML(c)}</div><div style="min-width:0"><div class="ic-name">${esc(it.name)}</div>
      <div class="ic-meta">${d < 0 ? '<span class="badge due">Overdue</span>' : ''}<span class="badge ${taken ? 'debt' : 'save'}">${taken ? 'Taken · Debt' : 'Not taken · Savings'}</span><span class="due-text ${urgent ? 'urgent' : ''}">${dueTxt}</span>${clipHTML(it)}</div></div></div>
      <div class="ic-amt"><div class="amt">${fmtMoney(it.installment)}</div><div class="per">/ round</div></div></div>
    <div class="progress-row"><div class="progress-labels"><span>Rounds <b>${it.roundsDone} of ${it.members} done</b></span><span>${pct}%</span></div>${barHTML(it.id, pct)}</div>
    <div class="ic-foot"><div class="figs">
      <div class="fig"><span class="fig-label">Paid in</span><span class="fig-value">${fmtMoney(it.paidIn)}</span></div>
      ${taken ? `<div class="fig"><span class="fig-label">Still owe</span><span class="fig-value neg">${fmtMoney(it.installment * (it.members - it.roundsDone))}</span></div>`
              : `<div class="fig"><span class="fig-label">Commission</span><span class="fig-value pos">+${fmtMoney(it.commission)}</span></div>`}</div>
      <div class="actions"><button class="round-btn ghost" data-act="hist" aria-label="View all rounds">${ICON.history}</button><button class="round-btn ghost" data-act="edit" aria-label="Edit ${esc(it.name)}">${ICON.edit}</button>
      <button class="pay-btn" data-act="pay" aria-label="Mark round ${r} as paid">${ICON.check}<span>Mark as paid</span></button></div></div>
  </article>`;
}

function renderHeader(){
  const h = new Date().getHours();
  $('#greeting').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  $('#hdrName').textContent = displayName();
  $('#pfName').textContent = displayName();
  $('#pfEmail').textContent = user.email;
  renderAvatar();
  const se = st().settings, age = ageFrom(se.dob), tags = [];
  if(se.company) tags.push(['🏢', se.company]);
  if(age != null) tags.push(['🎂', `${age} yrs`]);
  if(se.city) tags.push(['📍', se.city]);
  $('#pfTags').innerHTML = tags.map(([e, t]) => `<span class="pf-tag">${e3d(e)}${esc(t)}</span>`).join('');
  $('#pfTags').classList.toggle('hidden', !tags.length);
}
function avatarHTML(){
  const a = st().settings.avatar;
  if(a?.type === 'photo' && /^data:image\/(jpeg|png|webp);base64,/.test(a.v)) return `<img class="pa-photo" src="${a.v}" alt="">`;
  if(a?.type === 'emoji' && a.v) return e3d(a.v, 'pa-3d');
  return `<span class="pa-letter">${esc(displayName().charAt(0).toUpperCase())}</span>`;
}
function renderAvatar(){
  const a = st().settings.avatar, kind = a?.type === 'photo' ? 'photo' : a?.type === 'emoji' ? 'emoji' : 'letter';
  const face = avatarHTML();
  $('#pfAvatarFace').innerHTML = face; $('#hdrAvatarFace').innerHTML = face;
  $('#pfAvatar').dataset.kind = kind; $('#hdrAvatar').dataset.kind = kind;
}

function renderHome(){
  const t = totals(), inc = st().settings.income;
  countTo($('#heroDebt'), 'debt', t.debt);
  $('#heroSub').innerHTML = t.debt > 0 && t.lastEnd ? `Debt-free by <b>${fmtMonth(t.lastEnd)}</b> if paid on time` : activeItems().length ? 'No outstanding debt 🎉' : 'Add an EMI or chit to get started';
  $('#ringFg').style.strokeDashoffset = String(226.19 * (1 - t.repaidPct / 100));
  $('#ringPct').textContent = t.repaidPct + '%';
  const incEl = $('#msIncome');
  if(inc == null){ incEl.textContent = '+ Add'; incEl.classList.add('add'); delete lastNum.inc; }
  else { incEl.classList.remove('add'); countTo(incEl, 'inc', inc); }
  countTo($('#msOut'), 'out', Math.round(t.monthly));
  countTo($('#msSave'), 'sav', t.savings);
  const act = activeItems(), counts = {};
  act.forEach(i => counts[i.catId] = (counts[i.catId] || 0) + 1);
  if(filter !== 'all' && !counts[filter]) filter = 'all';
  $('#chips').innerHTML = act.length ? `<button class="chip ${filter === 'all' ? 'active' : ''}" data-f="all">All <span class="n">${act.length}</span></button>` +
    st().cats.filter(c => counts[c.id]).map(c => `<button class="chip ${filter === c.id ? 'active' : ''}" data-f="${c.id}">${c.emoji ? e3d(c.emoji, 'chip-3d') : ''}${esc(c.name)} <span class="n">${counts[c.id]}</span></button>`).join('') : '';
  const list = act.filter(i => filter === 'all' || i.catId === filter);
  list.sort(sortMode === 'due' ? (a, b) => dayNum(nextDue(a)) - dayNum(nextDue(b)) : (a, b) => (b.kind === 'chit' ? b.installment : b.amount) - (a.kind === 'chit' ? a.installment : a.amount));
  $('#activeCount').textContent = list.length ? `(${list.length})` : '';
  $('#sortBtn').classList.toggle('hidden', list.length < 2);
  $('#cardList').innerHTML = list.length ? list.map((it, i) => it.kind === 'chit' ? chitCompact(it, i) : billCard(it, i)).join('')
    : `<div class="empty"><div class="em">${e3d('🗂️')}</div><b>Nothing tracked yet</b>Add your EMIs, bills and chit funds to see what's due and when you'll be debt-free.
       <div class="empty-actions"><button class="btn btn-primary btn-sm" data-empty="bill">Add EMI or bill</button><button class="btn btn-secondary btn-sm" data-empty="chit">Add chit fund</button></div></div>`;
}

function renderStats(){
  const t = totals();
  const rows = st().cats.map(c => ({ c, v: t.byCat[c.id] || 0 })).filter(r => r.v > 0).sort((a, b) => b.v - a.v);
  const total = rows.reduce((s, r) => s + r.v, 0), max = Math.max(1, ...rows.map(r => r.v));
  $('#outflowBar').innerHTML = rows.length ? rows.map(r => `<div class="bar-row"><div class="bar-row-top"><div class="bl"><span class="sw" style="background:${catColor(r.c)}"></span>${esc(r.c.name)}</div><div class="bv">${fmtMoney(Math.round(r.v))}</div></div>
      <div class="track" style="height:9px"><div class="bar" data-pct="${Math.round(r.v / max * 100)}" style="width:0;background:${catColor(r.c)}"></div></div></div>`).join('')
    : '<div class="empty" style="padding:20px">Nothing to chart yet.</div>';
  let acc = 0;
  const stops = rows.map(r => { const a = acc / total * 100; acc += r.v; return `${catColor(r.c)} ${a.toFixed(2)}% ${(acc / total * 100).toFixed(2)}%`; }).join(', ');
  $('#outflowDonut').innerHTML = rows.length ? `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${stops})"><div class="donut-hole"><b>${fmtMoney(Math.round(total))}</b><span>per month</span></div></div></div>` +
    rows.map(r => `<div class="dl-row"><span class="sw" style="background:${catColor(r.c)}"></span>${esc(r.c.name)}<em>${Math.round(r.v / total * 100)}%</em><b>${fmtMoney(Math.round(r.v))}</b></div>`).join('') : '<div class="empty" style="padding:20px">Nothing to chart yet.</div>';
  const src = byView === 'active' ? activeItems() : closedItems();
  $('#byList').innerHTML = src.length ? src.map((it, i) => { const c = cat(it.catId), paid = itemPaid(it), rem = itemRemaining(it);
    const pct = it.status === 'closed' ? 100 : it.kind === 'chit' ? Math.round(it.roundsDone / it.members * 100) : it.ongoing ? 0 : Math.round((it.tenureTotal - it.tenureLeft) / it.tenureTotal * 100);
    const sub = it.status === 'closed' ? `Closed ${fmtDate(it.closedOn)} · ${fmtMoney(paid)} paid`
      : it.kind === 'chit' ? `${fmtMoney(paid)} in · ${it.taken ? fmtMoney(rem) + ' owed' : '+' + fmtMoney(it.commission) + ' commission'}`
      : it.ongoing ? `${fmtMoney(paid)} paid · ongoing` : `${fmtMoney(paid)} paid · ${fmtMoney(rem)} left`;
    const subFull = sub + (it.lateFees ? ` · ${fmtMoney(it.lateFees)} late fees` : '');
    return `<div class="by-row" style="--accent:${catColor(c)};--i:${i}"><div class="glyph">${glyphHTML(c, it)}</div><div style="min-width:0"><div class="by-name">${esc(it.name)}</div><div class="by-sub">${subFull}</div>${it.ongoing ? '' : barHTML('by_' + it.id, pct, catColor(c))}</div>
      <button class="mini-btn" data-export="${it.id}" aria-label="Export ${esc(it.name)}">${ICON.export}</button></div>`; }).join('')
    : `<div class="empty" style="padding:20px">${byView === 'active' ? 'No active commitments.' : 'Finished EMIs and chits show up here.'}</div>`;
  const ds = t.debt + t.savings, dp = ds ? Math.round(t.debt / ds * 100) : 0;
  $('#splitBar').innerHTML = ds ? `<div class="split-seg" style="width:${dp}%;background:var(--rose)">${dp >= 12 ? dp + '%' : ''}</div><div class="split-seg" style="width:${100 - dp}%;background:var(--gold)">${100 - dp >= 12 ? (100 - dp) + '%' : ''}</div>` : '';
  $('#splitLegend').innerHTML = `<span class="lg"><span class="sw" style="background:var(--rose)"></span>Debt · ${fmtMoney(t.debt)}</span><span class="lg"><span class="sw" style="background:var(--gold)"></span>Savings · ${fmtMoney(t.savings)}</span>`;
  const inc = st().settings.income, ob = Math.round(t.monthly);
  if(inc == null){
    $('#incomeBars').innerHTML = `<div class="card-sub" style="margin-bottom:10px">Add your monthly income to see what's left after commitments.</div><button class="btn btn-secondary btn-sm" data-income>Add income</button>`;
  } else {
    const mx = Math.max(inc, ob, 1);
    $('#incomeBars').innerHTML = `<div class="bar-row"><div class="bar-row-top"><div class="bl"><span class="sw" style="background:var(--primary)"></span>Income</div><div class="bv">${fmtMoney(inc)}</div></div><div class="track" style="height:9px"><div class="bar" data-pct="${Math.round(inc / mx * 100)}" style="width:0;background:var(--primary)"></div></div></div>
      <div class="bar-row"><div class="bar-row-top"><div class="bl"><span class="sw" style="background:var(--rose)"></span>Obligations</div><div class="bv">${fmtMoney(ob)}</div></div><div class="track" style="height:9px"><div class="bar" data-pct="${Math.round(ob / mx * 100)}" style="width:0;background:var(--rose)"></div></div></div>
      <div class="card-sub" style="margin-top:10px">${inc >= ob ? `${fmtMoney(inc - ob)} left each month after commitments` : `Commitments exceed income by ${fmtMoney(ob - inc)}`}</div>`;
  }
}

function chitDetail(it, i){
  const c = cat('chit'), r = it.roundsDone + 1, due = nextDue(it), taken = !!it.taken, left = it.members - it.roundsDone;
  const meta = `${fmtMoney(it.pot)} · ${it.members} people · every ${it.interval === 1 ? 'month' : it.interval + ' months'}${it.agent ? ' · Agent ' + esc(it.agent) : ''}`;
  const dateBtn = `<button class="m-edit" data-act="date">${ICON.edit}Change date</button>`;
  let metrics, note;
  if(taken){
    const owe = it.installment * left, net = it.taken.received - (it.paidIn + owe);
    metrics = `<div class="metric"><div class="fig-label">Received</div><div class="fig-value">${fmtMoney(it.taken.received)}</div><div class="fig-sub">Round ${it.taken.round} · bid ${fmtMoney(it.taken.bid)}</div></div>
      <div class="metric"><div class="fig-label">Still owe</div><div class="fig-value neg">${fmtMoney(owe)}</div><div class="fig-sub">${left} round${left === 1 ? '' : 's'} × ${fmtMoney(it.installment)}</div></div>
      <div class="metric"><div class="fig-label">Next due${announced(it) ? ' · announced' : ''}</div><div class="fig-value">${fmtDate(due)}</div><div class="fig-sub">Round ${r} of ${it.members}</div>${dateBtn}</div>
      <div class="metric"><div class="fig-label">${net >= 0 ? 'Projected gain' : 'Projected cost'}</div><div class="fig-value ${net >= 0 ? 'pos' : 'neg'}">${fmtMoney(Math.abs(net))}</div><div class="fig-sub">${it.commission ? `Incl. +${fmtMoney(it.commission)} commission` : 'Received − total you\'ll pay'}</div></div>`;
    note = `You took the pot in round ${it.taken.round} with a bid of ${fmtMoney(it.taken.bid)}. You now pay the full ${fmtMoney(it.installment)} every round until it ends — counted as debt.${it.commission ? ` Before that you earned ${fmtMoney(it.commission)} in commission.` : ''}`;
  } else {
    metrics = `<div class="metric"><div class="fig-label">Paid in</div><div class="fig-value">${fmtMoney(it.paidIn)}</div><div class="fig-sub">${it.roundsDone} round${it.roundsDone === 1 ? '' : 's'}</div></div>
      <div class="metric"><div class="fig-label">Commission so far</div><div class="fig-value pos">+${fmtMoney(it.commission)}</div><div class="fig-sub">Your share of winning bids</div></div>
      <div class="metric"><div class="fig-label">Next auction${announced(it) ? ' · announced' : ''}</div><div class="fig-value">${fmtDate(due)}</div><div class="fig-sub">Round ${r} of ${it.members}</div>${dateBtn}</div>
      <div class="metric"><div class="fig-label">Still waiting</div><div class="fig-value">${it.members - it.roundsDone}</div><div class="fig-sub">people incl. you</div></div>`;
    note = `You haven't taken the pot yet. Each round you get a share of the winning bid, so you pay less — counted as savings until you take it.`;
  }
  return `<article class="chit-card ${enterCls('w_' + it.id)}" data-id="${it.id}" data-state="${taken ? 'taken' : 'saving'}" style="--i:${i}">
    <div class="chit-head"><div style="min-width:0"><div class="chit-name">${c?.emoji ? e3d(c.emoji, 'name-3d') : ''}${esc(it.name)} <button type="button" class="info-i" data-info="${esc(note)}" aria-label="What this means">i</button> ${clipHTML(it)}</div><div class="chit-meta">${meta}</div></div>
      <span class="status-pill ${taken ? 'debt' : 'save'}">${taken ? 'Debt' : 'Savings'}</span></div>
    <div class="progress-row"><div class="progress-labels"><span>Rounds <b>${it.roundsDone} of ${it.members}</b></span><span>${Math.round(it.roundsDone / it.members * 100)}%</span></div>${barHTML('w_' + it.id, Math.round(it.roundsDone / it.members * 100))}</div>
    <div class="metric-grid">${metrics}</div>
    <div class="chit-actions">
      <button class="btn btn-primary btn-grow nowrap" data-act="pay" aria-label="Mark round ${r} as paid">${ICON.check}Mark as paid</button>
      <button class="round-btn ghost" data-act="edit" aria-label="Edit">${ICON.edit}</button>
      <button class="round-btn ghost" data-act="hist" aria-label="View all rounds">${ICON.history}</button>
      <button class="round-btn ghost" data-export="${it.id}" aria-label="Export ${esc(it.name)}">${ICON.export}</button></div>
  </article>`;
}

function renderWallet(){
  const t = totals();
  countTo($('#whSave'), 'wsave', t.savings); countTo($('#whDebt'), 'wdebt', t.chitDebt);
  $('#whSaveFoot').textContent = `${t.savingCount} not taken · +${fmtMoney(t.savingComm)} commission`;
  $('#whDebtFoot').textContent = `${t.takenCount} taken · full amount each round`;
  const chits = activeItems().filter(i => i.kind === 'chit');
  $('#chitList').innerHTML = chits.length ? chits.map(chitDetail).join('') : `<div class="empty"><div class="em">${e3d('🤝')}</div><b>No active chit funds</b>Tap + to add one.</div>`;
  const cl = closedItems();
  $('#closedCount').textContent = cl.length ? `(${cl.length})` : '';
  $('#closedList').innerHTML = cl.length ? cl.map(it => { const c = cat(it.catId);
    const sub = it.kind === 'chit' ? `${it.members} rounds${it.taken ? ' · received ' + fmtMoney(it.taken.received) : ''}` : `${it.tenureTotal} months`;
    return `<div class="closed-row" data-id="${it.id}" style="--accent:${catColor(c)}"><div class="glyph">${glyphHTML(c, it)}</div><div style="min-width:0"><div class="cr-name">${esc(it.name)}</div><div class="cr-sub">Closed ${fmtDate(it.closedOn)} · ${sub}</div></div><div class="cr-amt"><span>Paid</span>${fmtMoney(itemPaid(it))}</div>
      ${it.kind === 'chit' ? `<button class="mini-btn" data-act="hist" aria-label="View all rounds of ${esc(it.name)}">${ICON.history}</button>` : ''}<button class="mini-btn" data-export="${it.id}" aria-label="Export ${esc(it.name)}">${ICON.export}</button></div>`; }).join('')
    : '<div class="empty" style="padding:22px">Completed EMIs and chits move here automatically.</div>';
}

function swatchesHTML(selected){
  const theme = st().settings.theme; selected = palKey(selected);
  return Object.entries(PALETTES).map(([k, p], i) => `<button class="swatch ${selected === k ? 'sel' : ''}" data-pal="${k}" style="${swatchStyle(k, theme)};--i:${i}" aria-label="${esc(p.name)} colours" aria-pressed="${selected === k}"><span class="sw-check">${ICON.check}</span></button>`).join('');
}
function renderProfile(){
  renderBanks();
  $('#catGrid').innerHTML = st().cats.map((c, i) => {
    const n = st().items.filter(it => it.catId === c.id && it.status === 'active').length;
    return `<button class="cat-card" data-cat="${c.id}" style="--accent:${catColor(c)};--i:${i}"><span class="cat-edit">${ICON.edit}</span><span class="glyph">${glyphHTML(c)}</span>
      <span class="cat-name">${esc(c.name)}</span><span class="cat-count">${n ? n + ' active' : c.optional ? 'Optional' : 'No items yet'}</span>
      <span class="cat-rem">${ICON.bell}${esc(remSummary(c.reminders))}</span></button>`; }).join('');
  $('#palGrid').innerHTML = swatchesHTML(st().settings.palette);
  $('#versionSub').textContent = isNative ? `Version ${APP_VERSION}` : 'Web version · updates automatically';
  $('#checkUpdateBtn').classList.toggle('hidden', !isNative);
}

let alertSig = '', seenSig = '';
function renderBell(){
  const a = computeAlerts(); alertSig = a.map(x => x.it.id + x.due).join('|');
  const bc = $('#bellCount'); bc.textContent = a.length; bc.classList.toggle('gone', !a.length || alertSig === seenSig);
}

function renderSync(s = syncStatus()){
  const pill = $('#syncPill'), txt = $('#syncText');
  let cls = 'synced', label, long;
  if(s.running){ cls = 'syncing'; label = 'Syncing'; long = 'Syncing…'; }
  else if(s.error === 'auth'){ cls = 'error'; label = 'Sign in'; long = 'Signed out — sign in again to sync'; }
  else if(!s.online){ cls = 'offline'; label = s.pending ? `Offline · ${s.pending}` : 'Offline'; long = s.pending ? `Offline — ${s.pending} change${s.pending > 1 ? 's' : ''} will upload when you're back online` : 'Offline — everything is saved on this phone'; }
  else if(s.error){ cls = 'error'; label = 'Retry'; long = 'Last sync failed — tap Sync now'; }
  else if(s.pending){ cls = 'pending'; label = `${s.pending} waiting`; long = `${s.pending} change${s.pending > 1 ? 's' : ''} waiting to upload`; }
  else { label = 'Synced'; long = 'All changes backed up'; }
  pill.className = 'sync-pill ' + cls; txt.textContent = label;
  pill.setAttribute('aria-label', long);
  $('#syncLabel').textContent = long;
  $('#syncSub').textContent = `Last synced ${ago(s.lastSync)}`;
}

function render(){ renderHeader(); renderHome(); renderStats(); renderLedger(); renderWallet(); renderProfile(); renderBell(); renderSync(); flushBars(); queueFabCheck(); }

export function applySettings(){
  const s = st().settings, root = document.documentElement, v = paletteVars(s.palette, s.theme);
  root.dataset.theme = s.theme; root.dataset.text = s.text; root.dataset.pitch = isPitch(s.palette) ? '1' : '0';
  Object.entries(TOKEN_MAP).forEach(([k, css]) => root.style.setProperty(css, v[k]));
  $('meta[name="theme-color"]')?.setAttribute('content', v.bg);
  setBarsStyle(s.theme);
  paintLogos();
  setSwitch('themeSwitch', s.theme === 'dark');
  root.dataset.bold = s.bold ? '1' : '0'; setSwitch('boldSwitch', !!s.bold);
  setSwitch('alertsSwitch', s.alertsOn);
  $$('#textSizeSeg .seg-btn').forEach(b => b.classList.toggle('sel', b.dataset.size === s.text));
  requestAnimationFrame(() => { moveAllThumbs(); moveNavInd(); });
}

/* ================================================================
   NAVIGATION
================================================================ */
const ORDER = ['home', 'ledger', 'wallet', 'profile', 'stats'];
const navPage = () => page === 'stats' ? 'profile' : page;   // Stats lives under Profile
function moveNavInd(){ const b = $(`.nav-item[data-page="${navPage()}"]`), ind = $('#navInd'); if(!b || !b.offsetWidth) return; ind.style.left = b.offsetLeft + 'px'; ind.style.width = b.offsetWidth + 'px'; }
function go(p){
  const dir = Math.sign(ORDER.indexOf(p) - ORDER.indexOf(page));
  page = p;
  $$('.screen').forEach(s => { s.style.setProperty('--dir', dir); s.classList.toggle('active', s.id === 'screen-' + p); });
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === navPage()));
  moveNavInd();
  const hasFab = p === 'home' || p === 'wallet' || p === 'ledger';
  $('#fab').classList.toggle('fab-hidden', !hasFab); $('#fab').classList.remove('fab-away');
  $('#app').classList.toggle('has-fab', hasFab);
  setTimeout(queueFabCheck, 450);
  window.scrollTo({ top:0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  requestAnimationFrame(moveAllThumbs);
}
export function handleBack(){
  if(forcedUpdate) return true;
  if(coachStep && !openStack.length) return true;
  if(handleBackInOverlays()) return true;
  if(page === 'stats'){ go('profile'); return true; }
  if(page !== 'home'){ go('home'); return true; }
  return false;
}
export function openItemFromNotification(id){
  if(String(id || '').startsWith('__plan')){ closeSheet(); return openPlan(id.split(':')[1]); }
  const it = id && findLend(id);
  closeSheet(); filter = 'all';
  if(!it) return go('home');
  if(it.kind === 'lend'){ go('ledger'); setTimeout(() => highlight(`#lgList [data-id="${id}"], #lgClosedList [data-id="${id}"]`), 380); return; }
  if(it.kind === 'chit'){ go('wallet'); setTimeout(() => highlight(`#chitList [data-id="${id}"]`), 380); }
  else { go('home'); renderHome(); flushBars(); setTimeout(() => highlight(`#cardList [data-id="${id}"]`), 380); }
}
function highlight(sel){ const el = $(sel); if(!el) return; el.scrollIntoView({ behavior:'smooth', block:'center' }); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }

function animateOut(id){
  return new Promise(res => { const els = $$(`[data-id="${id}"]`); if(!els.length) return res();
    els.forEach(el => el.classList.add('leaving')); seen.delete(id); seen.delete('w_' + id); setTimeout(res, 300); });
}
function flashCard(id){ $$(`[data-id="${id}"]`).forEach(el => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }); }

/** Where the + button rests (ignoring its hide animation), lifted above any toasts. */
function fabRect(f){
  const lift = parseFloat(String(f.style.translate || '').split(' ')[1]) || 0, top = f.offsetTop + lift;
  return { left:f.offsetLeft, right:f.offsetLeft + f.offsetWidth, top, bottom: top + f.offsetHeight };
}
let queueFabCheck = () => {};
function fabCheck(goingDown){
  const f = $('#fab'); if(!f || f.classList.contains('fab-hidden')) return;
  const r = fabRect(f), pad = 8;
  const covers = $$('.screen.active [data-act], .screen.active [data-export]').some(b => { const q = b.getBoundingClientRect();
    return q.width && q.right > r.left - pad && q.left < r.right + pad && q.bottom > r.top - pad && q.top < r.bottom + pad; });
  f.classList.toggle('fab-away', goingDown || covers);
}

function onCardAction(e){
  const ex = e.target.closest('[data-export]'); if(ex) return openExport(ex.dataset.export);
  const btn = e.target.closest('[data-act]'); if(!btn) return;
  const card = btn.closest('[data-id]'); const it = findItem(card.dataset.id); if(!it) return;
  const act = btn.dataset.act;
  if(act === 'edit') return it.kind === 'chit' ? openChitSheet(it) : openBillSheet(it);
  if(act === 'hist') return openChitRounds(it);
  if(act === 'files') return openFilesSheet(it);
  if(act === 'date') return openAuctionDate(it);
  if(act === 'pay'){ if(btn.dataset.busy) return; btn.dataset.busy = '1'; setTimeout(() => delete btn.dataset.busy, 700); return it.kind === 'chit' ? openRoundSheet(it) : payBill(it); }
}

/* ================================================================
   EMI / BILL
================================================================ */
function payBill(it){
  if(diffDays(T, it.due) < 0) return openLateSheet(it);
  if(paidRecently(it)) return confirmBox({ title:'Already paid this cycle', body:`You paid ${it.name} on ${fmtDate(it.lastPaid)}. Pay the ${fmtDate(it.due)} installment early?`, yes:'Yes, pay early', danger:false, onYes:() => doPay(it.id) });
  const last = !it.ongoing && it.tenureLeft === 1;
  confirmBox({ title:`Has ${it.name} been paid?`, body:`${fmtMoney(it.amount)} due ${fmtDate(it.due)}${it.bankId && bankById(it.bankId) ? ' · from ' + bankLabel(bankById(it.bankId)) : ''}.${last ? ' This is the last payment — it will move to Closed.' : ''}`,
    yes:'Yes, it\'s paid', danger:false, onYes:() => doPay(it.id) });
}
async function doPay(id, { date = T, fee = 0 } = {}){
  const it = findItem(id), closing = !it.ongoing && it.tenureLeft === 1, name = it.name, amt = it.amount;
  if(closing) await animateOut(id);
  const newDue = addMonths(it.due, ev(it), it.anchorDay);
  commit(() => {
    const x = findItem(id);
    x.paid += x.amount; x.lastPaid = date;
    x.history.push({ date, amount:x.amount, n: x.ongoing ? null : x.tenureTotal - x.tenureLeft + 1, ...(fee ? { lateFee:fee } : {}) });
    if(fee) x.lateFees = round2((x.lateFees || 0) + fee);
    if(!x.ongoing) x.tenureLeft -= 1;
    if(!x.ongoing && x.tenureLeft === 0){ x.status = 'closed'; x.closedOn = T; }
    else x.due = newDue;
  }, closing ? { type:'success', title:`${name} fully paid 🎉`, body:'Moved to Closed in Chits.' }
             : { type:'success', title: date !== T && !fee ? 'Marked as paid on time' : 'Marked as paid', body:`${name} · ${fmtMoney(amt)}${fee ? ` + ${fmtMoney(fee)} late charges` : ''} · next due ${fmtDate(newDue)}` });
  if(!closing) flashCard(id);
}

/* ---------- paying an overdue bill: on time (forgot to mark) or late with charges ---------- */
let lateItem = null, lateMode = null;
function openLateSheet(it){
  lateItem = it; lateMode = null; clearForm('lateSheet');
  const days = -diffDays(T, it.due);
  $('#ltTitle').textContent = `${it.name} was due ${fmtDate(it.due)}`;
  $('#ltSub').textContent = `That's ${days} day${days === 1 ? '' : 's'} ago · ${fmtMoney(it.amount)}${it.bankId && bankById(it.bankId) ? ' from ' + bankLabel(bankById(it.bankId)) : ''}`;
  $('#ltDate').min = addDays(it.due, 1); $('#ltDate').max = T; $('#ltDate').value = T;
  setNum('ltFee', '');
  drawLate();
  openSheet('lateSheet');
}
function drawLate(){
  const it = lateItem, late = lateMode === 'late', fee = num($('#ltFee').value || 0) || 0;
  $$('#ltChoice .choice').forEach(b => b.classList.toggle('sel', (b.dataset.late === '1') === late && lateMode !== null));
  $('#ltLateFields').classList.toggle('hidden', !late);
  $('#ltCalc').classList.toggle('hidden', !lateMode);
  $('#ltCalc').innerHTML = !lateMode ? '' : late
    ? `<div class="calc-line"><span>Installment</span><b>${fmtMoney(it.amount)}</b></div><div class="calc-line"><span>Late charges</span><b class="neg">${fee ? '+ ' + fmtMoney(fee) : '—'}</b></div>
       <div class="calc-line total"><span>Total paid</span><b>${fmtMoney(it.amount + fee)}</b></div>`
    : `<div class="calc-line"><span>Recorded as paid on</span><b>${fmtDate(it.due)}</b></div><div class="calc-line total"><span>Amount</span><b>${fmtMoney(it.amount)}</b></div>`;
  const btn = $('#ltSave'); btn.disabled = !lateMode;
  btn.textContent = !lateMode ? 'Choose an option' : late ? 'Mark as paid late' : 'Mark as paid on time';
  footShadow($('#lateSheet'));
}
function saveLate(){
  const it = lateItem; if(!it || !lateMode) return;
  let date = it.due, fee = 0;
  if(lateMode === 'late'){
    clearForm('lateSheet');
    date = $('#ltDate').value; fee = num($('#ltFee').value || 0) || 0;
    let bad = setInvalid('ltDateG', !date || diffDays(it.due, date) <= 0 || diffDays(T, date) > 0);
    bad += setInvalid('ltFeeG', !(fee >= 0 && fee <= 1e5));
    if(bad) return;
  }
  closeSheet('lateSheet');
  doPay(it.id, { date, fee:round2(fee) });
}

/* ---------- documents attached to a commitment (shared by both forms) ---------- */
const att = { list:[], fresh:new Map(), removed:[], root:null, alertId:'' };
const fmtSize = n => n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
function attStart(rootId, alertId, files){ att.root = $('#' + rootId); att.alertId = alertId; att.list = clone(files || []); att.fresh = new Map(); att.removed = []; drawAtt(); }
function attRow(a, removable){
  const img = /^image\//.test(a.type);
  return `<div class="att-item" data-att="${a.id}" role="button" tabindex="0"><span class="att-thumb ${img ? 'img' : ''}">${img ? '🖼️' : 'PDF'}</span>
    <span style="min-width:0;flex:1"><span class="att-name">${esc(a.name)}</span><span class="att-sub">${img ? 'Photo' : 'PDF'} · ${fmtSize(a.size)}${a.path ? '' : ' · uploads when online'}</span></span>
    ${removable ? `<button type="button" class="att-x" data-att-x="${a.id}" aria-label="Remove ${esc(a.name)}">${ICON.x}</button>` : ''}</div>`;
}
async function fillThumbs(root, list, fresh){
  for(const a of list){
    if(!/^image\//.test(a.type)) continue;
    const b = fresh?.get(a.id);
    const url = b ? URL.createObjectURL(b) : await thumbUrl(a);
    const t = root.querySelector(`[data-att="${a.id}"] .att-thumb`);
    if(url && t) t.innerHTML = `<img src="${url}" alt="">`;
  }
}
function drawAtt(){
  const full = att.list.length >= MAX_FILES;
  att.root.innerHTML = att.list.map(a => attRow(a, true)).join('') +
    `<button type="button" class="att-add" data-att-add ${full ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>${full ? 'Maximum 3 documents' : `Add photo or PDF (${att.list.length}/${MAX_FILES})`}</button>`;
  fillThumbs(att.root, att.list, att.fresh);
  footShadow(att.root.closest('.sheet-overlay'));
}
async function attPicked(file){
  showAlert(att.alertId, '');
  try{
    const { meta, blob } = await prepareFile(file);
    att.list.push(meta); att.fresh.set(meta.id, blob); drawAtt();
  }catch(e){ showAlert(att.alertId, e instanceof FileError ? e.message : 'That file couldn\'t be added.'); }
}
function attClick(e){
  if(e.target.closest('[data-att-add]')){ const p = $('#filePicker'); p.value = ''; p.click(); return; }
  const x = e.target.closest('[data-att-x]');
  if(x){ const a = att.list.find(f => f.id === x.dataset.attX); att.list = att.list.filter(f => f !== a); att.fresh.delete(a.id); if(a.path) att.removed.push(a.path); drawAtt(); return; }
  const row = e.target.closest('[data-att]'); if(!row) return;
  const a = att.list.find(f => f.id === row.dataset.att), b = att.fresh.get(a.id);
  (b ? openBlob(b, a) : openAttachment(a)).catch(err => showAlert(att.alertId, err instanceof FileError ? err.message : 'Couldn\'t open that file.'));
}
/** Saves new blobs locally and returns the final file list for the item. */
async function attCommit(){
  for(const [id, blob] of att.fresh) await putLocal(id, blob);
  const removed = [...att.removed];
  return { files: att.list, afterSave: () => removed.forEach(queueFileDelete) };
}
function openFilesSheet(it){
  $('#fsTitle').textContent = `${it.name} · documents`;
  const root = $('#fsList');
  root.innerHTML = (it.files || []).map(a => attRow(a, false)).join('') || '<div class="empty" style="padding:20px">No documents.</div>';
  root.onclick = e => { const row = e.target.closest('[data-att]'); if(!row) return; const a = it.files.find(f => f.id === row.dataset.att);
    openAttachment(a).catch(err => toast({ type:'error', title:'Couldn\'t open the file', body: err instanceof FileError ? err.message : 'Please try again.' })); };
  fillThumbs(root, it.files || []);
  openSheet('filesSheet');
}
const queueItemFiles = it => (it.files || []).forEach(a => a.path && queueFileDelete(a.path));

let editingBill = null, billRemTouched = false, billRem, subTouched = false;
function fillSubSelect(selected){
  const c = cat($('#bCat').value), subs = c?.subs || [];
  $('#bSub').innerHTML = `<option value="">${subs.length ? 'Not set' : 'No types'}</option>` + subs.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  setSelect('bSub', selected && subs.some(x => x.id === selected) ? selected : '');
  $('#bSubG').classList.toggle('hidden', !subs.length);
  const noun = !c || c.id === 'emi' ? 'EMI' : c.id === 'household' ? 'household bill' : c.name.toLowerCase().replace(/s$/, '');
  $('#billSave').textContent = (editingBill ? 'Update ' : 'Add ') + noun;
}
/** Picks a type from words in the name ("Car loan" → Car loan) until the user chooses one. */
function guessSub(){
  if(subTouched) return;
  const name = $('#bName').value.toLowerCase(), subs = cat($('#bCat').value)?.subs || [];
  const hit = subs.find(x => { const w = x.name.toLowerCase().split(/[^a-z]+/)[0]; return w.length > 2 && new RegExp(`\\b${w}`).test(name); });
  if(hit && $('#bSub').value !== hit.id) setSelect('bSub', hit.id);
}
const billCats = () => st().cats.filter(c => c.kind === 'bill');
function syncBillForm(){
  const ongoing = isOn('bOngoing'), every = num($('#bEvery').value) || 1;
  $('#bTenureRow').classList.toggle('hidden', ongoing);
  $('#bTenLabel').innerHTML = (every === 1 ? 'Total months' : 'Total payments') + ' <span class="req">*</span>';
  $('#bPaidG label').textContent = editingBill ? (every === 1 ? 'Months paid (tracked)' : 'Payments made (tracked)') : (every === 1 ? 'Months already paid' : 'Payments already made');
  const ten = num($('#bTen').value), paidM = num($('#bPaidM').value || 0), due = $('#bDue').value, hint = $('#bTenHint');
  const done = editingBill && !editingBill.ongoing ? editingBill.tenureTotal - editingBill.tenureLeft : paidM;
  if(!ongoing && isInt(ten) && ten > 0 && due && ten - done >= 1){
    const end = addMonths(due, (ten - done - 1) * every);
    hint.textContent = `${ten - done} payment${ten - done === 1 ? '' : 's'} left · last one around ${fmtMonth(end)}`;
  } else hint.textContent = '';
  hint.classList.toggle('hidden', ongoing || !hint.textContent);
  footShadow($('#billSheet'));
}
function openBillSheet(it){
  editingBill = it; clearForm('billSheet');
  $('#bCat').innerHTML = billCats().map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('#billTitle').textContent = it ? 'Edit ' + it.name : 'Add EMI or bill';
  $('#bName').value = it ? it.name : '';
  setSelect('bCat', it && cat(it.catId) ? it.catId : (billCats()[0]?.id || ''));
  setSelect('bEvery', String(it ? ev(it) : 1));
  fillBankSelect(it?.bankId);
  subTouched = !!it?.subId; fillSubSelect(it?.subId);
  setNum('bAmt', it ? it.amount : '');
  setSwitch('bOngoing', it ? it.ongoing : false);
  setNum('bTen', it && !it.ongoing ? it.tenureTotal : '');
  setNum('bPaidM', it && !it.ongoing ? it.tenureTotal - it.tenureLeft : 0);
  $('#bPaidM').disabled = !!it;
  $('#bDue').value = it ? it.due : addDays(T, 7);
  $('#bDuePast').classList.toggle('hidden', !it || diffDays(T, it.due) >= 0);
  billRemTouched = !!(it && it.reminders);
  billRem.set(it ? effReminders(it) : (cat($('#bCat').value)?.reminders || [1]));
  billRem.setNote(billRemTouched ? 'Custom for this entry' : 'Category default');
  attStart('bFiles', 'billAlert', it?.files);
  $('#billDelete').classList.toggle('hidden', !it);
  syncBillForm();
  openSheet('billSheet');
}
async function saveBill(){
  clearForm('billSheet');
  const name = $('#bName').value.trim(), catId = $('#bCat').value, amt = num($('#bAmt').value), ongoing = isOn('bOngoing'), every = num($('#bEvery').value) || 1;
  const ten = num($('#bTen').value), paidM = num($('#bPaidM').value || 0), due = $('#bDue').value, bankId = $('#bBank').value || null, subId = $('#bSub').value || null;
  let bad = 0;
  bad += setInvalid('bNameG', !name);
  bad += setInvalid('bAmtG', !(amt >= 1 && amt <= 1e8));
  if(!ongoing){
    const paidSoFar = editingBill && !editingBill.ongoing ? editingBill.tenureTotal - editingBill.tenureLeft : 0;
    if(editingBill && !editingBill.ongoing) bad += setInvalid('bTenG', !(isInt(ten) && ten > paidSoFar && ten <= 600), 'bTenErr', `Must be more than the ${paidSoFar} already paid (max 600).`);
    else bad += setInvalid('bTenG', !(isInt(ten) && ten >= 1 && ten <= 600), 'bTenErr', 'Enter 1 – 600.');
    if(!editingBill) bad += setInvalid('bPaidG', !(isInt(paidM) && paidM >= 0 && (!isInt(ten) || paidM < ten)), 'bPaidErr', 'Must be less than the total.');
  }
  bad += setInvalid('bDueG', !due);
  if(bad){ showAlert('billAlert', `Please fix ${bad} highlighted field${bad > 1 ? 's' : ''}.`); scrollToError('billSheet'); return; }
  const rem = billRemTouched ? billRem.get() : null;
  const { files, afterSave } = await attCommit();
  closeSheet('billSheet');
  if(editingBill){
    const id = editingBill.id;
    commit(() => {
      const x = findItem(id), paidMonths = x.ongoing ? 0 : x.tenureTotal - x.tenureLeft;
      Object.assign(x, { name, catId, subId, amount:amt, every, ongoing, due, anchorDay:parseISO(due).getDate(), reminders:rem, files, bankId });
      if(ongoing){ x.tenureTotal = null; x.tenureLeft = null; } else { x.tenureTotal = ten; x.tenureLeft = ten - paidMonths; }
    }, { type:'success', title:'Changes saved', body:name });
    afterSave();
    flashCard(id);
  } else {
    const id = uid();
    commit(() => {
      const b = { id, kind:'bill', catId, subId, name, amount:amt, every, ongoing, bankId, tenureTotal: ongoing ? null : ten, tenureLeft: ongoing ? null : ten - paidM,
        paid: ongoing ? 0 : amt * paidM, due, anchorDay: parseISO(due).getDate(), reminders:rem, lastPaid:null, history:[], status:'active', files };
      if(!ongoing && paidM > 0) b.history.push({ date:T, amount: amt * paidM, n: paidM, opening:true });
      st().items.push(b);
      filter = 'all';
    }, { type: diffDays(T, due) < 0 ? 'warning' : 'success', title: name + ' added', body: diffDays(T, due) < 0 ? 'Its due date has passed, so it shows as Overdue.' : `Reminders: ${remSummary(rem ?? cat(catId).reminders)}` });
    go('home');
    setTimeout(() => highlight(`#cardList [data-id="${id}"]`), 380);
  }
  maybeAskNotify();
}
function deleteBill(){
  const it = editingBill; if(!it) return;
  closeSheet('billSheet');
  confirmBox({ title:`Delete ${it.name}?`, body:'It will be removed from your commitments and totals, with its documents. You can undo right after.', onYes: async () => {
    await animateOut(it.id);
    commit(() => { st().items = st().items.filter(i => i.id !== it.id); }, { type:'warning', title:'Deleted', body:it.name });
    queueItemFiles(it);
  }});
}

/* ================================================================
   CHIT FUND
================================================================ */
let editingChit = null, chitRemTouched = false, instTouched = false, chitRem;
function chitSummary(){
  const p = num($('#cPot').value), m = num($('#cMem').value), inst = num($('#cInst').value), iv = num($('#cInt').value), s = $('#cStart').value;
  if(!(p > 0) || !(m >= 2) || !s){ $('#chitSummary').innerHTML = 'Fill in the value, people and start date to see the schedule.'; return; }
  const done = num($('#cDone').value), lastDate = isOn('cProg') && !editingChit && isInt(done) && done > 0 && done < m && $(`#cRounds .round-row[data-r="${done}"] [data-f="date"]`)?.value;
  const anchor = lastDate ? { anchorRound:done, anchorDate:lastDate } : editingChit?.anchorRound ? { anchorRound:editingChit.anchorRound, anchorDate:editingChit.anchorDate } : {};
  const fake = { start:s, interval:iv, ...anchor }, end = roundDate(fake, m), coll = (inst || 0) * m;
  let html = `<b>${m} rounds</b> · every ${iv === 1 ? 'month' : iv + ' months'}<br>${fmtDate(s)} → <b>${fmtDate(end)}</b>`;
  if(inst > 0) html += `<br>${fmtMoney(inst)} × ${m} people = <b>${fmtMoney(coll)}</b> ` + (Math.abs(coll - p) < 1 ? '✓ matches the chit value' : `<span class="warn">— doesn't match ${fmtMoney(p)}</span>`);
  if(isOn('cAgentFirst')) html += '<br>Round 1 goes to the agent (no auction).';
  if(isOn('cProg') && !editingChit){ const d = num($('#cDone').value); if(isInt(d) && d >= 0 && d < m){
    const nd = roundDate(fake, d + 1);
    html += `<br>Next: <b>round ${d + 1}</b> around <b>${fmtDate(nd)}</b>${lastDate ? ` — ${iv === 1 ? 'a month' : iv + ' months'} after round ${d}` : ''}. You can change it once it's announced.`; } }
  $('#chitSummary').innerHTML = html;
}

/* ---------- past auctions, one row each ---------- */
let roundRows = [];
const MAX_PAST = 100;
function rowKind(r, agentFirst, takenR){ if(agentFirst && r === 1) return 'agent'; if(takenR && r === takenR) return 'taken'; if(takenR && r > takenR) return 'full'; return 'auction'; }
function readRounds(){
  $$('#cRounds .round-row').forEach(row => {
    const o = roundRows[+row.dataset.r - 1] ||= {};
    o.date = row.querySelector('[data-f="date"]').value;
    o.paid = row.querySelector('[data-f="paid"]').value;
    const c = row.querySelector('[data-f="comm"]'); if(c) o.comm = c.value;
    const b = row.querySelector('[data-f="bid"]'); if(b) o.bid = b.value;
  });
}
function roundsMeta(){
  const n = num($('#cDone').value || 0), m = num($('#cMem').value), takenR = isOn('cTaken') ? num($('#cTakenR').value) : NaN;
  return { count: isInt(n) && n > 0 ? Math.min(n, isInt(m) && m > 1 ? m - 1 : MAX_PAST, MAX_PAST) : 0, I: num($('#cInst').value),
    s: $('#cStart').value, iv: num($('#cInt').value) || 1, af: isOn('cAgentFirst'), takenR: isInt(takenR) ? takenR : null };
}
function drawRounds(){
  const box = $('#cRounds');
  if(!isOn('cProg') || editingChit){ box.innerHTML = ''; $('#cRoundsTotal').textContent = ''; return; }
  readRounds();
  const { count, I, s, iv, af, takenR } = roundsMeta();
  let html = '';
  for(let r = 1; r <= count; r++){
    const o = roundRows[r - 1] ||= {}, kind = rowKind(r, af, takenR);
    const date = o.date || (s ? roundDate({ start:s, interval:iv }, r) : '');
    const comm = kind === 'auction' ? (o.comm ?? '') : '';
    const paid = o.paidTouched ? o.paid : (I > 0 ? fmtNumInput(String(round2(I - (num(comm) || 0))), true) : (o.paid || ''));
    const tag = kind === 'agent' ? '<span class="tag agent">Agent\'s round</span>' : kind === 'taken' ? '<span class="tag taken">You took the pot · full amount</span>' : kind === 'full' ? '<span class="tag full">Full amount</span>' : '';
    html += `<div class="round-row" data-r="${r}"><div class="round-row-head"><span>Round ${r}</span>${tag}</div><div class="rr-grid">
      <div class="fgroup rr-date" id="rr${r}dG"><label>Date</label><input type="date" data-f="date" value="${date}" max="${T}"></div>
      <div class="fgroup" id="rr${r}pG"><label>You paid</label><div class="money-wrap"><input type="text" inputmode="decimal" data-money data-f="paid" value="${paid}" autocomplete="off"></div></div>
      ${kind === 'auction'
        ? `<div class="fgroup" id="rr${r}cG"><label>Commission</label><div class="money-wrap"><input type="text" inputmode="decimal" data-money data-f="comm" value="${comm}" placeholder="0" autocomplete="off"></div></div>`
        : kind === 'taken'
        ? `<div class="fgroup" id="rr${r}bG"><label>Your bid <span class="req">*</span></label><div class="money-wrap"><input type="text" inputmode="decimal" data-money data-f="bid" value="${o.bid ?? ''}" placeholder="10,000" autocomplete="off"></div></div>`
        : `<div class="fgroup"><label>Commission</label><div class="money-wrap"><input type="text" value="0" disabled></div></div>`}
    </div></div>`;
  }
  box.innerHTML = html;
  $$('[data-money]', box).forEach(bindNumeric);
  roundsTotal();
  footShadow($('#chitSheet'));
}
function roundsTotal(){
  readRounds();
  const { count, af, takenR } = roundsMeta(), pot = num($('#cPot').value);
  let paid = 0, comm = 0;
  for(let i = 0; i < count; i++){ paid += num(roundRows[i]?.paid) || 0; if(rowKind(i + 1, af, takenR) === 'auction') comm += num(roundRows[i]?.comm) || 0; }
  const bid = takenR && takenR <= count ? num(roundRows[takenR - 1]?.bid) : NaN;
  $('#cRoundsTotal').innerHTML = count ? `${count} round${count === 1 ? '' : 's'} · you paid <b>${fmtMoney(paid)}</b><br>Total commission <b class="pos">+${fmtMoney(comm)}</b>`
    + (bid >= 0 ? `<br>Took the pot in round ${takenR} · bid <b>${fmtMoney(bid)}</b>${pot > bid ? ` · received <b>${fmtMoney(pot - bid)}</b>` : ''}` : '') : '';
}
/** Paid and commission add up to the installment: changing either one fills in the other. */
function linkPaidComm(row, f, I){
  const paid = row.querySelector('[data-f="paid"]'), comm = row.querySelector('[data-f="comm"]');
  if(!(I > 0) || !paid || !comm || (f !== 'paid' && f !== 'comm')) return;
  const src = f === 'paid' ? paid : comm, dst = f === 'paid' ? comm : paid, v = num(src.value);
  if(src.value.trim() === '' || !(v >= 0)) return;
  dst.value = fmtNumInput(String(round2(Math.max(0, I - v))), true);
}
function onRoundsInput(e){
  if(e.target.dataset.f === 'date') chitSummary();
  const f = e.target.dataset.f, row = e.target.closest('.round-row'); if(!row) return;
  const o = roundRows[+row.dataset.r - 1] ||= {};
  if(f === 'paid' && !row.querySelector('[data-f="comm"]')) o.paidTouched = true;
  linkPaidComm(row, f, num($('#cInst').value));
  roundsTotal();
}

function openChitSheet(it){
  editingChit = it; clearForm('chitSheet');
  const locked = !!(it && it.history.length);
  $('#chitTitle').textContent = it ? 'Edit ' + it.name : 'Add chit fund';
  $('#chitSave').textContent = it ? 'Update chit fund' : 'Add chit fund';
  $('#cName').value = it ? it.name : ''; $('#cAgent').value = it ? it.agent || '' : '';
  setNum('cPot', it ? it.pot : ''); setNum('cMem', it ? it.members : '');
  setNum('cInst', it ? it.installment : ''); instTouched = !!it;
  setSelect('cInt', it ? String(it.interval) : '1');
  $('#cStart').value = it ? it.start : T;
  setNum('cAgComm', it && it.agentCut ? it.agentCut : '');
  setSwitch('cAgentFirst', it ? it.agentFirst : true);
  ['cPot', 'cMem', 'cInst', 'cInt', 'cStart'].forEach(id => $('#' + id).disabled = locked);
  $('#cInt')._dd.sync();
  if(locked) $('#cAgentFirst').dataset.locked = '1'; else delete $('#cAgentFirst').dataset.locked;
  $('#cAgentFirstRow').style.opacity = locked ? .55 : 1;
  $('#chitLock').classList.toggle('hidden', !locked);
  $('#cProgRow').classList.toggle('hidden', !!it); setSwitch('cProg', false); $('#cProgFields').classList.add('hidden');
  $('#cEditRoundsRow').classList.toggle('hidden', !locked); setSwitch('cEditRounds', false); $('#cEditRoundsFields').classList.add('hidden'); $('#cEditList').innerHTML = '';
  roundRows = [];
  setNum('cDone', 0); setSwitch('cTaken', false); $('#cTakenFields').classList.add('hidden'); setNum('cTakenR', '');
  drawRounds();
  chitRemTouched = !!(it && it.reminders);
  chitRem.set(it ? effReminders(it) : (cat('chit')?.reminders || [1]));
  chitRem.setNote(chitRemTouched ? 'Custom for this chit' : 'Category default');
  attStart('cFiles', 'chitAlert', it?.files);
  $('#chitDelete').classList.toggle('hidden', !it);
  chitSummary();
  openSheet('chitSheet');
}
async function saveChit(){
  clearForm('chitSheet');
  const name = $('#cName').value.trim(), agent = $('#cAgent').value.trim(), pot = num($('#cPot').value), m = num($('#cMem').value);
  const inst = num($('#cInst').value), iv = num($('#cInt').value), s = $('#cStart').value, agCut = num($('#cAgComm').value || 0), agentFirst = isOn('cAgentFirst');
  let bad = 0;
  bad += setInvalid('cNameG', !name);
  bad += setInvalid('cPotG', !(pot >= 1 && pot <= 1e9));
  bad += setInvalid('cMemG', !(isInt(m) && m >= 2 && m <= 100));
  bad += setInvalid('cInstG', !(inst >= 1 && inst <= 1e9));
  bad += setInvalid('cStartG', !s);
  bad += setInvalid('cAgCommG', !(agCut >= 0 && (!(pot > 0) || agCut < pot)));
  let past = null;
  if(!editingChit && isOn('cProg')){
    const done = num($('#cDone').value || 0);
    bad += setInvalid('cDoneG', !(isInt(done) && done >= 0 && (!isInt(m) || done < m)), 'cDoneErr', `Enter 0 – ${isInt(m) ? m - 1 : 'people − 1'}. A chit with every round done is already closed.`);
    let taken = null;
    readRounds();
    if(isOn('cTaken')){
      const tr = num($('#cTakenR').value), minR = agentFirst ? 2 : 1, okR = isInt(tr) && tr >= minR && isInt(done) && tr <= done;
      bad += setInvalid('cTakenRG', !okR, 'cTakenRErr', done >= minR ? `Pick round ${minR} – ${done}.` : `Complete at least round ${minR} first.`);
      const tb = okR ? num(roundRows[tr - 1]?.bid) : 0;
      if(okR) bad += setInvalid(`rr${tr}bG`, !(tb >= 0 && (!(pot > 0) || tb < pot)));
      taken = { round:tr, bid:round2(tb || 0), received: round2(pot - (tb || 0)) };
    }
    const rows = [];
    if(isInt(done) && done > 0 && done < m){
      for(let r = 1; r <= done; r++){
        const o = roundRows[r - 1] || {}, kind = rowKind(r, agentFirst, taken?.round), paid = num(o.paid), comm = kind === 'auction' ? (num(o.comm || 0)) : 0;
        bad += setInvalid(`rr${r}dG`, !o.date || diffDays(T, o.date) > 0);
        bad += setInvalid(`rr${r}pG`, !(paid >= 0 && (!(inst > 0) || paid <= inst)));
        if(kind === 'auction') bad += setInvalid(`rr${r}cG`, !(comm >= 0 && (!(inst > 0) || comm <= inst)));
        rows.push({ r, kind, date:o.date, paid, comm });
      }
    }
    past = { done, taken, rows };
  }
  const editRows = editingChit && isOn('cEditRounds') ? readEditRounds() : null;
  if(editRows) bad += validateEditRounds(editRows);
  if(bad){ showAlert('chitAlert', `Please fix ${bad} highlighted field${bad > 1 ? 's' : ''}.`); scrollToError('chitSheet'); return; }
  const rem = chitRemTouched ? chitRem.get() : null;
  const { files, afterSave } = await attCommit();
  closeSheet('chitSheet');
  if(editingChit){
    const id = editingChit.id;
    commit(() => { const x = findItem(id); Object.assign(x, { name, agent, agentCut:agCut, reminders:rem, files });
      if(!x.history.length) Object.assign(x, { pot, members:m, installment:inst, interval:iv, start:s, agentFirst });
      if(editRows) applyEditRounds(x, editRows); },
      { type:'success', title:'Chit updated', body: editRows ? `${name} · ${editRows.length} round${editRows.length === 1 ? '' : 's'} updated` : name });
    afterSave();
    flashCard(id);
  } else {
    const id = uid();
    commit(() => {
      const c = { id, kind:'chit', catId:'chit', name, agent, pot, members:m, installment:inst, interval:iv, start:s, agentFirst, agentCut:agCut,
        roundsDone:0, taken:null, paidIn:0, commission:0, reminders:rem, status:'active', history:[], files };
      if(past && past.rows.length){
        for(const row of past.rows){
          const base = { round:row.r, date:row.date, paid:round2(row.paid) };
          c.history.push(row.kind === 'agent' ? { ...base, type:'agent', share:0 }
            : row.kind === 'taken' ? { ...base, type:'taken', bid:past.taken.bid, received:past.taken.received, share:0 }
            : row.kind === 'full' ? { ...base, type:'full', share:0 }
            : { ...base, type:'commission', bid:null, share:round2(row.comm) });
        }
        c.roundsDone = past.rows.length;
        c.paidIn = round2(c.history.reduce((s_, h) => s_ + h.paid, 0));
        c.commission = round2(c.history.reduce((s_, h) => s_ + (h.share || 0), 0));
        c.taken = past.taken;
        const last = c.history[c.history.length - 1];
        c.anchorRound = last.round; c.anchorDate = last.date;
      }
      st().items.push(c);
    }, { type:'success', title:name + ' added', body: past?.taken ? 'Tracked as debt — you\'ve taken the pot.' : 'Tracked as savings until you take the pot.' });
    go('wallet');
  }
  maybeAskNotify();
}
function deleteChit(){
  const it = editingChit; if(!it) return;
  closeSheet('chitSheet');
  confirmBox({ title:`Delete ${it.name}?`, body:`All ${it.history.length} recorded round${it.history.length === 1 ? '' : 's'} and its documents will be removed too. You can undo right after.`, onYes: async () => {
    await animateOut(it.id);
    commit(() => { st().items = st().items.filter(i => i.id !== it.id); }, { type:'warning', title:'Chit deleted', body:it.name });
    queueItemFiles(it);
  }});
}

/* ---------- every round of a chit, past and upcoming ---------- */
function openChitRounds(it){
  const done = it.history.length, next = it.roundsDone + 1;
  $('#crTitle').textContent = `${it.name} · rounds`;
  $('#crSub').textContent = `${it.roundsDone} of ${it.members} done · ${fmtMoney(it.pot)} · every ${it.interval === 1 ? 'month' : it.interval + ' months'}`;
  $('#crSummary').innerHTML = `<div class="calc-line"><span>You've paid in</span><b>${fmtMoney(it.paidIn)}</b></div>
    <div class="calc-line"><span>Total commission</span><b class="pos">+${fmtMoney(it.commission)}</b></div>
    ${it.taken ? `<div class="calc-line"><span>Took the pot in round ${it.taken.round}${it.taken.bid ? ` · bid ${fmtMoney(it.taken.bid)}` : ''}</span><b class="pos">${fmtMoney(it.taken.received)}</b></div>` : ''}
    ${it.lateFees ? `<div class="calc-line"><span>Late fees</span><b class="neg">${fmtMoney(it.lateFees)}</b></div>` : ''}`;
  let html = it.history.map(h => `<div class="h-row"><span class="h-round">R${h.round}</span><span class="h-desc">${histDesc(h, fmtMoney, true)}${lateNote(h, fmtMoney)}<br><span class="h-date">${fmtDate(h.date)}</span></span><span class="h-amt">${fmtMoney(h.paid)}</span></div>`).join('');
  if(it.status === 'active') for(let r = Math.max(done, it.roundsDone) + 1; r <= it.members; r++){
    const d = r === next ? nextDue(it) : roundDate(it, r);
    html += `<div class="h-row upcoming"><span class="h-round">R${r}</span><span class="h-desc">${r === next ? '<b>Next round</b>' : 'Upcoming'}${it.taken ? ' · full amount' : ''}<br><span class="h-date">${fmtDate(d)}</span></span><span class="h-amt">${fmtMoney(it.installment)}</span></div>`;
  }
  $('#crList').innerHTML = html || '<div class="h-desc" style="padding:6px 0">No rounds yet.</div>';
  $('#crEdit').classList.toggle('hidden', !done);
  $('#crEdit').onclick = () => { closeSheet('chitRoundsSheet'); setTimeout(() => { openChitSheet(it); setSwitch('cEditRounds', true); toggleEditRounds(true); }, 160); };
  openSheet('chitRoundsSheet');
}

/* ---------- editing rounds that are already recorded ---------- */
const HIST_KIND = { agent:'agent', commission:'auction', taken:'taken', full:'full', last:'last', opening:'opening' };
const HIST_TAG = { agent:'<span class="tag agent">Agent\'s round</span>', taken:'<span class="tag taken">You took the pot · full amount</span>', full:'<span class="tag full">Full amount</span>',
  last:'<span class="tag agent">Final round · pot came to you</span>', opening:'<span class="tag full">Opening balance</span>' };
function toggleEditRounds(on){
  $('#cEditRoundsFields').classList.toggle('hidden', !on);
  if(on) drawEditRounds();
  footShadow($('#chitSheet'));
}
function drawEditRounds(){
  const it = editingChit; if(!it) return;
  $('#cEditList').innerHTML = it.history.map((h, i) => {
    const kind = HIST_KIND[h.type] || 'full', money = (f, v, ph = '0') => `<div class="money-wrap"><input type="text" inputmode="decimal" data-money data-f="${f}" value="${v ?? ''}" placeholder="${ph}" autocomplete="off"></div>`;
    const third = kind === 'auction' ? `<div class="fgroup" id="er${i}cG"><label>Commission</label>${money('comm', fmtNumInput(String(h.share || 0), true))}</div>`
      : kind === 'taken' ? `<div class="fgroup" id="er${i}bG"><label>Your bid</label>${money('bid', fmtNumInput(String(h.bid || 0), true))}</div>`
      : `<div class="fgroup"><label>Commission</label><div class="money-wrap"><input type="text" value="0" disabled></div></div>`;
    return `<div class="round-row" data-i="${i}"><div class="round-row-head"><span>Round ${h.type === 'opening' ? '1–' + h.round : h.round}</span>${HIST_TAG[kind] || ''}</div><div class="rr-grid">
      <div class="fgroup rr-date" id="er${i}dG"><label>Date</label><input type="date" data-f="date" value="${h.date}" max="${T}"></div>
      <div class="fgroup" id="er${i}pG"><label>You paid</label>${money('paid', fmtNumInput(String(h.paid), true))}</div>${third}</div></div>`;
  }).join('');
  $$('#cEditList [data-money]').forEach(bindNumeric);
  editRoundsTotal();
}
function readEditRounds(){
  return $$('#cEditList .round-row').map(row => { const v = f => row.querySelector(`[data-f="${f}"]`)?.value;
    return { i:+row.dataset.i, date:v('date'), paid:num(v('paid')), comm: v('comm') == null ? null : num(v('comm') || 0), bid: v('bid') == null ? null : num(v('bid') || 0) }; });
}
function editRoundsTotal(){
  const it = editingChit; if(!it) return;
  const rows = readEditRounds(), paid = rows.reduce((t, r) => t + (r.paid || 0), 0), comm = rows.reduce((t, r) => t + (r.comm || 0), 0), tk = rows.find(r => r.bid != null);
  const last = rows[rows.length - 1];
  $('#cEditTotal').innerHTML = `${rows.length} round${rows.length === 1 ? '' : 's'} · you paid <b>${fmtMoney(paid)}</b><br>Total commission <b class="pos">+${fmtMoney(comm)}</b>`
    + (tk && tk.bid >= 0 ? `<br>Took the pot · bid <b>${fmtMoney(tk.bid)}</b> · received <b>${fmtMoney(it.pot - tk.bid)}</b>` : '')
    + (it.status === 'active' && last?.date && it.roundsDone < it.members ? `<br>Next round ${it.roundsDone + 1} around <b>${fmtDate(addMonths(last.date, it.interval))}</b>` : '');
}
/** Checks the edited rounds; returns the number of bad fields. */
function validateEditRounds(rows){
  const it = editingChit; let bad = 0, prev = null;
  for(const r of rows){
    const h = it.history[r.i];
    bad += setInvalid(`er${r.i}dG`, !r.date || diffDays(T, r.date) > 0 || (prev && diffDays(prev, r.date) < 0));
    bad += setInvalid(`er${r.i}pG`, !(r.paid >= 0 && (h.type === 'opening' || r.paid <= it.installment)));
    if(r.comm != null) bad += setInvalid(`er${r.i}cG`, !(r.comm >= 0 && r.comm <= it.installment));
    if(r.bid != null) bad += setInvalid(`er${r.i}bG`, !(r.bid >= 0 && r.bid < it.pot));
    if(r.date) prev = r.date;
  }
  return bad;
}
/** Writes the edited rounds into the chit and recomputes its totals. */
function applyEditRounds(x, rows){
  const lastBefore = x.history[x.history.length - 1]?.date;
  for(const r of rows){
    const h = x.history[r.i]; h.date = r.date; h.paid = round2(r.paid);
    if(r.comm != null && round2(r.comm) !== h.share){ h.share = round2(r.comm); h.bid = round2(h.share * (x.members - h.round) + (x.agentCut || 0)); }
    if(r.bid != null){ h.bid = round2(r.bid); h.received = round2(x.pot - h.bid); x.taken = { round:h.round, bid:h.bid, received:h.received }; }
  }
  x.paidIn = round2(x.history.reduce((t, h) => t + h.paid, 0));
  x.commission = round2(x.history.reduce((t, h) => t + (h.share || 0), 0));
  const last = x.history[x.history.length - 1];
  if(last && last.date !== lastBefore){ x.anchorRound = last.round; x.anchorDate = last.date; }
  if(x.status === 'closed' && last) x.closedOn = last.date;
}

/* ---------- announced auction date ---------- */
let dateChit = null;
function openAuctionDate(it){
  dateChit = it; clearForm('auctionDateSheet');
  const r = it.roundsDone + 1;
  $('#adSub').textContent = `Round ${r} of ${it.members} · ${it.name}`;
  $('#adDate').value = nextDue(it);
  $('#adHint').textContent = `By the regular schedule this round falls on ${fmtDate(roundDate(it, r))}. Reminders will follow the date you set.`;
  $('#adReset').classList.toggle('hidden', !announced(it));
  $('#adSave').textContent = announced(it) ? 'Update auction date' : 'Set auction date';
  openSheet('auctionDateSheet');
}
function saveAuctionDate(){
  const it = dateChit; if(!it) return;
  const v = $('#adDate').value, last = it.history[it.history.length - 1]?.date, r = it.roundsDone + 1;
  if(setInvalid('adDateG', !v || (last && diffDays(last, v) <= 0), 'adErr', last ? `Pick a date after the last recorded round (${fmtDate(last)}).` : 'Pick a date.')) return;
  closeSheet('auctionDateSheet');
  commit(() => Object.assign(findItem(it.id), { nextDate:v, nextDateRound:r }), { type:'success', title:`Round ${r} set for ${fmtDate(v)}`, body:'Reminders updated to the new date.' });
  flashCard(it.id);
}
function resetAuctionDate(){
  const it = dateChit; if(!it) return;
  closeSheet('auctionDateSheet');
  commit(() => { const x = findItem(it.id); delete x.nextDate; delete x.nextDateRound; }, { type:'success', title:'Back to the regular schedule', body:`Round ${it.roundsDone + 1} · ${fmtDate(roundDate(it, it.roundsDone + 1))}` });
}

/* ---------- record a chit round ---------- */
let roundChit = null, roundMode = null, commMode = 'total';
function openRoundSheet(it){
  roundChit = it; roundMode = null; commMode = 'total'; clearForm('roundSheet');
  const r = it.roundsDone + 1, due = nextDue(it);
  $('#rTitle').textContent = `Round ${r} of ${it.members} · ${it.name}`;
  $('#rSub').textContent = `Scheduled ${fmtDate(due)} · ${fmtMoney(it.installment)} per person`;
  $('#rDate').value = diffDays(T, due) > 0 ? T : due;
  $('#rLateG').classList.toggle('hidden', diffDays(T, due) >= 0); setNum('rLate', '');
  if(diffDays(T, due) < 0) $('#rSub').textContent = `Overdue — was ${fmtDate(due)} · ${fmtMoney(it.installment)} per person`;
  if(r === 1 && it.agentFirst) roundMode = 'agent';
  else if(it.taken) roundMode = 'full';
  else if(r === it.members) roundMode = 'last';
  drawRoundBody();
  openSheet('roundSheet');
}
function drawRoundBody(){
  const it = roundChit, r = it.roundsDone + 1, I = it.installment, body = $('#rBody');
  if(roundMode === 'agent' || roundMode === 'full' || roundMode === 'last'){
    const info = roundMode === 'agent' ? `<b>Agent's round.</b> No auction in round 1 — everyone pays the full amount.`
      : roundMode === 'full' ? `<b>You've already taken this chit</b> (round ${it.taken.round}). Pay the full amount this round.`
      : `<b>Final round.</b> You're the last one waiting, so the full pot of ${fmtMoney(it.pot)} comes to you — no auction.`;
    const after = it.members - r;
    body.innerHTML = `<div class="chit-note">${info}</div><div class="calc-box">
      <div class="calc-line"><span>You pay this round</span><b>${fmtMoney(I)}</b></div>
      ${roundMode === 'last' ? `<div class="calc-line"><span>You receive</span><b class="pos">${fmtMoney(it.pot)}</b></div>` : ''}
      <div class="calc-line total"><span>${after ? 'Rounds left after this' : 'After this'}</span><b>${after ? after : 'Chit closes'}</b></div></div>`;
    $('#rSave').disabled = false; $('#rSave').textContent = `Record ${fmtMoney(I)} payment`;
    return;
  }
  const d = it.members - r;
  body.innerHTML = `<span class="flabel">What happened in this round?</span>
    <div class="choice-grid">
      <button type="button" class="choice ${roundMode === 'commission' ? 'sel' : ''}" data-mode="commission"><span class="ch-ic">${e3d('🪙')}</span><span class="ch-t">Got commission</span><span class="ch-s">Someone else won the auction</span></button>
      <button type="button" class="choice taken ${roundMode === 'taken' ? 'sel' : ''}" data-mode="taken"><span class="ch-ic">${e3d('🤝')}</span><span class="ch-t">I took the pot</span><span class="ch-s">I won the auction this round</span></button>
    </div><div id="rPanel"></div>`;
  $$('.choice', body).forEach(b => b.addEventListener('click', () => { roundMode = b.dataset.mode; clearForm('roundSheet'); drawRoundBody(); setTimeout(() => $('#rAmt')?.focus({ preventScroll:true }), 60); }));
  const panel = $('#rPanel');
  if(roundMode === 'commission'){
    panel.innerHTML = `<div class="segmented" id="commSeg" style="margin-bottom:12px"><div class="seg-thumb"></div><button type="button" class="seg-btn ${commMode === 'total' ? 'sel' : ''}" data-m="total">Total winning bid</button><button type="button" class="seg-btn ${commMode === 'head' ? 'sel' : ''}" data-m="head">Commission per head</button></div>
      <div class="fgroup" id="rAmtG"><label for="rAmt">${commMode === 'total' ? 'Winning bid' : 'Commission per head'}</label><div class="money-wrap"><input id="rAmt" type="text" inputmode="decimal" data-money placeholder="${commMode === 'total' ? '10,000' : '1,250'}" autocomplete="off"></div><div class="ferr" id="rAmtErr"></div>
      <div class="fhint">${commMode === 'total' ? `Shared by the ${d} people still waiting after this round${it.agentCut ? `, after the agent's ${fmtMoney(it.agentCut)} cut` : ''}.` : 'The amount knocked off your installment this round.'}</div></div>
      <div class="calc-box" id="rCalc"></div>`;
    bindSeg($('#commSeg'), b => { commMode = b.dataset.m; drawRoundBody(); $('#rAmt').focus({ preventScroll:true }); });
    requestAnimationFrame(() => moveThumb($('#commSeg')));
  } else if(roundMode === 'taken'){
    panel.innerHTML = `<div class="fgroup" id="rAmtG"><label for="rAmt">Your winning bid</label><div class="money-wrap"><input id="rAmt" type="text" inputmode="decimal" data-money placeholder="10,000" autocomplete="off"></div><div class="ferr" id="rAmtErr"></div>
      <div class="fhint">The discount you agreed to — you receive the chit value minus this.</div></div><div class="calc-box" id="rCalc"></div>`;
  }
  const a = $('#rAmt'); if(a){ bindNumeric(a); a.addEventListener('input', calcRound); }
  calcRound();
  requestAnimationFrame(() => footShadow($('#roundSheet')));
}
function roundCalc(){
  const it = roundChit, r = it.roundsDone + 1, I = it.installment, d = it.members - r, v = num($('#rAmt')?.value);
  if(roundMode === 'commission'){
    if(!(v >= 0)) return { ok:false };
    let bid, share;
    if(commMode === 'total'){ bid = v; share = d > 0 ? round2(Math.max(0, bid - (it.agentCut || 0)) / d) : 0; }
    else { share = v; bid = round2(share * d + (it.agentCut || 0)); }
    let err = '';
    if(bid >= it.pot) err = `The bid must be less than the chit value (${fmtMoney(it.pot)}).`;
    else if(share > I) err = `Commission per head can't be more than your ${fmtMoney(I)} installment.`;
    return { ok:!err, err, bid, share, paid: round2(I - share), d };
  }
  if(roundMode === 'taken'){
    if(!(v >= 0)) return { ok:false };
    const err = v >= it.pot ? `The bid must be less than the chit value (${fmtMoney(it.pot)}).` : '';
    const received = round2(it.pot - v), owe = I * d, net = round2(received - (it.paidIn + I + owe));
    return { ok:!err, err, bid:v, received, paid:I, owe, net, d };
  }
  return { ok:true };
}
function calcRound(){
  const it = roundChit, c = roundCalc(), calc = $('#rCalc');
  if(roundMode !== 'commission' && roundMode !== 'taken'){ $('#rSave').disabled = !roundMode; if(!roundMode) $('#rSave').textContent = 'Choose what happened'; return; }
  $('#rAmtG').classList.toggle('invalid', !!c.err); $('#rAmtErr').textContent = c.err || '';
  if(roundMode === 'commission'){
    calc.innerHTML = c.bid != null && !isNaN(c.bid) ? `<div class="calc-line"><span>Winning bid</span><b>${fmtMoney(c.bid)}</b></div>
      ${it.agentCut ? `<div class="calc-line"><span>Agent's cut</span><b>− ${fmtMoney(it.agentCut)}</b></div>` : ''}
      <div class="calc-line"><span>Shared by</span><b>${c.d} people</b></div>
      <div class="calc-line"><span>Your commission</span><b class="pos">+${fmtMoney(c.share)}</b></div>
      <div class="calc-line total"><span>You pay this round</span><b>${fmtMoney(c.paid)}</b></div>
      <div class="calc-line"><span>Commission so far → after</span><b>${fmtMoney(it.commission)} → ${fmtMoney(it.commission + c.share)}</b></div>`
      : `<div class="calc-line"><span>Enter the amount to see your share</span></div>`;
  } else {
    calc.innerHTML = c.received != null && !isNaN(c.received) ? `<div class="calc-line"><span>Chit value − your bid</span><b>${fmtMoney(it.pot)} − ${fmtMoney(c.bid)}</b></div>
      <div class="calc-line"><span>You receive</span><b class="pos">${fmtMoney(c.received)}</b></div>
      <div class="calc-line"><span>You pay this round</span><b>${fmtMoney(c.paid)}</b></div>
      <div class="calc-line"><span>Then ${c.d} more round${c.d === 1 ? '' : 's'} × ${fmtMoney(it.installment)}</span><b class="neg">${fmtMoney(c.owe)}</b></div>
      <div class="calc-line total"><span>${c.net >= 0 ? 'Projected gain' : 'Projected cost'}</span><b class="${c.net >= 0 ? 'pos' : 'neg'}">${fmtMoney(Math.abs(c.net))}</b></div>`
      : `<div class="calc-line"><span>Enter your bid to see what you receive</span></div>`;
  }
  $('#rSave').disabled = !c.ok; $('#rSave').textContent = roundMode === 'taken' ? 'I took it — move to debt' : 'Record round';
}
async function saveRound(){
  const it = roundChit, r = it.roundsDone + 1, date = $('#rDate').value;
  if(setInvalid('rDateG', !date || diffDays(T, date) > 0)) return;
  const lateFee = $('#rLateG').classList.contains('hidden') ? 0 : round2(num($('#rLate').value || 0) || 0);
  if(setInvalid('rLateG', !(lateFee >= 0 && lateFee <= 1e5))) return;
  const c = roundCalc(); if(!c.ok || !roundMode) return;
  const closing = r === it.members, id = it.id, name = it.name;
  closeSheet('roundSheet');
  if(closing) await animateOut(id);
  let entry;
  if(roundMode === 'commission') entry = { round:r, date, type:'commission', bid:c.bid, share:c.share, paid:c.paid };
  else if(roundMode === 'taken') entry = { round:r, date, type:'taken', bid:c.bid, received:c.received, paid:c.paid, share:0 };
  else if(roundMode === 'last') entry = { round:r, date, type:'last', bid:0, received:it.pot, paid:it.installment, share:0 };
  else entry = { round:r, date, type: roundMode === 'agent' ? 'agent' : 'full', paid:it.installment, share:0 };
  if(lateFee) entry.lateFee = lateFee;
  const t = closing ? { type:'success', title:`${name} completed 🎉`, body:'All rounds done — moved to Closed.' }
    : roundMode === 'commission' ? { type:'success', title:`Round ${r} recorded · +${fmtMoney(c.share)}`, body:`You paid ${fmtMoney(c.paid)}. Commission so far: ${fmtMoney(it.commission + c.share)}.` }
    : roundMode === 'taken' ? { type:'warning', title:`${name} moved to debt`, body:`Received ${fmtMoney(c.received)}. ${fmtMoney(it.installment)} per round for ${c.d} more round${c.d === 1 ? '' : 's'}.` }
    : { type:'success', title:`Round ${r} paid`, body:`${name} · ${fmtMoney(it.installment)}` };
  commit(() => {
    const x = findItem(id);
    x.history.push(entry); x.roundsDone = r; x.paidIn = round2(x.paidIn + entry.paid); x.commission = round2(x.commission + (entry.share || 0));
    if(lateFee) x.lateFees = round2((x.lateFees || 0) + lateFee);
    if(entry.type === 'taken' || entry.type === 'last') x.taken = { round:r, bid:entry.bid, received:entry.received };
    if(x.roundsDone >= x.members){ x.status = 'closed'; x.closedOn = date; }
  }, t);
  if(!closing) flashCard(id);
}

/* ================================================================
   DEVICES — every phone and browser signed in to this account
================================================================ */
let devCheckAt = 0, serverV2 = true;
async function checkDevice(force){
  if(!navigator.onLine || (!force && Date.now() - devCheckAt < 10 * 60e3)) return;
  devCheckAt = Date.now();
  try{
    const r = await registerDevice();
    serverV2 = !r.missing;
    if(r.revoked) onLogout(false, 'revoked');
  }catch(e){ console.warn('Device check failed', e); }
}
const devIcon = d => e3d(/android|iphone|phone/i.test(d.name + d.platform) && !/web|chrome|safari|firefox|edge/i.test(d.platform) ? '📱' : '💻');
async function openDevices(){
  openSheet('devicesSheet');
  const box = $('#devList');
  box.innerHTML = '<div class="empty" style="padding:22px"><span class="spinner dim"></span> Loading devices…</div>';
  $('#devOthers').classList.add('hidden');
  if(!navigator.onLine){ box.innerHTML = '<div class="empty" style="padding:22px">Connect to the internet to see your devices.</div>'; return; }
  try{
    const r = await listDevices();
    if(r.missing){ box.innerHTML = '<div class="empty" style="padding:22px">Devices need the Finly 2.0 server update. Run <b>supabase/v2.sql</b> in Supabase → SQL Editor.</div>'; return; }
    const me = deviceId(), list = r.data.sort((a, b) => (b.id === me) - (a.id === me));
    const others = list.filter(d => d.id !== me && !d.revoked);
    $('#devOthers').classList.toggle('hidden', !others.length);
    box.innerHTML = list.map(d => `<div class="dev-row ${d.revoked ? 'off' : ''}"><span class="dev-ic">${devIcon(d)}</span>
      <span class="dev-txt"><b>${esc(d.name || 'Unknown device')}</b>${d.id === me ? '<span class="badge save">This device</span>' : ''}
        <small>${esc(d.platform || '')}${d.city ? ' · ' + e3d('📍') + esc(d.city) : ''}</small>
        <small>${d.revoked ? 'Signed out' : d.id === me ? 'Active now' : 'Last active ' + ago(Date.parse(d.last_seen))} · signed in ${fmtDate(d.created_at.slice(0, 10))}</small></span>
      ${d.id === me ? '' : d.revoked ? `<button class="btn btn-secondary btn-sm" data-forget="${esc(d.id)}">Clear</button>` : `<button class="btn btn-danger btn-sm" data-revoke="${esc(d.id)}">Remove</button>`}</div>`).join('')
      || '<div class="empty" style="padding:22px">No devices yet.</div>';
    $('#devicesSub').textContent = `${list.filter(d => !d.revoked).length} signed in`;
  }catch(e){ box.innerHTML = '<div class="empty" style="padding:22px">Couldn\'t load devices. Please try again.</div>'; }
}
function onDevicesClick(e){
  const rv = e.target.closest('[data-revoke]'), fg = e.target.closest('[data-forget]');
  if(rv){
    const name = rv.closest('.dev-row').querySelector('b').textContent;
    confirmBox({ title:`Remove ${name}?`, body:'It will be signed out right away and its Finly data cleared the next time it opens. Your data stays safe in your account.', yes:'Remove device', onYes: async () => {
      try{ await revokeDevice(rv.dataset.revoke); toast({ type:'success', title:'Device removed', body:name }); }
      catch{ toast({ type:'error', title:'Couldn\'t remove the device', body:'Check your internet and try again.' }); }
      openDevices();
    }});
  } else if(fg){ forgetDevice(fg.dataset.forget).then(openDevices).catch(() => {}); }
}
function signOutOthers(){
  confirmBox({ title:'Sign out all other devices?', body:'Every other phone and browser will be signed out and their Finly data cleared. This device stays signed in.', yes:'Sign out others', onYes: async () => {
    try{
      const r = await listDevices();
      for(const d of (r.data || []).filter(x => x.id !== deviceId() && !x.revoked)) await revokeDevice(d.id);
      toast({ type:'success', title:'Other devices signed out' });
    }catch{ toast({ type:'error', title:'Couldn\'t sign out other devices', body:'Check your internet and try again.' }); }
    openDevices();
  }});
}

/* ================================================================
   WHATSAPP NUMBER — required from 2.0; existing users are walked to Profile
================================================================ */
async function pushProfile(force){
  const ph = st().settings.whatsapp, key = 'finly-profile-pushed';
  if(!ph || !navigator.onLine || (!force && localStorage.getItem(key) === user.id + ph)) return;
  try{
    const r = await saveRemoteProfile(ph, displayName());
    if(r.taken) return toast({ type:'error', title:'Number already in use', body:'Another Finly account uses this WhatsApp number. Check it in Profile.', ms:7000 });
    if(!r.missing) localStorage.setItem(key, user.id + ph);
    refreshShares();
  }catch(e){ console.warn('Profile sync failed', e); }
}
let coachStep = 0;
const needsWhatsapp = () => !st().settings.whatsapp;
function startCoach(){ if(!needsWhatsapp()) return; coachStep = page === 'profile' ? 2 : 1; drawCoach(); }
function drawCoach(){
  const c = $('#coach');
  if(!coachStep || openStack.length){ c.classList.add('hidden'); return; }
  const target = coachStep === 1 ? $('.nav-item[data-page="profile"]') : $('#profileCard');
  if(!target) return;
  c.classList.remove('hidden');
  $('#coachTitle').textContent = coachStep === 1 ? 'Add your WhatsApp number' : 'Edit your profile';
  $('#coachText').textContent = coachStep === 1 ? 'Finly 2.0 needs your WhatsApp number. Tap Profile to continue.' : 'Tap your profile, then enter your WhatsApp number and tap Update profile.';
  requestAnimationFrame(() => {
    const r = target.getBoundingClientRect(), pad = 6, hole = $('#coachHole'), tip = $('#coachTip');
    Object.assign(hole.style, { left:(r.left - pad) + 'px', top:(r.top - pad) + 'px', width:(r.width + pad * 2) + 'px', height:(r.height + pad * 2) + 'px' });
    const below = r.top < innerHeight / 2;
    tip.classList.toggle('below', below);
    tip.style.top = below ? (r.bottom + 22) + 'px' : ''; tip.style.bottom = below ? '' : (innerHeight - r.top + 22) + 'px';
    $('#coachArrow').style.left = Math.max(18, Math.min(tip.offsetWidth - 30, r.left + r.width / 2 - tip.getBoundingClientRect().left - 9)) + 'px';
  });
}
function onCoachClick(e){
  const r = $('#coachHole').getBoundingClientRect();
  if(e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
  if(coachStep === 1){ go('profile'); coachStep = 2; setTimeout(drawCoach, 480); }
  else { $('#coach').classList.add('hidden'); openProfileSheet(false, true); }
}
function afterWhatsappSaved(){
  if(needsWhatsapp()) return;
  if(coachStep){ coachStep = 0; drawCoach(); toast({ type:'success', title:'WhatsApp number saved', body:'Thanks! You\'re all set for Finly 2.0.' }); }
  setTimeout(maybeWhatsNew, 900);
}

/* ---------- what's new (once, for people updating from 1.x) ---------- */
const WN_KEY = 'finly-whatsnew-2';
function maybeWhatsNew(){
  if(localStorage.getItem(WN_KEY) || needsWhatsapp() || openStack.length) return;
  localStorage.setItem(WN_KEY, '1');
  if(!st().items.length) return;   // brand-new account: nothing to catch up on
  const f = [['📥', 'Updates inside the app', 'Update now downloads with a progress bar and installs right here.'],
    ['👥', 'Contacts in Ledger', 'Choose a contact for each person. If they use Finly too, the entry appears in their ledger once they accept.'],
    ['🗓️', 'Monthly plan image', 'On the last day of each month at 9 PM, get next month\'s dues as one image to share on WhatsApp.'],
    ['📲', 'Devices', 'See every phone signed in to your account, and remove any you don\'t recognise.'],
    ['🎨', 'Icon follows your colours', 'The app icon now matches the colour palette you pick.'],
    ['📊', 'Outflow breakdown', 'Tap Outflow on Home to see each category\'s monthly amounts.']];
  $('#wnList').innerHTML = f.map(([e, t, d]) => `<div class="wn-row"><span class="wn-ic">${e3d(e)}</span><span><b>${t}</b><small>${d}</small></span></div>`).join('');
  openSheet('whatsNewSheet');
}

/* ================================================================
   MONTHLY PLAN IMAGE — next month's dues as one PNG to share on WhatsApp
================================================================ */
let planMonth = null, planBlob = null;
const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
function planRows(key){
  const [y, m] = key.split('-').map(Number), from = `${key}-01`, to = toISO(new Date(y, m, 0)), inMonth = d => dayNum(d) >= dayNum(from) && dayNum(d) <= dayNum(to);
  const rows = [], bank = it => { const b = it.bankId && bankById(it.bankId); return b ? bankLabel(b) : ''; };
  for(const it of activeItems()){
    if(it.kind === 'bill'){
      let d = it.due, left = it.ongoing ? 1e4 : it.tenureLeft;
      while(left > 0 && dayNum(d) <= dayNum(to)){ if(inMonth(d)) rows.push({ date:d, name:it.name, sub:catLabel(it), amount:it.amount, bank:bank(it) }); d = addMonths(d, ev(it), it.anchorDay); left--; }
    } else {
      for(let r = it.roundsDone + 1; r <= it.members; r++){
        const d = r === it.roundsDone + 1 ? nextDue(it) : roundDate(it, r);
        if(dayNum(d) > dayNum(to)) break;
        if(inMonth(d)) rows.push({ date:d, name:it.name, sub:`Chit · round ${r} of ${it.members}${it.taken ? '' : ' · less commission'}`, amount:it.installment, bank:'' });
      }
    }
  }
  for(const it of activeLends()){ const d = lendDue(it); if(d && inMonth(d)) rows.push({ date:d, name: lendWho(it), sub:'Ledger', amount: lendState(it, d).outstanding, bank:'' }); }
  return { y, m, rows: rows.sort((a, b) => dayNum(a.date) - dayNum(b.date)) };
}
function drawPlan(key){
  const { y, m, rows } = planRows(key), pal = paletteVars(st().settings.palette, 'dark');
  const W = 1080, rowH = 132, head = 330, foot = 170, H = head + Math.max(1, rows.length) * rowH + foot;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), F = '-apple-system, "Segoe UI", Roboto, sans-serif';
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, pal.bgElev); bg.addColorStop(1, pal.bg); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(160, 80, 10, 160, 80, 700); glow.addColorStop(0, pal.primary + '55'); glow.addColorStop(1, pal.primary + '00'); g.fillStyle = glow; g.fillRect(0, 0, W, H);
  const month = new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month:'long', year:'numeric' });
  g.fillStyle = pal.primary2; g.font = `600 34px ${F}`; g.fillText('FINLY · MONTHLY PLAN', 72, 108);
  g.fillStyle = '#FFFFFF'; g.font = `800 76px ${F}`; g.fillText(month, 72, 196);
  const total = rows.reduce((t, r) => t + r.amount, 0);
  g.fillStyle = 'rgba(255,255,255,.65)'; g.font = `500 34px ${F}`;
  g.fillText(`${displayName()} · ${rows.length} payment${rows.length === 1 ? '' : 's'} · ${fmtMoney(Math.round(total))}`, 72, 256);
  let yy = head;
  if(!rows.length){ g.fillStyle = 'rgba(255,255,255,.8)'; g.font = `600 40px ${F}`; g.fillText('Nothing due this month 🎉', 72, yy + 80); yy += rowH; }
  for(const r of rows){
    const d = parseISO(r.date);
    g.fillStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.roundRect(56, yy, W - 112, rowH - 18, 28); g.fill();
    g.fillStyle = pal.primary + '33'; g.beginPath(); g.roundRect(80, yy + 16, 92, 82, 20); g.fill();
    g.fillStyle = pal.primary2; g.textAlign = 'center'; g.font = `800 40px ${F}`; g.fillText(String(d.getDate()), 126, yy + 62);
    g.font = `600 22px ${F}`; g.fillText(d.toLocaleDateString('en-IN', { weekday:'short' }).toUpperCase(), 126, yy + 90); g.textAlign = 'left';
    const maxW = W - 112 - 140 - 300;
    const clip = (t, font) => { g.font = font; let s_ = t; while(g.measureText(s_).width > maxW && s_.length > 3) s_ = s_.slice(0, -2); return s_ === t ? t : s_ + '…'; };
    g.fillStyle = '#FFFFFF'; g.fillText(clip(r.name, `700 36px ${F}`), 200, yy + 54);
    g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(clip([r.sub, r.bank].filter(Boolean).join(' · '), `500 26px ${F}`), 200, yy + 92);
    g.fillStyle = '#FFFFFF'; g.font = `800 38px ${F}`; g.textAlign = 'right'; g.fillText(fmtMoney(Math.round(r.amount)), W - 84, yy + 70); g.textAlign = 'left';
    yy += rowH;
  }
  g.fillStyle = pal.primary + '26'; g.beginPath(); g.roundRect(56, yy + 10, W - 112, 96, 28); g.fill();
  g.fillStyle = '#FFFFFF'; g.font = `700 36px ${F}`; g.fillText('Total for the month', 92, yy + 70);
  g.textAlign = 'right'; g.fillStyle = pal.gold; g.font = `800 40px ${F}`; g.fillText(fmtMoney(Math.round(total)), W - 92, yy + 72); g.textAlign = 'left';
  g.fillStyle = 'rgba(255,255,255,.45)'; g.font = `500 24px ${F}`; g.fillText(`Made with Finly · ${fmtDate(T)}`, 72, H - 40);
  return { canvas:c, month, count: rows.length, total };
}
async function openPlan(key){
  const now = parseISO(T), nx = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const keys = [monthKey(now.getFullYear(), now.getMonth()), monthKey(nx.getFullYear(), nx.getMonth())];
  planMonth = key || keys[1];
  $$('#plMonth .seg-btn').forEach(b => b.classList.toggle('sel', keys[+b.dataset.m] === planMonth));
  $('#plMonth').classList.toggle('hidden', !keys.includes(planMonth));
  const p = drawPlan(planMonth);
  $('#plTitle').textContent = `${p.month} plan`;
  $('#plSub').textContent = `${p.count} payment${p.count === 1 ? '' : 's'} · ${fmtMoney(Math.round(p.total))}`;
  planBlob = await new Promise(r => p.canvas.toBlob(r, 'image/png'));
  const img = $('#plImg'); if(img.src.startsWith('blob:')) URL.revokeObjectURL(img.src); img.src = URL.createObjectURL(planBlob);
  if(!$('#planSheet').classList.contains('show')) openSheet('planSheet');
  requestAnimationFrame(() => moveThumb($('#plMonth')));
}
async function sharePlan(){
  if(!planBlob) return;
  const name = `finly-plan-${planMonth}.png`;
  try{
    if(!isNative && navigator.canShare?.({ files:[new File([planBlob], name, { type:'image/png' })] })){
      await navigator.share({ files:[new File([planBlob], name, { type:'image/png' })], title:'Finly monthly plan' });
    } else await saveFile(name, planBlob);
  }catch(e){ if(!/abort|cancel/i.test(String(e?.message || e))) toast({ type:'error', title:'Couldn\'t share the image', body:'Please try again.' }); }
}

/* ================================================================
   OUTFLOW BREAKDOWN — monthly outflow by category, in a pop-up
================================================================ */
let ofTab = null;
function openOutflow(){
  const act = activeItems(), cats = st().cats.filter(c => act.some(i => i.catId === c.id));
  if(!cats.length) return toast({ type:'warning', title:'Nothing to show yet', body:'Add an EMI, bill or chit to see your monthly outflow.' });
  if(!ofTab || !cats.some(c => c.id === ofTab)) ofTab = cats.some(c => c.id === 'emi') ? 'emi' : cats[0].id;
  const perMonth = it => it.kind === 'chit' ? it.installment / it.interval : it.amount / ev(it);
  const total = act.reduce((t, it) => t + perMonth(it), 0);
  $('#ofSub').textContent = `${fmtMoney(Math.round(total))} on average each month`;
  $('#ofTabs').innerHTML = cats.map(c => `<button class="of-tab ${c.id === ofTab ? 'sel' : ''}" data-tab="${c.id}" role="tab" aria-selected="${c.id === ofTab}">${c.emoji ? e3d(c.emoji, 'chip-3d') : ''}${esc(c.name)}</button>`).join('');
  const list = act.filter(i => i.catId === ofTab).sort((a, b) => perMonth(b) - perMonth(a)), sum = list.reduce((t, it) => t + perMonth(it), 0);
  $('#ofList').innerHTML = `<div class="of-head"><span>Title</span><span>Amount</span><span>Avg / month</span></div>`
    + list.map(it => `<div class="of-row"><span class="of-name">${esc(it.name)}</span><span>${fmtMoney(it.kind === 'chit' ? it.installment : it.amount)}</span><b>${fmtMoney(Math.round(perMonth(it)))}</b></div>`).join('')
    + `<div class="of-row total"><span class="of-name">Total</span><span></span><b>${fmtMoney(Math.round(sum))}</b></div>`;
  if(!$('#outflowSheet').classList.contains('show')) openSheet('outflowSheet');
  $(`#ofTabs [data-tab="${ofTab}"]`)?.scrollIntoView({ block:'nearest', inline:'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
}

/* ================================================================
   LOGO + LAUNCHER ICON — follow the colour palette
================================================================ */
let logoSeq = 0;
function paintLogos(){
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(logoSVG(logoColors(st().settings.palette), { rounded:true, id: 'x' + (logoSeq++) }));
  $$('.brand-mark img, img.brand-ic').forEach(i => { i.src = url; });
}
function syncLauncherIcon(){
  if(!isNative) return;
  const want = palKey(st().settings.palette);
  if(localStorage.getItem('finly-launcher') === want) return;
  setLauncherIcon(want).then(r => { if(r) localStorage.setItem('finly-launcher', want); });
}

/* ================================================================
   LEDGER — money lent to or borrowed from people
================================================================ */
let lgFilter = 'all';

/* ---------- shared entries: the other person's side of an entry, kept in sync through the server ---------- */
const SHARE_KEY = () => 'finly-shares-' + user.id;
let shares = [], sharesMissing = false, sharesBusy = false;
function loadShares(){ try{ shares = JSON.parse(localStorage.getItem(SHARE_KEY()) || '[]'); }catch{ shares = []; } }
const pid = p => p.id || `l-${p.date}-${p.amount}`;
const shareOf = id => shares.find(r => r.id === id && r.owner === user.id);
const shareData = it => ({ dir:it.dir, note:it.note || '', amount:it.amount, date:it.date, interest:it.interest || null, tenure:it.tenure || null,
  payments:(it.payments || []).map(p => ({ id:pid(p), date:p.date, amount:p.amount, by:p.by || user.id })) });
/** Entries other people created that name me — shown with the direction flipped. */
function sharedLends(){
  if(!user.id) return [];
  return shares.filter(r => r.counterpart === user.id && r.status === 'accepted').map(r => {
    const d = r.data || {}, it = { id:'sh_' + r.id, shareId:r.id, remote:true, kind:'lend', dir: d.dir === 'lent' ? 'borrowed' : 'lent',
      person: r.owner_name || fmtPhone(r.owner_phone) || 'Someone', phone:r.owner_phone, note:d.note || '', amount:d.amount, date:d.date,
      interest:d.interest || null, tenure:d.tenure || null, payments:d.payments || [], reminders:null, status:'active' };
    if(it.payments.length && lendState(it, T).outstanding <= 0.5){ it.status = 'closed'; it.closedOn = [...it.payments].sort((a, b) => dayNum(b.date) - dayNum(a.date))[0].date; }
    return it;
  });
}
const findLend = id => findItem(id) || sharedLends().find(x => x.id === id);
const pendingShares = () => shares.filter(r => r.counterpart === user.id && r.status === 'pending');
async function refreshShares(){
  if(!navigator.onLine || sharesBusy || !user.id) return;
  sharesBusy = true;
  try{
    const r = await fetchShares();
    sharesMissing = !!r.missing;
    if(r.missing) return;
    shares = r.data || [];
    try{ localStorage.setItem(SHARE_KEY(), JSON.stringify(shares)); }catch{ /* full */ }
    // payments the other person recorded on my entries → into my copy
    const adds = [];
    for(const row of shares.filter(x => x.owner === user.id)){
      const it = findItem(row.id); if(!it) continue;
      const have = new Set((it.payments || []).map(pid));
      const fresh = (row.data?.payments || []).filter(p => !have.has(p.id));
      if(fresh.length) adds.push([it.id, fresh]);
    }
    if(adds.length) commit(() => { for(const [id, fresh] of adds){ const x = findItem(id); x.payments.push(...fresh.map(p => ({ id:p.id, date:p.date, amount:p.amount, by:p.by })));
      if(lendState(x, T).outstanding <= 0.5){ x.status = 'closed'; x.closedOn = [...x.payments].sort((a, b) => dayNum(b.date) - dayNum(a.date))[0].date; } } });
    // my entries with a number that the server doesn't have yet (or has an older copy of)
    for(const it of st().items.filter(i => i.kind === 'lend' && i.phone)){
      const row = shareOf(it.id);
      if(!row || row.status === 'removed' || JSON.stringify(row.data) !== JSON.stringify(shareData(it)) || row.counterpart_phone !== it.phone) await pushShare(it, true);
    }
    renderLedger(); renderBell();
  }catch(e){ console.warn('Shared entries sync failed', e); }
  finally{ sharesBusy = false; }
}
async function pushShare(it, quiet){
  if(!it.phone || !navigator.onLine || sharesMissing) return;
  if(it.phone === st().settings.whatsapp) return;
  try{
    const r = await shareUpsert(it.id, it.phone, displayName(), shareData(it));
    if(r.missing){ sharesMissing = true; return; }
    const row = shareOf(it.id), next = { ...(row || {}), id:it.id, owner:user.id, counterpart_phone:it.phone, data:shareData(it), status: row?.status || 'pending', counterpart: r.data === 'linked' ? (row?.counterpart || 'linked') : null };
    shares = shares.filter(x => !(x.id === it.id && x.owner === user.id)).concat(next);
    if(!quiet && r.data === 'linked' && !row) toast({ type:'success', title:`Sent to ${it.person}`, body:'It appears in their ledger once they accept.' });
    if(!quiet) setTimeout(refreshShares, 1500);
  }catch(e){ console.warn('Share failed', e); }
}
function shareChip(it){
  if(it.remote) return `<span class="badge share">${e3d('👥')}Shared by ${esc(it.person)}</span>`;
  if(!it.phone) return '';
  const row = shareOf(it.id);
  if(!row) return '';
  if(!row.counterpart) return '<span class="badge soft">Not on Finly yet</span>';
  return row.status === 'accepted' ? `<span class="badge share">${e3d('👥')}Shared</span>`
    : row.status === 'declined' ? '<span class="badge due">Declined</span>' : '<span class="badge soft">Waiting to accept</span>';
}
function requestCard(r){
  const d = r.data || {}, mine = d.dir === 'lent' ? 'borrowed' : 'lent', who = esc(r.owner_name || fmtPhone(r.owner_phone));
  return `<div class="req-card" data-share="${esc(r.id)}"><div class="req-top"><span class="glyph" style="--accent:var(--primary)">${e3d('👥')}</span>
    <span><b>${who}</b> added an entry with you</span></div>
    <p>${mine === 'borrowed' ? `You borrowed <b>${fmtMoney(d.amount)}</b> from ${who}` : `You gave <b>${fmtMoney(d.amount)}</b> to ${who}`} on ${fmtDate(d.date)}${d.interest ? ` · ${esc(rateLabel(d))}` : ''}${d.tenure ? ` · ${d.tenure} months` : ''}${d.note ? ` · ${esc(d.note)}` : ''}.</p>
    <div class="req-actions"><button class="btn btn-secondary btn-sm" data-share-dec>Decline</button><button class="btn btn-primary btn-sm" data-share-acc>Accept</button></div></div>`;
}
async function respondShare(id, accept){
  if(!navigator.onLine) return toast({ type:'warning', title:'You\'re offline', body:'Connect to the internet to respond.' });
  try{ await shareRespond(id, accept); toast({ type: accept ? 'success' : 'warning', title: accept ? 'Added to your ledger' : 'Declined' }); }
  catch{ toast({ type:'error', title:'Couldn\'t respond', body:'Please try again.' }); }
  refreshShares();
}

/* ---------- call the person (asks first, then opens the phone dialer) ---------- */
const callBtn = (it, cls = 'round-btn') => it.phone ? `<button type="button" class="${cls} call-btn" data-act="lcall" aria-label="Call ${esc(it.person)}">${ICON.call}</button>` : '';
function callPerson(it){
  confirmBox({ title:`Call ${it.person}?`, body:`${fmtPhone(it.phone)} · this opens your phone's dialer.`, yes:'Call', danger:false,
    onYes: () => { window.location.href = 'tel:' + it.phone; } });
}
const lendColor = it => it.dir === 'lent' ? 'var(--gold)' : 'var(--rose)';
const lendGlyph = it => e3d(it.dir === 'lent' ? '💸' : '💵');
function lendCard(it, i){
  const s_ = lendState(it, T), due = lendDue(it), d = due ? diffDays(T, due) : null, lent = it.dir === 'lent';
  const when = !due ? `<span class="due-text">Since ${fmtDate(it.date)}</span>`
    : d < 0 ? `<span class="badge due">Overdue</span><span class="due-text urgent">Was due ${fmtDate(due)}</span>`
    : `<span class="due-text ${d <= 7 ? 'urgent' : ''}">Due ${fmtDate(due)}</span>`;
  const pct = due ? Math.max(0, Math.min(100, Math.round(diffDays(it.date, T) / Math.max(1, diffDays(it.date, due)) * 100))) : 0;
  return `<article class="item-card ${enterCls('l_' + it.id)}" data-id="${it.id}" style="--accent:${lendColor(it)};--i:${i}">
    <div class="ic-top"><div class="ic-id"><div class="glyph">${lendGlyph(it)}</div><div style="min-width:0"><div class="ic-name">${esc(it.person)}</div>
      <div class="ic-meta"><span class="badge ${lent ? 'save' : 'debt'}">${lent ? 'You gave' : 'You borrowed'}</span><span class="badge soft">${esc(rateLabel(it))}</span>${shareChip(it)}${when}</div>
      ${it.note ? `<div class="ic-note">${esc(it.note)}</div>` : ''}</div></div>
      <div class="ic-amt"><div class="amt">${fmtMoney(s_.outstanding)}</div><div class="per">${lent ? 'to receive' : 'to pay back'}</div></div></div>
    ${due ? `<div class="progress-row"><div class="progress-labels"><span>Tenure <b>${it.tenure} month${it.tenure === 1 ? '' : 's'}</b></span><span>${pct}%</span></div>${barHTML('l_' + it.id, pct)}</div>` : ''}
    <div class="ic-foot"><div class="figs">
      <div class="fig"><span class="fig-label">${lent ? 'Given' : 'Borrowed'}</span><span class="fig-value">${fmtMoney(it.amount)}</span></div>
      ${it.interest ? `<div class="fig"><span class="fig-label">Interest so far</span><span class="fig-value ${lent ? 'pos' : 'neg'}">+${fmtMoney(s_.accrued)}</span></div>` : ''}
      ${s_.paid ? `<div class="fig"><span class="fig-label">${lent ? 'Received' : 'Repaid'}</span><span class="fig-value">${fmtMoney(s_.paid)}</span></div>` : ''}</div>
      <div class="actions">${callBtn(it)}${it.remote ? '' : `<button class="round-btn ghost" data-act="ledit" aria-label="Edit ${esc(it.person)}">${ICON.edit}</button>`}
      <button class="pay-btn" data-act="lpay" aria-label="${lent ? 'Money received from' : 'Money given to'} ${esc(it.person)}">${ICON.check}<span>${lent ? 'Received' : 'Given'}</span></button></div></div>
  </article>`;
}
function renderLedger(){
  const act = activeLends(), lent = act.filter(i => i.dir === 'lent'), bor = act.filter(i => i.dir === 'borrowed');
  const sum = list => list.reduce((t, it) => t + lendState(it, T).outstanding, 0), intr = list => list.reduce((t, it) => t + lendState(it, T).accrued, 0);
  countTo($('#lgGet'), 'lget', Math.round(sum(lent))); countTo($('#lgOwe'), 'lowe', Math.round(sum(bor)));
  $('#lgGetFoot').textContent = lent.length ? `${lent.length} ${lent.length === 1 ? 'person' : 'people'}${intr(lent) ? ` · +${fmtMoney(intr(lent))} interest` : ''}` : 'Nothing lent';
  $('#lgOweFoot').textContent = bor.length ? `${bor.length} ${bor.length === 1 ? 'person' : 'people'}${intr(bor) ? ` · ${fmtMoney(intr(bor))} interest` : ''}` : 'Nothing borrowed';
  const list = act.filter(i => lgFilter === 'all' || i.dir === lgFilter)
    .sort((a, b) => (lendDue(a) ? dayNum(lendDue(a)) : 1e9) - (lendDue(b) ? dayNum(lendDue(b)) : 1e9) || dayNum(b.date) - dayNum(a.date));
  const reqs = pendingShares();
  $('#lgList').innerHTML = (reqs.length ? `<div class="req-head">Requests <small>(${reqs.length})</small></div>` + reqs.map(requestCard).join('') : '') + (list.length ? list.map(lendCard).join('')
    : `<div class="empty"><div class="em">${e3d('🤝')}</div><b>${act.length ? 'Nothing here' : 'No money lent or borrowed'}</b>Keep track of money you gave someone or borrowed, with interest if any.
       <div class="empty-actions"><button class="btn btn-primary btn-sm" data-lnew="lent">I gave money</button><button class="btn btn-secondary btn-sm" data-lnew="borrowed">I borrowed money</button></div></div>`);
  const done = lends().filter(i => i.status === 'closed').sort((a, b) => dayNum(b.closedOn) - dayNum(a.closedOn));
  $('#lgClosedHead').classList.toggle('hidden', !done.length);
  $('#lgClosedCount').textContent = done.length ? `(${done.length})` : '';
  $('#lgClosedList').innerHTML = done.map(it => `<div class="closed-row" data-id="${it.id}" style="--accent:${lendColor(it)}"><div class="glyph">${lendGlyph(it)}</div>
    <div style="min-width:0"><div class="cr-name">${esc(it.person)}</div><div class="cr-sub">Settled ${fmtDate(it.closedOn)} · ${it.dir === 'lent' ? 'gave' : 'borrowed'} ${fmtMoney(it.amount)}</div></div>
    <div class="cr-amt"><span>${it.dir === 'lent' ? 'Got back' : 'Repaid'}</span>${fmtMoney(lendState(it, T).paid)}</div>
    ${callBtn(it, 'mini-btn')}<button class="mini-btn" data-act="lpay" aria-label="Payments for ${esc(it.person)}">${ICON.history}</button>${it.remote ? '' : `<button class="mini-btn" data-act="ledit" aria-label="Edit ${esc(it.person)}">${ICON.edit}</button>`}</div>`).join('');
}
function onLedgerClick(e){
  const nw = e.target.closest('[data-lnew]'); if(nw) return openLendSheet(null, nw.dataset.lnew);
  const rq = e.target.closest('[data-share-acc],[data-share-dec]');
  if(rq) return respondShare(rq.closest('[data-share]').dataset.share, rq.hasAttribute('data-share-acc'));
  const b = e.target.closest('[data-act]'); if(!b) return;
  const it = findLend(b.closest('[data-id]')?.dataset.id); if(!it) return;
  if(b.dataset.act === 'lcall') return callPerson(it);
  if(b.dataset.act === 'ledit') openLendSheet(it);
  else if(b.dataset.act === 'lpay') openLendPay(it);
}

/* ---------- add / edit an entry ---------- */
let editingLend = null, lendDir = 'lent', lendPer = 'month';
function pickSeg(id, attr, val){ $$(`#${id} .seg-btn`).forEach(b => b.classList.toggle('sel', b.dataset[attr] === val)); requestAnimationFrame(() => moveThumb($('#' + id))); }
function lendForm(){
  const interest = isOn('lInt') ? { rate: num($('#lRate').value), per: lendPer } : null, tenure = isOn('lTen') ? num($('#lTenM').value) : null;
  const rawPhone = $('#lPhone').value.trim();
  return { dir: lendDir, person: $('#lName').value.trim(), note: $('#lNote').value.trim(), amount: num($('#lAmt').value), date: $('#lDate').value, interest, tenure,
    phone: rawPhone ? normPhone(rawPhone) : '', payments: editingLend?.payments || [] };
}
function drawLendCalc(){
  const f = lendForm(), lent = lendDir === 'lent';
  $('#lNameLabel').innerHTML = (lent ? 'Given to' : 'Borrowed from') + ' <span class="req">*</span>';
  $('#lDateLabel').innerHTML = (lent ? 'Given on' : 'Borrowed on') + ' <span class="req">*</span>';
  $('#lIntFields').classList.toggle('hidden', !f.interest); $('#lTenG').classList.toggle('hidden', !isOn('lTen'));
  if(f.interest) requestAnimationFrame(() => moveThumb($('#lPer')));
  const okTen = isInt(f.tenure) && f.tenure >= 1 && f.tenure <= 600, due = okTen && f.date ? addMonths(f.date, f.tenure) : null;
  $('#lTenHint').textContent = due ? `Due around ${fmtDate(due)}` : '';
  $('#lShareHint').textContent = f.phone && PHONE_RE.test(f.phone) ? `If ${f.person || 'they'} use${f.person ? 's' : ''} Finly, this entry will also appear in their ledger (as "${lent ? 'I borrowed' : 'I gave'}") after they accept.` : '';
  const box = $('#lCalc');
  if(!(f.amount > 0) || !f.date || (f.interest && !(f.interest.rate > 0))){ box.innerHTML = '<div class="calc-line"><span>Enter the amount, date' + (f.interest ? ' and rate' : '') + ' to see the totals.</span></div>'; footShadow($('#lendSheet')); return; }
  const now = lendState(f, diffDays(T, f.date) > 0 ? f.date : T), atDue = due ? lendState(f, due) : null, word = lent ? 'to receive' : 'to pay back';
  box.innerHTML = (f.interest ? `<div class="calc-line"><span>Interest per month</span><b>${fmtMoney(now.monthly)}</b></div>
      <div class="calc-line"><span>Interest so far</span><b class="${lent ? 'pos' : 'neg'}">+${fmtMoney(now.accrued)}</b></div>` : '')
    + (now.paid ? `<div class="calc-line"><span>${lent ? 'Received' : 'Repaid'} so far</span><b>${fmtMoney(now.paid)}</b></div>` : '')
    + `<div class="calc-line total"><span>Today, ${word}</span><b>${fmtMoney(now.outstanding)}</b></div>`
    + (atDue ? `<div class="calc-line"><span>At the end of the tenure (${fmtDate(due)})</span><b>${fmtMoney(atDue.outstanding)}</b></div>`
      + (f.interest ? `<div class="calc-line"><span>Total interest over ${f.tenure} month${f.tenure === 1 ? '' : 's'}</span><b class="${lent ? 'pos' : 'neg'}">${fmtMoney(atDue.accrued)}</b></div>` : '') : '');
  footShadow($('#lendSheet'));
}
function openLendSheet(it, dir){
  editingLend = it || null; clearForm('lendSheet');
  lendDir = it ? it.dir : (dir || (lgFilter === 'borrowed' ? 'borrowed' : 'lent')); lendPer = it?.interest?.per || 'month';
  pickSeg('lDir', 'dir', lendDir); pickSeg('lPer', 'per', lendPer);
  $('#lTitle').textContent = it ? `Edit · ${it.person}` : 'Add to ledger';
  $('#lName').value = it?.person || ''; $('#lNote').value = it?.note || ''; $('#lPhone').value = fmtPhone(it?.phone || ''); lendAutoName = '';
  $('#lPick').classList.toggle('hidden', !isNative);
  setNum('lAmt', it ? it.amount : ''); $('#lDate').value = it?.date || T; $('#lDate').max = T;
  setSwitch('lInt', !!it?.interest); setNum('lRate', it?.interest ? it.interest.rate : '');
  setSwitch('lTen', !!it?.tenure); setNum('lTenM', it?.tenure || '');
  $('#lendDelete').classList.toggle('hidden', !it);
  $('#lendSave').textContent = it ? 'Update entry' : 'Add to ledger';
  drawLendCalc();
  openSheet('lendSheet');
  requestAnimationFrame(() => { moveThumb($('#lDir')); moveThumb($('#lPer')); });
}
function saveLend(){
  clearForm('lendSheet');
  const f = lendForm(), firstPay = [...f.payments].sort((a, b) => dayNum(a.date) - dayNum(b.date))[0]?.date;
  let bad = setInvalid('lNameG', !f.person);
  bad += setInvalid('lAmtG', !(f.amount >= 1 && f.amount <= 1e8));
  bad += setInvalid('lDateG', !f.date || diffDays(T, f.date) > 0 || (firstPay && diffDays(firstPay, f.date) > 0));
  if(f.interest) bad += setInvalid('lRateG', !(f.interest.rate >= 0.01 && f.interest.rate <= 100));
  if(isOn('lTen')) bad += setInvalid('lTenG', !(isInt(f.tenure) && f.tenure >= 1 && f.tenure <= 600));
  if(f.phone) bad += setInvalid('lPhoneG', !PHONE_RE.test(f.phone));
  if(bad){ showAlert('lendAlert', `Please fix ${bad} highlighted field${bad > 1 ? 's' : ''}.`); scrollToError('lendSheet'); return; }
  closeSheet('lendSheet');
  const rec = { dir:f.dir, person:f.person, note:f.note, phone:f.phone, amount:round2(f.amount), date:f.date, interest: f.interest ? { rate:round2(f.interest.rate), per:f.interest.per } : null, tenure: isOn('lTen') ? f.tenure : null };
  const hadPhone = editingLend?.phone;
  if(editingLend){
    const id = editingLend.id;
    commit(() => { const x = findItem(id); Object.assign(x, rec);
      const left = lendState(x, T).outstanding;
      if(x.payments.length && left <= 0.5){ if(x.status !== 'closed'){ x.status = 'closed'; x.closedOn = x.payments[x.payments.length - 1].date; } }
      else { x.status = 'active'; delete x.closedOn; } },
      { type:'success', title:'Entry updated', body:f.person });
    flashCard(id);
    if(rec.phone) pushShare(findItem(id)); else if(hadPhone) shareRemove(id).catch(() => {});
  } else {
    const id = uid();
    commit(() => st().items.push({ id, kind:'lend', catId:null, ...rec, payments:[], reminders:null, status:'active', files:[] }),
      { type:'success', title: f.dir === 'lent' ? `Gave ${fmtMoney(f.amount)} to ${f.person}` : `Borrowed ${fmtMoney(f.amount)} from ${f.person}`,
        body: rec.tenure ? `Due ${fmtDate(addMonths(f.date, rec.tenure))} · you'll get a reminder` : rateLabel(rec) });
    lgFilter = 'all'; pickSeg('lgFilter', 'f', 'all');
    if(page !== 'ledger') go('ledger');
    renderLedger(); flushBars();
    setTimeout(() => highlight(`#lgList [data-id="${id}"]`), 380);
    maybeAskNotify();
    if(rec.phone) pushShare(findItem(id));
  }
}
function deleteLend(){
  const it = editingLend; if(!it) return;
  closeSheet('lendSheet');
  confirmBox({ title:`Delete ${it.person}?`, body:`This entry${it.payments.length ? ` and its ${it.payments.length} payment${it.payments.length === 1 ? '' : 's'}` : ''} will be removed. You can undo right after.`, onYes: async () => {
    await animateOut(it.id);
    commit(() => { st().items = st().items.filter(i => i.id !== it.id); }, { type:'warning', title:'Deleted', body:it.person });
    if(it.phone) shareRemove(it.id).catch(() => {});
  }});
}

/* ---------- choose a person from the phone's contacts ---------- */
let lendAutoName = '';
async function chooseContact(){
  let c;
  try{ c = await pickContact(); }
  catch(e){ return toast({ type:'warning', title:'Contacts not allowed', body:'Allow Contacts for Finly in Android Settings → Apps → Finly → Permissions.', ms:7000 }); }
  if(!c) return;
  const name = $('#lName').value.trim();
  if(c.name && (!name || name === lendAutoName)){ $('#lName').value = c.name; lendAutoName = c.name; }
  const seen = new Set(), phones = (c.phones || []).map(p => ({ ...p, norm: normPhone(p.number) })).filter(p => PHONE_RE.test(p.norm) && !seen.has(p.norm) && seen.add(p.norm));
  const use = p => { $('#lPhone').value = fmtPhone(p.norm); $('#lPhoneG').classList.remove('invalid'); drawLendCalc(); };
  if(!phones.length){ drawLendCalc(); return toast({ type:'warning', title:'No mobile number', body:`${c.name || 'This contact'} has no phone number saved.` }); }
  if(phones.length === 1) return use(phones[0]);
  $('#ppTitle').textContent = c.name || 'Choose a number';
  $('#ppList').innerHTML = phones.map((p, i) => `<button class="pp-row" data-pp="${i}"><span class="pp-ic">${e3d('📱')}</span><span><b>${esc(fmtPhone(p.norm))}</b><small>${esc(p.label || 'Mobile')}${p.primary ? ' · default' : ''}</small></span>${ICON.right}</button>`).join('');
  $('#ppList').onclick = e => { const b = e.target.closest('[data-pp]'); if(!b) return; use(phones[+b.dataset.pp]); closeSheet('phonePickSheet'); };
  openSheet('phonePickSheet');
}

/* ---------- record money received / repaid ---------- */
let payLend = null;
function openLendPay(it){
  payLend = it; clearForm('lendPaySheet');
  const lent = it.dir === 'lent', s_ = lendState(it, T), closed = it.status === 'closed';
  $('#lpTitle').textContent = closed ? `${it.person} · payments` : lent ? `Received from ${it.person}` : `Given to ${it.person}`;
  $('#lpSub').textContent = closed ? `Settled ${fmtDate(it.closedOn)}` : `Outstanding ${fmtMoney(s_.outstanding)}${s_.interest ? ` (principal ${fmtMoney(s_.principal)} + interest ${fmtMoney(s_.interest)})` : ''}`;
  const last = it.payments.length ? [...it.payments].sort((a, b) => dayNum(b.date) - dayNum(a.date))[0].date : it.date;
  $('#lpDate').min = last; $('#lpDate').max = T; $('#lpDate').value = T;
  setNum('lpAmt', closed ? '' : s_.outstanding);
  $$('#lendPaySheet .frow, #lpCalc, #lpSave').forEach(el => el.classList.toggle('hidden', closed));
  $('#lpSave').textContent = lent ? 'Received' : 'Given';
  $('#lpHist').innerHTML = it.payments.length ? [...it.payments].sort((a, b) => dayNum(b.date) - dayNum(a.date))
      .map(p => `<div class="h-row"><span class="h-round">${e3d(lent ? '💰' : '💸')}</span><span class="h-desc">${lent ? 'Received' : 'Repaid'}<br><span class="h-date">${fmtDate(p.date)}</span></span><span class="h-amt">${fmtMoney(p.amount)}</span></div>`).join('')
    : '<div class="h-desc" style="padding:6px 0">No payments yet.</div>';
  drawLendPay();
  openSheet('lendPaySheet');
}
function lendPayCheck(){
  const it = payLend, v = num($('#lpAmt').value), date = $('#lpDate').value;
  if(!date || !(v > 0)) return { ok:false };
  const sp = splitPayment(it, v, date);
  return { ok: v <= sp.before.outstanding + 0.5, v, date, sp };
}
function drawLendPay(){
  const it = payLend, c = lendPayCheck(), lent = it.dir === 'lent';
  $('#lpAmtG').classList.toggle('invalid', !!c.sp && !c.ok);
  if(c.sp && !c.ok) $('#lpAmtErr').textContent = `More than the ${fmtMoney(c.sp.before.outstanding)} outstanding.`;
  $('#lpCalc').innerHTML = !c.sp ? '<div class="calc-line"><span>Enter the amount and date.</span></div>'
    : `<div class="calc-line"><span>Outstanding on ${fmtDate(c.date)}</span><b>${fmtMoney(c.sp.before.outstanding)}</b></div>
      ${c.sp.before.interest ? `<div class="calc-line"><span>Clears interest</span><b>${fmtMoney(c.sp.toInterest)}</b></div>` : ''}
      <div class="calc-line"><span>Clears principal</span><b>${fmtMoney(c.sp.toPrincipal)}</b></div>
      <div class="calc-line total"><span>${c.sp.after <= 0.5 ? 'Fully settled' : lent ? 'Still to receive' : 'Still to pay back'}</span><b class="${c.sp.after <= 0.5 ? 'pos' : ''}">${c.sp.after <= 0.5 ? '🎉' : fmtMoney(c.sp.after)}</b></div>`;
  $('#lpSave').disabled = !c.ok;
  footShadow($('#lendPaySheet'));
}
async function saveLendPay(){
  const it = payLend, c = lendPayCheck();
  if(setInvalid('lpDateG', !c.date || diffDays(T, c.date) > 0 || dayNum(c.date) < dayNum($('#lpDate').min))) return;
  if(!c.ok) return;
  const settles = c.sp.after <= 0.5, id = it.id, lent = it.dir === 'lent';
  if(it.remote){
    if(!navigator.onLine) return toast({ type:'warning', title:'You\'re offline', body:'Shared entries need the internet to record a payment.' });
    closeSheet('lendPaySheet');
    try{ await shareAddPayment(it.shareId, { id:uid(), date:c.date, amount:round2(c.v), by:user.id }); await refreshShares();
      toast({ type:'success', title: lent ? `Received ${fmtMoney(c.v)}` : `Repaid ${fmtMoney(c.v)}`, body:`${it.person} sees this payment too.` }); }
    catch{ toast({ type:'error', title:'Couldn\'t record the payment', body:'Please try again.' }); }
    return;
  }
  closeSheet('lendPaySheet');
  if(settles) await animateOut(id);
  commit(() => { const x = findItem(id); x.payments.push({ id:uid(), date:c.date, amount:round2(c.v), by:user.id });
      if(settles){ x.status = 'closed'; x.closedOn = c.date; } },
    settles ? { type:'success', title:`${it.person} — all settled 🎉`, body:'Moved to Settled.' }
      : { type:'success', title: lent ? `Received ${fmtMoney(c.v)}` : `Repaid ${fmtMoney(c.v)}`, body:`${it.person} · ${fmtMoney(c.sp.after)} ${lent ? 'still to receive' : 'still to pay back'}` });
  if(!settles) flashCard(id);
  if(it.phone) pushShare(findItem(id), true);
}

/* ================================================================
   CATEGORIES
================================================================ */
const EMOJIS = ['🏦','🤝','🏠','📶','📱','💡','🚗','🏍️','🎓','🏥','💊','🛒','🍔','⛽','✈️','🎮','🎵','📚','👕','🐾','🎁','💳','🧾','💰','🛠️','👶','🏋️','☕','🌐','📺','🔌','💼'];
let editingCat = null, pickedEmoji = '', catRem;
const nextCi = () => { const used = st().cats.map(c => c.ci); for(let i = 0; i < 64; i++) if(!used.includes(i)) return i; return st().cats.length; };
function drawCatPreview(bump){
  $$('.emoji-btn').forEach(b => b.classList.toggle('sel', b.dataset.e === pickedEmoji));
  const name = $('#catName').value.trim(), g = $('#catPrevGlyph');
  g.style.setProperty('--accent', catColor(editingCat || { ci: nextCi() }));
  g.innerHTML = pickedEmoji ? e3d(pickedEmoji) : `<span class="glyph-letter">${esc((name || '?').charAt(0).toUpperCase())}</span>`;
  if(bump){ g.classList.remove('bump'); void g.offsetWidth; g.classList.add('bump'); }
  $('#catPrevName').textContent = name || 'Category name';
  $('#catPrevSub').textContent = pickedEmoji ? 'Custom icon' : 'No icon picked — the first letter is used';
}
function openCatSheet(c){
  editingCat = c; clearForm('catSheet');
  $('#catTitle').textContent = c ? 'Edit ' + c.name : 'New category';
  $('#catSave').textContent = c ? 'Update category' : 'Add category';
  catSubs = clone(c?.subs || []); $('#catSubName').value = ''; $('#catSubErr').style.display = 'none';
  $('#catSubsG').classList.toggle('hidden', c?.kind === 'chit'); drawCatSubs();
  $('#catName').value = c ? c.name : ''; pickedEmoji = c ? c.emoji || '' : '';
  catRem.set(c ? c.reminders : [1]);
  $('#catDelete').classList.toggle('hidden', !c);
  drawCatPreview(false); openSheet('catSheet');
}
/* ---------- types inside a category ---------- */
let catSubs = [];
const SUB_ICONS = ['🚗','🏍️','🛵','🚕','🛺','🚜','🏡','🏠','🏗️','💵','🏦','🏧','📲','💳','💻','📱','📺','🎓','🏫','🏪','💼','🩺','🛡️','💍','🪙',
  '🌐','📡','🎬','💡','💧','🔥','🧹','🛒','🧺','👶','🐾','✈️','🎮','📦'];
function drawCatSubs(){
  $('#catSubs').innerHTML = catSubs.length ? catSubs.map(x => `<span class="sub-chip">${e3d(x.emoji)}${esc(x.name)}<button type="button" data-sub-x="${esc(x.id)}" aria-label="Remove ${esc(x.name)}">${ICON.x}</button></span>`).join('')
    : '<span class="sub-none">No types yet — add one below.</span>';
}
function addCatSub(){
  const name = $('#catSubName').value.trim(), err = $('#catSubErr');
  const bad = !name ? 'Type a name for the new type.' : catSubs.some(x => x.name.toLowerCase() === name.toLowerCase()) ? 'That type already exists.' : catSubs.length >= 20 ? 'Up to 20 types per category.' : '';
  err.textContent = bad; err.style.display = bad ? 'block' : 'none';
  if(bad) return;
  catSubs.push({ id: uid().slice(0, 8), name, emoji: $('#catSubIcon').value });
  $('#catSubName').value = ''; drawCatSubs();
}
function removeCatSub(id){
  const used = editingCat ? st().items.filter(i => i.catId === editingCat.id && i.subId === id).length : 0, err = $('#catSubErr');
  if(used){ err.textContent = `${used} item${used > 1 ? 's use' : ' uses'} this type. Change ${used > 1 ? 'them' : 'it'} first.`; err.style.display = 'block'; return; }
  catSubs = catSubs.filter(x => x.id !== id); err.style.display = 'none'; drawCatSubs();
}
function saveCat(){
  clearForm('catSheet');
  const name = $('#catName').value.trim(), dup = st().cats.find(c => c.name.toLowerCase() === name.toLowerCase() && c !== editingCat);
  if(setInvalid('catNameG', !name || dup, 'catNameErr', !name ? 'Name is required.' : `You already have a category called "${dup.name}".`)){ $('#catName').focus(); return; }
  const rem = catRem.get(), emoji = pickedEmoji;
  closeSheet('catSheet');
  if(editingCat){
    const id = editingCat.id;
    commit(() => Object.assign(cat(id), { name, emoji, reminders:rem, ...(editingCat.kind === 'chit' ? {} : { subs:catSubs }) }), { type:'success', title:'Category updated', body:`${name} · reminders ${remSummary(rem)}` });
  } else {
    commit(() => st().cats.push({ id:uid(), name, emoji, kind:'bill', ci:nextCi(), reminders:rem, subs:catSubs }),
      { type:'success', title:'Category added', body: emoji ? name : `${name} — showing "${name.charAt(0).toUpperCase()}" until you pick an icon` });
  }
}
function deleteCat(){
  const c = editingCat; if(!c) return;
  if(c.builtin) return showAlert('catAlert', `${c.name} is built in — chit tracking depends on it. You can rename it or change its icon.`);
  const used = st().items.filter(i => i.catId === c.id).length;
  if(used) return showAlert('catAlert', `${used} item${used > 1 ? 's use' : ' uses'} this category (including closed ones). Move or delete ${used > 1 ? 'them' : 'it'} first.`);
  closeSheet('catSheet');
  confirmBox({ title:`Delete ${c.name}?`, body:'No items use it. You can undo right after.', onYes:() =>
    commit(() => { st().cats = st().cats.filter(x => x.id !== c.id); }, { type:'warning', title:'Category deleted', body:c.name }) });
}

/* ================================================================
   PROFILE / INCOME
================================================================ */
function openProfileSheet(focusIncome, focusPhone){
  clearForm('profileSheet');
  const se = st().settings;
  $('#pfSheetEmail').textContent = user.email;
  $('#pfNameIn').value = displayName();
  $('#pfPhone').value = fmtPhone(se.whatsapp || '');
  $('#pfCompany').value = se.company || '';
  $('#pfDob').value = se.dob || ''; $('#pfDob').max = T;
  $('#pfPin').value = se.pin || '';
  $('#pfCity').value = se.city || '';
  pinState = { pin: se.pin || '', state: se.state || '' };
  setNum('pfIncomeIn', se.income ?? '');
  drawAge(); drawPinHint(se.pin && se.city ? `${se.city}${se.state ? ', ' + se.state : ''}` : '', 'ok');
  openSheet('profileSheet');
  if(focusIncome) setTimeout(() => $('#pfIncomeIn').focus(), 420);
  $('#pfPhoneG').classList.toggle('attn', !!focusPhone);
  if(focusPhone) setTimeout(() => $('#pfPhone').focus(), 420);
}
function drawAge(){
  const v = $('#pfDob').value, age = v && diffDays(T, v) < 0 ? ageFrom(v) : null;
  $('#pfAge span').textContent = age == null ? '—' : `${age} year${age === 1 ? '' : 's'}`;
  $('#pfAge').classList.toggle('filled', age != null);
}
let pinState = { pin:'', state:'' }, pinSeq = 0;
function drawPinHint(text, kind){
  const h = $('#pfPinHint');
  h.innerHTML = !text ? '' : kind === 'busy' ? `<span class="spinner dim"></span>${esc(text)}` : kind === 'ok' ? `${e3d('📍')}${esc(text)}` : esc(text);
  h.className = 'fhint pin-hint ' + (kind || '');
}
async function onPinInput(){
  const el = $('#pfPin'), pin = el.value.replace(/\D/g, '').slice(0, 6);
  if(el.value !== pin) el.value = pin;
  $('#pfPinG').classList.remove('invalid');
  if(pin.length < 6){ drawPinHint(pin ? 'Keep typing — 6 digits' : '', ''); return; }
  if(!PIN_RE.test(pin)){ setInvalid('pfPinG', true, 'pfPinErr', 'That isn\'t a valid PIN code.'); drawPinHint('', ''); return; }
  if(pin === pinState.pin && $('#pfCity').value) return;
  const seq = ++pinSeq;
  drawPinHint('Finding your city…', 'busy');
  try{
    const r = await lookupPin(pin);
    if(seq !== pinSeq) return;
    if(!r){ drawPinHint('We couldn\'t find this PIN code — type your city instead.', 'warn'); pinState = { pin, state:'' }; return; }
    $('#pfCity').value = r.city; pinState = { pin, state:r.state };
    $('#pfCity').classList.remove('pop'); void $('#pfCity').offsetWidth; $('#pfCity').classList.add('pop');
    drawPinHint(`${r.city}, ${r.state}`, 'ok');
  }catch{
    if(seq !== pinSeq) return;
    drawPinHint(navigator.onLine ? 'Couldn\'t look up the PIN right now — type your city instead.' : 'You\'re offline — type your city, or try again when you\'re online.', 'warn');
    pinState = { pin, state:'' };
  }
}
function saveProfile(){
  clearForm('profileSheet');
  const name = $('#pfNameIn').value.trim(), incRaw = $('#pfIncomeIn').value.trim(), inc = incRaw ? num(incRaw) : null;
  const company = $('#pfCompany').value.trim(), dob = $('#pfDob').value, pin = $('#pfPin').value.trim(), city = $('#pfCity').value.trim();
  const phone = normPhone($('#pfPhone').value);
  let bad = setInvalid('pfNameG', !name);
  bad += setInvalid('pfPhoneG', !PHONE_RE.test(phone), 'pfPhoneErr', 'Enter your WhatsApp number (10 digits, or with country code).');
  bad += setInvalid('pfDobG', !!dob && (diffDays(T, dob) >= 0 || ageFrom(dob) == null));
  bad += setInvalid('pfPinG', !!pin && !PIN_RE.test(pin), 'pfPinErr', 'Enter a 6-digit PIN code.');
  bad += setInvalid('pfIncomeG', inc != null && !(inc >= 0 && inc <= 1e8));
  if(bad){ showAlert('pfAlert', `Please fix ${bad} highlighted field${bad > 1 ? 's' : ''}.`); scrollToError('profileSheet'); return; }
  closeSheet('profileSheet');
  const state = pin && pin === pinState.pin ? pinState.state : (pin === st().settings.pin ? st().settings.state : '');
  const phoneChanged = phone !== st().settings.whatsapp;
  commit(() => Object.assign(st().settings, { name, income: inc, company, dob, pin, city, state, whatsapp: phone }), { type:'success', title:'Profile saved' });
  if(phoneChanged) pushProfile(true);
  afterWhatsappSaved();
}

/* ---------- profile icon: 3D icon, photo or initial ---------- */
function openAvatarSheet(){
  const a = st().settings.avatar;
  $('#avGrid').innerHTML = AVATARS.map((e, i) => `<button type="button" class="av-btn ${a?.type === 'emoji' && a.v === e ? 'sel' : ''}" data-av="${e}" style="--i:${i}" aria-label="Use ${e}">${e3d(e)}</button>`).join('');
  $('#avLetter').innerHTML = `<span class="av-letter">${esc(displayName().charAt(0).toUpperCase())}</span>Use initial`;
  openSheet('avatarSheet');
}
function setAvatar(avatar, title){
  closeSheet('avatarSheet');
  commit(() => { st().settings.avatar = avatar; }, { type:'success', title });
  const f = $('#pfAvatar'); f.classList.remove('bump'); void f.offsetWidth; f.classList.add('bump');
}
/** Square-crops and shrinks a photo to a small JPEG so it can sync with your settings. */
function photoToDataUrl(file){
  return new Promise((res, rej) => {
    if(!/^image\//.test(file.type)) return rej(new Error('type'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight), S = 192, c = document.createElement('canvas');
      c.width = c.height = S;
      c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, S, S);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', .82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
    img.src = url;
  });
}
async function onAvatarPicked(file){
  try{ setAvatar({ type:'photo', v: await photoToDataUrl(file) }, 'Profile photo updated'); }
  catch{ toast({ type:'error', title:'Couldn\'t use that picture', body:'Pick a JPG or PNG photo.' }); }
}

/* ================================================================
   EXPORT
================================================================ */
const ex = { status:new Set(), types:new Set(), cats:new Set(), excluded:new Set(), format:'pdf', csvKind:'payments' };
const TYPE_LABEL = { bill:'EMIs & bills', chit:'Chit funds' };
function openExport(presetId){
  const it = presetId && findItem(presetId);
  ex.status = new Set(['active', 'closed']); ex.types = new Set(['bill', 'chit']); ex.cats = new Set(st().cats.map(c => c.id));
  ex.excluded = new Set(it ? st().items.filter(i => i.id !== presetId).map(i => i.id) : []);
  $('#exTitle').textContent = it ? `Export ${it.name}` : 'Export';
  setSelect('exPeriod', 'all'); $('#exRange').classList.add('hidden');
  $('#exFrom').value = addMonths(T, -3); $('#exTo').value = T;
  drawExport(); openSheet('exportSheet');
}
const exVisible = () => st().items.filter(i => ex.status.has(i.status) && ex.types.has(i.kind) && ex.cats.has(i.catId))
  .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1) || a.name.localeCompare(b.name));
const exSelected = () => exVisible().filter(i => !ex.excluded.has(i.id));
function periodRange(){
  const v = $('#exPeriod').value, d = parseISO(T), y = d.getFullYear(), m = d.getMonth(), fy = m >= 3 ? y : y - 1;
  switch(v){
    case 'month': return { from: toISO(new Date(y, m, 1)), to: T, label: 'This month' };
    case '3m': return { from: addMonths(T, -3), to: T, label: 'Last 3 months' };
    case 'fy': return { from: `${fy}-04-01`, to: T, label: `FY ${fy}–${String(fy + 1).slice(2)}` };
    case 'lfy': return { from: `${fy - 1}-04-01`, to: `${fy}-03-31`, label: `FY ${fy - 1}–${String(fy).slice(2)}` };
    case 'year': return { from: `${y}-01-01`, to: T, label: String(y) };
    case 'custom': return { from: $('#exFrom').value || null, to: $('#exTo').value || T, label: 'Custom range', custom:true };
    default: return { from: null, to: T, label: 'All time' };
  }
}
function drawExport(){
  const pill = (attr, key, label, on) => `<button type="button" class="tpill ${on ? 'on' : ''}" ${attr}="${key}">${label}</button>`;
  $('#exStatus').innerHTML = pill('data-st', 'active', 'Active', ex.status.has('active')) + pill('data-st', 'closed', 'Closed', ex.status.has('closed'));
  $('#exType').innerHTML = Object.entries(TYPE_LABEL).map(([k, l]) => pill('data-ty', k, l, ex.types.has(k))).join('');
  $('#exCats').innerHTML = st().cats.map(c => pill('data-ca', c.id, (c.emoji ? esc(c.emoji) + ' ' : '') + esc(c.name), ex.cats.has(c.id))).join('');
  const vis = exVisible(), sel = exSelected();
  $('#exCount').textContent = `Commitments · ${sel.length} of ${vis.length} selected`;
  $('#exList').innerHTML = vis.length ? vis.map(it => { const c = cat(it.catId), on = !ex.excluded.has(it.id);
    return `<button type="button" class="ex-row ${on ? 'on' : ''}" data-row="${it.id}" role="checkbox" aria-checked="${on}" style="--accent:${catColor(c)}"><span class="cbox">${ICON.check}</span><span class="glyph">${glyphHTML(c, it)}</span>
      <span style="min-width:0"><span class="ex-name">${esc(it.name)}</span><span class="ex-sub">${it.status === 'active' ? 'Active' : 'Closed ' + fmtDate(it.closedOn)} · ${esc(catLabel(it))} · ${fmtMoney(itemPaid(it))} paid</span></span></button>`; }).join('')
    : '<div class="empty" style="border:none;padding:22px">Nothing matches these filters.</div>';
  $$('#exFormat .choice').forEach(b => b.classList.toggle('sel', b.dataset.fmt === ex.format));
  $('#exCsvWrap').classList.toggle('hidden', ex.format !== 'csv');
  $$('#exCsvKind .seg-btn').forEach(b => b.classList.toggle('sel', b.dataset.k === ex.csvKind));
  requestAnimationFrame(() => moveThumb($('#exCsvKind')));
  const r = periodRange(), pays = paymentRows(sel, r, fmtMoney, exportHelpers), paid = pays.reduce((s, p) => s + p.paid, 0);
  const badRange = r.custom && r.from && r.to && dayNum(r.from) > dayNum(r.to);
  $('#exFromG').classList.toggle('invalid', !!badRange);
  const needsPayments = ex.format === 'pdf' || ex.csvKind === 'payments';
  $('#exPreview').innerHTML = !sel.length ? '<span class="warn">Select at least one commitment to export.</span>'
    : `<b>${sel.length}</b> commitment${sel.length === 1 ? '' : 's'} · <b>${pays.length}</b> payment${pays.length === 1 ? '' : 's'} totalling <b>${fmtMoney(paid)}</b><br>Period: ${r.label}${r.from ? ` (${fmtDate(r.from)} – ${fmtDate(r.to)})` : ''}`
      + (needsPayments && !pays.length ? '<br><span class="warn">No payments fall in this period — the file will only show the summary.</span>' : '')
      + (ex.format === 'csv' && ex.csvKind === 'summary' ? '<br>Summary shows balances as of today; the period doesn\'t apply.' : '');
  const go_ = $('#exGo');
  go_.disabled = !sel.length || badRange;
  go_.innerHTML = `${ICON.export}Export ${ex.format === 'pdf' ? 'PDF' : 'CSV'}${sel.length === 1 ? '' : ` · ${sel.length} items`}`;
  requestAnimationFrame(() => footShadow($('#exportSheet')));
}
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'commitment';
async function runExport(){
  const items = exSelected(), r = periodRange(), btn = $('#exGo');
  if(!items.length) return;
  const base = items.length === 1 ? `finly-${slug(items[0].name)}` : 'finly';
  setBusy(btn, true, 'Preparing…');
  try{
    let filename, data;
    if(ex.format === 'csv'){ data = buildCsv(ex.csvKind, items, r, exportHelpers); filename = `${base}-${ex.csvKind}-${T}.csv`; }
    else { data = await buildPdf(items, r, exportHelpers, paletteVars(st().settings.palette, 'light'), { name: displayName(), email: user.email }); filename = `${base}-statement-${T}.pdf`; }
    const res = await saveFile(filename, data);
    setBusy(btn, false); drawExport();
    if(res === 'saved'){ closeSheet('exportSheet'); toast({ type:'success', title:'Export ready', body:`${filename} · ${items.length} commitment${items.length === 1 ? '' : 's'}`, ms:5000 }); }
    else toast({ type:'warning', title:'Export cancelled', body:'Nothing was saved.' });
  }catch(e){
    console.error(e); setBusy(btn, false); drawExport();
    toast({ type:'error', title:'Couldn\'t create the file', body:'Please try again.' });
  }
}

/* ================================================================
   ALERTS / NOTIFICATIONS
================================================================ */
function openAlerts(){
  const a = computeAlerts();
  $('#notifSub').textContent = !st().settings.alertsOn ? 'Reminders are turned off' : a.length ? (a.some(x => x.d < 0) ? `${a.filter(x => x.d < 0).length} overdue · ${a.length} in total — tap one to open it` : `${a.length} due soon — tap one to open it`) : 'Nothing due soon';
  $('#notifList').innerHTML = !st().settings.alertsOn
    ? `<div class="empty"><div class="em">${e3d('🔕')}</div><b>Reminders are off</b>Turn them on to get notified before due dates.<div class="empty-actions"><button class="btn btn-primary btn-sm" id="turnOnAlerts">Turn on reminders</button></div></div>`
    : a.length ? a.map(({ it, due, d }, i) => { const c = cat(it.catId), isLend = it.kind === 'lend';
        const when = d < 0 ? `Overdue ${-d}d` : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`;
        const what = isLend ? `${fmtMoney(lendState(it, T).outstanding)} ${it.dir === 'lent' ? 'to collect' : 'to repay'}` : it.kind === 'chit' ? `Round ${it.roundsDone + 1} · ${fmtMoney(it.installment)}` : fmtMoney(it.amount);
        return `<button class="notif-item" data-goto="${it.id}" style="--i:${i}"><span class="notif-ic glyph" style="--accent:${isLend ? lendColor(it) : catColor(c)}">${isLend ? lendGlyph(it) : glyphHTML(c, it)}</span>
          <span style="min-width:0"><span class="notif-t">${esc(isLend ? lendWho(it) : it.name)}</span><span class="notif-s">${what} · ${fmtDate(due)}</span></span>
          <span class="notif-when badge ${d <= 1 ? 'due' : 'soon'}">${when}</span></button>`; }).join('')
    : `<div class="empty"><div class="em">${e3d('✅')}</div><b>You're all caught up</b>Nothing is inside its reminder window right now.</div>`;
  seenSig = alertSig; renderBell();
  openSheet('notifSheet');
}
async function setAlerts(on){
  if(on && isNative){
    let p = await notifyPermission();
    if(p !== 'granted') p = await requestNotifyPermission();
    if(p !== 'granted'){
      setSwitch('alertsSwitch', false);
      toast({ type:'warning', title:'Notifications are blocked', body:'Allow them in Android Settings → Apps → Finly → Notifications, then turn this on again.', ms:7000 });
      if(st().settings.alertsOn) setSetting({ alertsOn:false });
      return;
    }
  }
  setSetting({ alertsOn:on });
  schedulePlanNotice(on);
  toast({ type: on ? 'success' : 'warning', title: on ? 'Reminders on' : 'Reminders off', body: on ? (isNative ? 'You\'ll get a notification at 9 AM before each due date.' : 'Due items will show in the bell. Phone notifications work in the Android app.') : 'You won\'t be reminded until you turn this back on.' });
}
/** Shows under the reminders switch whether this phone will actually show notifications. */
let notifyBlocked = false;
async function refreshNotifyStatus(){
  const sub = $('#alertsSub'); if(!sub) return;
  if(!isNative){ sub.textContent = 'Due items show in the bell — phone notifications work in the Android app'; return; }
  const p = await notifyPermission(); notifyBlocked = p !== 'granted';
  sub.textContent = !st().settings.alertsOn ? 'Off' : notifyBlocked ? 'Notifications are blocked — tap to allow' : 'Phone notification at 9 AM';
  $('#alertsRow').classList.toggle('warn-row', st().settings.alertsOn && notifyBlocked);
}
let askedNotify = false;
async function maybeAskNotify(){
  if(askedNotify || !isNative || !st().settings.alertsOn) return;
  askedNotify = true;
  if((await notifyPermission()) !== 'granted') await requestNotifyPermission();
  scheduleReminders(reminderPlan);
}

/* ================================================================
   BANK ACCOUNTS
================================================================ */
const banks = () => st().settings.banks || [];
const bankById = id => banks().find(b => b.id === id);
const bankLabel = b => `${shortName(b.name)} ${maskAcct(b.acct)}`;
const branchText = b => b.branch ? `${b.branch}${b.branchCity && b.branchCity !== b.branch ? ', ' + b.branchCity : ''}` : '';
function renderBanks(){
  $('#bankList').innerHTML = banks().length ? banks().map((b, i) => `<button class="bank-row" data-bank="${b.id}" style="animation-delay:${i * 40}ms">${bankBadgeHTML(b.name)}
      <span style="min-width:0;flex:1"><span class="bank-name">${esc(b.name)}</span><span class="bank-sub">${maskAcct(b.acct)} · ${esc(b.ifsc)}</span>${b.branch ? `<span class="bank-branch">${e3d('📍')}${esc(branchText(b))}</span>` : ''}</span>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m9 18 6-6-6-6"/></svg></button>`).join('')
    : `<div class="empty" style="padding:20px"><div class="em">${e3d('🏦')}</div>No bank accounts yet.<div class="empty-actions"><button class="btn btn-secondary btn-sm" data-add-bank>Add bank account</button></div></div>`;
  backfillBranches();
}
/** Accounts saved while offline get their branch filled in once we're back online. */
const branchTried = new Set();
async function backfillBranches(){
  if(!navigator.onLine) return;
  for(const b of banks().filter(x => !x.branch && !branchTried.has(x.ifsc))){
    branchTried.add(b.ifsc);
    try{
      const r = await lookupIfsc(b.ifsc); if(!r || !r.branch) continue;
      commit(() => { const x = banks().find(y => y.id === b.id); if(x && !x.branch) Object.assign(x, { branch:r.branch, branchCity:r.city || r.district }); });
    }catch{ branchTried.delete(b.ifsc); return; }
  }
}
function fillBankSelect(selected){
  $('#bBank').innerHTML = `<option value="">Not set</option>` + banks().map(b => `<option value="${b.id}">${esc(bankLabel(b))}</option>`).join('') + `<option value="__add">+ Add bank account</option>`;
  setSelect('bBank', selected && bankById(selected) ? selected : '');
  $('#bBank').dataset.prev = $('#bBank').value;
}

let editingBank = null, onBankSaved = null;
function openBankSheet(b, after){
  editingBank = b || null; onBankSaved = after || null; clearForm('bankSheet');
  $('#bkTitle').textContent = b ? 'Edit bank account' : 'Add bank account';
  $('#bkSave').textContent = b ? 'Update bank account' : 'Add bank account';
  $('#bkBank').innerHTML = `<option value="">Choose your bank</option>` + BANK_GROUPS.map(([g, list]) => `<optgroup label="${esc(g)}">${list.map(([n]) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</optgroup>`).join('')
    + `<optgroup label="Not listed"><option value="${OTHER_BANK}">Other — type the name</option></optgroup>`;
  const known = b && findBank(b.name);
  setSelect('bkBank', b ? (known ? b.name : OTHER_BANK) : '');
  $('#bkOther').value = b && !known ? b.name : '';
  $('#bkOtherG').classList.toggle('hidden', $('#bkBank').value !== OTHER_BANK);
  $('#bkHolder').value = b?.holder || '';
  $('#bkAcct').value = b?.acct || '';
  $('#bkIfsc').value = b?.ifsc || '';
  $('#bkIfscHint').textContent = 'Printed on your cheque book or passbook.';
  ifscFound = b?.branch ? { ifsc:b.ifsc, branch:b.branch, city:b.branchCity || '' } : null;
  drawBranch(ifscFound ? 'ok' : '');
  drawBankBadge();
  $('#bkDelete').classList.toggle('hidden', !b);
  openSheet('bankSheet');
}
function onBankPicked(){
  const v = $('#bkBank').value;
  $('#bkOtherG').classList.toggle('hidden', v !== OTHER_BANK);
  const known = findBank(v), ifsc = $('#bkIfsc');
  if(known && (!ifsc.value || bankFromIfsc(ifsc.value)?.[0] !== v) && ifsc.value.length < 5) ifsc.value = known[2];
  if(v === OTHER_BANK) setTimeout(() => $('#bkOther').focus(), 150);
  ifscHint(); drawBankBadge();
}
const drawBankBadge = () => $('#bkBank')._dd?.sync();
let ifscFound = null, ifscSeq = 0;
function drawBranch(kind, msg){
  const el = $('#bkBranch');
  if(!kind){ el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.className = 'lookup-card ' + kind;
  if(kind === 'busy') el.innerHTML = `<span class="spinner dim"></span><span>Looking up the branch…</span>`;
  else if(kind === 'ok') el.innerHTML = `${e3d('📍', 'lk-ic')}<span><b>${esc(ifscFound.branch)}</b>${ifscFound.city ? `<small>${esc(ifscFound.city)}${ifscFound.state ? ', ' + esc(ifscFound.state) : ''}</small>` : ''}</span>`;
  else el.innerHTML = `<span>${esc(msg)}</span>`;
}
async function findBranch(ifsc){
  if(ifscFound?.ifsc === ifsc) return drawBranch('ok');
  const seq = ++ifscSeq;
  drawBranch('busy');
  try{
    const r = await lookupIfsc(ifsc);
    if(seq !== ifscSeq) return;
    if(!r){ ifscFound = null; return drawBranch('warn', 'No branch found for this IFSC — please double-check it.'); }
    ifscFound = { ifsc, branch:r.branch, city:r.city || r.district, state:r.state };
    const guess = findBank(r.bank) ? r.bank : bankFromIfsc(ifsc)?.[0];
    if(guess && !$('#bkBank').value){ setSelect('bkBank', guess); $('#bkOtherG').classList.add('hidden'); drawBankBadge(); }
    drawBranch('ok'); ifscHint();
  }catch{
    if(seq !== ifscSeq) return;
    ifscFound = null;
    drawBranch('warn', navigator.onLine ? 'Couldn\'t look up the branch right now. You can still save — we\'ll fill it in later.' : 'You\'re offline. You can still save — the branch is filled in when you\'re back online.');
  }
}
function ifscHint(){
  const v = $('#bkIfsc').value, guess = bankFromIfsc(v), chosen = $('#bkBank').value;
  $('#bkIfscHint').textContent = guess && chosen && chosen !== OTHER_BANK && guess[0] !== chosen ? `This IFSC looks like ${guess[0]}.` : 'Printed on your cheque book or passbook.';
}
function onIfscInput(){
  const el = $('#bkIfsc'), clean = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
  if(el.value !== clean) el.value = clean;
  const guess = bankFromIfsc(clean);
  if(guess && !$('#bkBank').value){ setSelect('bkBank', guess[0]); $('#bkOtherG').classList.add('hidden'); drawBankBadge(); }
  ifscHint();
  if(IFSC_RE.test(clean)) findBranch(clean);
  else { ifscSeq++; if(ifscFound?.ifsc !== clean) ifscFound = null; drawBranch(''); }
}
function saveBank(){
  clearForm('bankSheet');
  const pick = $('#bkBank').value, name = pick === OTHER_BANK ? $('#bkOther').value.trim() : pick;
  const acct = $('#bkAcct').value.replace(/\D/g, ''), ifsc = $('#bkIfsc').value.trim().toUpperCase(), holder = $('#bkHolder').value.trim();
  let bad = setInvalid('bkBankG', !pick);
  if(pick === OTHER_BANK) bad += setInvalid('bkOtherG', !name);
  bad += setInvalid('bkAcctG', !/^\d{9,18}$/.test(acct), 'bkAcctErr', 'Enter 9 – 18 digits.');
  bad += setInvalid('bkIfscG', !IFSC_RE.test(ifsc));
  if(!bad && banks().some(b => b !== editingBank && b.name === name && b.acct === acct)) bad += setInvalid('bkAcctG', true, 'bkAcctErr', 'This account is already saved.');
  if(bad){ showAlert('bkAlert', `Please fix ${bad} highlighted field${bad > 1 ? 's' : ''}.`); scrollToError('bankSheet'); return; }
  const id = editingBank?.id || uid(), after = onBankSaved;
  closeSheet('bankSheet');
  commit(() => {
    const list = st().settings.banks = [...banks()];
    const old = list.find(b => b.id === id), found = ifscFound?.ifsc === ifsc ? ifscFound : null;
    const rec = { id, name, acct, ifsc, holder, branch: found?.branch || (old?.ifsc === ifsc ? old.branch : '') || '', branchCity: found?.city || (old?.ifsc === ifsc ? old.branchCity : '') || '' };
    const i = list.findIndex(b => b.id === id);
    if(i > -1) list[i] = rec; else list.push(rec);
  }, { type:'success', title: editingBank ? 'Bank account updated' : 'Bank account added', body:`${shortName(name)} ${maskAcct(acct)}` });
  after && after(id);
}
function deleteBank(){
  const b = editingBank; if(!b) return;
  const used = st().items.filter(i => i.bankId === b.id).length;
  if(used) return showAlert('bkAlert', `${used} EMI${used > 1 ? 's are' : ' is'} set to debit from this account. Change ${used > 1 ? 'them' : 'it'} first.`);
  closeSheet('bankSheet');
  confirmBox({ title:`Delete ${bankLabel(b)}?`, body:'You can undo right after.', onYes:() =>
    commit(() => { st().settings.banks = banks().filter(x => x.id !== b.id); }, { type:'warning', title:'Bank account deleted', body:bankLabel(b) }) });
}

/* ================================================================
   UPDATES — banner on Home, required updates block the app
================================================================ */
const UPD_KEY = 'finly-update-info';
let updateInfo = null, forcedUpdate = false;
const verParts = v => String(v || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
const isNewer = v => { const a = verParts(v), b = verParts(APP_VERSION); for(let i = 0; i < 3; i++) if((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); return false; };
function loadUpdateInfo(){
  if(!isNative){ updateInfo = null; return; }
  try{ updateInfo = JSON.parse(localStorage.getItem(UPD_KEY) || 'null'); }catch{ updateInfo = null; }
  if(updateInfo && !isNewer(updateInfo.latest)) updateInfo = null;
}
function updateBanner(where){
  const v = esc(updateInfo.latest);
  return `<div class="update-banner" data-where="${where}"><div class="u-ic">${ICON.download}</div><div style="flex:1;min-width:0"><div class="u-t">Update available · v${v}</div><div class="u-s">New features and fixes are ready to install.</div></div>
    <div class="u-actions"><button class="btn btn-secondary btn-sm" data-upd="later">Later</button><button class="btn btn-primary btn-sm" data-upd="now">Update now</button></div></div>`;
}
function renderUpdate(){
  const snoozedUntil = updateInfo ? Number(localStorage.getItem('finly-update-later-' + updateInfo.latest) || 0) : 0;
  forcedUpdate = !!updateInfo?.required;
  $('#homeUpdateSlot').innerHTML = updateInfo && !forcedUpdate && snoozedUntil < Date.now() ? updateBanner('home') : '';
  $('#updateSlot').innerHTML = updateInfo && !forcedUpdate ? updateBanner('profile') : '';
  const fu = $('#forceUpdate');
  fu.classList.toggle('hidden', !forcedUpdate);
  if(forcedUpdate){
    $('#fuText').textContent = `Version ${updateInfo.latest} is a major update and is needed to keep using Finly. You're on ${APP_VERSION}.`;
    $('#fuNote').textContent = navigator.onLine ? 'Your data stays safe — it\'s backed up to your account.' : 'Connect to the internet to download the update.';
  }
}
/* ---------- in-app update: download with progress, then Android's installer ---------- */
let updRunning = false;
function setUpd(p, msg){
  if(p != null){ const pct = Math.round(p * 100); $('#upPct').textContent = pct + '%'; $('#upBar').style.width = pct + '%';
    if(forcedUpdate) $('#fuGo').textContent = pct < 100 ? `Downloading… ${pct}%` : 'Installing…'; }
  if(msg){ $('#upMsg').textContent = msg; if(forcedUpdate) $('#fuNote').textContent = msg; }
}
async function startUpdateDownload(){
  if(!isNative) return openExternal(APK_URL);
  $('#upTitle').textContent = updateInfo?.latest ? `Updating to v${updateInfo.latest}` : 'Updating Finly';
  $('#upSub').textContent = 'Your data stays as it is.';
  ['#upAllow', '#upRetry'].forEach(x => $(x).classList.add('hidden'));
  if(!forcedUpdate) openSheet('updSheet');
  if(updRunning) return;
  setUpd(0, 'Checking permission…');
  if(!(await canInstallUpdates())){
    setUpd(0, 'Android needs your OK to let Finly install its own updates. Tap below, turn on "Allow from this source", then come back.');
    $('#upAllow').classList.remove('hidden');
    if(forcedUpdate){ $('#fuGo').textContent = 'Allow installing updates'; $('#fuGo').dataset.allow = '1'; }
    return;
  }
  updRunning = true;
  setUpd(0, 'Downloading the update…');
  try{
    await downloadAndInstall(APK_URL, p => setUpd(p, p < 1 ? 'Downloading the update…' : null));
    setUpd(1, 'Download complete. Tap Install on the next screen to finish.');
    $('#upRetry').textContent = 'Open installer again'; $('#upRetry').classList.remove('hidden');
  }catch(e){
    console.error(e);
    setUpd(null, navigator.onLine ? 'The download didn\'t finish. Please try again.' : 'You\'re offline. Connect to the internet and try again.');
    $('#upRetry').textContent = 'Try again'; $('#upRetry').classList.remove('hidden');
    if(forcedUpdate) $('#fuGo').textContent = 'Try again';
  }finally{ updRunning = false; }
}
async function allowUpdates(){
  const ok = await allowInstallUpdates();
  if(ok){ $('#upAllow').classList.add('hidden'); delete $('#fuGo').dataset.allow; startUpdateDownload(); }
  else setUpd(null, 'Installing updates is still off. Turn on "Allow from this source" for Finly to continue.');
}
async function checkUpdates(force){
  if(!isNative) return null;   // the web version is always the latest — APK updates don't apply
  if(!navigator.onLine) return null;
  const last = Number(localStorage.getItem('finly-update-check') || 0);
  if(!force && Date.now() - last < 3600e3) return null;
  localStorage.setItem('finly-update-check', String(Date.now()));
  const r = await checkForUpdate();
  updateInfo = r.available ? r : null;
  localStorage.setItem(UPD_KEY, JSON.stringify(updateInfo));
  if(r.available) notifyUpdate(r.latest).catch(() => {});
  renderUpdate();
  return r;
}
function onUpdateClick(e){
  const b = e.target.closest('[data-upd]'); if(!b) return;
  if(b.dataset.upd === 'now') return startUpdateDownload();
  localStorage.setItem('finly-update-later-' + updateInfo.latest, String(Date.now() + 24 * 3600e3));
  const banner = b.closest('.update-banner');
  if(banner?.dataset.where === 'home'){ banner.style.transition = 'opacity .25s, transform .25s'; banner.style.opacity = '0'; banner.style.transform = 'translateY(-8px)'; setTimeout(renderUpdate, 250); }
  toast({ type:'success', title:'We\'ll remind you tomorrow', body:'You can update any time from Profile → About.', ms:3500 });
}

/* ---------- collapsible profile sections: closed by default, only opened ones are remembered ---------- */
const ACC_KEY = 'finly-acc-open';
function initAccordions(){
  let open = [];
  try{ open = JSON.parse(localStorage.getItem(ACC_KEY) || '[]'); localStorage.removeItem('finly-acc'); }catch{ open = []; }
  $$('.acc:not(.static)').forEach(a => {
    const t = $('.acc-toggle', a), set = isOpen => { a.classList.toggle('closed', !isOpen); t.setAttribute('aria-expanded', String(isOpen)); };
    set(open.includes(a.dataset.acc));
    $('.acc-head', a).addEventListener('click', e => {
      if(e.target.closest('.info-i, .section-link')) return;
      const isOpen = a.classList.contains('closed'); set(isOpen);
      open = isOpen ? [...new Set([...open, a.dataset.acc])] : open.filter(k => k !== a.dataset.acc);
      try{ localStorage.setItem(ACC_KEY, JSON.stringify(open)); }catch{ /* private mode */ }
      if(isOpen) requestAnimationFrame(moveAllThumbs);
    });
  });
}

/* ================================================================
   WIRING (once)
================================================================ */
let wired = false;
function wire(){
  if(wired) return; wired = true;
  $$('#billSheet select, #chitSheet select, #exportSheet select, #bankSheet select, #catSheet select').forEach(enhanceSelect);
  setSelectIcons('bCat', o => { const c = cat(o.value); return c?.emoji ? e3d(c.emoji) : ''; });
  setSelectIcons('bSub', o => { const sb = (cat($('#bCat').value)?.subs || []).find(x => x.id === o.value); return sb ? e3d(sb.emoji) : ''; });
  setSelectIcons('bBank', o => { const b = bankById(o.value); return b ? bankBadgeHTML(b.name, 'sm') : ''; });
  setSelectIcons('bkBank', o => o.value && o.value !== OTHER_BANK ? bankBadgeHTML(o.value, 'sm') : o.value === OTHER_BANK && $('#bkOther').value.trim() ? bankBadgeHTML($('#bkOther').value.trim(), 'sm') : '');
  setSelectIcons('catSubIcon', o => e3d(o.value));
  billRem = makeReminderPicker($('#bRem'), () => { billRemTouched = true; billRem.setNote('Custom for this entry'); });
  chitRem = makeReminderPicker($('#cRem'), () => { chitRemTouched = true; chitRem.setNote('Custom for this chit'); });
  catRem = makeReminderPicker($('#catRem'));

  $$('.nav-item').forEach(b => b.addEventListener('click', () => go(b.dataset.page)));
  ['#lgList', '#lgClosedList'].forEach(x => $(x).addEventListener('click', onLedgerClick));
  bindSeg($('#lgFilter'), b => { lgFilter = b.dataset.f; flip($('#lgList'), renderLedger); flushBars(); });
  bindSeg($('#lDir'), b => { lendDir = b.dataset.dir; drawLendCalc(); });
  bindSeg($('#lPer'), b => { lendPer = b.dataset.per; drawLendCalc(); });
  bindSwitch('lIntRow', 'lInt', on => { drawLendCalc(); if(on) setTimeout(() => $('#lRate').focus({ preventScroll:true }), 60); });
  bindSwitch('lTenRow', 'lTen', on => { drawLendCalc(); if(on) setTimeout(() => $('#lTenM').focus({ preventScroll:true }), 60); });
  ['lAmt', 'lDate', 'lRate', 'lTenM'].forEach(id => { $('#' + id).addEventListener('input', drawLendCalc); $('#' + id).addEventListener('change', drawLendCalc); });
  $('#lendSave').addEventListener('click', saveLend);
  $('#lendDelete').addEventListener('click', deleteLend);
  ['lpAmt', 'lpDate'].forEach(id => { $('#' + id).addEventListener('input', drawLendPay); $('#' + id).addEventListener('change', drawLendPay); });
  $('#lpSave').addEventListener('click', saveLendPay);
  $('#openStats').addEventListener('click', () => go('stats'));
  $('#outflowTile').addEventListener('click', openOutflow);
  $('#ofTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if(b && b.dataset.tab !== ofTab){ ofTab = b.dataset.tab; openOutflow(); } });
  $('#openPlan').addEventListener('click', () => openPlan());
  bindSeg($('#plMonth'), b => { const now = parseISO(T), nx = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    openPlan(b.dataset.m === '0' ? monthKey(now.getFullYear(), now.getMonth()) : monthKey(nx.getFullYear(), nx.getMonth())); });
  $('#plShare').addEventListener('click', sharePlan);
  $('#plSave').addEventListener('click', () => planBlob && saveFile(`finly-plan-${planMonth}.png`, planBlob).catch(() => {}));
  $('#openDevices').addEventListener('click', openDevices);
  $('#devList').addEventListener('click', onDevicesClick);
  $('#devOthers').addEventListener('click', signOutOthers);
  $('#lPick').addEventListener('click', chooseContact);
  $('#lPhone').addEventListener('input', drawLendCalc);
  $('#wnGo').addEventListener('click', () => { closeSheet('whatsNewSheet'); go('ledger'); });
  $('#coach').addEventListener('click', onCoachClick);
  addEventListener('resize', () => drawCoach());
  // when the profile sheet closes without a number, walk them back to it
  new MutationObserver(() => { if(!$('#profileSheet').classList.contains('show') && needsWhatsapp() && coachStep) setTimeout(drawCoach, 300); })
    .observe($('#profileSheet'), { attributes:true, attributeFilter:['class'] });
  $('#statsBack').addEventListener('click', () => go('profile'));
  $('#testNotifRow').addEventListener('click', async () => {
    if(!isNative) return toast({ type:'warning', title:'Works in the Android app', body:'Phone notifications need the installed app.' });
    const r = await testNotification(); refreshNotifyStatus();
    if(r === 'sent') toast({ type:'success', title:'Test notification on its way', body:'It should appear in about 5 seconds. If not, check Settings → Apps → Finly → Notifications and Battery.', ms:6000 });
    else toast({ type:'warning', title:'Notifications are blocked', body:'Allow them in Android Settings → Apps → Finly → Notifications.', ms:7000 });
  });
  $('#sortBtn').addEventListener('click', () => { sortMode = sortMode === 'due' ? 'amount' : 'due'; $('#sortLabel').textContent = sortMode === 'due' ? 'Due date' : 'Amount'; flip($('#cardList'), renderHome); flushBars(); });
  $('#chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if(!b || b.dataset.f === filter) return; filter = b.dataset.f; flip($('#cardList'), renderHome); flushBars(); });
  $('#fab').addEventListener('click', () => page === 'wallet' ? openChitSheet(null) : page === 'ledger' ? openLendSheet(null) : openSheet('chooserSheet'));
  $('#chooseBill').addEventListener('click', () => { closeSheet('chooserSheet'); setTimeout(() => openBillSheet(null), 140); });
  $('#chooseChit').addEventListener('click', () => { closeSheet('chooserSheet'); setTimeout(() => openChitSheet(null), 140); });
  $('#cardList').addEventListener('click', e => { const em = e.target.closest('[data-empty]'); if(em) return em.dataset.empty === 'bill' ? openBillSheet(null) : openChitSheet(null); onCardAction(e); });
  ['#chitList', '#closedList', '#byList'].forEach(s => $(s).addEventListener('click', onCardAction));
  $$('[data-export-all]').forEach(b => b.addEventListener('click', () => openExport(null)));
  $('#howBtn').addEventListener('click', () => openSheet('howSheet'));
  $('#bellBtn').addEventListener('click', openAlerts);
  $('#notifList').addEventListener('click', e => {
    if(e.target.id === 'turnOnAlerts'){ closeSheet('notifSheet'); setAlerts(true); return; }
    const b = e.target.closest('[data-goto]'); if(b) openItemFromNotification(b.dataset.goto);
  });
  $('#incomeTile').addEventListener('click', () => openProfileSheet(true));
  $('#incomeBars').addEventListener('click', e => { if(e.target.closest('[data-income]')) openProfileSheet(true); });
  $('#profileCard').addEventListener('click', () => openProfileSheet(false));
  $('#pfSave').addEventListener('click', saveProfile);
  $('#pfDob').addEventListener('input', drawAge);
  $('#pfPin').addEventListener('input', onPinInput);
  $('#pfAvatar').addEventListener('click', openAvatarSheet);
  $('#hdrAvatar').addEventListener('click', () => go('profile'));
  $('#avGrid').addEventListener('click', e => { const b = e.target.closest('[data-av]'); if(b) setAvatar({ type:'emoji', v:b.dataset.av }, 'Profile icon updated'); });
  $('#avLetter').addEventListener('click', () => setAvatar(null, 'Showing your initial'));
  $('#avPhoto').addEventListener('click', () => { const p = $('#avatarPicker'); p.value = ''; p.click(); });
  $('#avatarPicker').addEventListener('change', e => { const f = e.target.files?.[0]; if(f) onAvatarPicked(f); });
  bindSeg($('#byToggle'), b => { byView = b.dataset.v; renderStats(); flushBars(); });
  bindSeg($('#chartToggle'), b => {
    const circle = b.dataset.view === 'circle';
    $('#outflowBar').classList.toggle('hidden', circle); $('#outflowDonut').classList.toggle('hidden', !circle);
    if(!circle){ renderStats(); flushBars(); } else { const d = $('#outflowDonut .donut'); if(d){ d.style.animation = 'none'; void d.offsetWidth; d.style.animation = ''; } }
  });

  bindSwitch('bOngoingRow', 'bOngoing', syncBillForm);
  $('#bCat').addEventListener('change', () => { fillSubSelect(''); subTouched = false; guessSub(); if(!billRemTouched){ billRem.set(cat($('#bCat').value)?.reminders || [1]); billRem.setNote('Category default'); } });
  $('#bEvery').addEventListener('change', syncBillForm);
  $('#bSub').addEventListener('change', () => { subTouched = true; });
  $('#bName').addEventListener('input', guessSub);
  ['bTen', 'bPaidM'].forEach(id => $('#' + id).addEventListener('input', syncBillForm));
  $('#bDue').addEventListener('change', () => { $('#bDuePast').classList.toggle('hidden', !$('#bDue').value || diffDays(T, $('#bDue').value) >= 0); syncBillForm(); });
  $('#billSave').addEventListener('click', saveBill);
  $('#ltChoice').addEventListener('click', e => { const b = e.target.closest('[data-late]'); if(!b) return; lateMode = b.dataset.late === '1' ? 'late' : 'ontime'; clearForm('lateSheet'); drawLate(); });
  $('#ltFee').addEventListener('input', drawLate);
  $('#ltSave').addEventListener('click', saveLate);
  $('#billDelete').addEventListener('click', deleteBill);
  ['#bFiles', '#cFiles'].forEach(s => $(s).addEventListener('click', attClick));
  $('#filePicker').addEventListener('change', e => { const f = e.target.files?.[0]; if(f) attPicked(f); });

  const chitChanged = () => { chitSummary(); drawRounds(); };
  bindSwitch('cAgentFirstRow', 'cAgentFirst', chitChanged);
  bindSwitch('cProgRow', 'cProg', on => { $('#cProgFields').classList.toggle('hidden', !on); chitChanged(); footShadow($('#chitSheet')); });
  bindSwitch('cTakenRow', 'cTaken', on => { $('#cTakenFields').classList.toggle('hidden', !on); chitChanged(); });
  $('#cInst').addEventListener('input', () => { instTouched = $('#cInst').value !== ''; chitChanged(); });
  ['cPot', 'cMem'].forEach(id => $('#' + id).addEventListener('input', () => {
    const p = num($('#cPot').value), m = num($('#cMem').value);
    if(!instTouched && p > 0 && m >= 2) setNum('cInst', round2(p / m));
    chitChanged();
  }));
  ['cInt', 'cStart', 'cDone', 'cTakenR'].forEach(id => { $('#' + id).addEventListener('input', chitChanged); $('#' + id).addEventListener('change', chitChanged); });
  $('#cAgComm').addEventListener('input', chitSummary);
  $('#cRounds').addEventListener('input', onRoundsInput);
  $('#cRounds').addEventListener('change', e => { if(e.target.dataset.f === 'date') chitSummary(); });
  bindSwitch('cEditRoundsRow', 'cEditRounds', toggleEditRounds);
  $('#cEditList').addEventListener('input', e => {
    const row = e.target.closest('.round-row');
    if(row && editingChit) linkPaidComm(row, e.target.dataset.f, editingChit.installment);
    editRoundsTotal();
  });
  $('#cEditList').addEventListener('change', editRoundsTotal);
  $('#chitSave').addEventListener('click', saveChit);
  $('#chitDelete').addEventListener('click', deleteChit);
  $('#rSave').addEventListener('click', saveRound);
  $('#adSave').addEventListener('click', saveAuctionDate);
  $('#adReset').addEventListener('click', resetAuctionDate);

  $('#emojiGrid').innerHTML = EMOJIS.map(e => `<button type="button" class="emoji-btn" data-e="${e}" aria-label="Icon ${e}">${e3d(e)}</button>`).join('');
  $('#emojiGrid').addEventListener('click', e => { const b = e.target.closest('.emoji-btn'); if(!b) return; pickedEmoji = pickedEmoji === b.dataset.e ? '' : b.dataset.e; drawCatPreview(true); });
  $('#catName').addEventListener('input', () => drawCatPreview(false));
  $('#newCatBtn').addEventListener('click', () => openCatSheet(null));
  $('#catGrid').addEventListener('click', e => { const b = e.target.closest('.cat-card'); if(b) openCatSheet(cat(b.dataset.cat)); });
  $('#catSave').addEventListener('click', saveCat);
  $('#catSubIcon').innerHTML = SUB_ICONS.map(e => `<option value="${e}"></option>`).join('');
  $('#catSubIcon')._dd.sync();
  $('#catSubAdd').addEventListener('click', addCatSub);
  $('#catSubName').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); addCatSub(); } });
  $('#catSubs').addEventListener('click', e => { const b = e.target.closest('[data-sub-x]'); if(b) removeCatSub(b.dataset.subX); });
  $('#catDelete').addEventListener('click', deleteCat);

  $('#exportSheet').addEventListener('click', e => {
    const t = e.target.closest('[data-st],[data-ty],[data-ca],[data-row],[data-fmt]'); if(!t) return;
    const toggle = (set, k) => set.has(k) ? set.delete(k) : set.add(k);
    if(t.dataset.st) toggle(ex.status, t.dataset.st);
    else if(t.dataset.ty) toggle(ex.types, t.dataset.ty);
    else if(t.dataset.ca) toggle(ex.cats, t.dataset.ca);
    else if(t.dataset.row) toggle(ex.excluded, t.dataset.row);
    else if(t.dataset.fmt) ex.format = t.dataset.fmt;
    const sc = $('#exScroll'), top = sc.scrollTop; drawExport(); sc.scrollTop = top;
  });
  $('#exAll').addEventListener('click', () => { exVisible().forEach(i => ex.excluded.delete(i.id)); drawExport(); });
  $('#exNone').addEventListener('click', () => { exVisible().forEach(i => ex.excluded.add(i.id)); drawExport(); });
  $('#exPeriod').addEventListener('change', () => { $('#exRange').classList.toggle('hidden', $('#exPeriod').value !== 'custom'); drawExport(); });
  ['exFrom', 'exTo'].forEach(id => $('#' + id).addEventListener('change', drawExport));
  bindSeg($('#exCsvKind'), b => { ex.csvKind = b.dataset.k; drawExport(); });
  $('#exGo').addEventListener('click', runExport);

  $('#themeRow').addEventListener('click', () => withTransition(() => { setSetting({ theme: st().settings.theme === 'dark' ? 'light' : 'dark' }); }));
  $('#palGrid').addEventListener('click', e => { const b = e.target.closest('.swatch'); if(!b || b.dataset.pal === palKey(st().settings.palette)) return; withTransition(() => setSetting({ palette:b.dataset.pal })); syncLauncherIcon(); });
  bindSeg($('#textSizeSeg'), b => setSetting({ text:b.dataset.size }));
  $('#alertsRow').addEventListener('click', async () => {
    if(st().settings.alertsOn && isNative && notifyBlocked){
      const p = await requestNotifyPermission(); await refreshNotifyStatus();
      if(p === 'granted'){ scheduleReminders(reminderPlan); toast({ type:'success', title:'Notifications allowed', body:'Reminders are set for your due dates.' }); }
      else toast({ type:'warning', title:'Still blocked', body:'Open Android Settings → Apps → Finly → Notifications and turn them on.', ms:7000 });
      return;
    }
    await setAlerts(!st().settings.alertsOn); refreshNotifyStatus();
  });
  $('#boldRow').addEventListener('click', () => setSetting({ bold: !st().settings.bold }));
  $('#syncPill').addEventListener('click', () => { if(syncStatus().error === 'auth') return onLogout(true); if(page !== 'home') go('home'); runSync(); });
  $('#syncNowBtn').addEventListener('click', () => { if(!syncStatus().online) return toast({ type:'warning', title:'You\'re offline', body:'Changes are saved on this phone and will upload when you reconnect.' }); runSync(); });
  $('#checkUpdateBtn').addEventListener('click', async () => {
    const btn = $('#checkUpdateBtn'); setBusy(btn, true, 'Checking…');
    try{ const r = await checkUpdates(true); setBusy(btn, false);
      if(!r) toast({ type:'warning', title:'You\'re offline', body:'Connect to the internet to check for updates.' });
      else if(!r.available) toast({ type:'success', title:'You\'re up to date', body:`Version ${APP_VERSION}` });
    }catch{ setBusy(btn, false); toast({ type:'error', title:'Couldn\'t check for updates', body:'Check your internet connection and try again.' }); }
  });
  ['#homeUpdateSlot', '#updateSlot'].forEach(s => $(s).addEventListener('click', onUpdateClick));
  $('#fuGo').addEventListener('click', () => $('#fuGo').dataset.allow ? allowUpdates() : startUpdateDownload());
  $('#upAllow').addEventListener('click', allowUpdates);
  $('#upRetry').addEventListener('click', startUpdateDownload);
  initAccordions();
  $('#newBankBtn').addEventListener('click', () => openBankSheet(null));
  $('#bankList').addEventListener('click', e => { if(e.target.closest('[data-add-bank]')) return openBankSheet(null); const r = e.target.closest('[data-bank]'); if(r) openBankSheet(bankById(r.dataset.bank)); });
  $('#bkBank').addEventListener('change', onBankPicked);
  $('#bkOther').addEventListener('input', drawBankBadge);
  $('#bkIfsc').addEventListener('input', onIfscInput);
  $('#bkAcct').addEventListener('input', e => { const c = e.target.value.replace(/\D/g, '').slice(0, 18); if(c !== e.target.value) e.target.value = c; });
  $('#bkSave').addEventListener('click', saveBank);
  $('#bkDelete').addEventListener('click', deleteBank);
  $('#bBank').addEventListener('change', () => {
    const s_ = $('#bBank');
    if(s_.value !== '__add'){ s_.dataset.prev = s_.value; return; }
    setSelect('bBank', s_.dataset.prev || '');
    openBankSheet(null, id => { fillBankSelect(id); });
  });
  $('#logoutRow').addEventListener('click', () => {
    const n = pendingCount();
    confirmBox({ title:'Log out?', body: n ? `${n} change${n > 1 ? 's haven\'t' : ' hasn\'t'} been backed up yet. Connect to the internet and sync first, or they'll be lost.` : 'Your data stays safe in your account. You can sign back in any time.',
      yes: n ? 'Log out anyway' : 'Log out', onYes:() => onLogout(false) });
  });
  addEventListener('resize', () => { moveAllThumbs(); moveNavInd(); });
  // The + button tucks away while scrolling down, and whenever it would sit on a card's buttons.
  let lastY = scrollY, goingDown = false, fabRaf = 0;
  addEventListener('scroll', () => {
    const y = scrollY, dy = y - lastY; if(Math.abs(dy) < 6) return; lastY = y;
    goingDown = dy > 0 && y > 60 && innerHeight + y < document.documentElement.scrollHeight - 24; queueFabCheck();
  }, { passive:true });
  queueFabCheck = () => { cancelAnimationFrame(fabRaf); fabRaf = requestAnimationFrame(() => fabCheck(goingDown)); };
  new ResizeObserver(() => setTimeout(queueFabCheck, 400)).observe($('#toastStack') || document.body);

  onSyncStatus(renderSync);
  onAfterSync(() => syncFiles({ userId:user.id, items:st().items, deletes:dueFileDeletes(), clearDelete:clearFileDelete,
    isReferenced: p => st().items.some(i => (i.files || []).some(a => a.path === p)),
    markUploaded: (itemId, attId, path) => commit(() => { const a = findItem(itemId)?.files?.find(f => f.id === attId); if(a) a.path = path; }) }));
  onRemoteChanges(() => { applySettings(); afterChange(); });
  setInterval(() => renderSync(), 30000);
}

/* ================================================================
   ENTRY
================================================================ */
export function startApp(u, { logout }){
  user = u; onLogout = logout;
  wire();
  seen.clear(); Object.keys(prevPct).forEach(k => delete prevPct[k]); Object.keys(lastNum).forEach(k => delete lastNum[k]);
  filter = 'all'; page = 'home';
  document.body.classList.remove('auth-mode');
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  applySettings(); go('home'); render(); layoutFab();
  scheduleReminders(reminderPlan);
  prepareUpdateChannel();
  refreshNotifyStatus();
  if(isNative && st().settings.alertsOn) setTimeout(() => maybeAskNotify().then(refreshNotifyStatus).catch(() => {}), 1500);
  scheduleSync(400);
  loadUpdateInfo(); renderUpdate();
  setTimeout(() => checkUpdates(true).catch(() => {}), 2500);
  const day = localStorage.getItem('finly-due-toast');
  const a = computeAlerts().filter(x => x.d <= 1);
  if(a.length && day !== T){
    localStorage.setItem('finly-due-toast', T);
    const nm = it => it.kind === 'lend' ? lendWho(it) : it.name;
    setTimeout(() => toast({ type:'warning', title: a.length === 1 ? (a[0].d < 0 ? `${nm(a[0].it)} is overdue` : `${nm(a[0].it)} is due ${a[0].d === 0 ? 'today' : 'tomorrow'}`) : a.some(x => x.d < 0) ? `${a.filter(x => x.d < 0).length} overdue, ${a.length} need attention` : `${a.length} payments due soon`, body: a.length > 1 ? a.slice(0, 2).map(x => nm(x.it)).join(', ') + (a.length > 2 ? '…' : '') : '', ms:5500 }), 900);
  }
  // Finly 2.0: WhatsApp number, this device, shared entries, monthly plan reminder, icon
  loadShares(); renderLedger();
  if(!st().settings.whatsapp && PHONE_RE.test(u.phone || '')) commit(() => { st().settings.whatsapp = u.phone; });
  pushProfile(false);
  checkDevice(true);
  setTimeout(refreshShares, 1200);
  schedulePlanNotice(st().settings.alertsOn);
  syncLauncherIcon();
  setTimeout(() => { if(needsWhatsapp()) startCoach(); else maybeWhatsNew(); }, 1400);
}
export function onResumeApp(){
  if(!store.uid) return;
  refreshToday(); render(); scheduleReminders(reminderPlan); scheduleSync(300); checkUpdates(false).catch(() => {}); refreshNotifyStatus();
  checkDevice(false); refreshShares(); schedulePlanNotice(st().settings.alertsOn); drawCoach();
}
export { swatchesHTML };
