import { Text, View, type ImageSourcePropType } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FEED_THE_KRAKEN_CHARACTER_NAMES as N, FEED_THE_KRAKEN_CHARACTER_SUMMARIES as S, type FeedTheKrakenCharacter } from '@zuychin-arcade/types';
import { CardSurface } from '../ui/CardSurface';
import { CardIllustration } from '../ui/CardIllustration';
import { typography as T } from './Controls';
import { KRAKEN as C } from './palette';

export const KRAKEN_CHARACTER_IMAGES: Record<FeedTheKrakenCharacter, ImageSourcePropType> = {
  kleptomaniac: require('../../assets/game-art/kraken-character-kleptomaniac.webp'),
  troublemaker: require('../../assets/game-art/kraken-character-troublemaker.webp'),
  gunsmith: require('../../assets/game-art/kraken-character-gunsmith.webp'),
  peacemaker: require('../../assets/game-art/kraken-character-peacemaker.webp'),
  gunslinger: require('../../assets/game-art/kraken-character-gunslinger.webp'),
  minstrel: require('../../assets/game-art/kraken-character-minstrel.webp'),
  boatswain: require('../../assets/game-art/kraken-character-boatswain.webp'),
  herbalist: require('../../assets/game-art/kraken-character-herbalist.webp'),
  lookout: require('../../assets/game-art/kraken-character-lookout.webp'),
  master_strategist: require('../../assets/game-art/kraken-character-master_strategist.webp'),
  smuggler: require('../../assets/game-art/kraken-character-smuggler.webp'),
  agitator: require('../../assets/game-art/kraken-character-agitator.webp'),
  adviser: require('../../assets/game-art/kraken-character-adviser.webp'),
  chief_cook: require('../../assets/game-art/kraken-character-chief_cook.webp'),
  rabble_rouser: require('../../assets/game-art/kraken-character-rabble_rouser.webp'),
  archivist: require('../../assets/game-art/kraken-character-archivist.webp'),
  mentor: require('../../assets/game-art/kraken-character-mentor.webp'),
  spiritualist: require('../../assets/game-art/kraken-character-spiritualist.webp'),
  debt_collector: require('../../assets/game-art/kraken-character-debt_collector.webp'),
  negotiator: require('../../assets/game-art/kraken-character-negotiator.webp'),
  instigator: require('../../assets/game-art/kraken-character-instigator.webp'),
};

export function CharacterCard({ character, compact = false }: { character: FeedTheKrakenCharacter; compact?: boolean }) {
  const portrait = <CardIllustration source={KRAKEN_CHARACTER_IMAGES[character]} aspectRatio={2 / 3} backgroundColor={C.panel}
    fallback={<MaterialCommunityIcons name="account" size={40} color={C.accent} />} />;
  const copy = <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: compact ? 180 : undefined, minWidth: 0, padding: compact ? 0 : 12, gap: 8 }}>
    <Text style={T.heading}>{N[character]}</Text>
    <Text style={T.body}>{S[character]}</Text>
  </View>;
  if (compact) return <View testID="kraken-character-card" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
    <View style={{ width: 80, flexShrink: 0, borderRadius: 8, overflow: 'hidden' }}>{portrait}</View>{copy}
  </View>;
  return <CardSurface fill radius={12} faceColor={C.surface} edgeColor={C.bg} highlightColor={C.border}>
    <View testID="kraken-character-card" style={{ flexGrow: 1 }}>{portrait}{copy}</View>
  </CardSurface>;
}
