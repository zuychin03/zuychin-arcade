import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScalePressable } from '../ui/ScalePressable';
import { CardSurface } from '../ui/CardSurface';
import { COLT as C } from '../../constants/theme';
import type { ColtCharacter } from '@zuychin-arcade/types';
import { BanditPiece } from './TrainBoard';

const characterEmblems: Record<string, { icon: keyof typeof MaterialCommunityIcons.glyphMap; colour: string }> = {
  Ghost: { icon: 'cards-outline', colour: C.text },
  Doc: { icon: 'cards-playing-outline', colour: C.cyan },
  Tuco: { icon: 'stairs', colour: C.gold },
  Django: { icon: 'arrow-expand-horizontal', colour: C.ember },
  Cheyenne: { icon: 'cash-multiple', colour: C.red },
  Belle: { icon: 'account-switch-outline', colour: '#C9AFE8' },
};

function CharacterFace({ character }: { character: { name: string; summary: string } }) {
  const emblem: (typeof characterEmblems)[string] = characterEmblems[character.name] ?? { icon: 'account-outline', colour: C.gold };
  return <CardSurface radius={12} faceColor={C.panel} edgeColor="#10131B" highlightColor={emblem.colour} depth={3}>
    <View style={{ padding: 16, gap: 12 }}>
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ minHeight: 112, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 26, backgroundColor: C.surface, borderRadius: 8 }}>
        <View style={{ width: 60, height: 90, alignItems: 'center', justifyContent: 'center' }}><View style={{ transform: [{ scale: 1.65 }] }}><BanditPiece character={character.name.toLowerCase() as ColtCharacter} /></View></View>
        <MaterialCommunityIcons name={emblem.icon} size={42} color={emblem.colour} />
      </View>
      <Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 20, lineHeight: 26, color: C.text }}>{character.name.toUpperCase()}</Text>
      <Text style={{ fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24, color: C.text }}>{character.summary}</Text>
    </View>
  </CardSurface>;
}

export function CharacterChoice({ character, disabled, onPress }: { character: { name: string; summary: string }; disabled: boolean; onPress: () => void }) {
  return <ScalePressable accessibilityLabel={`Choose ${character.name}. ${character.summary}`} accessibilityHint="Confirms this character for your robbery." accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 48, minWidth: 0, borderRadius: 12, marginBottom: 4 }}>
    <CharacterFace character={character} />
    <Text style={{ padding: 12, fontFamily: 'Outfit_700Bold', fontSize: 14, lineHeight: 21, color: disabled ? C.muted : C.ember }}>{disabled ? 'CHOICE UNAVAILABLE' : 'CHOOSE ' + character.name.toUpperCase()}</Text>
  </ScalePressable>;
}

export function TeamChoice({ characters, disabled, onPress }: { characters: { name: string; summary: string }[]; disabled: boolean; onPress: () => void }) {
  const names = characters.map(character => character.name.toUpperCase()).join(' & ');
  return <ScalePressable accessibilityLabel={'CHOOSE ' + names} accessibilityHint={characters.map(character => character.name + ': ' + character.summary).join(' ')} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={{ minHeight: 48, minWidth: 0, paddingVertical: 8, gap: 12 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{characters.map(character => <View key={character.name} style={{ flexBasis: 220, flexGrow: 1, minWidth: 0, paddingBottom: 4 }}><CharacterFace character={character} /></View>)}</View>
    <Text style={{ padding: 12, fontFamily: 'Outfit_700Bold', fontSize: 16, lineHeight: 24, color: disabled ? C.muted : C.ember }}>{disabled ? 'TEAM UNAVAILABLE' : 'CHOOSE ' + names}</Text>
  </ScalePressable>;
}
