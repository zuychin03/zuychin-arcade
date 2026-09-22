import '../../apps/mobile/global.css';
import { registerRootComponent } from 'expo';
import { useFonts } from 'expo-font';
import { Outfit_400Regular, Outfit_700Bold, Outfit_800ExtraBold } from '@expo-google-fonts/outfit';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import { useState, type ReactNode } from 'react';
import { ScrollView, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CITADELS_DISTRICT_MANIFEST, KING_OF_TOKYO_POWER_CARDS, LIBERTALIA_CREW, NOT_ALONE_PLACES, type BangCard, type SkullKingCard, type PathCard } from '@zuychin-arcade/types';
import { CharacterCard } from '../../apps/mobile/components/coup/CharacterCard';
import { PowerCard } from '../../apps/mobile/components/king-of-tokyo/PowerCard';
import { PowerCardCollection } from '../../apps/mobile/components/king-of-tokyo/PowerCardCollection';
import { TokyoDie } from '../../apps/mobile/components/king-of-tokyo/TokyoDie';
import { SkullKingCardView } from '../../apps/mobile/components/skull-king/SkullKingCard';
import { CitadelsDistrictView } from '../../apps/mobile/components/citadels/CitadelsCard';
import { NotAlonePlaceCard } from '../../apps/mobile/components/not-alone/PlaceCard';
import { BangCardView } from '../../apps/mobile/components/bang/Card';
import { BangHand } from '../../apps/mobile/components/bang/Hand';
import { CrewCard } from '../../apps/mobile/components/libertalia/CrewCard';
import { LibertaliaHand } from '../../apps/mobile/components/libertalia/Hand';
import { ActionCard } from '../../apps/mobile/components/colt/ActionCard';
import { HandCard } from '../../apps/mobile/components/saboteur/cards/HandCard';
import { PathCardView } from '../../apps/mobile/components/saboteur/cards/PathCardView';
import { ActionCardView, saboteurHandCardSize } from '../../apps/mobile/components/saboteur/cards/ActionCardView';
import { useIntrinsicCardHeight } from '../../apps/mobile/hooks/useIntrinsicCardHeight';
import { ARCADE } from '../../apps/mobile/constants/theme';
import { CardGrid } from '../../apps/mobile/components/ui/CardGrid';

const FAMILIES = ['saboteur', 'coup', 'tokyo', 'skull', 'citadels', 'not-alone', 'bang', 'libertalia', 'colt'] as const;
type Family = typeof FAMILIES[number];
const params = new URLSearchParams(location.search);
const requested = params.get('family');
if (!FAMILIES.includes(requested as Family)) throw new Error('Explicit gallery family required');
const family = requested as Family;
const transparentMarker = { display: 'contents' } as unknown as ViewStyle;
const railStyle: ViewStyle = { flexDirection: 'row', alignItems: 'stretch', gap: 12, padding: 12 };
const captions = ['Short caption', 'Long comparison caption that wraps without determining the painted card height', 'Unavailable card'];
const bangCards: BangCard[] = ['stagecoach', 'beer', 'volcanic'].map((name, index) => ({ id: 'gallery-' + index, name: name as BangCard['name'], rank: 'A', suit: 'hearts' }));
const skullCards: SkullKingCard[] = [{ id: 'gallery-0', kind: 'number', suit: 'green', rank: 1 }, { id: 'gallery-1', kind: 'skull_king' }, { id: 'gallery-2', kind: 'tigress' }];
const pathCard: PathCard = { id: 'gallery-path', type: 'path', subtype: 'tunnel', isDeadEnd: false, edges: { top: 'open', right: 'closed', bottom: 'open', left: 'open', center: true } };
const districts = [...CITADELS_DISTRICT_MANIFEST].sort((a, b) => (a.effectText?.length ?? 0) - (b.effectText?.length ?? 0));
const districtSamples = [districts[0], districts.at(-1)!, districts.at(-2)!];
const places = [...NOT_ALONE_PLACES].sort((a, b) => a.summary.length - b.summary.length);
const placeSamples = [places[0], places.at(-1)!, places.at(-2)!];
const crews = [...LIBERTALIA_CREW].sort((a, b) => a.summary.length - b.summary.length);
const crewRanks = [crews[0].rank, crews.at(-1)!.rank, crews.at(-2)!.rank];
const powers = [...KING_OF_TOKYO_POWER_CARDS].sort((a, b) => a.effect.length - b.effect.length);
const powerSamples = [powers[0], powers.at(-1)!, powers.at(-2)!];

function Marker({ index, children, kind = 'card' }: { index: number; children: ReactNode; kind?: 'card' | 'die' }) {
  return <View nativeID={`gallery-${kind}-marker-${index}`} style={transparentMarker}>{children}</View>;
}

