import { useState, type ReactNode } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CARTOGRAPHERS_CARDS, CARTOGRAPHERS_OBJECTIVES } from '@zuychin-arcade/types';
import { ARCADE } from '../../apps/mobile/constants/theme';
import { NavigationCard } from '../../apps/mobile/components/kraken/NavigationCard';
import { CharacterCard } from '../../apps/mobile/components/kraken/CharacterCard';
import { ExploreCard } from '../../apps/mobile/components/cartographers/ExploreCard';
import { ObjectiveCard } from '../../apps/mobile/components/cartographers/ObjectiveCard';
import { DreamCard } from '../../apps/mobile/components/dixit/DreamCard';
import { RelayDiagram } from '../../apps/mobile/components/telestrations/RelayDiagram';
import { Drawing } from '../../apps/mobile/components/telestrations/Drawing';
import { KrakenReferenceSheet } from '../../apps/mobile/components/kraken/ReferenceSheet';
import { TelestrationsReferenceSheet } from '../../apps/mobile/components/telestrations/ReferenceSheet';
import { CartographersReferenceSheet } from '../../apps/mobile/components/cartographers/ReferenceSheet';
import { DixitReferenceSheet } from '../../apps/mobile/components/dixit/ReferenceSheet';

export const EXPANSION_FAMILIES = ['kraken', 'telestrations', 'cartographers', 'dixit'] as const;
type ExpansionFamily = typeof EXPANSION_FAMILIES[number];
export function expansionSelection(params: URLSearchParams) {
  const family = params.get('family') as ExpansionFamily;
  const surface = params.get('surface') ?? 'cards';
  if (!EXPANSION_FAMILIES.includes(family)) throw new Error('Unknown expansion family');
  if (!['cards', 'rules'].includes(surface)) throw new Error('Unknown expansion surface');
  if (['page', 'panel', 'role'].some(key => params.has(key))) throw new Error('Expansion fixtures have no paging or private role parameters');
  return { family, surface };
}

export function ExpansionScene({ params }: { params: URLSearchParams }) {
  const { family, surface } = expansionSelection(params);
  const [visible, setVisible] = useState(true);
  const [selected, setSelected] = useState(0);
  const [actions, setActions] = useState(0);
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(300, Math.max(120, width - 32));
  const props = { visible, onClose: () => setVisible(false) };
  const guides = {
    kraken: <KrakenReferenceSheet {...props} />,
    telestrations: <TelestrationsReferenceSheet {...props} />,
    cartographers: <CartographersReferenceSheet {...props} />,
    dixit: <DixitReferenceSheet {...props} />,
  };
  const wrap = (id: string, child: ReactNode) => <View key={id} nativeID={`expansion-fixture-${id}`} style={{ width: cardWidth, maxWidth: '100%', minWidth: 0 }}>{child}</View>;
  let cards: ReactNode;
  if (family === 'kraken') cards = <>
    {(['blue', 'red', 'yellow'] as const).map((colour, index) => wrap(`kraken-${colour}`, <NavigationCard card={{ colour, effect: index === 0 ? 'mermaid' : index === 1 ? 'drunk' : 'uprising' }} selected={selected === index} disabled={index === 2} onSelect={() => { setSelected(index); setActions(value => value + 1); }} />))}
    {wrap('kraken-character', <CharacterCard character="master_strategist" />)}
    {wrap('kraken-character-compact', <CharacterCard character="gunsmith" compact />)}
  </>;
  else if (family === 'cartographers') cards = <>
    {(['explore', 'hero', 'ambush'] as const).map(kind => wrap(`cartographers-${kind}`, <ExploreCard card={CARTOGRAPHERS_CARDS.find(card => card.kind === kind)!} />))}
    {CARTOGRAPHERS_OBJECTIVES.slice(0, 2).map((objective, index) => wrap(`cartographers-objective-${index}`, <ObjectiveCard objective={objective} edict={index === 0 ? 'A' : 'B'} active={index === 0} />))}
  </>;
  else if (family === 'dixit') cards = (['dream-01', 'dream-02', 'dream-03'] as const).map((cardId, index) => wrap(cardId, <DreamCard cardId={cardId} width={cardWidth} selected={selected === index} onInspect={() => { setSelected(index); setActions(value => value + 1); }} />));
  else cards = <View nativeID="expansion-fixture-sketchbook" style={{ width: '100%', maxWidth: 700, gap: 16 }}>
    <RelayDiagram />
    {wrap('drawing', <Drawing drawing={{ strokes: [{ color: 1, width: 1, points: [[800, 2800], [2000, 1000], [3200, 2800], [800, 2800]] }] }} />)}
  </View>;
  return <SafeAreaProvider><ScrollView style={{ flex: 1, backgroundColor: ARCADE.bg }} contentContainerStyle={{ padding: 16, gap: 16 }}>
    <Text nativeID="expansion-ready" style={{ color: ARCADE.text, fontFamily: 'Outfit_700Bold', fontSize: 20 }}>{family} · {surface}</Text>
    <Text style={{ color: ARCADE.muted, fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24 }}>Synthetic component examples. Local callbacks only, no rooms or services. This is not game-route evidence.</Text>
    {surface === 'rules' ? guides[family] : <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 16 }}>{cards}</View>}
    {surface === 'rules' && !visible ? <Text nativeID="expansion-rules-closed" style={{ color: ARCADE.text }}>Reference closed.</Text> : null}
    <Text nativeID="expansion-actions" style={{ color: ARCADE.text }}>{actions}</Text>
  </ScrollView></SafeAreaProvider>;
}
