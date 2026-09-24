import { useState } from 'react';
import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { FeedTheKrakenJourney } from '@zuychin-arcade/types';
import { RemainingLanding } from '../../components/remaining/RemainingLanding';
import { KrakenReferenceSheet } from '../../components/kraken/ReferenceSheet';
import { GameCover } from '../../components/ui/GameCover';
import { HelmButton, typography as T } from '../../components/kraken/Controls';
import { KRAKEN as C } from '../../components/kraken/palette';
export default function Landing() {
  const [journey, setJourney] = useState<FeedTheKrakenJourney>('quick');
  return <RemainingLanding gameId="feed_the_kraken" base="/feed-the-kraken" title="FEED THE KRAKEN" presentation="illustrated" palette={C}
    tagline="One ship. Three allegiances. Choose your officers carefully, then watch where they steer."
    tags={['5–11 PLAYERS', 'HIDDEN ALLEGIANCES', 'MUTINY AT SEA']} createLabel="ASSEMBLE THE CREW"
    mark={<MaterialCommunityIcons name="ferry" size={64} color={C.accent} />}
    hero={<GameCover source={require('../../assets/game-art/feed-the-kraken-hero.webp')} rimColor={C.accent} backgroundColor={C.bg} />}
    createConfig={{ krakenJourney: journey }}
    renderCreateOptions={busy => <View style={{ gap: 12 }}>
      <Text style={T.heading}>Choose the voyage</Text>
      <HelmButton label="Quick · 5–11 players" selected={journey === 'quick'} disabled={busy} onPress={() => setJourney('quick')} />
      <HelmButton label="Long · 7–11 players" selected={journey === 'long'} disabled={busy} onPress={() => setJourney('long')} />
    </View>}
    renderRules={(visible, onClose) => <KrakenReferenceSheet visible={visible} onClose={onClose} />} />;
}
