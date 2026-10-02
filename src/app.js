import { $, $$, esc, ICON, T, refreshToday, parseISO, toISO, addDays, addMonths, dayNum, diffDays, fmtDate, fmtShort, fmtMonth, fmtMoney, round2, uid, clone, num, isInt, reduceMotion, ago } from './util.js';
import { PALETTES, TOKEN_MAP, paletteVars, swatchStyle } from './palettes.js';
import { store, commitState, replaceState, onSyncStatus, syncStatus, scheduleSync, runSync, onRemoteChanges, pendingCount, queueFileDelete, clearFileDelete, dueFileDeletes, onAfterSync } from './data.js';
import { MAX_FILES, prepareFile, putLocal, thumbUrl, openAttachment, openBlob, syncFiles, FileError } from './files.js';
import { toast, layoutFab, openSheet, closeSheet, confirmBox, setInvalid, showAlert, clearForm, scrollToError, setBusy, bindSwitch, setSwitch, isOn,
  moveThumb, bindSeg, moveAllThumbs, setNum, bindNumeric, enhanceSelect, setSelect, makeReminderPicker, remSummary, withTransition, flip, handleBackInOverlays, footShadow, fmtNumInput } from './ui.js';
import { isNative, APP_VERSION, APK_URL, setBarsStyle, scheduleReminders, notifyPermission, requestNotifyPermission, saveFile, checkForUpdate, openExternal } from './native.js';
import { paymentRows, summaryRow, buildCsv, buildPdf } from './export.js';

const st = () => store.state;
let user = { id:'', email:'', name:'' };
let onLogout = () => {};

/* ================================================================
   DERIVED DATA
================================================================ */
const cat = id => st().cats.find(c => c.id === id);
const findItem = id => st().items.find(i => i.id === id);
const activeItems = () => st().items.filter(i => i.status === 'active');
const closedItems = () => st().items.filter(i => i.status === 'closed').sort((a, b) => dayNum(b.closedOn) - dayNum(a.closedOn));
const roundDate = (c, r) => addMonths(c.start, (r - 1) * c.interval, parseISO(c.start).getDate());
const effReminders = it => it.reminders ?? (cat(it.catId)?.reminders ?? [1]);
const ev = it => it.every || 1;
const PER = { 1:'month', 3:'quarter', 6:'6 months', 12:'year' };
const perLabel = n => PER[n] || `${n} months`;
const announced = it => it.kind === 'chit' && it.nextDate && it.nextDateRound === it.roundsDone + 1;
const nextDue = it => it.kind === 'chit' ? (announced(it) ? it.nextDate : roundDate(it, it.roundsDone + 1)) : it.due;
const fileCount = it => (it.files || []).length;
const clipHTML = it => fileCount(it) ? `<button class="clip-badge" data-act="files" aria-label="${fileCount(it)} documents"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>${fileCount(it)}</button>` : '';
const alertWindow = it => Math.max(7, ...effReminders(it));
const paidRecently = it => it.kind === 'bill' && !!it.lastPaid && diffDays(T, it.due) > alertWindow(it);
const itemPaid = it => it.kind === 'chit' ? it.paidIn : it.paid;
const itemRemaining = it => it.status !== 'active' ? 0 : it.kind === 'chit' ? (it.taken ? it.installment * (it.members - it.roundsDone) : 0) : (it.ongoing ? 0 : it.amount * it.tenureLeft);
const catColor = c => { const cs = (PALETTES[st().settings.palette] || PALETTES.sapphire).cats; return cs[((c?.ci ?? 0) % cs.length + cs.length) % cs.length]; };
const displayName = () => st().settings.name || user.name || (user.email || '').split('@')[0] || 'there';

function histDesc(h, mf, rich){
  const b = s => rich ? `<b>${s}</b>` : s;
  return h.type === 'agent' ? 'Agent\'s round — no auction'
    : h.type === 'commission' ? `Got commission ${b(mf(h.share))}${h.bid != null ? ` (bid ${mf(h.bid)})` : ''}`
    : h.type === 'taken' ? `${b('Took the pot')} — bid ${mf(h.bid)}, received ${mf(h.received)}`
    : h.type === 'last' ? b('Final round — pot came to you') : h.type === 'opening' ? `Opening balance for rounds 1–${h.round}` : 'Paid in full';
}
const exportHelpers = { cat, itemPaid, itemRemaining, nextDue, histDesc };

