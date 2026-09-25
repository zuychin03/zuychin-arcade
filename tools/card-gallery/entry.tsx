import '../../apps/mobile/global.css';
import { registerRootComponent } from 'expo';
import { useFonts } from 'expo-font';
import { Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold } from '@expo-google-fonts/outfit';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import { useState, type ReactNode } from 'react';
import { ScrollView, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BANG_CARD_COUNTS, BANG_CHARACTERS, CITADELS_DISTRICT_MANIFEST, CITADELS_ROLES, COLT_CHARACTERS, COLT_RULES_VERSION, KING_OF_TOKYO_POWER_CARDS, LIBERTALIA_CREW, NOT_ALONE_HUNT_CARDS, NOT_ALONE_PLACES, NOT_ALONE_SURVIVAL_CARDS, type ActionSubtype, type BangCard, type BangCharacterId, type ColtPublicState, type SkullKingCard, type PathCard } from '@zuychin-arcade/types';
import { CharacterCard } from '../../apps/mobile/components/coup/CharacterCard';
import { PowerCard } from '../../apps/mobile/components/king-of-tokyo/PowerCard';
import { PowerCardCollection } from '../../apps/mobile/components/king-of-tokyo/PowerCardCollection';
import { TokyoArena } from '../../apps/mobile/components/king-of-tokyo/TokyoArena';
import { TokyoDie } from '../../apps/mobile/components/king-of-tokyo/TokyoDie';
import { SkullKingCardView, skullKingCardWidth } from '../../apps/mobile/components/skull-king/SkullKingCard';
import { CitadelsDistrictView, CitadelsRoleCard } from '../../apps/mobile/components/citadels/CitadelsCard';
import { MonsterAvatar, monsterProfile } from '../../apps/mobile/components/king-of-tokyo/MonsterAvatar';
import { CardBack } from '../../apps/mobile/components/saboteur/cards/CardBack';
import { RoleRevealOverlay } from '../../apps/mobile/components/saboteur/overlays/RoleRevealOverlay';
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
import { useMeasuredTextScale } from '../../apps/mobile/hooks/useMeasuredTextScale';
import { ARCADE, BANG, NOT_ALONE } from '../../apps/mobile/constants/theme';
import { CardGrid } from '../../apps/mobile/components/ui/CardGrid';
import { ReferenceSheet as CoupReferenceSheet } from '../../apps/mobile/components/coup/ReferenceSheet';
import { BangReferenceSheet } from '../../apps/mobile/components/bang/ReferenceSheet';
import { CitadelsReferenceSheet } from '../../apps/mobile/components/citadels/ReferenceSheet';
import { ColtReferenceSheet } from '../../apps/mobile/components/colt/ReferenceSheet';
import { KingOfTokyoReferenceSheet } from '../../apps/mobile/components/king-of-tokyo/ReferenceSheet';
import { LibertaliaReferenceSheet } from '../../apps/mobile/components/libertalia/ReferenceSheet';
import { NotAloneReferenceSheet } from '../../apps/mobile/components/not-alone/ReferenceSheet';
import { SaboteurReferenceSheet } from '../../apps/mobile/components/saboteur/ReferenceSheet';
import { SkullKingReferenceSheet } from '../../apps/mobile/components/skull-king/ReferenceSheet';
import MobileHeader from '../../apps/mobile/components/navigation/MobileHeader';
import Sidebar from '../../apps/mobile/components/navigation/Sidebar';
import MobileDrawer from '../../apps/mobile/components/navigation/MobileDrawer';
import { BangCharacterArtwork } from '../../apps/mobile/components/bang/CharacterArtwork';
import { CardChip } from '../../apps/mobile/components/not-alone/CardChip';
import { CharacterChoice } from '../../apps/mobile/components/colt/CharacterChoice';
import { TrainBoard } from '../../apps/mobile/components/colt/TrainBoard';
import { CoupTableArtwork } from '../../apps/mobile/components/coup/CoupTableArtwork';
import { SkullKingDeckArtwork } from '../../apps/mobile/components/skull-king/SkullKingCardArtwork';
import { ExpansionScene, expansionSelection } from './ExpansionScene';

