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
      pending = { email, code: String(Math.floor(100000 + Math.random() * 900000)), name: options?.data?.name || '' };
      console.info('[dev] OTP for', email, '=', pending.code);
      window.__devOtp = pending.code;
      return { error:null };
    },
    async verifyOtp({ email, token }){
      await sleep(350);
      if(!pending || pending.email !== email || pending.code !== token) return { data:{}, error:{ message:'Token has expired or is invalid', code:'otp_expired', status:403 } };
      const id = 'dev-' + [...email].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16);
      const s = { access_token:'dev', refresh_token:'dev', expires_at: Math.floor(Date.now() / 1000) + 3600, user:{ id, email, user_metadata:{ name: pending.name } } };
      localStorage.setItem(authKey, JSON.stringify(s));
      subs.forEach(f => f('SIGNED_IN', s));
      return { data:{ session:s, user:s.user }, error:null };
    },
    async getSession(){ return { data:{ session: session() }, error:null }; },
    onAuthStateChange(cb){ subs.add(cb); return { data:{ subscription:{ unsubscribe(){ subs.delete(cb); } } } }; },
    async signOut(){ localStorage.removeItem(authKey); subs.forEach(f => f('SIGNED_OUT', null)); return { error:null }; }
  };

  function from(){
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
  return { auth, from };
}
