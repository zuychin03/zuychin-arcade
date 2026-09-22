import { Platform } from 'react-native';

// Hex values mirrored from tailwind.config.js for use in style props
// (headers, navigators and animated styles can't take className).
export const ARCADE = {
  bg: '#0B0716',
  surface: '#161028',
  panel: '#1F1838',
  border: '#2E2452',
  pink: '#FF2E88',
  red: '#FF3355',
  purple: '#A855F7',
  violet: '#7C3AED',
  blue: '#4F8EF7',
  cyan: '#2EE6FF',
  muted: '#8E86B3',
  text: '#EDEAFB',
  surfaceTranslucent: 'rgba(22, 16, 40, 0.7)',
  panelTranslucent: 'rgba(31, 24, 56, 0.7)',
} as const;

export const MINE = {
  bg: '#130E1F',
  surface: '#241B36',
  gold: '#F5C518',
  stone: '#6B7280',
  danger: '#FF3355',
  tunnel: '#92400E',
} as const;

/** Coup in-game palette - a royal court of crimson, gold and deep purple. */
export const COUP = {
  bg: '#140A12',        // dark wine
  surface: '#241221',   // panel
  panel: '#311828',     // raised panel
  border: '#4A2238',    // subtle borders
  crimson: '#EF5775',   // coup red, AA on raised panels
  gold: '#F4C04E',      // coin gold
  purple: '#B365FF',    // royal purple, AA on raised panels
  blue: '#4F8EF7',      // duke blue accent
  green: '#34D399',     // confirm / allow
  muted: '#B79AAE',     // muted rose text
  text: '#F6E9F0',      // near-white
} as const;

/** King of Tokyo palette: electric city lights and monster energy. */
export const TOKYO = {
  bg: '#07130F',
  surface: '#10251D',
  panel: '#173328',
  border: '#43886C',
  lime: '#8BFF52',
  cyan: '#2EE6FF',
  energy: '#F4C04E',
  danger: '#FF5F6C',
  muted: '#91B5A8',
  text: '#EFFDF7',
} as const;

/** Skull King palette: moonlit black water, spectral white and treasure gold. */
export const SKULL_KING = {
  bg: '#080B12',
  surface: '#111722',
  panel: '#1A2230',
  border: '#3A4659',
  // Kept as `teal` for API compatibility; this is now the game's white primary.
  teal: '#F7FAFF',
  cyan: '#A9D8FF',
  gold: '#F4C04E',
  coral: '#FF6577',
  purple: '#BCA8FF',
  muted: '#9DA9B8',
  text: '#FFFFFF',
} as const;

/** Citadels palette: midnight stone, royal blue and illuminated gold. */
export const CITADELS = {
  bg: '#090D1A',
  surface: '#11182B',
  panel: '#19233B',
  border: '#2B3D63',
  royal: '#7395FF',
  gold: '#F4C04E',
  crimson: '#FF6577',
  emerald: '#43D6A0',
  violet: '#BA8CFF',
  muted: '#93A2C2',
  text: '#F2F5FF',
} as const;

/** Not Alone palette: ultraviolet Artemia, rescue signal purple and predatory rose. */
export const NOT_ALONE = {
  bg: '#0D0818',
  surface: '#17102A',
  panel: '#24163B',
  border: '#4A3470',
  signal: '#B57BFF',
  creature: '#FF6685',
  amber: '#F6C85F',
  safe: '#53D6A5',
  violet: '#8B5CF6',
  muted: '#A798BF',
  text: '#F8F3FF',
} as const;

/** BANG! palette: moonlit frontier, brass, dust and danger red. */
export const BANG = { bg:'#120A08',surface:'#24130E',panel:'#321C14',border:'#6B3825',gold:'#F6C453',red:'#FF5D55',sand:'#E8C99B',safe:'#5ED6A0',muted:'#B99276',text:'#FFF6E8' } as const;
/** Libertalia palette: Galecrest sky, violet sails and treasure gold. */
export const LIBERTALIA = { bg:'#080C1C',surface:'#111A35',panel:'#1A2850',border:'#344D7A',sky:'#6DE1FF',violet:'#B18CFF',gold:'#F5C85B',coral:'#FF718B',muted:'#94A9CC',text:'#F2F7FF' } as const;
/** Colt Express palette: midnight rail steel, ember orange and signal cyan. */
export const COLT = { bg:'#0C0D12',surface:'#171A24',panel:'#232837',border:'#424B61',ember:'#FF8A48',gold:'#F4C458',cyan:'#62D6E8',red:'#FF5E68',muted:'#9CA6B8',text:'#F8F6EE' } as const;

export const COUP_CHARACTER_COLOR: Record<string, string> = {
  duke: COUP.purple,
  assassin: '#F97316',
  captain: '#4F8EF7',
  ambassador: '#34D399',
  contessa: COUP.crimson,
  inquisitor: '#F4C04E',
};

/**
 * Full-screen centered overlay backdrop. Explicit style (not className)
 * because NativeWind classNames are unreliable on reanimated Animated views.
 */
export const OVERLAY_FILL = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0, 0, 0, 0.95)',
} as const;

/** Neon glow for text - pass into a <Text style={...}> */
export function neonText(color: string, radius = 12) {
  if (Platform.OS === 'web') {
    return { color, textShadow: `0px 0px ${radius}px ${color}` };
  }
  return { color, textShadowColor: color, textShadowRadius: radius, textShadowOffset: { width: 0, height: 0 } };
}

/** Neon glow for boxes (RN 0.76+ / web boxShadow) */
export function neonBox(color: string, radius = 10) {
  return { boxShadow: `0 0 ${radius}px ${color}` } as const;
}
