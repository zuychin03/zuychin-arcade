import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Role } from '@zuychin-arcade/types';
import { ARCADE, MINE } from '../../../constants/theme';
import { NeonButton } from '../../ui/NeonButton';
import { OverlayFrame } from './OverlayFrame';
import { GameCover } from '../../ui/GameCover';

const roleArtwork = {
  miner: require('../../../assets/game-art/saboteur-role-miner.webp'),
  saboteur: require('../../../assets/game-art/saboteur-role-saboteur.webp'),
};

export function RoleRevealOverlay({ role, round, onDismiss }: { role: Role; round: number; onDismiss: () => void }) {
  const saboteur = role === 'saboteur';
  const accent = saboteur ? ARCADE.red : MINE.gold;
  return <OverlayFrame id="saboteur-secret-role" label="Your secret role" onEscape={onDismiss}>
    <View style={{ width: 76, height: 76, alignSelf: 'center', borderRadius: 8, overflow: 'hidden' }}>
      <GameCover source={roleArtwork[role]} aspectRatio={1} backgroundColor={MINE.surface} fallback={<MaterialCommunityIcons name={saboteur ? 'emoticon-devil-outline' : 'pickaxe'} size={76} color={accent} />} />
    </View>
    <Text accessibilityRole="header" style={{ color: accent, fontFamily: 'Outfit_800ExtraBold', fontSize: 34, textAlign: 'center' }}>{saboteur ? 'SABOTEUR' : 'MINER'}</Text>
    <Text style={{ color: ARCADE.text, fontSize: 16, lineHeight: 24, textAlign: 'center' }}>
      {saboteur ? 'Stop the miners reaching gold before every card runs out. Block useful tunnels and damage tools without revealing your plan.' : 'Connect the start to gold through open tunnels. Keep your tools working and watch for players blocking the route.'}
    </Text>
    <Text style={{ color: ARCADE.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>Round {round} of 3. This role is private and is dealt again next round. Most total gold wins the match.</Text>
    <NeonButton label="HIDE SECRET ROLE" color={accent} onPress={onDismiss} />
    <Text style={{ color: ARCADE.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>Use the Role button to reveal this again. Keep your screen private.</Text>
  </OverlayFrame>;
}
