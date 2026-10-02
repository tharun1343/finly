// Fetches each bank's official square icon (the icon of its own app on Google Play, published by the bank)
// and saves it as public/banks/<slug>.webp, then writes src/bank-logos.js listing what's available.
// Banks without a verified icon keep the coloured monogram badge. Run: node assets/fetch-bank-logos.mjs
// Review the result before committing — see assets/bank-logos-check.png.
import sharp from 'sharp';
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BANK_GROUPS } from '../src/banks.js';

const out = fileURLToPath(new URL('../public/banks/', import.meta.url));
rmSync(out, { recursive:true, force:true }); mkdirSync(out, { recursive:true });
const UA = { 'User-Agent':'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36', 'Accept-Language':'en-IN' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const slug = name => name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Pinned Play Store apps where search is ambiguous, and words the publisher name must contain otherwise.
const PIN = {
  'State Bank of India':'com.sbi.lotusintouch', 'ICICI Bank':'com.csam.icici.bank.imobile', 'Axis Bank':'com.axis.mobile', 'Punjab National Bank':'com.Version1',
  'Canara Bank':'com.canarabank.mobility', 'Bank of Baroda':'com.bankofbaroda.bobworlddmb', 'Union Bank of India':'com.infrasoft.uboi', 'Kotak Mahindra Bank':'com.kotak.bank.mobile', 'HDFC Bank':'com.hdfcbank.android.now',
  'Paytm Payments Bank':'net.one97.paytm', 'Airtel Payments Bank':'com.myairtelapp', 'Jio Payments Bank':'com.jio.myjio', 'slice Small Finance Bank':'indwin.c3.shareapp'
};
const KEY = name => name.replace(/\b(Bank|of|India|Small Finance|Payments|Co-operative|Sahakari|Ltd)\b/gi, ' ').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(w => w.length > 2)[0]?.toLowerCase() || '';

async function page(url){ return (await fetch(url, { headers:UA, signal:AbortSignal.timeout(15000) })).text(); }
async function details(id){
  const d = await page(`https://play.google.com/store/apps/details?id=${id}&hl=en_IN&gl=IN`);
  const icon = (d.match(/<meta property="og:image" content="([^"]+)/) || [])[1];
  const dev = ((d.match(/"author":\{"@type":"Person","name":"([^"]+)/) || [])[1] || '').replace(/&amp;/g, '&');
  return { id, icon, dev };
}
async function findApp(name){
  if(PIN[name]) return details(PIN[name]);
  const html = await page(`https://play.google.com/store/search?q=${encodeURIComponent(name + ' mobile banking')}&c=apps&hl=en_IN&gl=IN`);
  const ids = [...new Set([...html.matchAll(/\/store\/apps\/details\?id=([\w.]+)/g)].map(m => m[1]))].slice(0, 4);
  for(const id of ids){
    const a = await details(id);
    if(a.icon && a.dev.toLowerCase().includes(KEY(name))) return a;
    await sleep(200);
  }
  return null;
}

