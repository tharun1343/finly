import { PALETTES, palKey } from './palettes.js';

/** Logo colours for a palette. Sapphire keeps the original navy-and-gold brand mark. */
export function logoColors(key){
  key = palKey(key);
  if(key === 'sapphire') return { bg1:'#16264F', bg2:'#060A17', glow:'#3A5BC7', m1:'#FCE6AE', m2:'#E2AA4C', m3:'#B8812E' };
  const d = PALETTES[key].dark;
  return { bg1: mix(d.bgElev, d.primary, .22), bg2: d.bg, glow: d.primary, m1: mix(d.primary2, '#FFFFFF', .35), m2: d.primary2, m3: d.primary };
}

function mix(a, b, t){
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

const MARK = '<circle cx="512" cy="512" r="300" fill="none" stroke="url(#lg)" stroke-width="24" stroke-linecap="round" stroke-dasharray="1660 225"/><path d="M402 352H622V424H474V484H574V548H474V672H402Z" fill="url(#lg)" stroke="url(#lg)" stroke-width="16" stroke-linejoin="round"/>';

/** The Finly monogram as SVG markup in the given colours. */
export function logoSVG(c, { back = true, mark = true, rounded = false, id = 'f' } = {}){
  const defs = `<linearGradient id="lg" gradientUnits="userSpaceOnUse" x1="300" y1="200" x2="720" y2="840"><stop offset="0" stop-color="${c.m1}"/><stop offset=".55" stop-color="${c.m2}"/><stop offset="1" stop-color="${c.m3}"/></linearGradient>`
    + `<linearGradient id="lb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.bg1}"/><stop offset="1" stop-color="${c.bg2}"/></linearGradient>`
    + `<radialGradient id="lh" cx=".3" cy=".25" r=".7"><stop offset="0" stop-color="${c.glow}" stop-opacity=".35"/><stop offset="1" stop-color="${c.glow}" stop-opacity="0"/></radialGradient>`
    + (rounded ? '<clipPath id="lc"><rect width="1024" height="1024" rx="230"/></clipPath>' : '');
  const body = (back ? '<rect width="1024" height="1024" fill="url(#lb)"/><rect width="1024" height="1024" fill="url(#lh)"/>' : '') + (mark ? MARK : '');
  // ids are suffixed so several logos can live on one page
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs>${defs}</defs>${rounded ? `<g clip-path="url(#lc)">${body}</g>` : body}</svg>`;
  return svg.replace(/id="l([gbhc])"/g, `id="l$1${id}"`).replace(/url\(#l([gbhc])\)/g, `url(#l$1${id})`);
}
