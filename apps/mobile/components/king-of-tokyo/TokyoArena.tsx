import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Defs, LinearGradient, Line, Path, Rect, Stop } from 'react-native-svg';
import type { KingOfTokyoPublicPlayer } from '@zuychin-arcade/types';
import { TOKYO } from '../../constants/theme';
import { MonsterAvatar } from './MonsterAvatar';

interface Props {
  players: KingOfTokyoPublicPlayer[];
  currentPlayerId: string | null;
  capacity: number;
  compact?: boolean;
}

function ZoneOccupant({ player, profileIndex, label, active }: { player?: KingOfTokyoPublicPlayer; profileIndex?: number; label: string; active: boolean }) {
  return (
    <View style={{ flexBasis: 110, flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: '100%', alignItems: 'center', gap: 7, padding: 9, borderRadius: 14, backgroundColor: '#07130FD9', borderTopWidth: 1, borderTopColor: '#000000', borderBottomWidth: 1, borderBottomColor: `${TOKYO.cyan}66` }}>
      <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: TOKYO.cyan, fontSize: 13, textAlign: 'center' }}>{label}</Text>
      {player ? (
        <>
          <View style={{ width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: active ? TOKYO.lime : TOKYO.border, backgroundColor: TOKYO.surface, boxShadow: '0 3px 5px rgba(0,0,0,0.4)' }}>
            <MonsterAvatar seed={player.playerId} profileIndex={profileIndex} size={54} active={false} eliminated={player.eliminated} />
          </View>
          <Text style={{ fontFamily: 'Outfit_700Bold', color: TOKYO.text, fontSize: 14, lineHeight: 20, maxWidth: '100%', textAlign: 'center' }}>{player.displayName}</Text>
          {active ? <Text style={{ fontFamily: 'Outfit_700Bold', color: TOKYO.lime, fontSize: 12, lineHeight: 17, textAlign: 'center' }}>CURRENT TURN</Text> : null}
        </>
      ) : (
        <>
          <View style={{ width: 66, height: 66, borderRadius: 33, borderWidth: 1.5, borderStyle: 'dashed', borderColor: `${TOKYO.cyan}66`, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="map-marker-outline" size={26} color={TOKYO.cyan} /></View>
          <Text style={{ fontFamily: 'Outfit_400Regular', fontSize: 14, color: TOKYO.muted, textAlign: 'center' }}>Empty</Text>
        </>
      )}
    </View>
  );
}

