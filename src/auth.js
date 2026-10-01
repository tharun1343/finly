import { $, $$, esc, EMAIL_RE, mmss, num } from './util.js';
import { sendCode, verifyCode } from './data.js';
import { toast, setInvalid, showAlert, clearForm, setBusy, bindSwitch, isOn, setSwitch, setNum } from './ui.js';
import { isNative } from './native.js';

const OTP_TTL = 10 * 60 * 1000, RESEND_WAIT = 60 * 1000, MAX_TRIES = 3, LOCK_MS = 60 * 1000;
const otp = { email:'', name:'', from:'signin', sentAt:0, expiresAt:0, tries:0, lockedUntil:0, verifying:false, timer:null };
let handlers = { onVerified(){} };

export function showAuth(screen){
  document.body.classList.add('auth-mode');
  $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden');
  $$('.auth-screen').forEach(s => s.classList.toggle('active', s.id === 'scr-' + screen));
  if(screen !== 'otp') clearInterval(otp.timer);
  window.scrollTo(0, 0);
}
export function currentAuthScreen(){ return $('.auth-screen.active')?.id?.replace('scr-', '') || ''; }
/** Android back button inside the auth flow. */
export function authBack(){
  const s = currentAuthScreen();
  if(s === 'signup' || s === 'signin'){ showAuth('welcome'); return true; }
  if(s === 'otp'){ showAuth(otp.from); return true; }
  return false;
}

const boxes = () => $$('.otp-box');
function otpStatus(kind, msg){ const s = $('#otpStatus'); s.className = 'otp-status ' + kind; s.textContent = msg; }
function maskEmail(e){ const [u, d] = e.split('@'); return (u.length <= 2 ? u[0] + '•' : u[0] + '•••' + u.slice(-1)) + '@' + d; }

async function requestCode(from, email, name, btn){
  const alertId = from === 'signup' ? 'signupAlert' : 'signinAlert';
  showAlert(alertId, '');
  setBusy(btn, true, 'Sending code…');
  try{
    await sendCode(email, name);
    Object.assign(otp, { email, name, from, sentAt:Date.now(), expiresAt:Date.now() + OTP_TTL, tries:0, lockedUntil:0 });
    openOtp();
  }catch(e){
    showAlert(alertId, e.message);
  }finally{ setBusy(btn, false); }
}

function openOtp(){
  $('#otpSub').innerHTML = `We've sent a 6-digit code to <b>${esc(maskEmail(otp.email))}</b>. It's valid for 10 minutes.`;
  boxes().forEach(b => { b.value = ''; b.disabled = false; b.classList.remove('filled'); });
  $('#otpRow').classList.remove('ok');
  otpStatus('info', 'The code is checked as soon as you enter the 6th digit.');
  showAuth('otp');
  clearInterval(otp.timer); otp.timer = setInterval(tick, 500); tick();
  setTimeout(() => boxes()[0].focus(), 350);
}

function tick(){
  const now = Date.now(), rb = $('#resendBtn');
  const expired = now >= otp.expiresAt, locked = now < otp.lockedUntil;
  $('#otpExpiry').textContent = expired ? 'Code expired' : `Code expires in ${mmss(otp.expiresAt - now)}`;
  if(otp.lockedUntil && !locked && otp.tries >= MAX_TRIES){ otp.lockedUntil = 0; otpStatus('info', 'You can request a new code now.'); }
  if(expired && !otp.expiredShown){ otp.expiredShown = true; boxes().forEach(b => b.disabled = true); otpStatus('err', 'This code has expired. Request a new one.'); }
  if(locked){ rb.disabled = true; rb.textContent = `New code in ${mmss(otp.lockedUntil - now)}`; return; }
  if(otp.tries >= MAX_TRIES || expired){ rb.disabled = false; rb.textContent = 'Send new code'; return; }
  const wait = otp.sentAt + RESEND_WAIT - now; rb.disabled = wait > 0; rb.textContent = wait > 0 ? `Resend in ${mmss(wait)}` : 'Resend code';
}

async function resend(){
  const rb = $('#resendBtn'); rb.disabled = true; rb.textContent = 'Sending…';
  try{
    await sendCode(otp.email, otp.name);
    Object.assign(otp, { sentAt:Date.now(), expiresAt:Date.now() + OTP_TTL, tries:0, lockedUntil:0, expiredShown:false });
    openOtp();
    toast({ type:'success', title:'New code sent', body:`Check ${maskEmail(otp.email)}` });
  }catch(e){ otpStatus('err', e.message); tick(); }
}

