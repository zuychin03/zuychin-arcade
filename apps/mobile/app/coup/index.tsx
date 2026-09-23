import { useState } from 'react';
import { Text, View } from 'react-native';
import type { CoupVariant } from '@zuychin-arcade/types';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { RemainingLanding } from '../../components/remaining/RemainingLanding';
import { CoupMark } from '../../components/coup/CoupArtwork';
import { GameCover } from '../../components/ui/GameCover';
import { ReferenceSheet } from '../../components/coup/ReferenceSheet';
import { COUP_PALETTE } from '../../components/coup/palette';

export default function CoupLanding() {
  const [variant, setVariant] = useState<CoupVariant>('base');
  return <RemainingLanding gameId="coup" base="/coup" title="COUP" presentation="illustrated"
    tagline="Claim any character, bluff without blinking and challenge the court before your last influence is exposed."
    tags={['BLUFF', 'CHALLENGE', variant === 'base' ? '2–6 PLAYERS' : '2–10 PLAYERS']} createLabel="ENTER THE COURT"
    createConfig={{ coupVariant: variant }}
    renderCreateOptions={(busy) => <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: COUP_PALETTE.text, fontFamily: 'Outfit_700Bold', fontSize: 16 }}>Game version</Text>
      {(['base', 'reformation'] as const).map((option) => <ScalePressable key={option} disabled={busy}
        accessibilityState={{ selected: variant === option, disabled: busy }}
        accessibilityLabel={option === 'base' ? 'Base Coup, 2 to 6 players' : 'Reformation with Inquisitor, 2 to 10 players'}
        onPress={() => setVariant(option)} style={{ minHeight: 48, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: variant === option ? COUP_PALETTE.accent : COUP_PALETTE.border, backgroundColor: variant === option ? COUP_PALETTE.panel : COUP_PALETTE.surface }}>
        <Text style={{ color: COUP_PALETTE.text, fontFamily: 'Outfit_700Bold', fontSize: 16 }}>{option === 'base' ? 'Base Coup (2–6)' : 'Reformation + Inquisitor (2–10)'}</Text>
        <Text style={{ color: COUP_PALETTE.muted, fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24 }}>{option === 'base' ? 'The original five characters and hidden influence.' : 'Allegiances, conversion, the Treasury and private examination.'}</Text>
        {variant === option ? <Text style={{ color: COUP_PALETTE.accent, fontFamily: 'Outfit_700Bold', fontSize: 14, marginTop: 4 }}>Selected</Text> : null}
      </ScalePressable>)}
    </View>}
    mark={<CoupMark size={68} />}
    hero={<GameCover nativeID="coup-entrance-art" source={require('../../assets/game-art/coup-hero.webp')} fallback={<CoupMark size={100} />} />}
    renderRules={(visible, onClose) => <ReferenceSheet visible={visible} variant={variant} onClose={onClose} />}
    palette={COUP_PALETTE} />;
}
