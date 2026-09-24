import { useState } from 'react';
import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TELESTRATIONS_CATEGORIES, type TelestrationsScoringMode } from '@zuychin-arcade/types';
import { RemainingLanding } from '../../components/remaining/RemainingLanding';
import { TelestrationsReferenceSheet } from '../../components/telestrations/ReferenceSheet';
import { GameCover } from '../../components/ui/GameCover';
import { BookButton, typography as T } from '../../components/telestrations/Controls';
import { TELESTRATIONS as C } from '../../components/telestrations/palette';
export default function TelestrationsLanding() {
  const [mode, setMode] = useState<TelestrationsScoringMode>('friendly');
  const [direction, setDirection] = useState<1 | -1>(1);
  const [category, setCategory] = useState<string | undefined>();
  return <RemainingLanding gameId="telestrations" base="/telestrations" title="TELESTRATIONS" presentation="illustrated" palette={C}
    tagline="A secret becomes a sketch. The sketch becomes a guess. Pass the books and discover where your idea travels."
    tags={['4–12 PLAYERS', 'DRAW · GUESS · REVEAL', 'THREE ROUNDS']} createLabel="OPEN THE SKETCHBOOKS"
    mark={<MaterialCommunityIcons name="draw" size={64} color={C.accent} />}
    hero={<GameCover source={require('../../assets/game-art/telestrations-hero.webp')} rimColor={C.accent} backgroundColor={C.bg} />}
    createConfig={{ telestrationsScoringMode: mode, telestrationsDirection: direction, ...(category ? { telestrationsCategory: category } : {}) }}
    renderCreateOptions={busy => <View style={{ gap: 16 }}>
      <Text style={T.heading}>Your table</Text>
      <Text style={T.body}>Scoring</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {([['friendly', 'Friendly'], ['competitive', 'Competitive'], ['none', 'Just for laughs']] as const).map(([value, label]) => <BookButton key={value} label={label} selected={mode === value} disabled={busy} onPress={() => setMode(value)} />)}
      </View>
      <Text style={T.body}>Passing direction</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <BookButton label="Clockwise" selected={direction === 1} disabled={busy} onPress={() => setDirection(1)} />
        <BookButton label="Anticlockwise" selected={direction === -1} disabled={busy} onPress={() => setDirection(-1)} />
      </View>
      <Text style={T.body}>Secrets</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <BookButton label="Original prompt offers" selected={!category} disabled={busy} onPress={() => setCategory(undefined)} />
        <BookButton label="Invent within a category" selected={Boolean(category)} disabled={busy} onPress={() => setCategory(TELESTRATIONS_CATEGORIES[0])} />
      </View>
      {category ? <View style={{ gap: 8 }}>
        <Text style={T.muted}>Everyone invents a secret in the selected category.</Text>
        {TELESTRATIONS_CATEGORIES.map(value => <BookButton key={value} label={value} selected={category === value} disabled={busy} onPress={() => setCategory(value)} />)}
      </View> : null}
    </View>}
    renderRules={(visible, onClose) => <TelestrationsReferenceSheet visible={visible} onClose={onClose} />} />;
}
