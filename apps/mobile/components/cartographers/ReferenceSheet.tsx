import { TYPOGRAPHY } from '../../constants/typography';
import { Text, View } from 'react-native';
import { CARTOGRAPHERS_CARDS, CARTOGRAPHERS_OBJECTIVES, CARTOGRAPHERS_SEASONS } from '@zuychin-arcade/types';
import { RulesReferenceSheet } from '../ui/RulesReferenceSheet';
import { CardGrid } from '../ui/CardGrid';
import { CARTOGRAPHERS as C } from './palette';
import { ExploreCard } from './ExploreCard';
import { ObjectiveCard } from './ObjectiveCard';
import { MapBoard, TERRAIN } from './MapBoard';
import { emptyChart } from './geometry';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const body = { color: C.text, fontFamily: TYPOGRAPHY.body.fontFamily, fontSize: 16, lineHeight: 24 } as const;
export function CartographersReferenceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  if (!visible) return null;
  return <RulesReferenceSheet visible={visible} onClose={onClose} gameTitle="Cartographers Heroes" subtitle="Standalone Heroes · maps C and D · 1–100 players" icon="map-outline"
    palette={{ ...C, background: C.bg }} sections={[
      { title: 'Explore, draw, score', icon: 'pencil-outline', entries: [
        { title: 'One reveal, everyone draws', body: 'Choose an offered terrain and shape. Rotate or mirror it, then place every filled square inside the 11 × 11 map without overlap. Gaps in a shape may surround filled squares. Confirm once; submitted placements cannot be undone.' },
        { title: 'Four changing seasons', body: 'Each season scores two objectives plus all current coins, minus one point per distinct empty square beside a surviving monster. A square beside several monsters is penalised once. Highest four-season total wins; ties favour the smallest cumulative monster penalty, then share the win.' },
        { title: 'Earn coins', body: 'A coin-marked shape earns one coin. Surround all four sides of a mountain to earn its coin once. Coins persist and score each season, up to 14. Ruins are printed landmarks only in this standalone game.' },
        { title: 'When no shape fits', body: 'The server checks every option and orientation. Only then may you draw one square of any terrain except mountain. An ambush fallback is one generic monster with no named power. A completely full map settles automatically.' },
      ] },
      { title: 'Heroes and ambushes', icon: 'sword-cross', entries: [
        { title: 'Lasting protection', body: 'Place the hero on an empty square and rotate or mirror its attack pattern. Attack cells may extend over filled squares or off the map. Monsters in protected squares are destroyed immediately, including future monsters. Protection survives the hero’s destruction.' },
        { title: 'Draw on a neighbour’s map', body: 'The ambush direction chooses your assigned map. The displayed map owner matters: you may receive several assignments after a departure. Confirm each separately. In solo play the server fixes the unrotated ambush position by its corner and inward spiral; an unplaceable ambush is discarded.' },
        { title: 'Dragon Inferno', body: 'Earn 3 coins once all Dragon squares are destroyed or have no adjacent empty square.' },
        { title: 'Zombie Plague', body: 'After scoring, each surviving Zombie spreads into its empty orthogonal neighbours in one simultaneous wave.' },
        { title: 'Giant Troll Ravage', body: 'After scoring, choose one empty square adjacent to a surviving Troll to destroy. Effects also resolve after winter.' },
        { title: 'Gorgon Gaze', body: 'Immediately after placing Gorgons, the drawing player chooses one non-mountain square adjacent to any surviving Gorgon to destroy. Existing hero protection resolves first. Destroyed squares remain occupied but have no terrain.' },
      ] },
      { title: 'Your seat and the end of the map', icon: 'account-group-outline', entries: [
        { title: 'Solo score', body: 'Subtract the four objective modifiers from your total to obtain your solo rating and title. A multiplayer game never changes to solo scoring after departures.' },
        { title: 'Leaving and reconnecting', body: 'Leaving or failing to reconnect forfeits future scoring and victory eligibility. Submitted map changes stay. An unfinished ambush assignment passes to its map owner. One remaining multiplayer seat wins by forfeit; no remaining seats means no winner.' },
        { title: 'Inspect one map', body: 'Finished maps are fetched one at a time. Select a player in the results to inspect their map. A rematch needs every retained seat connected.' },
      ] },
    ]}>
    <View testID="cartographers-rules-guide" style={{ gap: 24, minWidth: 0 }}>
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={{ ...body, color: C.accent, fontFamily: TYPOGRAPHY.heading.fontFamily, fontSize: 23, lineHeight: 30 }}>One reveal, a different map for everyone</Text>
        <Text style={body}>Read the revealed card, choose its terrain and shape, then draw on your assigned map. The season calendar tells you which two objectives will score next. Use the live map and card examples below to learn their symbols; open a chapter for exact placement and scoring rules.</Text>
      </View>
      <Text accessibilityRole="header" style={{ ...body, color: C.accent, fontFamily: TYPOGRAPHY.heading.fontFamily, fontSize: 22 }}>Read the terrain</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>{Object.entries(TERRAIN).map(([id, value]) => <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <MaterialCommunityIcons name={value.icon} size={24} color={value.colour} /><Text style={body}>{value.label}</Text>
      </View>)}</View>
      <Text style={body}>Adjacency is orthogonal, never diagonal. A region is a connected group of one terrain. Dashed outlines mark permanent hero protection; crossed squares are destroyed.</Text>
      <Text accessibilityRole="header" style={{ ...body, color: C.accent, fontFamily: TYPOGRAPHY.heading.fontFamily, fontSize: 22 }}>The season calendar</Text>
      {CARTOGRAPHERS_SEASONS.map(season => <Text key={season.name} style={body}>{season.name}: {season.threshold} time · objectives {season.edicts.map(index => 'ABCD'[index]).join(' + ')}</Text>)}
      <Text style={body}>Finish all assignments before checking the time threshold. Add one new hero and one new ambush each season. Revealed heroes and ambushes do not return; unresolved ones remain in later decks.</Text>
      <MapBoard map={emptyChart('C')} side="C" label="Open frontier" />
      <MapBoard map={emptyChart('D')} side="D" label="Broken frontier, with wasteland" />
      <Text accessibilityRole="header" style={{ ...body, color: C.accent, fontFamily: TYPOGRAPHY.heading.fontFamily, fontSize: 22 }}>All 19 drawing cards</Text>
      <CardGrid items={CARTOGRAPHERS_CARDS} keyExtractor={card => card.id} minCardWidth={230} maxCardWidth={350} gap={16} renderItem={card => <ExploreCard card={card} />} />
      <Text accessibilityRole="header" style={{ ...body, color: C.accent, fontFamily: TYPOGRAPHY.heading.fontFamily, fontSize: 22 }}>All 16 scoring objectives</Text>
      <Text style={body}>One objective from each category is assigned randomly to A, B, C and D. Each scores twice. The diagrams show patterns, not complete scored maps.</Text>
      <CardGrid items={CARTOGRAPHERS_OBJECTIVES} keyExtractor={objective => objective.id} minCardWidth={230} maxCardWidth={350} gap={16} renderItem={objective => <ObjectiveCard objective={objective} />} />
    </View>
  </RulesReferenceSheet>;
}
