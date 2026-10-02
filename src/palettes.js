const LIGHT_SEM = { gold:'#B7791F', gold2:'#D69E2E', rose:'#DC3545', warn:'#D9690B', onAccent:'#FFFFFF' };
const DARK_SEM = { gold:'#F2B84B', gold2:'#FFD27A', rose:'#FF6B7A', warn:'#FF9F45' };
const COOL_CATS = ['#8FA8FF','#F2B84B','#FF8A95','#5CC8FF','#C3A6FF','#FFB38A','#7FD1E8','#F49AC1'];
const WARM_CATS = ['#F2A07B','#E9C46A','#FF8A95','#8FB8DE','#C9A7EB','#9ED2BE','#F4A3B4','#D6B48C'];
const EARTH_CATS = ['#9CCBA8','#E9C46A','#F28B82','#8FB8DE','#C9A7EB','#F2A07B','#7FCBC4','#D6B48C'];

/** Each palette has its own hue family and background tint, so the options look clearly different. */
export const PALETTES = {
  sapphire:{ name:'Sapphire & Gold',
    dark:{ bg:'#0A0F1D', bgElev:'#111A2E', primary:'#7C9BFF', primary2:'#AFC2FF', accent2:'#5CC8FF', ...DARK_SEM, onAccent:'#07112A' },
    light:{ bg:'#F4F6FB', bgElev:'#FFFFFF', primary:'#3558F0', primary2:'#2445D4', accent2:'#1E9BE0', ...LIGHT_SEM },
    cats:COOL_CATS },
  violet:{ name:'Amethyst',
    dark:{ bg:'#0E0B1A', bgElev:'#17122A', primary:'#A78BFA', primary2:'#C4B5FD', accent2:'#F0ABFC', ...DARK_SEM, onAccent:'#160F2B' },
    light:{ bg:'#F7F5FF', bgElev:'#FFFFFF', primary:'#7C3AED', primary2:'#6D28D9', accent2:'#C026D3', ...LIGHT_SEM },
    cats:['#C4B5FD','#F5C04E','#FB7185','#93C5FD','#F0ABFC','#FDBA74','#A5B4FC','#F9A8D4'] },
  berry:{ name:'Berry',
    dark:{ bg:'#150A12', bgElev:'#21101C', primary:'#F472B6', primary2:'#F9A8D4', accent2:'#FDA4AF', gold:'#F7C25A', gold2:'#FFDA94', rose:'#FF5C6C', warn:'#FDBA74', onAccent:'#2A0A1C' },
    light:{ bg:'#FDF5F9', bgElev:'#FFFFFF', primary:'#DB2777', primary2:'#BE185D', accent2:'#E11D48', ...LIGHT_SEM, rose:'#B91C1C' },
    cats:['#F9A8D4','#F7C25A','#FF8A8A','#A5B4FC','#C4B5FD','#FDBA74','#93C5FD','#F0ABFC'] },
  ruby:{ name:'Ruby',
    dark:{ bg:'#140909', bgElev:'#211112', primary:'#F27272', primary2:'#F9A5A5', accent2:'#F59E7A', gold:'#F2C14E', gold2:'#FFD98A', rose:'#FF9466', warn:'#F5B544', onAccent:'#2A0808' },
    light:{ bg:'#FCF5F4', bgElev:'#FFFFFF', primary:'#C81E3A', primary2:'#A3162E', accent2:'#E0583A', gold:'#B7791F', gold2:'#D69E2E', rose:'#C2410C', warn:'#B45309', onAccent:'#FFFFFF' },
    cats:WARM_CATS },
  terracotta:{ name:'Terracotta',
    dark:{ bg:'#140E0B', bgElev:'#211712', primary:'#E8875C', primary2:'#F3B08F', accent2:'#F2B880', ...DARK_SEM, gold:'#E9C46A', onAccent:'#2A1005' },
    light:{ bg:'#FBF6F2', bgElev:'#FFFFFF', primary:'#B4532A', primary2:'#97431F', accent2:'#C9772F', ...LIGHT_SEM, gold:'#8A6A12', gold2:'#A88418' },
    cats:WARM_CATS },
  amber:{ name:'Saffron',
    dark:{ bg:'#13100A', bgElev:'#1F1A10', primary:'#F2B441', primary2:'#F8D082', accent2:'#F08A4B', gold:'#6FC9B9', gold2:'#9EDFD3', rose:'#FF6B7A', warn:'#FF9F45', onAccent:'#231703' },
    light:{ bg:'#FBF8F0', bgElev:'#FFFFFF', primary:'#9A6A00', primary2:'#7C5500', accent2:'#C99A06', gold:'#0F766E', gold2:'#14958A', rose:'#DC3545', warn:'#C2410C', onAccent:'#FFFFFF' },
    cats:['#F2C14E','#6FC9B9','#FF8A95','#8FB8DE','#C9A7EB','#F2A07B','#9CCBA8','#F4A3B4'] },
  mocha:{ name:'Mocha',
    dark:{ bg:'#110E0C', bgElev:'#1C1714', primary:'#C8A27C', primary2:'#E2C9A6', accent2:'#D9B48F', ...DARK_SEM, gold:'#E9C46A', onAccent:'#1A120A' },
    light:{ bg:'#F7F3EF', bgElev:'#FFFFFF', primary:'#7A5230', primary2:'#5E3E22', accent2:'#9A6B43', ...LIGHT_SEM },
    cats:EARTH_CATS },
  sage:{ name:'Sage',
    dark:{ bg:'#0B110E', bgElev:'#131C17', primary:'#8CC5A2', primary2:'#B8DEC6', accent2:'#C7D59F', ...DARK_SEM, gold:'#E9C46A', onAccent:'#0B1A12' },
    light:{ bg:'#F3F7F4', bgElev:'#FFFFFF', primary:'#2F7354', primary2:'#245C43', accent2:'#5E7F3A', ...LIGHT_SEM },
    cats:EARTH_CATS },
  teal:{ name:'Teal & Coral',
    dark:{ bg:'#061413', bgElev:'#0D201F', primary:'#45C4B0', primary2:'#8FE0D3', accent2:'#7FC8E8', ...DARK_SEM, rose:'#FF8A70', onAccent:'#03201C' },
    light:{ bg:'#F1F8F7', bgElev:'#FFFFFF', primary:'#0F766E', primary2:'#0B5E58', accent2:'#0E7490', ...LIGHT_SEM, rose:'#E04F2E' },
    cats:['#67D3C2','#F4C152','#FF8A70','#8FA8FF','#C3A6FF','#F2A07B','#93C5FD','#F49AC1'] },
  mono:{ name:'Monochrome',
    dark:{ bg:'#0C0C0D', bgElev:'#161618', primary:'#E7E7EA', primary2:'#FFFFFF', accent2:'#A1A1AA', gold:'#E9B949', gold2:'#F5D27E', rose:'#F06B6B', warn:'#F0A04B', onAccent:'#111113' },
    light:{ bg:'#F6F6F7', bgElev:'#FFFFFF', primary:'#18181B', primary2:'#09090B', accent2:'#52525B', gold:'#A16207', gold2:'#CA8A04', rose:'#DC2626', warn:'#C2410C', onAccent:'#FFFFFF' },
    cats:['#D4D4D8','#E9B949','#F28B8B','#A5B4FC','#C4B5FD','#FDBA74','#93C5FD','#F9A8D4'] }
};

/** Palettes from earlier versions map to their closest current one. */
const RETIRED = { indigo:'violet', twilight:'violet', plum:'violet', graphite:'sapphire', cobalt:'sapphire', aurora:'sapphire', arctic:'teal', lagoon:'teal' };
export const palKey = k => PALETTES[k] ? k : RETIRED[k] || 'sapphire';

export const TOKEN_MAP = { bg:'--bg', bgElev:'--bg-elev', primary:'--primary', primary2:'--primary-2', accent2:'--accent-2', gold:'--gold', gold2:'--gold-2', rose:'--rose', warn:'--warn', onAccent:'--on-accent' };

export function paletteVars(key, theme){
  return { ...PALETTES[palKey(key)][theme] };
}

export function swatchStyle(key, theme){
  const v = paletteVars(key, theme);
  return `background:radial-gradient(circle, ${v.bg} 0 27%, transparent 28%), conic-gradient(from 210deg, ${v.primary} 0 58%, ${v.accent2} 58% 82%, ${v.gold} 82% 100%)`;
}
