// Banks operating in India, grouped as the RBI classifies them.
// [display name, short name, IFSC prefix]; the prefix lets the app recognise a bank from its IFSC.
export const BANK_GROUPS = [
  ['Public sector banks', [
    ['State Bank of India', 'SBI', 'SBIN'], ['Punjab National Bank', 'PNB', 'PUNB'], ['Bank of Baroda', 'BoB', 'BARB'],
    ['Canara Bank', 'Canara', 'CNRB'], ['Union Bank of India', 'Union Bank', 'UBIN'], ['Bank of India', 'BOI', 'BKID'],
    ['Indian Bank', 'Indian Bank', 'IDIB'], ['Central Bank of India', 'Central Bank', 'CBIN'], ['Indian Overseas Bank', 'IOB', 'IOBA'],
    ['UCO Bank', 'UCO', 'UCBA'], ['Bank of Maharashtra', 'BoM', 'MAHB'], ['Punjab & Sind Bank', 'P&S Bank', 'PSIB']]],
  ['Private sector banks', [
    ['HDFC Bank', 'HDFC', 'HDFC'], ['ICICI Bank', 'ICICI', 'ICIC'], ['Axis Bank', 'Axis', 'UTIB'], ['Kotak Mahindra Bank', 'Kotak', 'KKBK'],
    ['IndusInd Bank', 'IndusInd', 'INDB'], ['Yes Bank', 'Yes Bank', 'YESB'], ['IDFC FIRST Bank', 'IDFC FIRST', 'IDFB'], ['IDBI Bank', 'IDBI', 'IBKL'],
    ['Federal Bank', 'Federal', 'FDRL'], ['South Indian Bank', 'SIB', 'SIBL'], ['Karur Vysya Bank', 'KVB', 'KVBL'], ['City Union Bank', 'CUB', 'CIUB'],
    ['Tamilnad Mercantile Bank', 'TMB', 'TMBL'], ['Karnataka Bank', 'Karnataka Bank', 'KARB'], ['RBL Bank', 'RBL', 'RATN'], ['Bandhan Bank', 'Bandhan', 'BDBL'],
    ['CSB Bank', 'CSB', 'CSBK'], ['DCB Bank', 'DCB', 'DCBL'], ['Dhanlaxmi Bank', 'Dhanlaxmi', 'DLXB'], ['Jammu & Kashmir Bank', 'J&K Bank', 'JAKA'],
    ['Nainital Bank', 'Nainital Bank', 'NTBL']]],
  ['Small finance banks', [
    ['AU Small Finance Bank', 'AU Bank', 'AUBL'], ['Equitas Small Finance Bank', 'Equitas', 'ESFB'], ['Ujjivan Small Finance Bank', 'Ujjivan', 'UJVN'],
    ['Jana Small Finance Bank', 'Jana', 'JSFB'], ['Suryoday Small Finance Bank', 'Suryoday', 'SURY'], ['ESAF Small Finance Bank', 'ESAF', 'ESMF'],
    ['Utkarsh Small Finance Bank', 'Utkarsh', 'UTKS'], ['Capital Small Finance Bank', 'Capital SFB', 'CLBL'], ['North East Small Finance Bank', 'NESFB', 'NESF'],
    ['Shivalik Small Finance Bank', 'Shivalik', 'SMCB'], ['Unity Small Finance Bank', 'Unity', 'UNBA'], ['slice Small Finance Bank', 'slice', 'NESF']]],
  ['Payments banks', [
    ['India Post Payments Bank', 'IPPB', 'IPOS'], ['Airtel Payments Bank', 'Airtel PB', 'AIRP'], ['Fino Payments Bank', 'Fino', 'FINO'],
    ['Jio Payments Bank', 'Jio PB', 'JIOP'], ['NSDL Payments Bank', 'NSDL PB', 'NSPB'], ['Paytm Payments Bank', 'Paytm PB', 'PYTM']]],
  ['Foreign banks', [
    ['Standard Chartered Bank', 'StanChart', 'SCBL'], ['HSBC', 'HSBC', 'HSBC'], ['DBS Bank India', 'DBS', 'DBSS'], ['Citibank', 'Citi', 'CITI'],
    ['Deutsche Bank', 'Deutsche', 'DEUT'], ['Barclays Bank', 'Barclays', 'BARC']]],
  ['Co-operative & regional banks', [
    ['Tamil Nadu State Apex Co-operative Bank', 'TNSC Bank', 'TNSC'], ['Saraswat Co-operative Bank', 'Saraswat', 'SRCB'], ['Cosmos Co-operative Bank', 'Cosmos', 'COSB'],
    ['TJSB Sahakari Bank', 'TJSB', 'TJSB'], ['SVC Co-operative Bank', 'SVC', 'SVCB'], ['Abhyudaya Co-operative Bank', 'Abhyudaya', 'ABHY'],
    ['Kerala Gramin Bank', 'KGB', 'KLGB'], ['Tamil Nadu Grama Bank', 'TN Grama', 'IDIB'], ['Karnataka Gramin Bank', 'Karnataka Gramin', 'PKGB'],
    ['Andhra Pradesh Grameena Vikas Bank', 'APGVB', 'SBIN']]]
];

