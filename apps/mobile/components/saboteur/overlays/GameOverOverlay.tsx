import { Text, View } from 'react-native';
import type { SaboteurPublicState } from '@zuychin-arcade/types';
import { NeonButton } from '../../ui/NeonButton';
import { ARCADE, MINE } from '../../../constants/theme';
import { OverlayFrame } from './OverlayFrame';

export function GameOverOverlay({ state, isHost, canRematch, busy, connectedCount, message, onPlayAgain, onLeave }: {
  state: SaboteurPublicState; isHost: boolean; canRematch: boolean; busy: boolean; connectedCount: number; message: string | null; onPlayAgain: () => void; onLeave: () => void;
}) {
  const ranked = [...state.players].sort((a, b) => (b.goldCollected ?? 0) - (a.goldCollected ?? 0));
  const winners = new Set(state.winnerIds ?? []);
  const abandoned = state.terminationReason === 'not_enough_players';
  return <OverlayFrame id="saboteur-match-result" label="Final Saboteur results" onEscape={onLeave}>
    <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: MINE.gold, fontSize: 30 }}>{abandoned ? 'Match ended early' : 'Final gold count'}</Text>
    <Text style={{ color: ARCADE.text, fontSize: 16, lineHeight: 24 }}>{abandoned ? 'Fewer than three active players remain. There is no winner and no competitive result is recorded. The gold below is only the progress made before the match ended.' : 'Three rounds complete. ' + (winners.size > 1 ? 'The tied richest players share victory.' : 'The richest eligible player wins.')}</Text>
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: ARCADE.border, padding: 14, gap: 16 }}>
      {ranked.map((player) => <View key={player.playerId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: ARCADE.text, fontSize: 17, fontFamily: 'Outfit_700Bold' }}>{player.displayName}</Text>
          {player.forfeited ? <Text style={{ color: ARCADE.red, fontSize: 13 }}>FORFEITED · NOT ELIGIBLE</Text> : !abandoned && winners.has(player.playerId) ? <Text style={{ color: MINE.gold, fontSize: 13 }}>WINNER</Text> : null}
        </View>
        <Text style={{ color: MINE.gold, fontSize: 19, fontFamily: 'Outfit_800ExtraBold' }}>{player.goldCollected ?? 0} gold</Text>
      </View>)}
    </View>
    <Text style={{ color: ARCADE.muted, fontSize: 14, lineHeight: 21 }}>{connectedCount} connected. A fresh match needs at least 3 players and no reserved seat still reconnecting.</Text>
    {message && <Text accessibilityLiveRegion="polite" style={{ color: ARCADE.text, fontSize: 14, lineHeight: 20 }}>{message}</Text>}
    {isHost ? <NeonButton label={busy ? 'WAITING…' : 'PLAY AGAIN'} color={MINE.gold} disabled={busy || !canRematch} onPress={onPlayAgain} /> : <Text style={{ color: ARCADE.muted, fontSize: 14 }}>The host can start the next match.</Text>}
    <NeonButton label="BACK TO ARCADE" color={ARCADE.cyan} variant="outline" onPress={onLeave} />
  </OverlayFrame>;
}
