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

/** Coup in-game palette — a royal court of crimson, gold and deep purple. */
export const COUP = {
  bg: '#140A12',        // dark wine
  surface: '#241221',   // panel
  panel: '#311828',     // raised panel
  border: '#4A2238',    // subtle borders
  crimson: '#E23A5E',   // coup red
  gold: '#F4C04E',      // coin gold
  purple: '#A855F7',    // royal purple
  blue: '#4F8EF7',      // duke blue accent
  green: '#34D399',     // confirm / allow
  muted: '#B79AAE',     // muted rose text
  text: '#F6E9F0',      // near-white
} as const;

/** Per-character accent colors for influence cards. */
export const COUP_CHARACTER_COLOR: Record<string, string> = {
  duke: '#A855F7',
  assassin: '#C2410C',
  captain: '#4F8EF7',
  ambassador: '#34D399',
  contessa: '#E23A5E',
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

import { Platform } from 'react-native';

/** Neon glow for text — pass into a <Text style={...}> */
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
