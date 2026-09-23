import { useState } from 'react';
import { Image, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Line, Path, Polygon, Rect, Stop } from 'react-native-svg';
import { TOKYO, neonBox } from '../../constants/theme';

const MONSTER_PROFILES = [
  { name: 'Voltclaw', accent: '#8BFF52', secondary: '#2EE6FF' },
  { name: 'Emberback', accent: '#FFB84D', secondary: '#FF5A67' },
  { name: 'Prism Moth', accent: '#D78BFF', secondary: '#2EE6FF' },
  { name: 'Abyssal', accent: '#2EE6FF', secondary: '#4F8EF7' },
  { name: 'Scrap Sentinel', accent: '#F4C04E', secondary: '#8BFF52' },
  { name: 'Riftfang', accent: '#FF5A67', secondary: '#D78BFF' },
] as const;

const MONSTER_PORTRAITS = [
  require('../../assets/game-art/tokyo-monster-voltclaw.webp'),
  require('../../assets/game-art/tokyo-monster-emberback.webp'),
  require('../../assets/game-art/tokyo-monster-prism-moth.webp'),
  require('../../assets/game-art/tokyo-monster-abyssal.webp'),
  require('../../assets/game-art/tokyo-monster-scrap-sentinel.webp'),
  require('../../assets/game-art/tokyo-monster-riftfang.webp'),
] as const;

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function profileIndex(seed: string, assignedIndex?: number): number {
  if (assignedIndex === undefined) return hashSeed(seed) % MONSTER_PROFILES.length;
  return ((assignedIndex % MONSTER_PROFILES.length) + MONSTER_PROFILES.length) % MONSTER_PROFILES.length;
}

export function monsterProfile(seed: string, assignedIndex?: number) {
  return MONSTER_PROFILES[profileIndex(seed, assignedIndex)];
}

interface Props {
  seed: string;
  size?: number;
  active?: boolean;
  eliminated?: boolean;
  profileIndex?: number;
}