export function TokyoArena({ players, currentPlayerId, capacity, compact = false }: Props) {
  const [backdropFailed, setBackdropFailed] = useState(false);
  const city = players.find((player) => player.tokyoZone === 'tokyo_city');
  const bay = players.find((player) => player.tokyoZone === 'tokyo_bay');
  const cityProfileIndex = city ? players.findIndex((player) => player.playerId === city.playerId) : undefined;
  const bayProfileIndex = bay ? players.findIndex((player) => player.playerId === bay.playerId) : undefined;
  const currentIsInside = currentPlayerId === city?.playerId || currentPlayerId === bay?.playerId;

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`Tokyo arena, capacity ${capacity}. City occupied by ${city?.displayName ?? 'nobody'}${capacity > 1 ? `, Bay occupied by ${bay?.displayName ?? 'nobody'}` : ', Bay closed'}`}
      style={[
        {
          minHeight: compact ? 220 : 250,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: TOKYO.border,
          backgroundColor: TOKYO.panel,
          overflow: 'hidden',
          paddingBottom: 12,
          gap: 14,
        },
      ]}
    >
      <Svg accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" width="100%" height="100%" viewBox="0 0 420 222" preserveAspectRatio="none" style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id="arena-sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#143B32" />
            <Stop offset="1" stopColor="#07130F" />
          </LinearGradient>
          <LinearGradient id="arena-water" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#092822" />
            <Stop offset="0.5" stopColor="#0A3B3E" />
            <Stop offset="1" stopColor="#092822" />
          </LinearGradient>
        </Defs>
        <Rect width="420" height="222" fill="url(#arena-sky)" />
        <Circle cx="345" cy="38" r="21" fill={TOKYO.cyan} opacity="0.09" />
        <Circle cx="345" cy="38" r="15" fill="none" stroke={TOKYO.cyan} strokeOpacity="0.4" strokeWidth="2" />
        <Path d="M0 125 H420 V222 H0 Z" fill="url(#arena-water)" />
        <Path d="M0 141 C65 128 121 149 184 137 C255 123 328 153 420 134" fill="none" stroke={TOKYO.cyan} strokeOpacity="0.26" strokeWidth="2" />
        <Path d="M12 126 V93 H36 V108 H49 V71 H71 V126 M80 126 V102 H99 V84 H116 V126 M125 126 V92 H143 V61 H164 V126 M261 126 V89 H282 V73 H300 V126 M308 126 V67 H333 V97 H350 V126 M357 126 V84 H382 V105 H407 V126" fill="#0A1C17" stroke={TOKYO.cyan} strokeOpacity="0.54" strokeWidth="2" strokeLinejoin="round" />
        <Path d="M210 15 V207" stroke={TOKYO.cyan} strokeOpacity="0.2" strokeWidth="2" strokeDasharray="5 7" />
        <Line x1="24" y1="200" x2="190" y2="200" stroke={TOKYO.lime} strokeOpacity="0.45" strokeWidth="2" />
        <Line x1="230" y1="200" x2="396" y2="200" stroke={TOKYO.cyan} strokeOpacity="0.45" strokeWidth="2" />
      </Svg>
      {!backdropFailed && <View pointerEvents="none" style={{ position: 'absolute', width: '100%', height: '100%' }}><Image
        testID="tokyo-arena-backdrop"
        source={require('../../assets/game-art/tokyo-arena-backdrop.webp')}
        resizeMode="contain"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onError={() => setBackdropFailed(true)}
        style={{ width: '100%', height: '100%', opacity: 0.55 }}
      /></View>}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <MaterialCommunityIcons name="city-variant" size={17} color={TOKYO.lime} />
          <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: TOKYO.lime, fontSize: 13, letterSpacing: 2 }}>TOKYO</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, backgroundColor: '#07130FCC', paddingHorizontal: 8, paddingVertical: 4 }}>
          <MaterialCommunityIcons name="account-multiple-outline" size={12} color={TOKYO.muted} />
          <Text style={{ fontFamily: 'SpaceMono_700Bold', color: TOKYO.muted, fontSize: 11 }}>{capacity} SLOT{capacity === 1 ? '' : 'S'}</Text>
        </View>
      </View>

      <View style={{ flexGrow: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'stretch', paddingHorizontal: 10 }}>
        <ZoneOccupant player={city} profileIndex={cityProfileIndex} label="CITY" active={city?.playerId === currentPlayerId} />
        {capacity > 1 ? (
          <ZoneOccupant player={bay} profileIndex={bayProfileIndex} label="BAY" active={bay?.playerId === currentPlayerId} />
        ) : (
          <View style={{ flexBasis: 110, flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: '100%', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 9 }}>
            <View style={{ width: 66, height: 46, borderRadius: 10, borderWidth: 1, borderColor: TOKYO.border, backgroundColor: TOKYO.bg, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="lock-outline" size={24} color={TOKYO.muted} /></View>
            <Text style={{ fontFamily: 'Outfit_700Bold', color: TOKYO.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>BAY CLOSED</Text>
            <Text style={{ fontFamily: 'Outfit_400Regular', color: TOKYO.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>Opens with 5–6 monsters</Text>
          </View>
        )}
      </View>

      <View style={{ pointerEvents: 'none', position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: currentIsInside ? TOKYO.lime : `${TOKYO.cyan}66` }} />
    </View>
  );
}
