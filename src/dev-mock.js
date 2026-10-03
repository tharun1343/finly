// Development-only stand-in for Supabase (used by `npm run dev` when no Supabase keys are set).
// Never included in production builds: data.js imports it only behind import.meta.env.DEV.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DB_KEY = 'finly-dev-server';

export function createMockClient(authKey){
  const db = JSON.parse(localStorage.getItem(DB_KEY) || '{"records":[]}');
  const persist = () => localStorage.setItem(DB_KEY, JSON.stringify(db));
  const subs = new Set();
  let pending = null;
  const session = () => JSON.parse(localStorage.getItem(authKey) || 'null');

  const auth = {
    async signInWithOtp({ email, options }){
      await sleep(350);
      pending = { email, code: String(Math.floor(100000 + Math.random() * 900000)), name: options?.data?.name || '', phone: options?.data?.phone || '' };
      console.info('[dev] OTP for', email, '=', pending.code);
      window.__devOtp = pending.code;
      return { error:null };
    },
    async verifyOtp({ email, token }){
      await sleep(350);
      if(!pending || pending.email !== email || pending.code !== token) return { data:{}, error:{ message:'Token has expired or is invalid', code:'otp_expired', status:403 } };
      const id = 'dev-' + [...email].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16);
      const s = { access_token:'dev', refresh_token:'dev', expires_at: Math.floor(Date.now() / 1000) + 3600, user:{ id, email, user_metadata:{ name: pending.name, phone: pending.phone } } };
      localStorage.setItem(authKey, JSON.stringify(s));
      subs.forEach(f => f('SIGNED_IN', s));
      return { data:{ session:s, user:s.user }, error:null };
    },
    async getSession(){ return { data:{ session: session() }, error:null }; },
    onAuthStateChange(cb){ subs.add(cb); return { data:{ subscription:{ unsubscribe(){ subs.delete(cb); } } } }; },
    async signOut(){ localStorage.removeItem(authKey); subs.forEach(f => f('SIGNED_OUT', null)); return { error:null }; }
  };

  /* ---- Finly 2.0 tables, simulated (devices, profiles, ledger_shares) ---- */
  db.devices ||= []; db.profiles ||= []; db.shares ||= [];
  const me = () => session()?.user?.id;
  const ok = data => ({ data, error:null });
  async function rpc(name, a){
    await sleep(100);
    const u = me(); if(!u) return { data:null, error:{ message:'not signed in' } };
    let out = null;
    if(name === 'register_device'){
      let d = db.devices.find(x => x.user_id === u && x.id === a.p_id);
      if(d?.revoked) return ok({ revoked:true });
      const fresh = !d;
      if(!d){ d = { user_id:u, id:a.p_id, created_at:new Date().toISOString(), revoked:false }; db.devices.push(d); }
      Object.assign(d, { name:a.p_name, platform:a.p_platform, city:a.p_city || d.city || '', last_seen:new Date().toISOString() });
      out = { revoked:false, is_new:fresh, others: db.devices.filter(x => x.user_id === u && x.id !== a.p_id && !x.revoked).length };
    } else if(name === 'revoke_device'){ const d = db.devices.find(x => x.user_id === u && x.id === a.p_id); if(d) d.revoked = true; }
    else if(name === 'forget_device'){ db.devices = db.devices.filter(x => !(x.user_id === u && x.id === a.p_id && x.revoked)); }
    else if(name === 'save_profile'){
      if(db.profiles.some(x => x.phone === a.p_phone && x.user_id !== u)) return { data:null, error:{ message:'phone_taken' } };
      db.profiles = db.profiles.filter(x => x.user_id !== u).concat({ user_id:u, phone:a.p_phone, name:a.p_name });
      db.shares.forEach(r => { if(!r.counterpart && r.counterpart_phone === a.p_phone && r.owner !== u) r.counterpart = u; });
    } else if(name === 'share_upsert'){
      const cp = db.profiles.find(x => x.phone === a.p_phone && x.user_id !== u)?.user_id || null, mine = db.profiles.find(x => x.user_id === u)?.phone || '';
      let r = db.shares.find(x => x.id === a.p_id);
      if(r && r.owner !== u) return { data:null, error:{ message:'not yours' } };
      if(!r){ r = { id:a.p_id, owner:u, status:'pending', created_at:new Date().toISOString() }; db.shares.push(r); }
      else if(r.counterpart_phone !== a.p_phone || r.status === 'removed') r.status = 'pending';
      Object.assign(r, { owner_name:a.p_owner_name, owner_phone:mine, counterpart:cp, counterpart_phone:a.p_phone, data:a.p_data, updated_at:new Date().toISOString() });
      out = cp ? 'linked' : 'waiting';
    } else if(name === 'share_respond'){ const r = db.shares.find(x => x.id === a.p_id && x.counterpart === u); if(r) r.status = a.p_accept ? 'accepted' : 'declined'; }
    else if(name === 'share_add_payment'){
      const r = db.shares.find(x => x.id === a.p_id && (x.owner === u || (x.counterpart === u && x.status === 'accepted')));
      if(r && !(r.data.payments || []).some(p => p.id === a.p_payment.id)) r.data.payments = [...(r.data.payments || []), a.p_payment];
    } else if(name === 'share_remove'){ const r = db.shares.find(x => x.id === a.p_id && x.owner === u); if(r) r.status = 'removed'; }
    else return { data:null, error:{ code:'PGRST202', message:'Could not find the function' } };
    persist();
    return ok(out);
  }
  function table(name){
    const filters = [];
    const rows = () => { const u = me(); return name === 'devices' ? db.devices.filter(x => x.user_id === u) : db.shares.filter(x => x.owner === u || x.counterpart === u); };
    const b = {
      select(){ return b; }, order(){ return b; },
      neq(c, v){ filters.push(r => r[c] !== v); return b; }, eq(c, v){ filters.push(r => r[c] === v); return b; },
      async maybeSingle(){ await sleep(60); return ok(rows().filter(r => filters.every(f => f(r)))[0] || null); },
      then(res, rej){ return sleep(100).then(() => ok(JSON.parse(JSON.stringify(rows().filter(r => filters.every(f => f(r))))))).then(res, rej); }
    };
    return b;
  }
  const functions = { async invoke(){ return ok('sent'); } };

  function from(tbl){
    if(tbl === 'devices' || tbl === 'ledger_shares') return table(tbl);
    const q = { filters:[], ord:null, lim:null };
    const builder = {
      async upsert(rows){
        await sleep(120);
        const uidNow = session()?.user?.id;
        for(const row of rows){
          if(row.user_id !== uidNow) return { error:{ message:'RLS violation' } };
          const i = db.records.findIndex(r => r.user_id === row.user_id && r.collection === row.collection && r.id === row.id);
          if(i > -1 && Date.parse(row.client_updated_at) < Date.parse(db.records[i].client_updated_at)) continue;
          const rec = { ...row, server_updated_at: new Date(Date.now() + Math.random()).toISOString() };
          if(i > -1) db.records[i] = rec; else db.records.push(rec);
          await sleep(1);
        }
        persist();
        return { error:null };
      },
      select(){ return builder; },
      gt(col, v){ q.filters.push(r => r[col] > v); return builder; },
      order(col){ q.ord = col; return builder; },
      limit(n){ q.lim = n; return builder; },
      then(res, rej){
        const uidNow = session()?.user?.id;
        let out = db.records.filter(r => r.user_id === uidNow && q.filters.every(f => f(r)));
        if(q.ord) out.sort((a, b) => (a[q.ord] < b[q.ord] ? -1 : 1));
        if(q.lim) out = out.slice(0, q.lim);
        return sleep(120).then(() => ({ data: JSON.parse(JSON.stringify(out)), error:null })).then(res, rej);
      }
    };
    return builder;
  }
  return { auth, from, rpc, functions };
}
