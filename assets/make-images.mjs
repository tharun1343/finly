// Renders the Finly logo (navy + gold monogram) into the PNGs used for Android icons, splash and emails.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('.', import.meta.url));
const pub = fileURLToPath(new URL('../public/', import.meta.url));

const GOLD = '<linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="300" y1="200" x2="720" y2="840"><stop offset="0" stop-color="#FCE6AE"/><stop offset=".55" stop-color="#E2AA4C"/><stop offset="1" stop-color="#B8812E"/></linearGradient>';
const BG = '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16264F"/><stop offset="1" stop-color="#060A17"/></linearGradient><radialGradient id="hl" cx=".3" cy=".25" r=".7"><stop offset="0" stop-color="#3A5BC7" stop-opacity=".35"/><stop offset="1" stop-color="#3A5BC7" stop-opacity="0"/></radialGradient>';
export const MARK = '<circle cx="512" cy="512" r="300" fill="none" stroke="url(#gold)" stroke-width="24" stroke-linecap="round" stroke-dasharray="1660 225"/><path d="M402 352H622V424H474V484H574V548H474V672H402Z" fill="url(#gold)" stroke="url(#gold)" stroke-width="16" stroke-linejoin="round"/>';
const BACK = '<rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#hl)"/>';
const svg = (body, w = 1024, h = 1024, vb = '0 0 1024 1024') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}"><defs>${GOLD}${BG}</defs>${body}</svg>`;
const png = (s, file) => sharp(Buffer.from(s)).png().toFile(file);

const full = svg(BACK + MARK);
writeFileSync(dir + 'icon.svg', full);
await png(full, dir + 'icon-only.png');
await png(svg(BACK), dir + 'icon-background.png');
await png(svg(MARK), dir + 'icon-foreground.png');
const splash = svg(`<rect width="2732" height="2732" fill="#0A0F1D"/><g transform="translate(1066 1066) scale(0.586)"><rect width="1024" height="1024" rx="230" fill="url(#bg)"/><rect width="1024" height="1024" rx="230" fill="url(#hl)"/>${MARK}</g>`, 2732, 2732, '0 0 2732 2732');
await png(splash, dir + 'splash.png');
await png(splash, dir + 'splash-dark.png');
const rounded = svg(`<clipPath id="c"><rect width="1024" height="1024" rx="230"/></clipPath><g clip-path="url(#c)">${BACK}${MARK}</g>`);
writeFileSync(pub + 'favicon.svg', rounded);
await sharp(Buffer.from(rounded)).resize(192, 192).png().toFile(pub + 'email-logo.png');
console.log('images ready');