const FAMILIES = ['saboteur', 'coup', 'tokyo', 'skull', 'citadels', 'not-alone', 'bang', 'libertalia', 'colt'] as const;
type Family = typeof FAMILIES[number];
const params = new URLSearchParams(location.search);
const requested = params.get('family');
const expansionScene = params.get('scene') === 'expansion';
if (expansionScene) expansionSelection(params);
if (!expansionScene && !FAMILIES.includes(requested as Family)) throw new Error('Explicit gallery family required');
const family = requested as Family;
const artworkScene = params.get('scene') === 'artwork';
const rulesScene = params.get('scene') === 'rules';
const navigationScene = params.get('scene') === 'navigation';
if (params.has('scene') && !artworkScene && !rulesScene && !navigationScene && !expansionScene) throw new Error('Unknown gallery scene');
const artworkPage = Number(params.get('page') ?? '1');
const artworkPanel = params.get('panel') ?? 'cards';
const artworkRole = params.get('role') ?? 'miner';
if (artworkScene) {
  const pages = { libertalia: 10, citadels: 2, saboteur: 2, tokyo: 18, bang: 10, 'not-alone': 9, colt: 3, coup: 1, skull: 1 }[family];
  if (!Number.isInteger(artworkPage) || artworkPage < 1 || artworkPage > pages) throw new Error('Artwork page outside fixture bounds');
  if (!['cards', 'role'].includes(artworkPanel) || (artworkPanel === 'role' && family !== 'saboteur')) throw new Error('Unsupported artwork panel');
  if (!['miner', 'saboteur'].includes(artworkRole)) throw new Error('Unknown private role fixture');
}
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