export const OTHER_BANK = '__other';
const ALL = BANK_GROUPS.flatMap(([, list]) => list);
export const findBank = name => ALL.find(b => b[0] === name);
/** Regional banks share their sponsor's prefix; the main bank is listed first, so it wins. */
export const bankFromIfsc = ifsc => { const p = String(ifsc || '').slice(0, 4).toUpperCase(); return p.length === 4 ? ALL.find(b => b[2] === p) || null : null; };
export const shortName = name => findBank(name)?.[1] || name;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const last4 = acct => String(acct || '').slice(-4);
export const maskAcct = acct => '••••' + last4(acct);

/* ---------- brand-coloured bank badges (colours inspired by each bank; no logos are copied) ---------- */
const BRAND = {
  SBIN:'#1F5AA6', PUNB:'#A3133B', BARB:'#F26522', CNRB:'#0087CD', UBIN:'#D71920', BKID:'#F07D22', IDIB:'#1B3F8B', CBIN:'#C8102E',
  IOBA:'#1E4E9D', UCBA:'#0070BA', MAHB:'#1D4C9B', PSIB:'#0E8A4B', HDFC:'#004C8F', ICIC:'#AE282E', UTIB:'#97144D', KKBK:'#E3262B',
  INDB:'#8E2430', YESB:'#0060AA', IDFB:'#9C1D27', IBKL:'#00836C', FDRL:'#0B3B85', SIBL:'#D2232A', KVBL:'#1D6B3E', CIUB:'#1F3C88',
  TMBL:'#21409A', KARB:'#7B2D8B', RATN:'#21409A', BDBL:'#E2231A', CSBK:'#0E6CB4', DCBL:'#1C3F94', DLXB:'#B5121B', JAKA:'#0A5C36',
  NTBL:'#1E5A9C', AUBL:'#6B2C91', ESFB:'#F58220', UJVN:'#00A0A0', JSFB:'#00A651', SURY:'#F4A21B', ESMF:'#E25C26', UTKS:'#6D2077',
  CLBL:'#00599C', NESF:'#1C7C54', SMCB:'#173F7A', UNBA:'#5B2D8E', IPOS:'#D2232A', AIRP:'#E40000', FINO:'#0A4DA2', JIOP:'#0F3CC9',
  NSPB:'#2B3990', PYTM:'#00B9F1', SCBL:'#0473EA', HSBC:'#DB0011', DBSS:'#E2231A', CITI:'#056DAE', DEUT:'#0018A8', BARC:'#00AEEF',
  TNSC:'#1B6E3A', SRCB:'#C1272D', COSB:'#2E3192', TJSB:'#E31E24', SVCB:'#1C4E9D', ABHY:'#0D6B37', KLGB:'#00843D', PKGB:'#00843D'
};
const FALLBACK = ['#3B5BDB', '#7048E8', '#0B7285', '#2B8A3E', '#C2255C', '#E8590C', '#5F3DC4', '#1864AB'];
export function bankColor(name){
  const b = findBank(name);
  if(b && BRAND[b[2]] && !(b[0].includes('Gramin') || b[0].includes('Grama') || b[0].includes('Grameena'))) return BRAND[b[2]];
  let h = 0; for(const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}
export function bankMono(name){
  const s = shortName(name).replace(/[^A-Za-z0-9& ]/g, '').trim(), words = s.split(/\s+/).filter(Boolean);
  if(words.length === 1 && s.length <= 5) return s;
  if(/^[A-Z&]{2,4}$/.test(words[0])) return words[0];
  return (words.length > 1 ? words.slice(0, 3).map(w => w[0]).join('') : s.slice(0, 3)).toUpperCase();
}
/** Glossy, brand-coloured monogram badge. */
export const bankBadgeHTML = (name, cls = '') => `<span class="bank-badge ${cls}" style="--bk:${bankColor(name)}" aria-hidden="true"><span>${String(bankMono(name)).replace(/[&<>]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c]))}</span></span>`;

/* ---------- branch lookup from IFSC (Razorpay's free public IFSC API) ---------- */
const branchCache = new Map();
/** @returns {Promise<{bank, branch, city, district, state, address} | null>} null = no such IFSC; throws when offline. */
export async function lookupIfsc(ifsc){
  ifsc = String(ifsc || '').toUpperCase();
  if(!IFSC_RE.test(ifsc)) return null;
  if(branchCache.has(ifsc)) return branchCache.get(ifsc);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try{
    const r = await fetch(`https://ifsc.razorpay.com/${ifsc}`, { signal:ctl.signal });
    if(r.status === 404){ branchCache.set(ifsc, null); return null; }
    if(!r.ok) throw new Error('lookup failed');
    const j = await r.json();
    const res = { bank:j.BANK || '', branch:titleCase(j.BRANCH), city:titleCase(j.CITY || j.CENTRE), district:titleCase(j.DISTRICT), state:titleCase(j.STATE), address:j.ADDRESS || '' };
    branchCache.set(ifsc, res);
    return res;
  } finally { clearTimeout(t); }
}
/** "MG ROAD BRANCH" → "MG Road Branch": short vowel-less words (MG, RPC, SME) stay in capitals. */
export const titleCase = s => String(s || '').trim().split(/(\s+|[-/(),.])/).map(w => (/^[A-Z]{2,4}$/.test(w) && !/[AEIOU]/.test(w)) || /^[IVX]{1,4}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