function computeAlerts(){
  if(!st().settings.alertsOn) return [];
  const out = [];
  for(const it of activeItems()){
    const due = nextDue(it), d = diffDays(T, due), offs = effReminders(it);
    if(d < 0 || !offs.length || paidRecently(it)) continue;
    if(d <= Math.max(...offs)) out.push({ it, due, d });
  }
  return out.sort((a, b) => a.d - b.d);
}
function reminderPlan(){
  return { enabled: st().settings.alertsOn, entries: activeItems().map(it => ({ id:it.id, name:it.name, due:nextDue(it), offsets:effReminders(it),
    amount: it.kind === 'chit' ? it.installment : it.amount, chit: it.kind === 'chit', round: it.kind === 'chit' ? it.roundsDone + 1 : null })) };
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

function glyphHTML(c){ return c && c.emoji ? esc(c.emoji) : `<span class="glyph-letter">${esc((c?.name || '?').charAt(0).toUpperCase())}</span>`; }
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
  if(d < 0) return { cls:'due', label:'Overdue', urgent:true, text:`Was due ${fmtDate(it.due)}` };
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
    <div class="ic-top"><div class="ic-id"><div class="glyph">${glyphHTML(c)}</div><div style="min-width:0"><div class="ic-name">${esc(it.name)}</div>
      <div class="ic-meta"><span class="badge ${st_.cls}">${st_.label}</span><span class="due-text ${st_.urgent ? 'urgent' : ''}">${st_.text}</span>${clipHTML(it)}</div></div></div>
      <div class="ic-amt"><div class="amt">${fmtMoney(it.amount)}</div><div class="per">/ ${perLabel(ev(it))}</div></div></div>
    ${middle}
    <div class="ic-foot"><div class="figs">${figs}</div><div class="actions">
      <button class="round-btn ghost" data-act="edit" aria-label="Edit ${esc(it.name)}">${ICON.edit}</button>
      <button class="round-btn ${recent ? 'paid' : 'pay'}" data-act="pay" aria-label="${recent ? 'Paid this cycle' : 'Mark as paid'}">${ICON.check}</button></div></div>
  </article>`;
}
function chitCompact(it, i){
  const c = cat('chit'), r = it.roundsDone + 1, due = nextDue(it), d = diffDays(T, due);
  const pct = Math.round(it.roundsDone / it.members * 100), taken = !!it.taken, urgent = d <= 1;
  const dueTxt = d < 0 ? `Round ${r} was ${fmtDate(due)}` : d === 0 ? `Round ${r} · today` : d === 1 ? `Round ${r} · tomorrow` : `Round ${r} · ${fmtDate(due)}`;
  return `<article class="item-card ${enterCls(it.id)}" data-id="${it.id}" style="--accent:${taken ? 'var(--rose)' : catColor(c)};--i:${i}">
    <div class="ic-top"><div class="ic-id"><div class="glyph" style="--accent:${catColor(c)}">${glyphHTML(c)}</div><div style="min-width:0"><div class="ic-name">${esc(it.name)}</div>
      <div class="ic-meta"><span class="badge ${taken ? 'debt' : 'save'}">${taken ? 'Taken · Debt' : 'Not taken · Savings'}</span><span class="due-text ${urgent ? 'urgent' : ''}">${dueTxt}</span>${clipHTML(it)}</div></div></div>
      <div class="ic-amt"><div class="amt">${fmtMoney(it.installment)}</div><div class="per">/ round</div></div></div>
    <div class="progress-row"><div class="progress-labels"><span>Rounds <b>${it.roundsDone} of ${it.members} done</b></span><span>${pct}%</span></div>${barHTML(it.id, pct)}</div>
    <div class="ic-foot"><div class="figs">
      <div class="fig"><span class="fig-label">Paid in</span><span class="fig-value">${fmtMoney(it.paidIn)}</span></div>
      ${taken ? `<div class="fig"><span class="fig-label">Still owe</span><span class="fig-value neg">${fmtMoney(it.installment * (it.members - it.roundsDone))}</span></div>`
              : `<div class="fig"><span class="fig-label">Commission</span><span class="fig-value pos">+${fmtMoney(it.commission)}</span></div>`}</div>
      <div class="actions"><button class="round-btn ghost" data-act="edit" aria-label="Edit ${esc(it.name)}">${ICON.edit}</button>
      <button class="round-btn pay" data-act="pay" aria-label="Record round ${r}">${ICON.check}</button></div></div>
  </article>`;
}

function renderHeader(){
  const h = new Date().getHours();
  $('#greeting').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  $('#hdrName').textContent = displayName();
  $('#pfName').textContent = displayName();
  $('#pfEmail').textContent = user.email;
  $('#pfAvatar').textContent = displayName().charAt(0).toUpperCase();
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
    st().cats.filter(c => counts[c.id]).map(c => `<button class="chip ${filter === c.id ? 'active' : ''}" data-f="${c.id}">${c.emoji ? esc(c.emoji) + ' ' : ''}${esc(c.name)} <span class="n">${counts[c.id]}</span></button>`).join('') : '';
  const list = act.filter(i => filter === 'all' || i.catId === filter);
  list.sort(sortMode === 'due' ? (a, b) => dayNum(nextDue(a)) - dayNum(nextDue(b)) : (a, b) => (b.kind === 'chit' ? b.installment : b.amount) - (a.kind === 'chit' ? a.installment : a.amount));
  $('#activeCount').textContent = list.length ? `(${list.length})` : '';
  $('#sortBtn').classList.toggle('hidden', list.length < 2);
  $('#cardList').innerHTML = list.length ? list.map((it, i) => it.kind === 'chit' ? chitCompact(it, i) : billCard(it, i)).join('')
    : `<div class="empty"><div class="em">🗂️</div><b>Nothing tracked yet</b>Add your EMIs, bills and chit funds to see what's due and when you'll be debt-free.
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
    return `<div class="by-row" style="--accent:${catColor(c)};--i:${i}"><div class="glyph">${glyphHTML(c)}</div><div style="min-width:0"><div class="by-name">${esc(it.name)}</div><div class="by-sub">${sub}</div>${it.ongoing ? '' : barHTML('by_' + it.id, pct, catColor(c))}</div>
      <button class="mini-btn" data-export="${it.id}" aria-label="Export ${esc(it.name)}">${ICON.download}</button></div>`; }).join('')
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
      <div class="metric"><div class="fig-label">${net >= 0 ? 'Projected gain' : 'Projected cost'}</div><div class="fig-value ${net >= 0 ? 'pos' : 'neg'}">${fmtMoney(Math.abs(net))}</div><div class="fig-sub">Received − total you'll pay</div></div>`;
    note = `You took the pot in round ${it.taken.round}. You now pay the <b>full ${fmtMoney(it.installment)}</b> every round until it ends — counted as <b>debt</b>.`;
  } else {
    metrics = `<div class="metric"><div class="fig-label">Paid in</div><div class="fig-value">${fmtMoney(it.paidIn)}</div><div class="fig-sub">${it.roundsDone} round${it.roundsDone === 1 ? '' : 's'}</div></div>
      <div class="metric"><div class="fig-label">Commission so far</div><div class="fig-value pos">+${fmtMoney(it.commission)}</div><div class="fig-sub">Your share of winning bids</div></div>
      <div class="metric"><div class="fig-label">Next auction${announced(it) ? ' · announced' : ''}</div><div class="fig-value">${fmtDate(due)}</div><div class="fig-sub">Round ${r} of ${it.members}</div>${dateBtn}</div>
      <div class="metric"><div class="fig-label">Still waiting</div><div class="fig-value">${it.members - it.roundsDone}</div><div class="fig-sub">people incl. you</div></div>`;
    note = `You haven't taken the pot yet. Each round you get a share of the winning bid, so you pay less — counted as <b>savings</b> until you take it.`;
  }
  const hist = it.history.length ? [...it.history].reverse().map(h => `<div class="h-row"><span class="h-round">R${h.round}</span><span class="h-desc">${histDesc(h, fmtMoney, true)}<br><span style="color:var(--text-faint)">${fmtDate(h.date)}</span></span><span class="h-amt">${fmtMoney(h.paid)}</span></div>`).join('')
    : '<div class="h-desc" style="padding:6px 0">No rounds recorded yet.</div>';
  return `<article class="chit-card ${enterCls('w_' + it.id)}" data-id="${it.id}" data-state="${taken ? 'taken' : 'saving'}" style="--i:${i}">
    <div class="chit-head"><div style="min-width:0"><div class="chit-name">${c?.emoji ? esc(c.emoji) + ' ' : ''}${esc(it.name)} ${clipHTML(it)}</div><div class="chit-meta">${meta}</div></div>
      <span class="status-pill ${taken ? 'debt' : 'save'}">${taken ? 'Debt' : 'Savings'}</span></div>
    <div class="progress-row"><div class="progress-labels"><span>Rounds <b>${it.roundsDone} of ${it.members}</b></span><span>${Math.round(it.roundsDone / it.members * 100)}%</span></div>${barHTML('w_' + it.id, Math.round(it.roundsDone / it.members * 100))}</div>
    <div class="metric-grid">${metrics}</div>
    <div class="chit-note">${note}</div>
    <div class="chit-actions">
      <button class="btn btn-primary btn-grow" data-act="pay">${ICON.check}Record round ${r}</button>
      <button class="round-btn ghost" data-act="edit" aria-label="Edit">${ICON.edit}</button>
      <button class="round-btn ghost" data-act="hist" aria-label="Show history">${ICON.history}</button>
      <button class="round-btn ghost" data-export="${it.id}" aria-label="Export ${esc(it.name)}">${ICON.download}</button></div>
    <div class="history"><div><div class="history-inner">${hist}</div></div></div>
  </article>`;
}

