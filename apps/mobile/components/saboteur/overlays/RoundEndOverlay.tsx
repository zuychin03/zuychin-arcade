import { Text, View } from 'react-native';
import type { SaboteurPublicState } from '@zuychin-arcade/types';
import { ARCADE, MINE } from '../../../constants/theme';
import { NeonButton } from '../../ui/NeonButton';
import { OverlayFrame } from './OverlayFrame';

export function RoundEndOverlay({ state, myPlayerId, myGoldCollected, onLeave }: {
  state: SaboteurPublicState; myPlayerId: string | null; myGoldCollected: number; onLeave: () => void;
}) {
  const minersWon = state.roundWinner === 'miners';
  const picker = state.players.find((p) => p.playerId === state.goldDistribution?.currentPickerId);
  return <OverlayFrame id="saboteur-round-result" label={'Round ' + state.round + ' results'} onEscape={onLeave}>
    <Text accessibilityRole="header" style={{ color: minersWon ? MINE.gold : ARCADE.red, fontFamily: 'Outfit_800ExtraBold', fontSize: 28 }}>{minersWon ? 'Miners win the round' : 'Saboteurs win the round'}</Text>
    <Text style={{ color: ARCADE.text, fontSize: 16 }}>Round {state.round} of 3 · Your private total: {myGoldCollected} gold</Text>
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: ARCADE.border, padding: 14, gap: 12 }}>
      {state.revealedRoles?.map((player) => <View key={player.playerId} style={{ gap: 3 }}>
        <Text style={{ color: ARCADE.text, fontFamily: 'Outfit_700Bold', fontSize: 16 }}>{player.displayName}{player.playerId === myPlayerId ? ' (you)' : ''}</Text>
        <Text style={{ color: player.role === 'saboteur' ? ARCADE.red : MINE.gold, fontSize: 14 }}>{player.role === 'saboteur' ? 'Saboteur' : 'Miner'}</Text>
      </View>)}
    </View>
    <Text accessibilityLiveRegion="polite" style={{ color: ARCADE.text, fontSize: 16, lineHeight: 24 }}>
      {picker ? 'Waiting for ' + picker.displayName + ' to choose a gold card…' : state.round < 3 ? 'The next round starts shortly. Roles, hands and the mine are reset.' : 'Tallying final scores…'}
    </Text>
    <NeonButton label="LEAVE GAME" color={ARCADE.red} variant="outline" onPress={onLeave} />
  </OverlayFrame>;
}
