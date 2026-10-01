// Renders the Finly logo into the source PNGs that `capacitor-assets` turns into Android icons + splash.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('.', import.meta.url));
const grad = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C9BFF"/><stop offset="1" stop-color="#5CC8FF"/></linearGradient></defs>';
const glyph = (s = 1, dx = 0, dy = 0) => `<g transform="translate(${dx} ${dy}) scale(${s})"><path d="M372 274h330v104H492v118h178v102H492v174H372z" fill="#07112A"/><circle cx="676" cy="720" r="58" fill="#F2B84B"/></g>`;
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${grad}${body}</svg>`);
await sharp(readFileSync(dir + 'icon.svg')).resize(1024, 1024).png().toFile(dir + 'icon-only.png');
await sharp(svg(1024, 1024, `<rect width="1024" height="1024" fill="url(#g)"/>`)).png().toFile(dir + 'icon-background.png');
await sharp(svg(1024, 1024, glyph(0.62, 195, 195))).png().toFile(dir + 'icon-foreground.png');
const splash = bg => svg(2732, 2732, `<rect width="2732" height="2732" fill="${bg}"/><g transform="translate(1066 1066) scale(0.586)"><rect width="1024" height="1024" rx="230" fill="url(#g)"/>${glyph()}</g>`);
await sharp(splash('#0A0F1D')).png().toFile(dir + 'splash.png');
await sharp(splash('#0A0F1D')).png().toFile(dir + 'splash-dark.png');
console.log('images ready');