function renderWallet(){
  const t = totals();
  countTo($('#whSave'), 'wsave', t.savings); countTo($('#whDebt'), 'wdebt', t.chitDebt);
  $('#whSaveFoot').textContent = `${t.savingCount} not taken · +${fmtMoney(t.savingComm)} commission`;
  $('#whDebtFoot').textContent = `${t.takenCount} taken · full amount each round`;
  const chits = activeItems().filter(i => i.kind === 'chit');
  const open = new Set($$('#chitList .history.open').map(h => h.closest('[data-id]').dataset.id));
  $('#chitList').innerHTML = chits.length ? chits.map(chitDetail).join('') : '<div class="empty"><div class="em">🤝</div><b>No active chit funds</b>Tap + to add one.</div>';
  open.forEach(id => $(`#chitList [data-id="${id}"] .history`)?.classList.add('open'));
  const cl = closedItems();
  $('#closedCount').textContent = cl.length ? `(${cl.length})` : '';
  $('#closedList').innerHTML = cl.length ? cl.map(it => { const c = cat(it.catId);
    const sub = it.kind === 'chit' ? `${it.members} rounds${it.taken ? ' · received ' + fmtMoney(it.taken.received) : ''}` : `${it.tenureTotal} months`;
    return `<div class="closed-row" style="--accent:${catColor(c)}"><div class="glyph">${glyphHTML(c)}</div><div style="min-width:0"><div class="cr-name">${esc(it.name)}</div><div class="cr-sub">Closed ${fmtDate(it.closedOn)} · ${sub}</div></div><div class="cr-amt"><span>Paid</span>${fmtMoney(itemPaid(it))}</div>
      <button class="mini-btn" data-export="${it.id}" aria-label="Export ${esc(it.name)}">${ICON.download}</button></div>`; }).join('')
    : '<div class="empty" style="padding:22px">Completed EMIs and chits move here automatically.</div>';
}

function swatchesHTML(selected){
  const theme = st().settings.theme;
  return Object.entries(PALETTES).map(([k, p], i) => `<button class="swatch ${selected === k ? 'sel' : ''}" data-pal="${k}" style="${swatchStyle(k, theme)};--i:${i}" aria-label="${esc(p.name)} colours" aria-pressed="${selected === k}"><span class="sw-check">${ICON.check}</span></button>`).join('');
}
function renderProfile(){
  $('#catGrid').innerHTML = st().cats.map((c, i) => {
    const n = st().items.filter(it => it.catId === c.id && it.status === 'active').length;
    return `<button class="cat-card" data-cat="${c.id}" style="--accent:${catColor(c)};--i:${i}"><span class="cat-edit">${ICON.edit}</span><span class="glyph">${glyphHTML(c)}</span>
      <span class="cat-name">${esc(c.name)}</span><span class="cat-count">${n ? n + ' active' : c.optional ? 'Optional' : 'No items yet'}</span>
      <span class="cat-rem">${ICON.bell}${esc(remSummary(c.reminders))}</span></button>`; }).join('');
  $('#palGrid').innerHTML = swatchesHTML(st().settings.palette);
  $('#versionSub').textContent = `Version ${APP_VERSION}`;
}

