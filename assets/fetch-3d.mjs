// Downloads Microsoft Fluent 3D emoji (MIT licence) for the emoji the app uses and
// saves them as small WebP files in public/e3d/<codepoints>.webp. Run: node assets/fetch-3d.mjs
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { E3D } from '../src/e3d-list.js';

const out = fileURLToPath(new URL('../public/e3d/', import.meta.url));
mkdirSync(out, { recursive:true });
const RAW = 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/';
const tree = await (await fetch('https://api.github.com/repos/microsoft/fluentui-emoji/git/trees/main?recursive=1')).json();
const pngs = tree.tree.map(t => t.path).filter(p => /_3d(_default)?\.png$/.test(p));
const code = e => [...e.replace(/️/g, '')].map(c => c.codePointAt(0).toString(16)).join('-');

let ok = 0;
for(const [emoji, folder] of Object.entries(E3D)){
  const hit = pngs.find(p => p.startsWith(`assets/${folder}/3D/`)) || pngs.find(p => p.startsWith(`assets/${folder}/Default/3D/`));
  if(!hit){ console.warn('missing', emoji, folder); continue; }
  const buf = Buffer.from(await (await fetch(RAW + hit.split('/').map(encodeURIComponent).join('/'))).arrayBuffer());
  writeFileSync(out + code(emoji) + '.webp', await sharp(buf).resize(112, 112).webp({ quality:82, alphaQuality:90 }).toBuffer());
  ok++;
}
writeFileSync(out + 'LICENSE.txt', 'Fluent Emoji © Microsoft Corporation, MIT License — https://github.com/microsoft/fluentui-emoji\n');
console.log(`${ok} of ${Object.keys(E3D).length} icons saved`);
