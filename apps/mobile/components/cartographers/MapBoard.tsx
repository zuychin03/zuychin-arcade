import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CARTOGRAPHERS_MAPS } from '@zuychin-arcade/types';
import type { CartographersMapSide, CartographersMapView, CartographersPoint, CartographersTerrain } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { CARTOGRAPHERS as C } from './palette';
import { cellIndex, insideMap } from './geometry';

export const TERRAIN: Record<CartographersTerrain, { colour: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string }> = {
  forest: { colour: '#427958', icon: 'pine-tree', label: 'Forest' }, village: { colour: '#BA755D', icon: 'home-variant', label: 'Village' },
  farm: { colour: '#D4AF56', icon: 'barley', label: 'Farm' }, water: { colour: '#5B95AB', icon: 'waves', label: 'Water' },
  monster: { colour: '#A66899', icon: 'skull-outline', label: 'Monster' }, hero: { colour: '#E7D998', icon: 'sword-cross', label: 'Hero' },
  mountain: { colour: '#8A8D7C', icon: 'terrain', label: 'Mountain' },
};

export function ShapeDiagram({ cells, attack = [], terrain = 'forest', size = 22 }: { cells: readonly CartographersPoint[]; attack?: readonly CartographersPoint[]; terrain?: CartographersTerrain; size?: number }) {
  const all = [...cells, ...attack];
  const minX = Math.min(0, ...all.map(p => p.x)), minY = Math.min(0, ...all.map(p => p.y));
  const width = Math.max(0, ...all.map(p => p.x)) - minX + 1, height = Math.max(0, ...all.map(p => p.y)) - minY + 1;
  return <View accessible accessibilityLabel={`${cells.length} filled cells${attack.length ? ` and ${attack.length} attack cells` : ''}`} style={{ width: width * size, height: height * size }}>
    {all.map((p, i) => <View key={`${i}:${p.x}:${p.y}`} style={{ position: 'absolute', left: (p.x - minX) * size + 1, top: (p.y - minY) * size + 1, width: size - 2, height: size - 2,
      backgroundColor: i < cells.length ? TERRAIN[terrain].colour : C.panel, borderWidth: i < cells.length ? 0 : 2, borderColor: C.secondary, borderRadius: 3,
      boxShadow: i < cells.length ? 'inset 1px 1px 0 rgba(255,255,255,0.35), inset -1px -2px 0 rgba(0,0,0,0.35)' : undefined }} />)}
  </View>;
}

interface Props {
  map: CartographersMapView; side: CartographersMapSide; label: string;
  interactive?: boolean; disabled?: boolean; onCell?: (position: CartographersPoint) => void;
  preview?: readonly CartographersPoint[]; previewTerrain?: CartographersTerrain; valid?: boolean;
  attack?: readonly number[]; targets?: readonly number[]; selectedTarget?: number | null;
}
export function MapBoard({ map, side, label, interactive = false, disabled = false, onCell, preview = [], previewTerrain = 'forest', valid = true, attack = [], targets = [], selectedTarget }: Props) {
  const [width, setWidth] = useState(280);
  const cellSize = interactive ? Math.max(48, Math.min(56, (width - 24) / 11)) : Math.max(12, Math.min(48, (width - 24) / 11));
  const marked = new Set(preview.filter(insideMap).map(cellIndex));
  const aura = new Set([...map.attackCells, ...attack]); const choices = new Set(targets);
  const ruins = new Set(CARTOGRAPHERS_MAPS[side].ruins.map(cellIndex));
  const board = <View style={{ width: cellSize * 11 + 24, padding: 12, backgroundColor: C.parchment, borderRadius: 12,
    boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.3), 0 6px 14px rgba(0,0,0,0.35)' }}>
    {Array.from({ length: 11 }, (_, y) => <View key={y} style={{ flexDirection: 'row' }}>
      {Array.from({ length: 11 }, (_, x) => {
        const i = y * 11 + x; const cell = map.cells[i]!; const drawing = marked.has(i);
        const terrain = drawing ? previewTerrain : cell.terrain;
        const selected = selectedTarget === i;
        const colour = drawing && !valid ? '#B85445' : terrain ? TERRAIN[terrain].colour : cell.destroyed ? '#665E55' : cell.wasteland ? '#9B8C72' : '#EDE2C9';
        const icon = cell.destroyed && !drawing ? 'close' : cell.wasteland && !drawing ? 'texture' : terrain ? TERRAIN[terrain].icon : ruins.has(i) ? 'pillar' : null;
        const name = `Column ${x + 1}, row ${y + 1}: ${cell.destroyed ? 'destroyed' : cell.wasteland ? 'wasteland' : cell.terrain ? TERRAIN[cell.terrain].label : 'empty'}${aura.has(i) ? ', hero protection' : ''}${choices.has(i) ? ', destruction choice' : ''}${drawing ? ', placement preview' : ''}`;
        const style = { width: cellSize, height: cellSize, backgroundColor: colour, borderWidth: selected || drawing || choices.has(i) ? 2 : 0.5,
          borderColor: selected ? C.danger : drawing ? valid ? C.ink : '#591B16' : choices.has(i) ? '#793245' : '#AB9A77', alignItems: 'center' as const, justifyContent: 'center' as const };
        const content = <>{icon ? <MaterialCommunityIcons name={icon} size={Math.max(10, cellSize * 0.57)} color={cell.destroyed ? C.text : C.ink} /> : null}
          {aura.has(i) ? <View pointerEvents="none" style={{ position: 'absolute', inset: 3, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#175F5A', borderRadius: 3 }} /> : null}
          {selected ? <MaterialCommunityIcons name="target" size={cellSize * 0.65} color="#702B26" style={{ position: 'absolute' }} /> : null}</>;
        return interactive ? <ScalePressable key={x} disabled={disabled} accessibilityLabel={name} accessibilityState={{ selected: selected || drawing }} scaleTo={0.98}
          onPress={() => onCell?.({ x, y })} style={style}>{content}</ScalePressable> : <View key={x} accessible accessibilityLabel={name} style={style}>{content}</View>;
      })}
    </View>)}
  </View>;
  return <View style={{ gap: 8, minWidth: 0 }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_700Bold', fontSize: 18, color: C.text }}>{label} · Map {side}</Text>
    {interactive ? <Text style={{ color: C.muted, fontFamily: 'Outfit_400Regular', fontSize: 14, lineHeight: 20 }}>Tap a square to position the shape. Slide the map sideways to reach every column.</Text> : null}
    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator contentContainerStyle={{ paddingBottom: 12 }} style={{ minWidth: 0 }}>{board}</ScrollView>
  </View>;
}
