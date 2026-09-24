import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CartographersObjective, CartographersTerrain } from '@zuychin-arcade/types';
import { CardSurface } from '../ui/CardSurface';
import { CARTOGRAPHERS as C } from './palette';
import { TERRAIN } from './MapBoard';
import { OBJECTIVE_GUIDES } from './objectives';

const symbols: Record<string, CartographersTerrain> = { F: 'forest', A: 'farm', W: 'water', V: 'village', M: 'mountain' };
export function ObjectiveCard({ objective, edict, active = false }: { objective: CartographersObjective; edict?: string; active?: boolean }) {
  const guide = OBJECTIVE_GUIDES[objective.id]!;
  return <CardSurface fill selected={active} faceColor={C.panel} edgeColor={C.bg} highlightColor={`${C.accent}88`} radius={12}>
    <View style={{ padding: 16, gap: 12 }}>
      <Text accessibilityRole="header" style={{ color: C.accent, fontFamily: 'Outfit_700Bold', fontSize: 20 }}>{edict ? `${edict} · ` : ''}{objective.name}</Text>
      <View accessible accessibilityLabel="Pattern guide, not a scored map" style={{ width: 120, alignSelf: 'center' }}>
        {guide.pattern.map((row, y) => <View key={y} style={{ flexDirection: 'row' }}>{[...row].map((symbol, x) => <View key={x} style={{ width: 24, height: 24, backgroundColor: symbols[symbol] ? TERRAIN[symbols[symbol]!].colour : C.parchment, borderWidth: 0.5, borderColor: '#9B8C72', alignItems: 'center', justifyContent: 'center' }}>
          {symbols[symbol] ? <MaterialCommunityIcons name={TERRAIN[symbols[symbol]!].icon} size={17} color={C.ink} /> : null}
        </View>)}</View>)}
      </View>
      <Text style={{ color: C.muted, fontFamily: 'Outfit_400Regular', fontSize: 12 }}>Pattern guide, not a scored map</Text>
      <Text style={{ color: C.text, fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24 }}>{guide.rule}</Text>
      <Text style={{ color: C.muted, fontFamily: 'SpaceMono_400Regular', fontSize: 13 }}>Solo modifier: −{objective.soloModifier}{active ? ' · Scores this season' : ''}</Text>
    </View>
  </CardSurface>;
}