function ArtworkScene() {
  const [roleVisible, setRoleVisible] = useState(true);
  const { width: viewportWidth, fontScale } = useWindowDimensions();
  const { textRef, onTextLayout, textScale } = useMeasuredTextScale(14, fontScale);
  const labelStyle = { color: ARCADE.text, fontFamily: 'Outfit_400Regular', fontSize: 14, lineHeight: 20 };
  const wrap = (id: string, label: string, child: ReactNode, width?: number) => <View key={id} testID={`artwork-fixture-${id}`} nativeID={`artwork-fixture-${id}`} style={{ gap: 8, alignItems: 'stretch', width, maxWidth: '100%', minWidth: 0 }}><Text style={labelStyle}>{label}</Text><View style={{ flexGrow: 1, minWidth: 0, maxWidth: '100%', alignItems: 'stretch', ...(family === 'not-alone' ? { flexDirection: 'row' as const } : {}) }}>{child}</View></View>;
  const start = (artworkPage - 1) * 4;
  const actions: ActionSubtype[] = ['repair_lantern', 'sabotage_lantern', 'repair_cart', 'sabotage_cart', 'repair_pickaxe', 'sabotage_pickaxe', 'map', 'rockfall'];
  let fixtures: ReactNode;
  if (family === 'citadels') fixtures = CITADELS_ROLES.slice(start, start + 4).map(info => wrap(info.role, info.name, <CitadelsRoleCard role={info.role} fill />));
  else if (family === 'libertalia') fixtures = LIBERTALIA_CREW.slice(start, start + 4).map(info => wrap(`crew-${info.rank}`, `Rank ${info.rank}`, <CrewCard rank={info.rank} />));
  else if (family === 'tokyo') {
    if (artworkPage === 1) fixtures = Array.from({ length: 6 }, (_, index) => wrap(`monster-${index}`, monsterProfile('artwork-qa', index).name,
      <View style={{ gap: 12, flexDirection: 'row', alignItems: 'center' }}>{([45, 54] as const).map(size => <View key={size} testID={`artwork-monster-${index}-${size}`} style={{ gap: 8, alignItems: 'center' }}><Text style={labelStyle}>{size} px</Text><MonsterAvatar seed="artwork-qa" profileIndex={index} size={size} /></View>)}</View>));
    else if (artworkPage <= 17) {
      const powerStart = (artworkPage - 2) * 4;
      fixtures = <View style={{ width: '100%', minWidth: 0 }}><PowerCardCollection>{layout => KING_OF_TOKYO_POWER_CARDS.slice(powerStart, powerStart + 4).map((card, index) => <View key={card.id} testID={`artwork-fixture-tokyo-power-${card.id}`} nativeID={`artwork-fixture-tokyo-power-${card.id}`} style={transparentMarker}><PowerCard {...layout} card={{ instanceId: `artwork-${card.id}`, cardId: card.id }} selected={index === 0} actionLabel="LOCAL QA ACTION" actionDisabled={index === 3} onAction={() => {}} /></View>)}</PowerCardCollection></View>;
    } else fixtures = <View testID="artwork-fixture-tokyo-arena" nativeID="artwork-fixture-tokyo-arena" style={{ width: '100%', minWidth: 0 }}><Text style={labelStyle}>Production TokyoArena with two empty synthetic zones. City labels and capacity remain live UI.</Text><TokyoArena players={[]} currentPlayerId={null} capacity={2} /></View>;
  }
  else if (family === 'bang') {
    const cards = (Object.keys(BANG_CARD_COUNTS) as BangCard['name'][]).map(name => ({ id: `bang-card-${name}`, label: name.replaceAll('_', ' '), node: <BangCardView card={{ id: `artwork-${name}`, name, rank: 'A', suit: 'hearts' }} fluid /> }));
    const characters = (Object.keys(BANG_CHARACTERS) as BangCharacterId[]).map(character => ({ id: `bang-character-${character}`, label: BANG_CHARACTERS[character].name, node: <View style={{ flexGrow: 1, padding: 12, gap: 12, backgroundColor: BANG.panel }}><BangCharacterArtwork character={character} /><Text style={labelStyle}>{BANG_CHARACTERS[character].summary}</Text></View> }));
    fixtures = [...cards, ...characters].slice(start, start + 4).map(item => wrap(item.id, item.label, item.node, 240));
  } else if (family === 'not-alone') {
    const cards = [...NOT_ALONE_SURVIVAL_CARDS.map(card => ({ card, kind: 'survival', color: NOT_ALONE.signal })), ...NOT_ALONE_HUNT_CARDS.map(card => ({ card, kind: 'hunt', color: NOT_ALONE.creature }))];
    fixtures = cards.slice(start, start + 4).map(({ card, kind, color }, index) => wrap(`${kind}-${card.id}`, `${kind} example`, <CardChip cardId={card.id} width={240} title={`${card.name} · P${card.phase || 'COPY'}`} body={card.summary} color={color} disabled={index === 3} needsOptions={index % 2 === 0} onPress={() => {}} />, 240));
  } else if (family === 'colt') {
    if (artworkPage < 3) fixtures = Object.entries(COLT_CHARACTERS).slice(start, start + 4).map(([id, character]) => wrap(`colt-character-${id}`, character.name, <CharacterChoice character={character} disabled={false} onPress={() => {}} />, 240));
    else {
      const game: ColtPublicState = { gameId: 'colt_express', roomCode: 'QA', rulesVersion: COLT_RULES_VERSION, revision: 1, status: 'playing', endReason: null, turnOrder: [], initialPlayerCount: 2, twoBanditMode: true, phase: 'programming', round: 1, slot: 0, slots: 1, turnType: 'standard', roundCard: { id: 'qa-round', title: 'Synthetic standard round', band: '2-4', turns: ['standard'], event: 'none' }, firstPlayerId: null, programmingPlayerId: null, programmingActionNumber: null, teamSelectionPlayerId: null, availableTeams: [], availableCharacters: [], trainCars: 3, marshalCar: 2, neutralBulletsRemaining: 13, players: [], lootBySpace: { '0:inside': [{ id: 'qa-purse', type: 'purse', value: null }], '1:roof': [{ id: 'qa-jewel', type: 'jewel', value: 500 }], '2:inside': [{ id: 'qa-strongbox', type: 'strongbox', value: 1000 }] }, program: [], executionIndex: 0, pending: null, winnerPlayerIds: [], log: [] };
      fixtures = <View testID="artwork-fixture-colt-train" nativeID="artwork-fixture-colt-train" style={{ width: '100%', minWidth: 0 }}><Text style={labelStyle}>Production TrainBoard: three synthetic cars, both levels, marshal and loot. Browse to inspect all three artworks.</Text><TrainBoard game={game} playerId={null} /></View>;
    }
  } else if (family === 'coup') fixtures = <>{(['back', 'loyalist', 'reformist', 'treasury'] as const).map(kind => wrap(`coup-${kind}`, kind, <View style={{ width: 96, alignSelf: 'center' }}><CoupTableArtwork kind={kind} /></View>, 160))}{wrap('coup-compact-seat', 'Synthetic compact seat: hidden + revealed lost influence', <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 8 }}><CharacterCard size="xs" faceDown /><CharacterCard size="xs" character="duke" lost /></View>, 160)}</>;
  else if (family === 'skull') fixtures = <>{(['green', 'purple', 'yellow', 'black'] as const).map((suit, index) => wrap(`skull-suit-${suit}`, `${suit} number card`, <SkullKingCardView card={{ id: `artwork-${suit}`, kind: 'number', suit, rank: index === 3 ? 14 : 1 }} />, skullKingCardWidth(false, textScale, viewportWidth)))}{wrap('skull-deck-back', 'Uniform deck back', <View style={{ width: 96, alignSelf: 'center' }}><SkullKingDeckArtwork /></View>, skullKingCardWidth(false, textScale, viewportWidth))}</>;
  else fixtures = <>{actions.slice(start, start + 4).map(subtype => wrap(subtype, subtype.replaceAll('_', ' '), <ActionCardView card={{ id: `artwork-${subtype}`, type: 'action', subtype }} {...saboteurHandCardSize()} />))}{wrap('deck-back', 'Uniform concealed back', <CardBack />)}</>;
  return <SafeAreaProvider><ScrollView style={{ flex: 1, backgroundColor: ARCADE.bg }} contentContainerStyle={{ padding: 16, gap: 20 }}>
    <Text ref={textRef} onLayout={onTextLayout} nativeID="artwork-ready" testID="artwork-ready" style={labelStyle}>{family} artwork QA, page {artworkPage}</Text>
    <Text style={labelStyle}>Local production components. Synthetic fixtures only; no gameplay or private room data. Tokyo uses the two production call-site sizes.</Text>
    <View testID="artwork-fixtures" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 20 }}>{fixtures}</View>
    {family === 'saboteur' && artworkPanel === 'role' && roleVisible ? <RoleRevealOverlay role={artworkRole as 'miner' | 'saboteur'} round={1} onDismiss={() => setRoleVisible(false)} /> : null}
    {family === 'saboteur' && artworkPanel === 'role' && !roleVisible ? <Text testID="artwork-role-dismissed" style={labelStyle}>Synthetic role hidden.</Text> : null}
  </ScrollView></SafeAreaProvider>;
}