function fillFrom(i, digits){
  const bs = boxes();
  for(let k = 0; k < digits.length && i + k < 6; k++) bs[i + k].value = digits[k];
  bs[Math.min(i + digits.length, 5)].focus(); checkOtp();
}
function checkOtp(){
  const bs = boxes();
  bs.forEach(b => b.classList.toggle('filled', !!b.value));
  const code = bs.map(b => b.value).join('');
  if(code.length === 6 && !otp.verifying) verify(code);   // auto-submit on the 6th digit
}
async function verify(code){
  if(Date.now() >= otp.expiresAt || Date.now() < otp.lockedUntil || otp.tries >= MAX_TRIES) return;
  otp.verifying = true; boxes().forEach(b => b.disabled = true); otpStatus('info', 'Checking code…');
  try{
    const u = await verifyCode(otp.email, code);
    $('#otpRow').classList.add('ok'); otpStatus('ok', 'Verified — signing you in…'); clearInterval(otp.timer);
    if(!u.name && otp.name) u.name = otp.name;
    setTimeout(() => handlers.onVerified(u), 550);
  }catch(e){
    const row = $('#otpRow'); row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
    boxes().forEach(b => { b.value = ''; b.classList.remove('filled'); });
    if(e.kind === 'offline' || e.kind === 'rate'){
      boxes().forEach(b => b.disabled = false); boxes()[0].focus(); otpStatus('err', e.message);
    } else {
      otp.tries++;
      if(otp.tries >= MAX_TRIES){
        otp.lockedUntil = Date.now() + LOCK_MS; boxes().forEach(b => b.disabled = true);
        otpStatus('err', 'Too many incorrect attempts. Wait 1 minute, then request a new code.');
      } else {
        boxes().forEach(b => b.disabled = false); boxes()[0].focus();
        otpStatus('err', `Incorrect or expired code. ${MAX_TRIES - otp.tries} attempt${MAX_TRIES - otp.tries === 1 ? '' : 's'} left.`);
      }
    }
    tick();
  }finally{ otp.verifying = false; }
}

/* ---------- onboarding ---------- */
let obDone = null;
export function showOnboarding({ name, swatches, palette, onPalette, onDone }){
  obDone = onDone;
  clearForm('scr-onboard');
  $('#obName').value = name || '';
  setNum('obIncome', '');
  $('#obSwatches').innerHTML = swatches(palette);
  $('#obSwatches').onclick = e => { const b = e.target.closest('.swatch'); if(!b) return; onPalette(b.dataset.pal); $('#obSwatches').innerHTML = swatches(b.dataset.pal); };
  $('#obNotifyRow').classList.toggle('hidden', !isNative);
  setSwitch('obNotify', true);
  showAuth('onboard');
}

export function initAuth(h){
  handlers = h;
  $$('[data-auth]').forEach(b => b.addEventListener('click', () => {
    const to = b.dataset.auth; clearForm('scr-' + to);
    if(to === 'signin' && !$('#siEmail').value) $('#siEmail').value = $('#suEmail').value;
    if(to === 'signup' && !$('#suEmail').value) $('#suEmail').value = $('#siEmail').value;
    showAuth(to);
  }));
  $('#signupForm').addEventListener('submit', e => {
    e.preventDefault(); clearForm('scr-signup');
    const name = $('#suName').value.trim(), email = $('#suEmail').value.trim().toLowerCase();
    const bad = setInvalid('suNameG', !name) + setInvalid('suEmailG', !EMAIL_RE.test(email));
    if(!bad) requestCode('signup', email, name, $('#suBtn'));
  });
  $('#signinForm').addEventListener('submit', e => {
    e.preventDefault(); clearForm('scr-signin');
    const email = $('#siEmail').value.trim().toLowerCase();
    if(!setInvalid('siEmailG', !EMAIL_RE.test(email))) requestCode('signin', email, '', $('#siBtn'));
  });
  $('#otpBack').addEventListener('click', () => showAuth(otp.from));
  $('#resendBtn').addEventListener('click', resend);
  boxes().forEach((b, i) => {
    b.addEventListener('input', () => { const v = b.value.replace(/\D/g, ''); if(v.length > 1) return fillFrom(i, v); b.value = v; if(v && i < 5) boxes()[i + 1].focus(); checkOtp(); });
    b.addEventListener('keydown', e => {
      const bs = boxes();
      if(e.key === 'Backspace' && !b.value && i > 0){ e.preventDefault(); bs[i - 1].value = ''; bs[i - 1].focus(); checkOtp(); }
      else if(e.key === 'ArrowLeft' && i > 0){ e.preventDefault(); bs[i - 1].focus(); }
      else if(e.key === 'ArrowRight' && i < 5){ e.preventDefault(); bs[i + 1].focus(); }
    });
    b.addEventListener('paste', e => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6); if(t) fillFrom(t.length === 6 ? 0 : i, t); });
    b.addEventListener('focus', () => setTimeout(() => b.select(), 0));
  });
  bindSwitch('obNotifyRow', 'obNotify');
  $('#obGo').addEventListener('click', () => {
    clearForm('scr-onboard');
    const name = $('#obName').value.trim(), raw = $('#obIncome').value.trim(), inc = raw ? num(raw) : null;
    const bad = setInvalid('obNameG', !name) + setInvalid('obIncomeG', inc != null && !(inc >= 0 && inc <= 1e8));
    if(bad) return;
    obDone && obDone({ name, income: inc, notify: isNative ? isOn('obNotify') : true });
  });
}
export function prefillSignin(email, message){
  $('#siEmail').value = email || '';
  $('#siSub').textContent = message || 'Enter your email and we\'ll send you a 6-digit sign-in code.';
}
