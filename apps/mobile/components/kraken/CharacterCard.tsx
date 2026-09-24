import { useState } from 'react';
import { Image, Text, View, type ImageSourcePropType } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FEED_THE_KRAKEN_CHARACTER_NAMES as N, FEED_THE_KRAKEN_CHARACTER_SUMMARIES as S, type FeedTheKrakenCharacter } from '@zuychin-arcade/types';
import { CardSurface } from '../ui/CardSurface';
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
  const [failed, setFailed] = useState<FeedTheKrakenCharacter | null>(null);
  const portrait = <View style={{ width: compact ? 80 : '100%', aspectRatio: 2 / 3, flexShrink: 0, backgroundColor: C.panel, borderRadius: 8, overflow: 'hidden' }}>
    {failed !== character ? <Image key={character} source={KRAKEN_CHARACTER_IMAGES[character]} accessible={false} resizeMode="contain"
      onError={() => setFailed(character)} style={{ width: '100%', height: '100%' }} />
      : <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><MaterialCommunityIcons name="account" size={40} color={C.accent} accessible={false} /></View>}
  </View>;
  const copy = <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: compact ? 180 : undefined, minWidth: 0, padding: compact ? 0 : 12, gap: 8 }}>
    <Text style={T.heading}>{N[character]}</Text>
    <Text style={T.body}>{S[character]}</Text>
  </View>;
  if (compact) return <View testID="kraken-character-card" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>{portrait}{copy}</View>;
  return <CardSurface fill radius={12} faceColor={C.surface} edgeColor={C.bg} highlightColor={C.border}>
    <View testID="kraken-character-card" style={{ padding: 5, flexGrow: 1 }}>{portrait}{copy}</View>
  </CardSurface>;
}