function RulesScene() {
  const [visible, setVisible] = useState(true);
  const props = { visible, onClose: () => setVisible(false) };
  const guides = {
    bang: <BangReferenceSheet {...props} />,
    citadels: <CitadelsReferenceSheet {...props} />,
    colt: <ColtReferenceSheet {...props} />,
    coup: <CoupReferenceSheet {...props} variant="reformation" />,
    tokyo: <KingOfTokyoReferenceSheet {...props} />,
    libertalia: <LibertaliaReferenceSheet {...props} />,
    'not-alone': <NotAloneReferenceSheet {...props} />,
    saboteur: <SaboteurReferenceSheet {...props} />,
    skull: <SkullKingReferenceSheet {...props} />,
  };
  return <SafeAreaProvider><View style={{ flex: 1, backgroundColor: ARCADE.bg }}>
    <Text testID="rules-scene-ready" style={{ color: ARCADE.text }}>Production {family} reference, synthetic QA scene.</Text>
    {guides[family]}
    {!visible ? <Text testID="rules-scene-closed" style={{ color: ARCADE.text }}>Reference closed.</Text> : null}
  </View></SafeAreaProvider>;
}

function NavigationScene() {
  const [drawer, setDrawer] = useState(false);
  const { width } = useWindowDimensions();
  return <SafeAreaProvider><View style={{ flex: 1, backgroundColor: ARCADE.bg }}>
    <MobileHeader onMenuPress={() => setDrawer(true)} />
    <View style={{ flex: 1, flexDirection: 'row' }}>
      {width >= 768 ? <Sidebar /> : null}
      <View style={{ flex: 1, padding: 16 }}><Text testID="navigation-scene-ready" style={{ color: ARCADE.text, fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24 }}>Production navigation components. Open and close the menu to check its brand lockup.</Text></View>
    </View>
    <MobileDrawer isOpen={drawer} onClose={() => setDrawer(false)} />
  </View></SafeAreaProvider>;
}

function Gallery() {
  const [fonts, error] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold, SpaceMono_400Regular, SpaceMono_700Bold });
  const [actions, setActions] = useState<number[]>([]);
  const [textScale, setTextScale] = useState(1);
  const { width, fontScale = 1 } = useWindowDimensions();
  const handCardSize = saboteurHandCardSize(fontScale, 12 * textScale);
  const intrinsic = useIntrinsicCardHeight(['0', '1', '2'], `${family}:${width}:${textScale}`);
  const press = (index: number) => () => setActions(previous => [...previous, index]);
  if (error) throw error;
  if (!fonts) return <Text>Loading real production fonts</Text>;
  if (expansionScene) return <ExpansionScene params={params} />;
  if (artworkScene) return <ArtworkScene />;
  if (rulesScene) return <RulesScene />;
  if (navigationScene) return <NavigationScene />;
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
