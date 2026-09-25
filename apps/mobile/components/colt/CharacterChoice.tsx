import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScalePressable } from '../ui/ScalePressable';
import { CardSurface } from '../ui/CardSurface';
import { COLT as C } from '../../constants/theme';
import { ColtCharacterArtwork } from './ColtCharacterArtwork';

const characterEmblems: Record<string, { icon: keyof typeof MaterialCommunityIcons.glyphMap; colour: string }> = {
  Ghost: { icon: 'cards-outline', colour: C.text },
  Doc: { icon: 'cards-playing-outline', colour: C.cyan },
  Tuco: { icon: 'stairs', colour: C.gold },
  Django: { icon: 'arrow-expand-horizontal', colour: C.ember },
  Cheyenne: { icon: 'cash-multiple', colour: C.red },
  Belle: { icon: 'account-switch-outline', colour: '#C9AFE8' },
};

function CharacterFace({ character, footer }: { character: { name: string; summary: string }; footer?: ReactNode }) {
  const emblem: (typeof characterEmblems)[string] = characterEmblems[character.name] ?? { icon: 'account-outline', colour: C.gold };
  return <CardSurface fill radius={12} faceColor={C.panel} edgeColor="#10131B" highlightColor={emblem.colour} depth={3}>
    <ColtCharacterArtwork name={character.name} color={emblem.colour} />
    <View style={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><MaterialCommunityIcons name={emblem.icon} size={24} color={emblem.colour} accessible={false} /><Text style={{ flex: 1, minWidth: 0, fontFamily: 'Outfit_800ExtraBold', fontSize: 20, lineHeight: 26, color: C.text }}>{character.name.toUpperCase()}</Text></View>
      <Text style={{ fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24, color: C.text }}>{character.summary}</Text>
    </View>
    {footer}
  </CardSurface>;
}

export function CharacterChoice({ character, disabled, onPress }: { character: { name: string; summary: string }; disabled: boolean; onPress: () => void }) {
  return <ScalePressable accessibilityLabel={`Choose ${character.name}. ${character.summary}`} accessibilityHint="Confirms this character for your robbery." accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 48, minWidth: 0, flexGrow: 1, borderRadius: 12, marginBottom: 4 }}>
    <CharacterFace character={character} footer={<Text style={{ marginTop: 'auto', padding: 12, fontFamily: 'Outfit_700Bold', fontSize: 14, lineHeight: 21, color: disabled ? C.muted : C.ember }}>{disabled ? 'CHOICE UNAVAILABLE' : 'CHOOSE ' + character.name.toUpperCase()}</Text>} />
  </ScalePressable>;
}

export function TeamChoice({ characters, disabled, onPress }: { characters: { name: string; summary: string }[]; disabled: boolean; onPress: () => void }) {
  const names = characters.map(character => character.name.toUpperCase()).join(' & ');
  return <ScalePressable accessibilityLabel={'CHOOSE ' + names} accessibilityHint={characters.map(character => character.name + ': ' + character.summary).join(' ')} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={{ minHeight: 48, minWidth: 0, paddingVertical: 8, gap: 12 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{characters.map(character => <View key={character.name} style={{ flexBasis: 220, flexGrow: 1, minWidth: 0, paddingBottom: 4 }}><CharacterFace character={character} /></View>)}</View>
    <Text style={{ padding: 12, fontFamily: 'Outfit_700Bold', fontSize: 16, lineHeight: 24, color: disabled ? C.muted : C.ember }}>{disabled ? 'TEAM UNAVAILABLE' : 'CHOOSE ' + names}</Text>
  </ScalePressable>;
}
