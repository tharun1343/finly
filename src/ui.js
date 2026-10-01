import { $, $$, esc, ICON, num, isInt, reduceMotion } from './util.js';

/* ---------------- toasts (bottom, above the nav) ---------------- */
const stack = () => $('#toastStack');
let undoHandle = null;
export function layoutFab(){ const f = $('#fab'); if(!f) return; const h = stack().offsetHeight; f.style.translate = h ? `0 -${h + 10}px` : '0 0'; }
export function toast({ type = 'success', title, body = '', undo = null, ms }){
  const st = stack();
  if(undo && undoHandle) undoHandle();
  while(st.children.length >= 3) st.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const ic = type === 'success' ? ICON.check : type === 'warning' ? ICON.warn : ICON.err;
  el.innerHTML = `<div class="t-ic">${ic}</div><div class="t-txt"><div class="t-title">${esc(title)}</div>${body ? `<div class="t-body">${esc(body)}</div>` : ''}</div>`
    + (undo ? '<button class="t-undo">Undo</button>' : '') + `<button class="t-x" aria-label="Dismiss">${ICON.x}</button><div class="t-timer"></div>`;
  const dur = ms || (undo ? 6500 : 4000);
  let gone = false, timer, start = performance.now(), remaining = dur;
  const bar = el.querySelector('.t-timer');
  const dismiss = () => { if(gone) return; gone = true; clearTimeout(timer); el.classList.remove('show'); el.classList.add('out');
    if(undo && undoHandle === dismiss) undoHandle = null; setTimeout(() => { el.remove(); layoutFab(); }, 240); };
  const run = () => { start = performance.now(); timer = setTimeout(dismiss, remaining);
    bar.animate([{ transform:`scaleX(${remaining / dur})` }, { transform:'scaleX(0)' }], { duration: remaining, fill:'forwards' }); };
  el.querySelector('.t-x').addEventListener('click', dismiss);
  if(undo){ el.querySelector('.t-undo').addEventListener('click', () => { dismiss(); undo(); toast({ type:'success', title:'Change undone', ms:2200 }); }); undoHandle = dismiss; }
  el.addEventListener('pointerenter', () => { clearTimeout(timer); remaining -= performance.now() - start; bar.getAnimations().forEach(a => a.pause()); });
  el.addEventListener('pointerleave', () => { if(!gone){ bar.getAnimations().forEach(a => a.cancel()); run(); } });
  st.appendChild(el); layoutFab();
  if(document.hidden) el.classList.add('show'); else requestAnimationFrame(() => el.classList.add('show'));
  run();
}
export function initToasts(){ new ResizeObserver(layoutFab).observe(stack()); }

/* ---------------- sheets ---------------- */
export const openStack = [];
export function footShadow(o){ const sc = $('.sheet-scroll', o), ft = $('.sheet-foot', o); if(sc && ft) ft.classList.toggle('raised', sc.scrollHeight - sc.scrollTop - sc.clientHeight > 4); }
export function openSheet(id){
  const o = $('#' + id); o.classList.add('show'); openStack.push(id); document.body.classList.add('sheet-open');
  const sc = $('.sheet-scroll', o); if(sc) sc.scrollTop = 0;
  requestAnimationFrame(() => footShadow(o));
}
export function closeSheet(id){
  closeDropdown();
  id = id || openStack[openStack.length - 1]; if(!id) return;
  const o = $('#' + id); o.classList.remove('show'); $('.sheet', o).style.transform = '';
  const i = openStack.lastIndexOf(id); if(i > -1) openStack.splice(i, 1);
  if(!openStack.length) document.body.classList.remove('sheet-open');
  document.activeElement?.blur?.();
}
export function closeAllSheets(){ [...openStack].forEach(closeSheet); }
export function initSheets(){
  $$('.sheet-overlay').forEach(o => {
    o.addEventListener('click', e => { if(e.target === o) closeSheet(o.id); });
    const sc = $('.sheet-scroll', o);
    if(sc){ sc.addEventListener('scroll', () => { footShadow(o); closeDropdown(); }, { passive:true }); new ResizeObserver(() => footShadow(o)).observe(sc); sc.addEventListener('input', () => footShadow(o)); }
    const top = $('.sheet-top', o), sheet = $('.sheet', o);
    let y0 = 0, t0 = 0, dy = 0, dragging = false;
    top.addEventListener('pointerdown', e => { if(e.target.closest('button')) return; dragging = true; y0 = e.clientY; t0 = performance.now(); dy = 0; sheet.style.transition = 'none'; top.setPointerCapture(e.pointerId); });
    top.addEventListener('pointermove', e => { if(!dragging) return; dy = Math.max(0, e.clientY - y0); sheet.style.transform = `translate(-50%, ${dy}px)`; });
    const end = () => { if(!dragging) return; dragging = false; sheet.style.transition = ''; const v = dy / Math.max(1, performance.now() - t0);
      if(dy > 110 || (dy > 30 && v > .6)) closeSheet(o.id); else sheet.style.transform = ''; };
    top.addEventListener('pointerup', end); top.addEventListener('pointercancel', end);
  });
  $$('.sheet-x').forEach(b => b.innerHTML = ICON.x);
  $$('[data-close]').forEach(b => b.addEventListener('click', () => closeSheet(b.closest('.sheet-overlay').id)));
  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    if(ddOpen){ const s = ddOpen.sel; closeDropdown(); s._dd.btn.focus(); return; }
    if(openStack.length) closeSheet();
  });
  $('#cfYes').addEventListener('click', () => { const cb = confirmCb; confirmCb = null; closeSheet('confirmSheet'); cb && cb(); });
}
/** For the Android back button: returns true if something was closed. */
export function handleBackInOverlays(){
  if(ddOpen){ closeDropdown(); return true; }
  if(openStack.length){ closeSheet(); return true; }
  return false;
}