let alertSig = '', seenSig = '';
function renderBell(){
  const a = computeAlerts(); alertSig = a.map(x => x.it.id + x.due).join('|');
  const bc = $('#bellCount'); bc.textContent = a.length; bc.classList.toggle('gone', !a.length || alertSig === seenSig);
}

function renderSync(s = syncStatus()){
  const pill = $('#syncPill'), txt = $('#syncText');
  let cls = '', label, long;
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

function render(){ renderHeader(); renderHome(); renderStats(); renderWallet(); renderProfile(); renderBell(); renderSync(); flushBars(); }

export function applySettings(){
  const s = st().settings, root = document.documentElement, v = paletteVars(s.palette, s.theme);
  root.dataset.theme = s.theme; root.dataset.text = s.text;
  Object.entries(TOKEN_MAP).forEach(([k, css]) => root.style.setProperty(css, v[k]));
  $('meta[name="theme-color"]')?.setAttribute('content', v.bg);
  setBarsStyle(s.theme);
  setSwitch('themeSwitch', s.theme === 'dark');
  setSwitch('alertsSwitch', s.alertsOn);
  $$('#textSizeSeg .seg-btn').forEach(b => b.classList.toggle('sel', b.dataset.size === s.text));
  requestAnimationFrame(() => { moveAllThumbs(); moveNavInd(); });
}

/* ================================================================
   NAVIGATION
================================================================ */
const ORDER = ['home', 'stats', 'wallet', 'profile'];
function moveNavInd(){ const b = $(`.nav-item[data-page="${page}"]`), ind = $('#navInd'); if(!b || !b.offsetWidth) return; ind.style.left = b.offsetLeft + 'px'; ind.style.width = b.offsetWidth + 'px'; }
function go(p){
  const dir = Math.sign(ORDER.indexOf(p) - ORDER.indexOf(page));
  page = p;
  $$('.screen').forEach(s => { s.style.setProperty('--dir', dir); s.classList.toggle('active', s.id === 'screen-' + p); });
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === p));
  moveNavInd();
  $('#fab').classList.toggle('fab-hidden', !(p === 'home' || p === 'wallet'));
  window.scrollTo({ top:0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  requestAnimationFrame(moveAllThumbs);
}
export function handleBack(){
  if(handleBackInOverlays()) return true;
  if(page !== 'home'){ go('home'); return true; }
  return false;
}
export function openItemFromNotification(id){
  const it = id && findItem(id);
  closeSheet(); filter = 'all';
  if(!it) return go('home');
  if(it.kind === 'chit'){ go('wallet'); setTimeout(() => highlight(`#chitList [data-id="${id}"]`), 380); }
  else { go('home'); renderHome(); flushBars(); setTimeout(() => highlight(`#cardList [data-id="${id}"]`), 380); }
}
function highlight(sel){ const el = $(sel); if(!el) return; el.scrollIntoView({ behavior:'smooth', block:'center' }); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }

function animateOut(id){
  return new Promise(res => { const els = $$(`[data-id="${id}"]`); if(!els.length) return res();
    els.forEach(el => el.classList.add('leaving')); seen.delete(id); seen.delete('w_' + id); setTimeout(res, 300); });
}
function flashCard(id){ $$(`[data-id="${id}"]`).forEach(el => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }); }

function onCardAction(e){
  const ex = e.target.closest('[data-export]'); if(ex) return openExport(ex.dataset.export);
  const btn = e.target.closest('[data-act]'); if(!btn) return;
  const card = btn.closest('[data-id]'); const it = findItem(card.dataset.id); if(!it) return;
  const act = btn.dataset.act;
  if(act === 'edit') return it.kind === 'chit' ? openChitSheet(it) : openBillSheet(it);
  if(act === 'hist'){ card.querySelector('.history').classList.toggle('open'); return; }
  if(act === 'files') return openFilesSheet(it);
  if(act === 'date') return openAuctionDate(it);
  if(act === 'pay'){ if(btn.dataset.busy) return; btn.dataset.busy = '1'; setTimeout(() => delete btn.dataset.busy, 700); return it.kind === 'chit' ? openRoundSheet(it) : payBill(it); }
}

