// Renders one launcher icon per colour palette (Android activity-alias icons) plus the in-app logo colours.
// Run: node assets/make-palette-icons.mjs   (needs `sharp`, e.g. npm i --no-save sharp)
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PALETTES } from '../src/palettes.js';
import { logoColors, logoSVG } from '../src/logo.js';

const res = fileURLToPath(new URL('../android/app/src/main/res/', import.meta.url));
const dir = d => { mkdirSync(res + d, { recursive:true }); return res + d + '/'; };

for(const key of Object.keys(PALETTES)){
  const c = logoColors(key);
  // full icon (legacy launchers, Android 7), foreground mark and background for adaptive icons
  await sharp(Buffer.from(logoSVG(c, { back:true, mark:true }))).resize(192, 192).png().toFile(dir('mipmap-xxxhdpi') + `ic_launcher_${key}.png`);
  await sharp(Buffer.from(logoSVG(c, { back:true, mark:false }))).resize(192, 192).png().toFile(dir('mipmap-xxxhdpi') + `ic_launcher_${key}_background.png`);
  await sharp(Buffer.from(logoSVG(c, { back:false, mark:true }))).resize(192, 192).png().toFile(dir('mipmap-xxxhdpi') + `ic_launcher_${key}_foreground.png`);
  writeFileSync(dir('mipmap-anydpi-v26') + `ic_launcher_${key}.xml`, `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background>
        <inset android:drawable="@mipmap/ic_launcher_${key}_background" android:inset="16.7%" />
    </background>
    <foreground>
        <inset android:drawable="@mipmap/ic_launcher_${key}_foreground" android:inset="16.7%" />
    </foreground>
</adaptive-icon>
`);
}
console.log('palette icons ready');