let confirmCb = null;
export function confirmBox({ title, body, yes = 'Delete', danger = true, onYes }){
  $('#cfTitle').textContent = title; $('#cfBody').textContent = body;
  const y = $('#cfYes'); y.textContent = yes; y.className = 'btn btn-grow ' + (danger ? 'btn-danger' : 'btn-primary');
  confirmCb = onYes; openSheet('confirmSheet');
}

/* ---------------- forms ---------------- */
export function setInvalid(groupId, bad, msgElId, msg){ const g = $('#' + groupId); g.classList.remove('invalid'); if(bad){ void g.offsetWidth; g.classList.add('invalid'); } if(msgElId && msg) $('#' + msgElId).textContent = msg; return bad ? 1 : 0; }
export function showAlert(id, msg, warn){ const a = $('#' + id); a.classList.toggle('show', !!msg); a.classList.toggle('warn', !!warn); if(msg) a.querySelector('span').textContent = msg; }
export function clearForm(rootId){ $$('#' + rootId + ' .fgroup.invalid').forEach(g => g.classList.remove('invalid')); $$('#' + rootId + ' .form-alert').forEach(a => a.classList.remove('show')); }
export function scrollToError(rootId){ const g = $('#' + rootId + ' .fgroup.invalid'); if(g){ g.scrollIntoView({ behavior:'smooth', block:'center' }); const i = g.querySelector('input'); i && i.focus({ preventScroll:true }); } }
export function setBusy(btn, busy, label){ if(busy){ btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${esc(label || 'Please wait…')}`; } else { btn.disabled = false; if(btn.dataset.label) btn.innerHTML = btn.dataset.label; } }

export function bindSwitch(rowId, swId, onChange){
  const sw = $('#' + swId);
  $('#' + rowId).addEventListener('click', () => { if(sw.dataset.locked) return; setSwitch(swId, !sw.classList.contains('on')); onChange && onChange(sw.classList.contains('on')); });
}
export function setSwitch(swId, on){ const sw = $('#' + swId); sw.classList.toggle('on', !!on); sw.setAttribute('aria-checked', String(!!on)); }
export const isOn = swId => $('#' + swId).classList.contains('on');

export function moveThumb(seg){
  if(!seg) return;
  const btns = $$('.seg-btn', seg), i = btns.findIndex(b => b.classList.contains('sel')), th = $('.seg-thumb', seg);
  if(i < 0 || !btns[i].offsetWidth) return;
  th.style.width = btns[i].offsetWidth + 'px'; th.style.transform = `translateX(${btns[i].offsetLeft - 3}px)`;
}
export function bindSeg(seg, onPick){
  seg.addEventListener('click', e => { const b = e.target.closest('.seg-btn'); if(!b || b.classList.contains('sel')) return;
    $$('.seg-btn', seg).forEach(x => x.classList.toggle('sel', x === b)); moveThumb(seg); onPick(b); });
}
export const moveAllThumbs = () => $$('.segmented').forEach(moveThumb);

/* ---------------- numeric inputs: no spinners, ₹ Indian commas ---------------- */
export function fmtNumInput(raw, money){
  let clean = String(raw).replace(money ? /[^\d.]/g : /\D/g, '');
  if(money){ const p = clean.split('.'); clean = p[0].slice(0, 12) + (p.length > 1 ? '.' + p.slice(1).join('').slice(0, 2) : ''); }
  else clean = clean.slice(0, 6);
  if(!clean) return '';
  if(!money) return clean.replace(/^0+(?=\d)/, '');
  let [i, d] = clean.split('.'); i = i.replace(/^0+(?=\d)/, '');
  return (i === '' ? '0' : Number(i).toLocaleString('en-IN')) + (d !== undefined ? '.' + d : '');
}
export function bindNumeric(input){
  if(input._num) return; input._num = true;
  const money = input.hasAttribute('data-money');
  input.addEventListener('input', () => {
    const raw = input.value, caret = input.selectionStart ?? raw.length;
    const before = raw.slice(0, caret).replace(money ? /[^\d.]/g : /\D/g, '').length;
    const out = fmtNumInput(raw, money);
    if(out === raw) return;
    input.value = out;
    let pos = 0, seen = 0; while(pos < out.length && seen < before){ if(/[\d.]/.test(out[pos])) seen++; pos++; }
    try{ input.setSelectionRange(pos, pos); }catch{ /* not focused */ }
  }, true);
  input.addEventListener('focus', () => setTimeout(() => { if(input.value === '0') input.select(); }, 0));
}
export function setNum(id, v){ const el = $('#' + id); el.value = v === '' || v == null || Number.isNaN(v) ? '' : fmtNumInput(String(v), el.hasAttribute('data-money')); }
export const initNumeric = () => $$('[data-money],[data-int]').forEach(bindNumeric);

/* ---------------- custom dropdown ---------------- */
let ddOpen = null;
export function enhanceSelect(sel){
  sel.classList.add('dd-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'dd-trigger'; btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `<span class="dd-value"></span>${ICON.chevron}`;
  const lbl = sel.id && $(`label[for="${sel.id}"]`); if(lbl){ btn.id = sel.id + '_dd'; lbl.htmlFor = btn.id; }
  sel.after(btn);
  const sync = () => { const o = sel.options[sel.selectedIndex]; btn.querySelector('.dd-value').textContent = o ? o.textContent : ''; btn.disabled = sel.disabled; };
  sel._dd = { btn, sync }; sync();
  btn.addEventListener('click', () => ddOpen && ddOpen.sel === sel ? closeDropdown() : openDropdown(sel));
  btn.addEventListener('keydown', e => { if(['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){ e.preventDefault(); openDropdown(sel); } });
  sel.addEventListener('change', sync);
}
export function setSelect(id, v){ const s = $('#' + id); s.value = v; s._dd && s._dd.sync(); }
function openDropdown(sel){
  closeDropdown();
  const btn = sel._dd.btn, r = btn.getBoundingClientRect();
  const menu = document.createElement('div'); menu.className = 'dd-menu'; menu.setAttribute('role', 'listbox');
  menu.innerHTML = Array.from(sel.options).map((o, i) => `<button type="button" role="option" class="dd-opt ${i === sel.selectedIndex ? 'sel' : ''}" data-i="${i}" aria-selected="${i === sel.selectedIndex}" style="--i:${i}"><span class="dd-l">${esc(o.textContent)}${o.dataset.hint ? `<small>${esc(o.dataset.hint)}</small>` : ''}</span><svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M20 6 9 17l-5-5"/></svg></button>`).join('');
  document.body.appendChild(menu);
  const w = Math.max(r.width, 200), h = Math.min(menu.scrollHeight, 300), below = innerHeight - r.bottom, up = below < h + 16 && r.top > below;
  menu.style.width = w + 'px';
  menu.style.left = Math.min(Math.max(8, r.left), innerWidth - w - 8) + 'px';
  menu.style.top = (up ? r.top - h - 6 : r.bottom + 6) + 'px';
  if(up) menu.classList.add('up');
  btn.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => menu.classList.add('show'));
  const opts = $$('.dd-opt', menu);
  (opts[sel.selectedIndex] || opts[0])?.focus({ preventScroll:true });
  menu.addEventListener('click', e => { const b = e.target.closest('.dd-opt'); if(!b) return;
    sel.selectedIndex = Number(b.dataset.i); sel.dispatchEvent(new Event('change', { bubbles:true })); closeDropdown(); btn.focus(); });
  menu.addEventListener('keydown', e => {
    const i = opts.indexOf(document.activeElement);
    if(e.key === 'ArrowDown'){ e.preventDefault(); opts[Math.min(opts.length - 1, i + 1)].focus(); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); opts[Math.max(0, i - 1)].focus(); }
    else if(e.key === 'Tab') closeDropdown();
  });
  const outside = e => { if(!menu.contains(e.target) && !btn.contains(e.target)) closeDropdown(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  ddOpen = { sel, menu, btn, outside };
}
export function closeDropdown(){
  if(!ddOpen) return;
  const { menu, btn, outside } = ddOpen; ddOpen = null;
  document.removeEventListener('pointerdown', outside, true);
  btn.classList.remove('open'); btn.setAttribute('aria-expanded', 'false');
  menu.classList.remove('show'); setTimeout(() => menu.remove(), 220);
}
addEventListener('scroll', closeDropdown, { passive:true });
addEventListener('resize', closeDropdown);

/* ---------------- reminder picker (0–30 days before; never after) ---------------- */
const offLabel = o => o === 0 ? 'On due date' : o === 1 ? '1 day before' : o === 7 ? '1 week before' : o + ' days before';
export const remSummary = arr => !arr.length ? 'No reminders' : [...arr].sort((a, b) => b - a).map(o => o === 0 ? 'on the day' : o + 'd before').join(', ');
export function makeReminderPicker(root, onChange){
  let values = [], customOpen = false;
  function draw(){
    const opts = [...new Set([0, 1, 3, 7, ...values])].sort((a, b) => a - b);
    root.innerHTML = `<div class="rem-chips">${opts.map(o => `<button type="button" class="rem-chip ${values.includes(o) ? 'sel' : ''}" data-o="${o}">${offLabel(o)}</button>`).join('')}
      <button type="button" class="rem-chip add" data-add>+ Custom</button></div>
      ${customOpen ? `<div class="rem-custom"><div class="fgroup" style="margin:0"><input type="text" inputmode="numeric" data-int placeholder="5" class="rc-in" autocomplete="off"></div><span>days before</span><button type="button" class="btn btn-secondary rc-add">Add</button></div><div class="ferr rc-err" style="display:none"></div>` : ''}
      <div class="rem-meta"><span class="rm-note">${values.length ? '' : 'No reminders — you won\'t be notified for this.'}</span></div>`;
    $$('.rem-chip[data-o]', root).forEach(b => b.addEventListener('click', () => {
      const o = Number(b.dataset.o); values = values.includes(o) ? values.filter(v => v !== o) : [...values, o]; draw(); onChange && onChange(values); }));
    $('[data-add]', root).addEventListener('click', () => { customOpen = !customOpen; draw(); if(customOpen) $('.rc-in', root).focus(); });
    if(customOpen){
      bindNumeric($('.rc-in', root));
      const add = () => {
        const v = num($('.rc-in', root).value), err = $('.rc-err', root);
        if(!isInt(v) || v < 1 || v > 30){ err.textContent = 'Enter a whole number from 1 to 30. Reminders can only be before the due date.'; err.style.display = 'block'; return; }
        if(!values.includes(v)) values = [...values, v];
        customOpen = false; draw(); onChange && onChange(values);
      };
      $('.rc-add', root).addEventListener('click', add);
      $('.rc-in', root).addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); add(); } });
    }
  }
  return { set(v){ values = [...v]; customOpen = false; draw(); }, get: () => [...values].sort((a, b) => b - a), setNote(t){ const n = $('.rm-note', root); if(n && values.length) n.textContent = t; } };
}

/* ---------------- motion helpers ---------------- */
export function withTransition(fn){ if(document.startViewTransition && !reduceMotion() && !document.hidden) document.startViewTransition(fn); else fn(); }
export function flip(container, mutate){
  if(reduceMotion() || document.hidden){ mutate(); return; }
  const first = new Map($$(':scope > [data-id]', container).map(el => [el.dataset.id, el.getBoundingClientRect()]));
  mutate();
  $$(':scope > [data-id]', container).forEach((el, i) => {
    el.classList.remove('enter');
    const f = first.get(el.dataset.id);
    if(!f){ el.animate([{ opacity:0, transform:'translateY(12px) scale(.97)' }, { opacity:1, transform:'none' }], { duration:380, delay:i * 30, easing:'cubic-bezier(.2,.9,.2,1)', fill:'backwards' }); return; }
    const l = el.getBoundingClientRect(), dx = f.left - l.left, dy = f.top - l.top;
    if(dx || dy) el.animate([{ transform:`translate(${dx}px,${dy}px)` }, { transform:'none' }], { duration:460, easing:'cubic-bezier(.2,.9,.2,1)' });
  });
}
