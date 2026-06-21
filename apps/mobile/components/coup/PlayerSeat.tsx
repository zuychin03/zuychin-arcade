import { Text, View } from 'react-native';
import type { CoupPublicPlayer } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { CharacterCard } from './CharacterCard';
import { COUP } from '../../constants/theme';

interface Props {
  player: CoupPublicPlayer;
  isMe: boolean;
  selectable?: boolean;
  waiting?: boolean; // game is currently waiting on this player
  onSelect?: () => void;
}

export function PlayerSeat({ player, isMe, selectable, waiting, onSelect }: Props) {
  const dead = player.eliminated;
  const borderColor = player.isCurrentTurn ? COUP.gold : selectable ? COUP.crimson : COUP.border;

  const inner = (
    <View
      style={{
        borderRadius: 14,
        borderWidth: player.isCurrentTurn || selectable ? 2 : 1,
        borderColor,
        backgroundColor: COUP.surface,
        padding: 10,
        opacity: dead ? 0.45 : 1,
        boxShadow: player.isCurrentTurn ? `0 0 12px ${COUP.gold}55` : selectable ? `0 0 10px ${COUP.crimson}66` : undefined,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
          {player.allegiance && (
            <Text style={{ fontSize: 12 }}>{player.allegiance === 'loyalist' ? '⛪' : '✊'}</Text>
          )}
          <Text
            numberOfLines={1}
            style={{ fontFamily: 'Outfit_800ExtraBold', color: dead ? COUP.muted : COUP.text, fontSize: 14 }}
          >
            {player.isCurrentTurn ? '▶ ' : ''}
            {player.displayName}
            {isMe ? ' (you)' : ''}
          </Text>
          {dead && <Text style={{ fontSize: 12 }}>💀</Text>}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Text style={{ fontSize: 12 }}>🪙</Text>
          <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.gold, fontSize: 14 }}>{player.coins}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 5 }}>
        {/* face-down (alive) influence backs */}
        {Array.from({ length: player.influenceCount }).map((_, i) => (
          <CharacterCard key={`back-${i}`} faceDown size="xs" />
        ))}
        {/* revealed (lost) influence */}
        {player.revealedCharacters.map((c, i) => (
          <CharacterCard key={`lost-${i}`} character={c} lost size="xs" />
        ))}
      </View>

      {waiting && (
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.crimson, fontSize: 10, marginTop: 6 }}>
          ⏳ deciding…
        </Text>
      )}
    </View>
  );

  return selectable && onSelect ? <ScalePressable onPress={onSelect}>{inner}</ScalePressable> : inner;
}