const found = [], log = [];
for(const [, list] of BANK_GROUPS){
  for(const [name] of list){
    try{
      const a = await findApp(name);
      if(!a?.icon){ log.push(`✗ ${name}`); continue; }
      const buf = Buffer.from(await (await fetch(a.icon.replace(/=[^/]*$/, '') + '=s256', { headers:UA })).arrayBuffer());
      writeFileSync(out + slug(name) + '.webp', await sharp(buf).resize(128, 128).webp({ quality:88 }).toBuffer());
      found.push(name); log.push(`✓ ${name}  ←  ${a.id} (${a.dev})`);
    }catch(err){ log.push(`✗ ${name} (${err.message})`); }
    await sleep(300);
  }
}
// Banks whose app icon shows the app's brand rather than the bank's: use the symbol cut from the bank's
// official logo on Wikimedia Commons instead. [Wikipedia article, left, right, top, bottom (fractions), tile colour].
const WIKI_CROP = {
  'State Bank of India':['State Bank of India', 0, .36], 'Axis Bank':['Axis Bank', 0, .2], 'Punjab National Bank':['Punjab National Bank', .085, .19, 0, .7, '#A6123E'],
  'Union Bank of India':['Union Bank of India', 0, .27], 'Indian Overseas Bank':['Indian Overseas Bank', 0, .2], 'HDFC Bank':['HDFC Bank', 0, .165],
  'Tamilnad Mercantile Bank':['Tamilnad Mercantile Bank', 0, .69, 0, .8], 'Canara Bank':['Canara Bank', .31, .5]
};
const DROP = ['India Post Payments Bank'];   // icon unreadable at small sizes
async function wikiLogo(title){
  const j = await (await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&sites=enwiki&titles=${encodeURIComponent(title)}&props=claims&format=json&redirects=yes`,
    { headers:{ 'User-Agent':'FinlyBuild/1.0 (https://github.com/tharun1343/finly)' } })).json();
  const file = Object.values(j.entities || {})[0]?.claims?.P154?.at(-1)?.mainsnak?.datavalue?.value;
  if(!file) return null;
  return Buffer.from(await (await fetch(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=1600`, { headers:{ 'User-Agent':'FinlyBuild/1.0 (https://github.com/tharun1343/finly)' } })).arrayBuffer());
}
for(const [name, [title, x0, x1, y0 = 0, y1 = 1, bg = '#fff']] of Object.entries(WIKI_CROP)){
  try{
    const raw = await wikiLogo(title); if(!raw){ log.push(`✗ crop ${name}`); continue; }
    const trimmed = await sharp(raw).flatten({ background:'#fff' }).trim({ threshold:20 }).toBuffer({ resolveWithObject:true });
    const W = trimmed.info.width, H = trimmed.info.height, left = Math.round(W * x0), width = Math.max(1, Math.round(W * (x1 - x0)));
    const top = Math.round(H * y0), height = Math.round(H * (y1 - y0));
    const sym = await sharp(trimmed.data).extract({ left, top, width:Math.min(width, W - left), height:Math.min(height, H - top) }).trim({ threshold:20 }).toBuffer();
    const icon = await sharp(sym).resize(100, 100, { fit:'contain', background:bg }).extend({ top:14, bottom:14, left:14, right:14, background:bg }).webp({ quality:90 }).toBuffer();
    writeFileSync(out + slug(name) + '.webp', icon);
    if(!found.includes(name)) found.push(name);
    log.push(`✓ crop ${name}`);
  }catch(err){ log.push(`✗ crop ${name} (${err.message})`); }
  await sleep(300);
}
for(const name of DROP){ rmSync(out + slug(name) + '.webp', { force:true }); found.splice(found.indexOf(name), 1); }

writeFileSync(fileURLToPath(new URL('../src/bank-logos.js', import.meta.url)),
  `// Generated by assets/fetch-bank-logos.mjs — banks with an icon in public/banks/.\nexport const BANK_LOGOS = new Set(${JSON.stringify(found.map(slug))});\n`);

// contact sheet for a human check
const files = readdirSync(out).filter(f => f.endsWith('.webp')).sort(), C = 9, W = 150;
const rows = Math.ceil(files.length / C);
const label = files.map((f, i) => `<text x="${(i % C) * W + 75}" y="${Math.floor(i / C) * (W + 10) + 150}" font-size="11" text-anchor="middle" font-family="Arial">${f.replace('.webp', '').slice(0, 24)}</text>`).join('');
await sharp({ create:{ width:C * W, height:rows * (W + 10), channels:4, background:'#fff' } })
  .composite([...files.map((f, i) => ({ input:out + f, left:(i % C) * W + 11, top:Math.floor(i / C) * (W + 10) + 5 })),
    { input:Buffer.from(`<svg width="${C * W}" height="${rows * (W + 10)}">${label}</svg>`), left:0, top:0 }])
  .png().toFile(fileURLToPath(new URL('./bank-logos-check.png', import.meta.url)));
console.log(log.join('\n') + `\n\n${found.length} icons saved`);