export function MonsterAvatar({ seed, size = 54, active = false, eliminated = false, profileIndex: assignedIndex }: Props) {
  const variant = profileIndex(seed, assignedIndex);
  const [failedPortraits, setFailedPortraits] = useState<ReadonlySet<number>>(() => new Set());
  const profile = MONSTER_PROFILES[variant];
  const gradientId = `monster-${variant}`;
  const glow = active ? profile.accent : TOKYO.border;

  return (
    <View
      pointerEvents="none"
      accessibilityLabel={`${profile.name} monster emblem${eliminated ? ', eliminated' : ''}`}
      style={[
        { width: size, height: size, borderRadius: size / 2 },
        active ? neonBox(`${profile.accent}88`, Math.max(8, size * 0.2)) : null,
      ]}
    >
      <Svg accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={profile.accent} stopOpacity="0.34" />
            <Stop offset="1" stopColor="#07130F" stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Circle cx="50" cy="50" r="47" fill={`url(#${gradientId})`} stroke={glow} strokeWidth={active ? 4 : 2.5} />
        <Circle cx="50" cy="50" r="40" fill="none" stroke={profile.secondary} strokeOpacity="0.24" strokeWidth="1.5" strokeDasharray="4 5" />

        {variant === 0 && (
          <G>
            <Path d="M24 75 C21 57 26 36 39 28 L35 13 L48 26 L61 13 L60 30 C75 39 79 57 74 75 Z" fill="#112B20" stroke={profile.accent} strokeWidth="3" strokeLinejoin="round" />
            <Path d="M31 46 L42 40 L45 48 L31 51 Z M69 46 L58 40 L55 48 L69 51 Z" fill={profile.secondary} />
            <Path d="M39 62 Q50 70 61 62 L57 74 L50 68 L43 74 Z" fill={profile.accent} />
            <Path d="M24 71 L14 78 L30 80 M76 71 L86 78 L70 80" fill="none" stroke={profile.accent} strokeWidth="3" strokeLinecap="round" />
          </G>
        )}
        {variant === 1 && (
          <G>
            <Circle cx="25" cy="43" r="12" fill="#26180D" stroke={profile.accent} strokeWidth="3" />
            <Circle cx="75" cy="43" r="12" fill="#26180D" stroke={profile.accent} strokeWidth="3" />
            <Path d="M28 75 C20 56 26 27 50 23 C74 27 80 56 72 75 Z" fill="#271B13" stroke={profile.accent} strokeWidth="3" />
            <Path d="M34 39 L45 36 L43 45 L33 47 Z M66 39 L55 36 L57 45 L67 47 Z" fill={profile.secondary} />
            <Path d="M35 55 Q50 47 65 55 L62 70 Q50 77 38 70 Z" fill="#0B1712" stroke={profile.secondary} strokeWidth="2" />
            <Rect x="43" y="58" width="5" height="7" rx="1" fill={profile.accent} />
            <Rect x="52" y="58" width="5" height="7" rx="1" fill={profile.accent} />
          </G>
        )}
        {variant === 2 && (
          <G>
            <Path d="M49 28 C33 8 12 22 19 49 C25 65 38 61 49 50 Z" fill="#20102B" stroke={profile.accent} strokeWidth="3" />
            <Path d="M51 28 C67 8 88 22 81 49 C75 65 62 61 51 50 Z" fill="#20102B" stroke={profile.accent} strokeWidth="3" />
            <Path d="M50 27 C38 37 38 65 50 78 C62 65 62 37 50 27 Z" fill="#10221D" stroke={profile.secondary} strokeWidth="3" />
            <Circle cx="45" cy="45" r="3" fill={profile.accent} />
            <Circle cx="55" cy="45" r="3" fill={profile.accent} />
            <Line x1="45" y1="29" x2="37" y2="15" stroke={profile.secondary} strokeWidth="2.5" strokeLinecap="round" />
            <Line x1="55" y1="29" x2="63" y2="15" stroke={profile.secondary} strokeWidth="2.5" strokeLinecap="round" />
            <Circle cx="36" cy="14" r="3" fill={profile.accent} />
            <Circle cx="64" cy="14" r="3" fill={profile.accent} />
            <Path d="M24 35 L40 42 M76 35 L60 42 M27 50 L42 48 M73 50 L58 48" stroke={profile.secondary} strokeOpacity="0.55" strokeWidth="2" />
          </G>
        )}
        {variant === 3 && (
          <G>
            <Path d="M32 32 C24 15 11 26 22 41 M68 32 C76 15 89 26 78 41" fill="none" stroke={profile.accent} strokeWidth="5" strokeLinecap="round" />
            <Path d="M24 72 C22 51 29 29 50 27 C71 29 78 51 76 72 L63 65 L56 78 L50 67 L44 78 L37 65 Z" fill="#0B2030" stroke={profile.accent} strokeWidth="3" strokeLinejoin="round" />
            <Ellipse cx="38" cy="48" rx="7" ry="9" fill={profile.secondary} />
            <Ellipse cx="62" cy="48" rx="7" ry="9" fill={profile.secondary} />
            <Circle cx="40" cy="47" r="2.5" fill="#EFFFFF" />
            <Circle cx="60" cy="47" r="2.5" fill="#EFFFFF" />
            <Path d="M42 60 Q50 66 58 60" fill="none" stroke={profile.accent} strokeWidth="2.5" strokeLinecap="round" />
          </G>
        )}
        {variant === 4 && (
          <G>
            <Path d="M22 37 L34 25 L66 25 L78 37 L73 73 L60 80 L40 80 L27 73 Z" fill="#25230F" stroke={profile.accent} strokeWidth="3" strokeLinejoin="round" />
            <Rect x="31" y="37" width="16" height="13" rx="2" fill="#0B1712" stroke={profile.secondary} strokeWidth="2" />
            <Rect x="53" y="37" width="16" height="13" rx="2" fill="#0B1712" stroke={profile.secondary} strokeWidth="2" />
            <Circle cx="40" cy="43.5" r="3" fill={profile.accent} />
            <Circle cx="60" cy="43.5" r="3" fill={profile.accent} />
            <Path d="M36 61 H64 L58 70 H42 Z" fill="#0B1712" stroke={profile.secondary} strokeWidth="2" />
            <Line x1="50" y1="25" x2="50" y2="14" stroke={profile.accent} strokeWidth="3" />
            <Circle cx="50" cy="11" r="4" fill={profile.secondary} />
            <Path d="M24 46 L13 40 L21 57 M76 46 L87 40 L79 57" fill="none" stroke={profile.accent} strokeWidth="3" strokeLinejoin="round" />
          </G>
        )}
        {variant === 5 && (
          <G>
            <Polygon points="18,42 31,34 29,17 43,30 50,15 57,30 71,17 69,34 82,42 74,73 50,82 26,73" fill="#2A101B" stroke={profile.accent} strokeWidth="3" strokeLinejoin="round" />
            <Path d="M28 45 L44 39 L42 51 L28 54 Z M72 45 L56 39 L58 51 L72 54 Z" fill={profile.secondary} />
            <Path d="M37 64 L44 59 L50 64 L56 59 L63 64 L58 73 L42 73 Z" fill="#09080D" stroke={profile.accent} strokeWidth="2" />
            <Path d="M20 59 L9 65 L24 68 M80 59 L91 65 L76 68" fill="none" stroke={profile.secondary} strokeWidth="3" strokeLinecap="round" />
          </G>
        )}

        <Path d="M13 83 H87" stroke={profile.secondary} strokeOpacity="0.5" strokeWidth="2" />
        <Path d="M17 83 V76 H23 V81 H29 V73 H34 V83 M66 83 V75 H72 V79 H78 V70 H84 V83" fill="none" stroke={profile.secondary} strokeOpacity="0.55" strokeWidth="2" />
      </Svg>
      {!failedPortraits.has(variant) && <Image
        key={variant}
        source={MONSTER_PORTRAITS[variant]}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        resizeMode="contain"
        onError={() => setFailedPortraits(previous => new Set(previous).add(variant))}
        style={{ position: 'absolute', top: size * 0.06, left: size * 0.06, width: size * 0.88, height: size * 0.88, borderRadius: size / 2 }}
      />}
      <Svg accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
        <Circle cx="50" cy="50" r="47" fill="none" stroke={glow} strokeWidth={active ? 4 : 2.5} />
        {eliminated && (
          <G>
            <Circle cx="50" cy="50" r="46" fill="#07130F" opacity="0.72" />
            <Line x1="28" y1="28" x2="72" y2="72" stroke={TOKYO.danger} strokeWidth="8" strokeLinecap="round" />
            <Line x1="72" y1="28" x2="28" y2="72" stroke={TOKYO.danger} strokeWidth="8" strokeLinecap="round" />
          </G>
        )}
      </Svg>
    </View>
  );
}
