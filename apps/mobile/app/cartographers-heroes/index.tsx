import { useState } from 'react';
import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CartographersMapSide } from '@zuychin-arcade/types';
import { RemainingLanding } from '../../components/remaining/RemainingLanding';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { GameCover } from '../../components/ui/GameCover';
import { CartographersReferenceSheet } from '../../components/cartographers/ReferenceSheet';
import { MapBoard } from '../../components/cartographers/MapBoard';
import { emptyChart } from '../../components/cartographers/geometry';
import { CARTOGRAPHERS as C } from '../../components/cartographers/palette';
import { TYPOGRAPHY } from '../../constants/typography';

export default function CartographersLanding() {
  const [side, setSide] = useState<CartographersMapSide>('C');
  return <RemainingLanding gameId="cartographers_heroes" base="/cartographers-heroes" title="CARTOGRAPHERS HEROES" presentation="illustrated"
    tagline="Chart a frontier across four seasons. Shape the land, face ambushes and let your heroes defend the map."
    tags={['1–100 PLAYERS', 'DRAW TOGETHER', 'FOUR SEASONS']} createLabel="OPEN A CHARTING TABLE" palette={C}
    mark={<MaterialCommunityIcons name="map-outline" size={64} color={C.accent} />}
    hero={<GameCover source={require('../../assets/game-art/cartographers-heroes-hero.webp')} rimColor={C.accent} backgroundColor={C.bg} />}
    createConfig={{ cartographersMapSide: side }} renderCreateOptions={busy => <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ ...TYPOGRAPHY.heading, color: C.text }}>Choose the shared map</Text>
      {(['C', 'D'] as const).map(value => <ScalePressable key={value} disabled={busy} onPress={() => setSide(value)} accessibilityLabel={`Map ${value}`} accessibilityState={{ selected: side === value }}
        style={{ minHeight: 48, padding: 12, borderRadius: 12, backgroundColor: side === value ? C.accent : C.panel }}>
        <Text style={{ ...TYPOGRAPHY.control, color: side === value ? C.ink : C.text }}>Map {value} · {value === 'C' ? 'Open frontier' : 'Wasteland obstacles'}</Text>
      </ScalePressable>)}
      <MapBoard map={emptyChart(side)} side={side} label={`Map ${side} starting chart`} />
    </View>} renderRules={(visible, onClose) => <CartographersReferenceSheet visible={visible} onClose={onClose} />} />;
}