function Gallery() {
  const [fonts, error] = useFonts({ Outfit_400Regular, Outfit_700Bold, Outfit_800ExtraBold, SpaceMono_400Regular, SpaceMono_700Bold });
  const [actions, setActions] = useState<number[]>([]);
  const [textScale, setTextScale] = useState(1);
  const { width, fontScale = 1 } = useWindowDimensions();
  const handCardSize = saboteurHandCardSize(fontScale, 12 * textScale);
  const intrinsic = useIntrinsicCardHeight(['0', '1', '2'], `${family}:${width}:${textScale}`);
  const press = (index: number) => () => setActions(previous => [...previous, index]);
  if (error) throw error;
  if (!fonts) return <Text>Loading real production fonts</Text>;
  const card = (index: number): ReactNode => {
    const selected = index === 0, disabled = index === 2, onPress = press(index);
    switch (family) {
      case 'saboteur': return <HandCard selected={selected} disabled={disabled} accessibilityLabel={`Gallery Saboteur card ${index}`} onPress={onPress}>{index === 0 ? <PathCardView card={pathCard} {...handCardSize} fill /> : <ActionCardView card={{ id: 'gallery-' + index, type: 'action', subtype: index === 1 ? 'repair_lantern_pickaxe' : 'map' }} {...handCardSize} fill />}</HandCard>;
      case 'coup': return <CharacterCard character={index === 0 ? 'duke' : 'inquisitor'} size="md" fluid selected={selected} faceDown={disabled} disabled={disabled} onPress={onPress} />;
      case 'skull': return <View style={{ gap: 8, alignItems: 'center' }}><SkullKingCardView card={skullCards[index]} selected={selected} disabled={disabled} onPress={onPress} faceSizing={intrinsic.forCard(String(index))} /><Text style={{ color: ARCADE.text, fontFamily: 'Outfit_400Regular', fontSize: 14, lineHeight: 20, width: 148 }}>{captions[index]}</Text></View>;
      case 'citadels': return <CitadelsDistrictView card={{ ...districtSamples[index], id: 'gallery-' + index }} selected={selected} disabled={disabled} onPress={onPress} />;
      case 'not-alone': return <View style={{ gap: 8, alignItems: 'center' }}><NotAlonePlaceCard placeId={placeSamples[index].id} selected={selected} disabled={disabled} powerDisabled={disabled} onPress={onPress} faceSizing={intrinsic.forCard(String(index))} /><Text style={{ color: ARCADE.text, fontFamily: 'Outfit_400Regular', fontSize: 14, lineHeight: 20, width: 208 }}>{captions[index]}</Text></View>;
      case 'colt': return <ActionCard fluid action={index === 0 ? 'move' : index === 1 ? 'shoot' : 'bullet'} owner={index === 1 ? 'A long synthetic player name' : 'Gallery'} disabled={disabled} configure={selected} onPress={onPress} />;
      default: return null;
    }
  };
  const samples = [0, 1, 2];
  let collection: ReactNode;
  if (family === 'bang') collection = <BangHand cards={bangCards} textScale={textScale} renderCard={(item, onFocus, fluid) => { const index = bangCards.indexOf(item); return <Marker index={index}><BangCardView card={item} selected={index === 0} disabled={index === 2} onPress={press(index)} onFocus={onFocus} fluid={fluid} /></Marker>; }} />;
  else if (family === 'libertalia') collection = <LibertaliaHand ranks={crewRanks} textScale={textScale} renderCard={(rank, onFocus, fluid) => { const index = crewRanks.indexOf(rank); return <Marker index={index}><CrewCard rank={rank} selection={index === 0 ? 'candidate' : undefined} disabled={index === 2} onPress={press(index)} onFocus={onFocus} fluid={fluid} /></Marker>; }} />;
  else if (family === 'tokyo') collection = <PowerCardCollection>{layout => samples.map(index => <Marker key={index} index={index}><PowerCard {...layout} card={{ instanceId: 'gallery-' + index, cardId: powerSamples[index].id }} selected={index === 0} actionLabel="QA LOCAL ACTION" actionDisabled={index === 2} onAction={press(index)} /></Marker>)}</PowerCardCollection>;
  else if (family === 'coup') collection = <CardGrid items={samples} keyExtractor={String} minCardWidth={208} maxCardWidth={280} gap={10} textScale={fontScale} renderItem={index => <Marker index={index}>{card(index)}</Marker>} />;
  else if (family === 'colt') collection = <CardGrid items={samples} keyExtractor={String} minCardWidth={240} maxCardWidth={320} gap={12} textScale={fontScale} renderItem={index => <Marker index={index}>{card(index)}</Marker>} />;
  else collection = <ScrollView horizontal contentContainerStyle={railStyle}>{samples.map(index => <Marker key={index} index={index}>{card(index)}</Marker>)}</ScrollView>;
  return <SafeAreaProvider><ScrollView style={{ flex: 1, backgroundColor: ARCADE.bg }} contentContainerStyle={{ padding: 12, gap: 16 }}>
    <Text nativeID="gallery-ready" onLayout={event => setTextScale(Math.max(1, event.nativeEvent.layout.height / 22))} style={{ color: ARCADE.text, fontFamily: 'Outfit_700Bold', fontSize: 16, lineHeight: 22 }}>{family}</Text>
    <Text style={{ color: ARCADE.muted, fontFamily: 'Outfit_400Regular', fontSize: 14, lineHeight: 20 }}>QA component comparison. {['bang', 'libertalia', 'tokyo', 'coup', 'colt'].includes(family) ? 'Production collection in a QA scene, not authenticated route evidence.' : 'Neutral rail, not game-route layout evidence.'}</Text>
    <View nativeID="gallery-collection" style={{ minWidth: 0 }}>{collection}</View>
    {family === 'tokyo' ? <ScrollView horizontal contentContainerStyle={railStyle}>{samples.map(index => <Marker key={index} index={index} kind="die"><TokyoDie face={index === 0 ? 1 : index === 1 ? 'smash' : 'energy'} index={index} size={90} textScale={textScale} interactive={index !== 2} selectionState={index === 0 ? 'kept' : undefined} onPress={press(index + 3)} /></Marker>)}</ScrollView> : null}
    <Text nativeID="gallery-actions" style={{ color: ARCADE.text, fontFamily: 'SpaceMono_400Regular', fontSize: 14, lineHeight: 20 }}>{JSON.stringify(actions)}</Text>
  </ScrollView></SafeAreaProvider>;
}

registerRootComponent(Gallery);
