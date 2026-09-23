import { useRef, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { COLT_CHARACTERS, type ColtCharacter, type ColtLootType, type ColtPublicLoot, type ColtPublicState } from '@zuychin-arcade/types';
import { NeonButton } from '../ui/NeonButton';
import { COLT as C } from '../../constants/theme';
import { coltCarName } from './decision';
import { TrainArtwork } from './TrainArtwork';
import { useIntrinsicCardHeight } from '../../hooks/useIntrinsicCardHeight';

const decoration = { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const, pointerEvents: 'none' as const };
const pieceColours: Record<ColtCharacter, string> = { ghost: C.text, doc: C.cyan, tuco: C.gold, django: C.ember, cheyenne: C.red, belle: '#C9AFE8' };
const text = { fontFamily: 'Outfit_400Regular', color: C.text, fontSize: 15, lineHeight: 22 } as const;

export function BanditPiece({ character, marshal = false }: { character?: ColtCharacter; marshal?: boolean }) {
  const colour = marshal ? C.gold : (character ? pieceColours[character] : null) ?? C.text;
  return <View {...decoration} style={{ width: 36, height: 48, flexShrink: 0, alignItems: 'center', justifyContent: 'flex-end' }}>
    <View style={{ position: 'absolute', bottom: 0, width: 34, height: 9, borderRadius: 18, backgroundColor: '#090B10', boxShadow: '0 3px 5px rgba(0,0,0,0.4)' }} />
    <View style={{ width: 14, height: 10, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: colour, borderTopWidth: 2, borderTopColor: 'rgba(255,255,255,0.45)' }} />
    <View style={{ width: 30, height: 4, borderRadius: 2, backgroundColor: colour }} />
    <View style={{ width: 12, height: 9, backgroundColor: colour }} />
    <View style={{ width: 24, height: 18, borderTopLeftRadius: 7, borderTopRightRadius: 7, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, backgroundColor: colour, borderRightWidth: 4, borderRightColor: 'rgba(0,0,0,0.24)' }} />
    {marshal ? <View style={{ position: 'absolute', bottom: 12, width: 7, height: 7, backgroundColor: C.bg, transform: [{ rotate: '45deg' }] }} /> : null}
    <View style={{ width: 28, height: 5, borderRadius: 3, backgroundColor: colour, borderBottomWidth: 2, borderBottomColor: 'rgba(0,0,0,0.35)' }} />
  </View>;
}

function LootPiece({ kind }: { kind: ColtLootType }) {
  return <View {...decoration} style={{ width: 32, height: 32, flexShrink: 0, justifyContent: 'center', alignItems: 'center' }}>
    {kind === 'jewel' ? <View style={{ width: 19, height: 19, backgroundColor: C.cyan, borderTopWidth: 5, borderLeftWidth: 5, borderColor: '#B7EFF5', borderRightWidth: 3, borderRightColor: '#328A9B', transform: [{ rotate: '45deg' }], boxShadow: '2px 2px 3px rgba(0,0,0,0.4)' }} /> : kind === 'strongbox' ? <View style={{ width: 29, height: 22, borderRadius: 3, backgroundColor: C.border, borderTopWidth: 4, borderTopColor: '#67728A', borderBottomWidth: 3, borderBottomColor: C.bg, justifyContent: 'center', alignItems: 'center' }}><View style={{ width: 7, height: 9, borderRadius: 1, backgroundColor: C.gold }} /></View> : <View style={{ alignItems: 'center' }}><View style={{ width: 11, height: 5, borderRadius: 2, backgroundColor: C.gold }} /><View style={{ width: 24, height: 21, borderRadius: 9, backgroundColor: C.ember, borderTopWidth: 3, borderTopColor: C.gold, borderRightWidth: 3, borderRightColor: '#B56132', borderBottomWidth: 3, borderBottomColor: '#8B4929' }} /></View>}
  </View>;
}

function spaceLoot(loot: ColtPublicLoot[]) {
  const groups: { type: ColtLootType; value: number | null; count: number }[] = [];
  for (const token of loot) {
    const group = groups.find(item => item.type === token.type && item.value === token.value);
    if (group) group.count += 1;
    else groups.push({ type: token.type, value: token.value, count: 1 });
  }
  return groups;
}

function Wheels({ locomotive }: { locomotive: boolean }) {
  return <View {...decoration} style={{ height: 37, paddingHorizontal: 24, justifyContent: 'space-between', flexDirection: 'row', alignItems: 'flex-start' }}>
    {(locomotive ? [0, 1, 2] : [0, 1]).map(wheel => <View key={wheel} style={{ width: 29, height: 29, borderRadius: 16, borderWidth: 4, borderColor: '#596173', backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', boxShadow: '0 3px 4px rgba(0,0,0,0.4)' }}><View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: C.muted }} /></View>)}
    <View style={{ position: 'absolute', left: 0, right: -20, bottom: 1, height: 3, backgroundColor: C.border, borderTopWidth: 1, borderTopColor: C.muted }} />
  </View>;
}

export function TrainBoard({ game, playerId }: { game: ColtPublicState; playerId: string | null }) {
  const scroll = useRef<ScrollView>(null);
  const [offset, setOffset] = useState(0), [viewport, setViewport] = useState(0), [contentWidth, setContentWidth] = useState(0);
  const maximum = Math.max(0, contentWidth - viewport);
  const carWidth = viewport > 0 ? Math.max(216, Math.min(320, viewport - 12)) : 252;
  const { fontScale } = useWindowDimensions();
  const occupants = game.players.filter(p => p.setupComplete && game.turnOrder.includes(p.playerId)).flatMap(p => p.positions.flatMap((position, bandit) => {
    const characterId = p.characters[bandit]!;
    const character = COLT_CHARACTERS[characterId];
    if (!character || !position || !Number.isInteger(position.carIndex) || position.carIndex < 0 || position.carIndex >= game.trainCars || !['roof', 'inside'].includes(position.level)) return [];
    return [{ p, position, bandit, character, characterId }];
  }));
  const roofHeights = useIntrinsicCardHeight(Array.from({ length: game.trainCars }, (_, car) => String(car)), JSON.stringify([carWidth, fontScale, playerId, occupants, game.lootBySpace]));
  const browse = (direction: number) => { const next = Math.max(0, Math.min(maximum, offset + direction * (carWidth + 20))); setOffset(next); scroll.current?.scrollTo({ x: next, animated: false }); };
  return <View style={{ gap: 12 }}>
    <Text style={{ ...text, color: C.muted }}>{game.trainCars} cars, caboose to locomotive. Swipe, scroll or use the car controls to inspect both levels.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><NeonButton label="PREVIOUS CAR" color={C.cyan} variant="outline" disabled={offset <= 1} onPress={() => browse(-1)} /><NeonButton label="NEXT CAR" color={C.cyan} variant="outline" disabled={offset >= maximum - 1} onPress={() => browse(1)} /></View>
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator onLayout={event => setViewport(event.nativeEvent.layout.width)} onContentSizeChange={width => setContentWidth(width)} onScroll={event => setOffset(event.nativeEvent.contentOffset.x)} scrollEventThrottle={80} contentContainerStyle={{ gap: 20, paddingHorizontal: 6, paddingTop: 8, paddingBottom: 12, alignItems: 'stretch' }}>
      {Array.from({ length: game.trainCars }, (_, car) => {
        const locomotive = car === game.trainCars - 1;
        const roofSizing = roofHeights.forCard(String(car));
        return <View key={car} style={{ width: carWidth, flexShrink: 0 }}>
          <View {...decoration} style={{ height: 20, paddingHorizontal: 20, flexDirection: 'row', justifyContent: locomotive ? 'flex-end' : 'center', alignItems: 'flex-end' }}>
            {locomotive ? <View style={{ width: 27, height: 20, backgroundColor: C.border, borderTopWidth: 5, borderTopColor: C.muted, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} /> : car === 0 ? <View style={{ width: 58, height: 14, borderTopLeftRadius: 5, borderTopRightRadius: 5, backgroundColor: C.border, borderTopWidth: 3, borderTopColor: C.muted }} /> : null}
          </View>
          <View style={{ flexGrow: 1, borderTopLeftRadius: 22, borderTopRightRadius: locomotive ? 8 : 22, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, backgroundColor: '#303747', borderTopWidth: 3, borderTopColor: '#697489', borderBottomWidth: 6, borderBottomColor: '#10131A', boxShadow: '0 5px 8px rgba(0,0,0,0.3)' }}>
            <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: C.gold, fontSize: 17, lineHeight: 24, paddingHorizontal: 14, paddingVertical: 12 }}>{coltCarName(car, game.trainCars).toUpperCase()}</Text>
            <View {...decoration} style={{ marginHorizontal: 8, marginBottom: 8, borderRadius: 8, overflow: 'hidden' }}><TrainArtwork kind={locomotive ? 'locomotive' : car === 0 ? 'caboose' : 'carriage'} /></View>
            {(['roof', 'inside'] as const).map(level => <View key={level} testID={`colt-space-${car}-${level}`} style={{ minHeight: level === 'roof' ? Math.max(132, roofSizing.minimumHeight + 5) : 132, ...(level === 'inside' ? { flexGrow: 1, marginHorizontal: 8, marginBottom: 8, borderRadius: 4, borderTopWidth: 5, borderTopColor: '#10131A', backgroundColor: '#151A24' } : { borderBottomWidth: 5, borderBottomColor: '#596173' }) }}>
              <View key={level === 'roof' ? roofSizing.measurementKey : level} onLayout={level === 'roof' ? event => roofSizing.onMeasure(event.nativeEvent.layout.height) : undefined} style={{ padding: 12, gap: 10 }}>
              <Text style={{ fontFamily: 'Outfit_700Bold', color: level === 'roof' ? C.cyan : C.gold, fontSize: 14, lineHeight: 21 }}>{level.toUpperCase()}</Text>
              {level === 'inside' && car === game.marshalCar ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><BanditPiece marshal /><Text style={{ ...text, flex: 1, minWidth: 0, fontFamily: 'Outfit_700Bold', color: C.gold }}>MARSHAL INSIDE</Text></View> : null}
              {occupants.filter(x => x.position.carIndex === car && x.position.level === level).map(({ p, bandit, character, characterId }) => <View key={`${p.playerId}:${bandit}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <BanditPiece character={characterId} />
                <Text style={{ ...text, flex: 1, minWidth: 0, fontFamily: p.playerId === playerId ? 'Outfit_700Bold' : 'Outfit_400Regular', color: p.playerId === playerId ? C.ember : C.text }}>{p.playerId === playerId ? 'You' : p.displayName} · {character.name} · {p.lootCounts[bandit]} loot</Text>
              </View>)}
              <View style={{ gap: 4, paddingTop: 4 }}>
                {spaceLoot(game.lootBySpace[`${car}:${level}`] ?? []).map(loot => <View key={`${loot.type}:${loot.value ?? 'hidden'}`} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><LootPiece kind={loot.type} /><Text style={{ ...text, flex: 1, minWidth: 0 }}>{loot.type} × {loot.count}{loot.value === null ? ' · hidden value' : ` · $${loot.value} each`}</Text></View>)}
                {!game.lootBySpace[`${car}:${level}`]?.length ? <Text style={{ ...text, color: C.muted }}>No loot</Text> : null}
              </View>
              </View>
            </View>)}
            {car < game.trainCars - 1 ? <View {...decoration} style={{ position: 'absolute', right: -21, bottom: 10, width: 22, height: 8, borderRadius: 3, backgroundColor: '#596173', borderTopWidth: 2, borderTopColor: C.muted, borderBottomWidth: 2, borderBottomColor: '#10131A' }} /> : null}
          </View>
          <Wheels locomotive={locomotive} />
        </View>;
      })}
    </ScrollView>
  </View>;
}