/* ================================================================
   EMI / BILL
================================================================ */
function payBill(it){
  if(paidRecently(it)) return confirmBox({ title:'Already paid this cycle', body:`You paid ${it.name} on ${fmtDate(it.lastPaid)}. Pay the ${fmtDate(it.due)} installment early?`, yes:'Pay early', danger:false, onYes:() => doPay(it.id) });
  doPay(it.id);
}
async function doPay(id){
  const it = findItem(id), closing = !it.ongoing && it.tenureLeft === 1, name = it.name, amt = it.amount;
  if(closing) await animateOut(id);
  const newDue = addMonths(it.due, ev(it), it.anchorDay);
  commit(() => {
    const x = findItem(id);
    x.paid += x.amount; x.lastPaid = T; x.history.push({ date:T, amount:x.amount, n: x.ongoing ? null : x.tenureTotal - x.tenureLeft + 1 });
    if(!x.ongoing) x.tenureLeft -= 1;
    if(!x.ongoing && x.tenureLeft === 0){ x.status = 'closed'; x.closedOn = T; }
    else x.due = newDue;
  }, closing ? { type:'success', title:`${name} fully paid 🎉`, body:'Moved to Closed in Chits.' }
             : { type:'success', title:'Marked as paid', body:`${name} · ${fmtMoney(amt)} · next due ${fmtDate(newDue)}` });
  if(!closing) flashCard(id);
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

let editingBill = null, billRemTouched = false, billRem;
const billCats = () => st().cats.filter(c => c.kind === 'bill');
function syncBillForm(){
  const ongoing = isOn('bOngoing'), every = num($('#bEvery').value) || 1;
  $('#bTenureRow').classList.toggle('hidden', ongoing);
  $('#bTenLabel').textContent = every === 1 ? 'Total months *' : 'Total payments *';
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
  $('#bCat').innerHTML = billCats().map(c => `<option value="${c.id}">${c.emoji ? c.emoji + '  ' : ''}${esc(c.name)}</option>`).join('');
  $('#billTitle').textContent = it ? 'Edit ' + it.name : 'Add EMI or bill';
  $('#bName').value = it ? it.name : '';
  setSelect('bCat', it && cat(it.catId) ? it.catId : (billCats()[0]?.id || ''));
  setSelect('bEvery', String(it ? ev(it) : 1));
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
  const ten = num($('#bTen').value), paidM = num($('#bPaidM').value || 0), due = $('#bDue').value;
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
      Object.assign(x, { name, catId, amount:amt, every, ongoing, due, anchorDay:parseISO(due).getDate(), reminders:rem, files });
      if(ongoing){ x.tenureTotal = null; x.tenureLeft = null; } else { x.tenureTotal = ten; x.tenureLeft = ten - paidMonths; }
    }, { type:'success', title:'Changes saved', body:name });
    afterSave();
    flashCard(id);
  } else {
    const id = uid();
    commit(() => {
      const b = { id, kind:'bill', catId, name, amount:amt, every, ongoing, tenureTotal: ongoing ? null : ten, tenureLeft: ongoing ? null : ten - paidM,
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
  const fake = { start:s, interval:iv }, end = roundDate(fake, m), coll = (inst || 0) * m;
  let html = `<b>${m} rounds</b> · every ${iv === 1 ? 'month' : iv + ' months'}<br>${fmtDate(s)} → <b>${fmtDate(end)}</b>`;
  if(inst > 0) html += `<br>${fmtMoney(inst)} × ${m} people = <b>${fmtMoney(coll)}</b> ` + (Math.abs(coll - p) < 1 ? '✓ matches the chit value' : `<span class="warn">— doesn't match ${fmtMoney(p)}</span>`);
  if(isOn('cAgentFirst')) html += '<br>Round 1 goes to the agent (no auction).';
  if(isOn('cProg') && !editingChit){ const d = num($('#cDone').value); if(isInt(d) && d >= 0 && d < m) html += `<br>Next: <b>round ${d + 1}</b> around ${fmtDate(roundDate(fake, d + 1))} — you can change it once it's announced.`; }
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
    const tag = kind === 'agent' ? '<span class="tag agent">Agent\'s round</span>' : kind === 'taken' ? '<span class="tag taken">You took the pot</span>' : kind === 'full' ? '<span class="tag full">Full amount</span>' : '';
    html += `<div class="round-row" data-r="${r}"><div class="round-row-head"><span>Round ${r}</span>${tag}</div><div class="rr-grid">
      <div class="fgroup rr-date" id="rr${r}dG"><label>Date</label><input type="date" data-f="date" value="${date}" max="${T}"></div>
      <div class="fgroup" id="rr${r}pG"><label>You paid</label><div class="money-wrap"><input type="text" inputmode="decimal" data-money data-f="paid" value="${paid}" autocomplete="off"></div></div>
      ${kind === 'auction'
        ? `<div class="fgroup" id="rr${r}cG"><label>Commission</label><div class="money-wrap"><input type="text" inputmode="decimal" data-money data-f="comm" value="${comm}" placeholder="0" autocomplete="off"></div></div>`
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
  const { count } = roundsMeta();
  let paid = 0, comm = 0;
  for(let i = 0; i < count; i++){ paid += num(roundRows[i]?.paid) || 0; comm += num(roundRows[i]?.comm) || 0; }
  $('#cRoundsTotal').innerHTML = count ? `${count} round${count === 1 ? '' : 's'} · you paid <b>${fmtMoney(paid)}</b> · commission <b>${fmtMoney(comm)}</b>` : '';
}
function onRoundsInput(e){
  const f = e.target.dataset.f, row = e.target.closest('.round-row'); if(!row) return;
  const o = roundRows[+row.dataset.r - 1] ||= {};
  if(f === 'paid') o.paidTouched = true;
  if(f === 'comm' && !o.paidTouched){
    const I = num($('#cInst').value);
    if(I > 0) row.querySelector('[data-f="paid"]').value = fmtNumInput(String(round2(Math.max(0, I - (num(e.target.value) || 0)))), true);
  }
  roundsTotal();
}

function openChitSheet(it){
  editingChit = it; clearForm('chitSheet');
  const locked = !!(it && it.history.length);
  $('#chitTitle').textContent = it ? 'Edit ' + it.name : 'Add chit fund';
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
  roundRows = [];
  setNum('cDone', 0); setSwitch('cTaken', false); $('#cTakenFields').classList.add('hidden'); setNum('cTakenR', ''); setNum('cTakenB', 0);
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
    if(isOn('cTaken')){
      const tr = num($('#cTakenR').value), tb = num($('#cTakenB').value || 0), minR = agentFirst ? 2 : 1;
      bad += setInvalid('cTakenRG', !(isInt(tr) && tr >= minR && isInt(done) && tr <= done), 'cTakenRErr', done >= minR ? `Pick round ${minR} – ${done}.` : `Complete at least round ${minR} first.`);
      bad += setInvalid('cTakenBG', !(tb >= 0 && (!(pot > 0) || tb < pot)));
      taken = { round:tr, bid:tb, received: round2(pot - tb) };
    }
    readRounds();
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
  if(bad){ showAlert('chitAlert', `Please fix ${bad} highlighted field${bad > 1 ? 's' : ''}.`); scrollToError('chitSheet'); return; }
  const rem = chitRemTouched ? chitRem.get() : null;
  const { files, afterSave } = await attCommit();
  closeSheet('chitSheet');
  if(editingChit){
    const id = editingChit.id;
    commit(() => { const x = findItem(id); Object.assign(x, { name, agent, agentCut:agCut, reminders:rem, files });
      if(!x.history.length) Object.assign(x, { pot, members:m, installment:inst, interval:iv, start:s, agentFirst }); },
      { type:'success', title:'Chit updated', body:name });
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

/* ---------- announced auction date ---------- */
let dateChit = null;
function openAuctionDate(it){
  dateChit = it; clearForm('auctionDateSheet');
  const r = it.roundsDone + 1;
  $('#adSub').textContent = `Round ${r} of ${it.members} · ${it.name}`;
  $('#adDate').value = nextDue(it);
  $('#adHint').textContent = `By the regular schedule this round falls on ${fmtDate(roundDate(it, r))}. Reminders will follow the date you set.`;
  $('#adReset').classList.toggle('hidden', !announced(it));
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
      <button type="button" class="choice ${roundMode === 'commission' ? 'sel' : ''}" data-mode="commission"><span class="ch-ic">🪙</span><span class="ch-t">Got commission</span><span class="ch-s">Someone else won the auction</span></button>
      <button type="button" class="choice taken ${roundMode === 'taken' ? 'sel' : ''}" data-mode="taken"><span class="ch-ic">🤝</span><span class="ch-t">I took the pot</span><span class="ch-s">I won the auction this round</span></button>
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
  const c = roundCalc(); if(!c.ok || !roundMode) return;
  const closing = r === it.members, id = it.id, name = it.name;
  closeSheet('roundSheet');
  if(closing) await animateOut(id);
  let entry;
  if(roundMode === 'commission') entry = { round:r, date, type:'commission', bid:c.bid, share:c.share, paid:c.paid };
  else if(roundMode === 'taken') entry = { round:r, date, type:'taken', bid:c.bid, received:c.received, paid:c.paid, share:0 };
  else if(roundMode === 'last') entry = { round:r, date, type:'last', bid:0, received:it.pot, paid:it.installment, share:0 };
  else entry = { round:r, date, type: roundMode === 'agent' ? 'agent' : 'full', paid:it.installment, share:0 };
  const t = closing ? { type:'success', title:`${name} completed 🎉`, body:'All rounds done — moved to Closed.' }
    : roundMode === 'commission' ? { type:'success', title:`Round ${r} recorded · +${fmtMoney(c.share)}`, body:`You paid ${fmtMoney(c.paid)}. Commission so far: ${fmtMoney(it.commission + c.share)}.` }
    : roundMode === 'taken' ? { type:'warning', title:`${name} moved to debt`, body:`Received ${fmtMoney(c.received)}. ${fmtMoney(it.installment)} per round for ${c.d} more round${c.d === 1 ? '' : 's'}.` }
    : { type:'success', title:`Round ${r} paid`, body:`${name} · ${fmtMoney(it.installment)}` };
  commit(() => {
    const x = findItem(id);
    x.history.push(entry); x.roundsDone = r; x.paidIn = round2(x.paidIn + entry.paid); x.commission = round2(x.commission + (entry.share || 0));
    if(entry.type === 'taken' || entry.type === 'last') x.taken = { round:r, bid:entry.bid, received:entry.received };
    if(x.roundsDone >= x.members){ x.status = 'closed'; x.closedOn = date; }
  }, t);
  if(!closing) flashCard(id);
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
  g.innerHTML = pickedEmoji ? esc(pickedEmoji) : `<span class="glyph-letter">${esc((name || '?').charAt(0).toUpperCase())}</span>`;
  if(bump){ g.classList.remove('bump'); void g.offsetWidth; g.classList.add('bump'); }
  $('#catPrevName').textContent = name || 'Category name';
  $('#catPrevSub').textContent = pickedEmoji ? 'Custom icon' : 'No icon picked — the first letter is used';
}
function openCatSheet(c){
  editingCat = c; clearForm('catSheet');
  $('#catTitle').textContent = c ? 'Edit ' + c.name : 'New category';
  $('#catName').value = c ? c.name : ''; pickedEmoji = c ? c.emoji || '' : '';
  catRem.set(c ? c.reminders : [1]);
  $('#catDelete').classList.toggle('hidden', !c);
  drawCatPreview(false); openSheet('catSheet');
}
function saveCat(){
  clearForm('catSheet');
  const name = $('#catName').value.trim(), dup = st().cats.find(c => c.name.toLowerCase() === name.toLowerCase() && c !== editingCat);
  if(setInvalid('catNameG', !name || dup, 'catNameErr', !name ? 'Name is required.' : `You already have a category called "${dup.name}".`)){ $('#catName').focus(); return; }
  const rem = catRem.get(), emoji = pickedEmoji;
  closeSheet('catSheet');
  if(editingCat){
    const id = editingCat.id;
    commit(() => Object.assign(cat(id), { name, emoji, reminders:rem }), { type:'success', title:'Category updated', body:`${name} · reminders ${remSummary(rem)}` });
  } else {
    commit(() => st().cats.push({ id:uid(), name, emoji, kind:'bill', ci:nextCi(), reminders:rem }),
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
function openProfileSheet(focusIncome){
  clearForm('profileSheet');
  $('#pfSheetEmail').textContent = user.email;
  $('#pfNameIn').value = displayName();
  setNum('pfIncomeIn', st().settings.income ?? '');
  openSheet('profileSheet');
  if(focusIncome) setTimeout(() => $('#pfIncomeIn').focus(), 420);
}
function saveProfile(){
  clearForm('profileSheet');
  const name = $('#pfNameIn').value.trim(), incRaw = $('#pfIncomeIn').value.trim(), inc = incRaw ? num(incRaw) : null;
  let bad = setInvalid('pfNameG', !name);
  bad += setInvalid('pfIncomeG', inc != null && !(inc >= 0 && inc <= 1e8));
  if(bad) return;
  closeSheet('profileSheet');
  commit(() => Object.assign(st().settings, { name, income: inc }), { type:'success', title:'Profile saved' });
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
    return `<button type="button" class="ex-row ${on ? 'on' : ''}" data-row="${it.id}" role="checkbox" aria-checked="${on}" style="--accent:${catColor(c)}"><span class="cbox">${ICON.check}</span><span class="glyph">${glyphHTML(c)}</span>
      <span style="min-width:0"><span class="ex-name">${esc(it.name)}</span><span class="ex-sub">${it.status === 'active' ? 'Active' : 'Closed ' + fmtDate(it.closedOn)} · ${esc(c ? c.name : '')} · ${fmtMoney(itemPaid(it))} paid</span></span></button>`; }).join('')
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
  go_.innerHTML = `${ICON.download}Export ${ex.format === 'pdf' ? 'PDF' : 'CSV'}${sel.length === 1 ? '' : ` · ${sel.length} items`}`;
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
  $('#notifSub').textContent = !st().settings.alertsOn ? 'Reminders are turned off' : a.length ? `${a.length} due soon — tap one to open it` : 'Nothing due soon';
  $('#notifList').innerHTML = !st().settings.alertsOn
    ? `<div class="empty"><div class="em">🔕</div><b>Reminders are off</b>Turn them on to get notified before due dates.<div class="empty-actions"><button class="btn btn-primary btn-sm" id="turnOnAlerts">Turn on reminders</button></div></div>`
    : a.length ? a.map(({ it, due, d }, i) => { const c = cat(it.catId);
        const when = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`;
        const what = it.kind === 'chit' ? `Round ${it.roundsDone + 1} · ${fmtMoney(it.installment)}` : fmtMoney(it.amount);
        return `<button class="notif-item" data-goto="${it.id}" style="--i:${i}"><span class="notif-ic glyph" style="--accent:${catColor(c)}">${glyphHTML(c)}</span>
          <span style="min-width:0"><span class="notif-t">${esc(it.name)}</span><span class="notif-s">${what} · ${fmtDate(due)}</span></span>
          <span class="notif-when badge ${d <= 1 ? 'due' : 'soon'}">${when}</span></button>`; }).join('')
    : `<div class="empty"><div class="em">✅</div><b>You're all caught up</b>Nothing is inside its reminder window right now.</div>`;
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
  toast({ type: on ? 'success' : 'warning', title: on ? 'Reminders on' : 'Reminders off', body: on ? (isNative ? 'You\'ll get a notification at 9 AM before each due date.' : 'Due items will show in the bell. Phone notifications work in the Android app.') : 'You won\'t be reminded until you turn this back on.' });
}
let askedNotify = false;
async function maybeAskNotify(){
  if(askedNotify || !isNative || !st().settings.alertsOn) return;
  askedNotify = true;
  if((await notifyPermission()) !== 'granted') await requestNotifyPermission();
  scheduleReminders(reminderPlan);
}

/* ================================================================
   UPDATES
================================================================ */
function showUpdateBanner(latest){
  $('#updateSlot').innerHTML = `<div class="update-banner"><div class="u-ic">${ICON.download}</div><div><div class="u-t">Update available</div><div class="u-s">Version ${esc(latest)} is ready to install</div></div><button class="btn btn-primary btn-sm" id="getUpdate">Get it</button></div>`;
  $('#getUpdate').addEventListener('click', () => openExternal(APK_URL));
}
async function autoUpdateCheck(){
  try{
    const lastCheck = Number(localStorage.getItem('finly-update-check') || 0);
    if(Date.now() - lastCheck < 12 * 3600e3 || !navigator.onLine) return;
    localStorage.setItem('finly-update-check', String(Date.now()));
    const r = await checkForUpdate();
    if(r.available){
      showUpdateBanner(r.latest);
      if(localStorage.getItem('finly-update-told') !== r.latest){ localStorage.setItem('finly-update-told', r.latest); toast({ type:'success', title:`Update ${r.latest} available`, body:'Open Profile to install it.', ms:6000 }); }
    }
  }catch{ /* offline or rate-limited: try again later */ }
}

/* ================================================================
   WIRING (once)
================================================================ */
let wired = false;
function wire(){
  if(wired) return; wired = true;
  $$('#billSheet select, #chitSheet select, #exportSheet select').forEach(enhanceSelect);
  billRem = makeReminderPicker($('#bRem'), () => { billRemTouched = true; billRem.setNote('Custom for this entry'); });
  chitRem = makeReminderPicker($('#cRem'), () => { chitRemTouched = true; chitRem.setNote('Custom for this chit'); });
  catRem = makeReminderPicker($('#catRem'));

  $$('.nav-item').forEach(b => b.addEventListener('click', () => go(b.dataset.page)));
  $('#sortBtn').addEventListener('click', () => { sortMode = sortMode === 'due' ? 'amount' : 'due'; $('#sortLabel').textContent = sortMode === 'due' ? 'Due date' : 'Amount'; flip($('#cardList'), renderHome); flushBars(); });
  $('#chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if(!b || b.dataset.f === filter) return; filter = b.dataset.f; flip($('#cardList'), renderHome); flushBars(); });
  $('#fab').addEventListener('click', () => page === 'wallet' ? openChitSheet(null) : openSheet('chooserSheet'));
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
  bindSeg($('#byToggle'), b => { byView = b.dataset.v; renderStats(); flushBars(); });
  bindSeg($('#chartToggle'), b => {
    const circle = b.dataset.view === 'circle';
    $('#outflowBar').classList.toggle('hidden', circle); $('#outflowDonut').classList.toggle('hidden', !circle);
    if(!circle){ renderStats(); flushBars(); } else { const d = $('#outflowDonut .donut'); if(d){ d.style.animation = 'none'; void d.offsetWidth; d.style.animation = ''; } }
  });

  bindSwitch('bOngoingRow', 'bOngoing', syncBillForm);
  $('#bCat').addEventListener('change', () => { if(!billRemTouched){ billRem.set(cat($('#bCat').value)?.reminders || [1]); billRem.setNote('Category default'); } });
  $('#bEvery').addEventListener('change', syncBillForm);
  ['bTen', 'bPaidM'].forEach(id => $('#' + id).addEventListener('input', syncBillForm));
  $('#bDue').addEventListener('change', () => { $('#bDuePast').classList.toggle('hidden', !$('#bDue').value || diffDays(T, $('#bDue').value) >= 0); syncBillForm(); });
  $('#billSave').addEventListener('click', saveBill);
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
  ['cTakenB', 'cAgComm'].forEach(id => $('#' + id).addEventListener('input', chitSummary));
  $('#cRounds').addEventListener('input', onRoundsInput);
  $('#chitSave').addEventListener('click', saveChit);
  $('#chitDelete').addEventListener('click', deleteChit);
  $('#rSave').addEventListener('click', saveRound);
  $('#adSave').addEventListener('click', saveAuctionDate);
  $('#adReset').addEventListener('click', resetAuctionDate);

  $('#emojiGrid').innerHTML = EMOJIS.map(e => `<button type="button" class="emoji-btn" data-e="${e}" aria-label="Icon ${e}">${e}</button>`).join('');
  $('#emojiGrid').addEventListener('click', e => { const b = e.target.closest('.emoji-btn'); if(!b) return; pickedEmoji = pickedEmoji === b.dataset.e ? '' : b.dataset.e; drawCatPreview(true); });
  $('#catName').addEventListener('input', () => drawCatPreview(false));
  $('#newCatBtn').addEventListener('click', () => openCatSheet(null));
  $('#catGrid').addEventListener('click', e => { const b = e.target.closest('.cat-card'); if(b) openCatSheet(cat(b.dataset.cat)); });
  $('#catSave').addEventListener('click', saveCat);
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
  $('#palGrid').addEventListener('click', e => { const b = e.target.closest('.swatch'); if(!b || b.dataset.pal === st().settings.palette) return; withTransition(() => setSetting({ palette:b.dataset.pal })); });
  bindSeg($('#textSizeSeg'), b => setSetting({ text:b.dataset.size }));
  $('#alertsRow').addEventListener('click', () => setAlerts(!st().settings.alertsOn));
  $('#syncPill').addEventListener('click', () => { if(syncStatus().error === 'auth') return onLogout(true); if(page !== 'home') go('home'); runSync(); });
  $('#syncNowBtn').addEventListener('click', () => { if(!syncStatus().online) return toast({ type:'warning', title:'You\'re offline', body:'Changes are saved on this phone and will upload when you reconnect.' }); runSync(); });
  $('#checkUpdateBtn').addEventListener('click', async () => {
    const btn = $('#checkUpdateBtn'); setBusy(btn, true, 'Checking…');
    try{ const r = await checkForUpdate(); setBusy(btn, false);
      if(r.available){ showUpdateBanner(r.latest); toast({ type:'success', title:`Version ${r.latest} is available`, body:'Tap "Get it" to download.' }); }
      else toast({ type:'success', title:'You\'re up to date', body:`Version ${APP_VERSION}` });
    }catch{ setBusy(btn, false); toast({ type:'error', title:'Couldn\'t check for updates', body:'Check your internet connection and try again.' }); }
  });
  $('#logoutRow').addEventListener('click', () => {
    const n = pendingCount();
    confirmBox({ title:'Log out?', body: n ? `${n} change${n > 1 ? 's haven\'t' : ' hasn\'t'} been backed up yet. Connect to the internet and sync first, or they'll be lost.` : 'Your data stays safe in your account. You can sign back in any time.',
      yes: n ? 'Log out anyway' : 'Log out', onYes:() => onLogout(false) });
  });
  addEventListener('resize', () => { moveAllThumbs(); moveNavInd(); });

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
  scheduleSync(400);
  setTimeout(autoUpdateCheck, 3000);
  const day = localStorage.getItem('finly-due-toast');
  const a = computeAlerts().filter(x => x.d <= 1);
  if(a.length && day !== T){
    localStorage.setItem('finly-due-toast', T);
    setTimeout(() => toast({ type:'warning', title: a.length === 1 ? `${a[0].it.name} is due ${a[0].d === 0 ? 'today' : 'tomorrow'}` : `${a.length} payments due soon`, body: a.length > 1 ? a.slice(0, 2).map(x => x.it.name).join(', ') + (a.length > 2 ? '…' : '') : '', ms:5500 }), 900);
  }
}
export function onResumeApp(){
  if(!store.uid) return;
  refreshToday(); render(); scheduleReminders(reminderPlan); scheduleSync(300); autoUpdateCheck();
}
export { swatchesHTML };
