const LIGHT_SEM = { gold:'#B7791F', gold2:'#D69E2E', rose:'#DC3545', warn:'#D9690B', onAccent:'#FFFFFF' };
const DARK_SEM = { gold:'#F2B84B', gold2:'#FFD27A', rose:'#FF6B7A', warn:'#FF9F45' };
const COOL_CATS = ['#8FA8FF','#F2B84B','#FF8A95','#5CC8FF','#C3A6FF','#FFB38A','#7FD1E8','#F49AC1'];

export const PALETTES = {
  sapphire:{ name:'Sapphire & Gold',
    dark:{ bg:'#0A0F1D', bgElev:'#111A2E', primary:'#7C9BFF', primary2:'#AFC2FF', accent2:'#5CC8FF', ...DARK_SEM, onAccent:'#07112A' },
    light:{ bg:'#F4F6FB', bgElev:'#FFFFFF', primary:'#3558F0', primary2:'#2445D4', accent2:'#1E9BE0', ...LIGHT_SEM },
    cats:COOL_CATS },
  indigo:{ name:'Indigo & Gold',
    dark:{ bg:'#0A0C14', bgElev:'#11131D', primary:'#818CF8', primary2:'#A5B4FC', accent2:'#C4B5FD', gold:'#F0B94D', gold2:'#FBCB6E', rose:'#FB7185', warn:'#FB923C', onAccent:'#0D0E1F' },
    light:{ bg:'#F2F3F8', bgElev:'#FFFFFF', primary:'#6366F1', primary2:'#4F46E5', accent2:'#8B7FE8', ...LIGHT_SEM },
    cats:['#A5B4FC','#F0B94D','#FB7185','#7DD3FC','#C4B5FD','#F9A8D4','#FDBA74','#93C5FD'] },
  plum:{ name:'Plum & Peach',
    dark:{ bg:'#110C16', bgElev:'#1A1322', primary:'#B69CFF', primary2:'#D3C2FF', accent2:'#F49AC8', gold:'#F7B27A', gold2:'#FFCB9E', rose:'#FF6B8E', warn:'#FFB454', onAccent:'#1A0F24' },
    light:{ bg:'#FAF6FA', bgElev:'#FFFFFF', primary:'#7B4DDB', primary2:'#6236C2', accent2:'#D0559A', gold:'#B8641B', gold2:'#D9822B', rose:'#D02F5E', warn:'#C7650A', onAccent:'#FFFFFF' },
    cats:['#C9B3FF','#F7B27A','#FF8FA8','#8EC5FF','#F49AC8','#FFD08A','#B0A4FF','#FFB3C7'] },
  graphite:{ name:'Graphite & Ocean',
    dark:{ bg:'#0D0F12', bgElev:'#171A1F', primary:'#4DA3FF', primary2:'#8CC4FF', accent2:'#6B8CFF', gold:'#EDB949', gold2:'#F7D27E', rose:'#F26D6D', warn:'#F59E3B', onAccent:'#04121F' },
    light:{ bg:'#F5F6F7', bgElev:'#FFFFFF', primary:'#1F6FEB', primary2:'#1558C7', accent2:'#4C6FFF', ...LIGHT_SEM },
    cats:['#7CB6FF','#EDB949','#F28B8B','#9AA8FF','#C7A2FF','#FFB079','#88D1F0','#E9A0D0'] },
  violet:{ name:'Violet Night',
    dark:{ bg:'#0E0B1A', bgElev:'#17122A', primary:'#A78BFA', primary2:'#C4B5FD', accent2:'#F0ABFC', ...DARK_SEM, onAccent:'#160F2B' },
    light:{ bg:'#F7F5FF', bgElev:'#FFFFFF', primary:'#7C3AED', primary2:'#6D28D9', accent2:'#C026D3', ...LIGHT_SEM },
    cats:['#C4B5FD','#F5C04E','#FB7185','#93C5FD','#F0ABFC','#FDBA74','#A5B4FC','#F9A8D4'] },
  arctic:{ name:'Arctic',
    dark:{ bg:'#0A1218', bgElev:'#111D26', primary:'#6CC3FF', primary2:'#A8DCFF', accent2:'#8FA8FF', ...DARK_SEM, onAccent:'#04131F' },
    light:{ bg:'#F3F8FB', bgElev:'#FFFFFF', primary:'#0B7BD3', primary2:'#0866B0', accent2:'#4361EE', ...LIGHT_SEM },
    cats:['#8ED0FF','#F2BE55','#FF8F99','#A5B4FC','#C3B5FD','#FFB38A','#7FD1E8','#F5A3C7'] },
  lagoon:{ name:'Lagoon',
    dark:{ bg:'#071417', bgElev:'#0E2025', primary:'#3FD0E0', primary2:'#9BE8F0', accent2:'#5B8CFF', ...DARK_SEM, onAccent:'#03181C' },
    light:{ bg:'#F2FAFB', bgElev:'#FFFFFF', primary:'#0891B2', primary2:'#0E7490', accent2:'#2563EB', ...LIGHT_SEM },
    cats:['#67E0EC','#F4C152','#FF8A95','#8FA8FF','#C3A6FF','#FFB38A','#93C5FD','#F49AC1'] },
  berry:{ name:'Berry',
    dark:{ bg:'#150A12', bgElev:'#21101C', primary:'#F472B6', primary2:'#F9A8D4', accent2:'#A78BFA', gold:'#F7C25A', gold2:'#FFDA94', rose:'#FF5C6C', warn:'#FDBA74', onAccent:'#2A0A1C' },
    light:{ bg:'#FDF5F9', bgElev:'#FFFFFF', primary:'#DB2777', primary2:'#BE185D', accent2:'#7C3AED', ...LIGHT_SEM, rose:'#DC2626' },
    cats:['#F9A8D4','#F7C25A','#FF8A8A','#A5B4FC','#C4B5FD','#FDBA74','#93C5FD','#F0ABFC'] },
  cobalt:{ name:'Cobalt',
    dark:{ bg:'#070B19', bgElev:'#0F1630', primary:'#4F7BFF', primary2:'#8FA9FF', accent2:'#22D3EE', ...DARK_SEM, onAccent:'#FFFFFF' },
    light:{ bg:'#F3F6FE', bgElev:'#FFFFFF', primary:'#2952E3', primary2:'#1E40AF', accent2:'#0891B2', ...LIGHT_SEM },
    cats:COOL_CATS },
  mono:{ name:'Monochrome',
    dark:{ bg:'#0C0C0D', bgElev:'#161618', primary:'#E7E7EA', primary2:'#FFFFFF', accent2:'#A1A1AA', gold:'#E9B949', gold2:'#F5D27E', rose:'#F06B6B', warn:'#F0A04B', onAccent:'#111113' },
    light:{ bg:'#F6F6F7', bgElev:'#FFFFFF', primary:'#18181B', primary2:'#09090B', accent2:'#52525B', gold:'#A16207', gold2:'#CA8A04', rose:'#DC2626', warn:'#C2410C', onAccent:'#FFFFFF' },
    cats:['#D4D4D8','#E9B949','#F28B8B','#A5B4FC','#C4B5FD','#FDBA74','#93C5FD','#F9A8D4'] },
  twilight:{ name:'Twilight',
    dark:{ bg:'#0D0B17', bgElev:'#171427', primary:'#818CF8', primary2:'#A5B4FC', accent2:'#F472B6', ...DARK_SEM, onAccent:'#0F0B22' },
    light:{ bg:'#F6F5FD', bgElev:'#FFFFFF', primary:'#6366F1', primary2:'#4F46E5', accent2:'#DB2777', ...LIGHT_SEM },
    cats:['#A5B4FC','#F2B84B','#FB7185','#7DD3FC','#F9A8D4','#FDBA74','#C4B5FD','#93C5FD'] },
  aurora:{ name:'Aurora',
    dark:{ bg:'#08101C', bgElev:'#101A2C', primary:'#7DD3FC', primary2:'#BAE6FD', accent2:'#C084FC', ...DARK_SEM, onAccent:'#06121F' },
    light:{ bg:'#F3F8FD', bgElev:'#FFFFFF', primary:'#0284C7', primary2:'#0369A1', accent2:'#9333EA', ...LIGHT_SEM },
    cats:['#7DD3FC','#F2B84B','#FF8A95','#C4B5FD','#A5B4FC','#FFB38A','#F0ABFC','#93C5FD'] }
};

export const TOKEN_MAP = { bg:'--bg', bgElev:'--bg-elev', primary:'--primary', primary2:'--primary-2', accent2:'--accent-2', gold:'--gold', gold2:'--gold-2', rose:'--rose', warn:'--warn', onAccent:'--on-accent' };

export function paletteVars(key, theme){
  const p = PALETTES[key] || PALETTES.sapphire;
  return { ...p[theme] };
}

export function swatchStyle(key, theme){
  const v = paletteVars(key, theme);
  return `background:radial-gradient(circle, ${v.bg} 0 27%, transparent 28%), conic-gradient(from 200deg, ${v.primary} 0 38%, ${v.accent2} 38% 62%, ${v.gold} 62% 81%, ${v.rose} 81% 100%)`;
}
