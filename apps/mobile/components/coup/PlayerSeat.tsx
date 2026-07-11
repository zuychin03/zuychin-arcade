import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CoupPublicPlayer } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { CharacterCard } from './CharacterCard';
import { Coin } from './Coin';
import { GlowPulse } from '../ui/GlowPulse';
import { COUP } from '../../constants/theme';

interface Props {
  player: CoupPublicPlayer;
  isMe: boolean;
  selectable?: boolean;
  waiting?: boolean; // game is currently waiting on this player
  reaction?: string; // transient speech bubble text
  fill?: boolean; // stretch to fill the parent's height (equal-height grid cells)
  onSelect?: () => void;
}

function getReactionColorAndIcon(reaction: string): { color: string; icon?: keyof typeof MaterialCommunityIcons.glyphMap } {
  const lower = reaction.toLowerCase();
  if (lower.includes('duke')) return { color: '#A855F7', icon: 'crown' };
  if (lower.includes('assassin')) return { color: '#C2410C', icon: 'sword' };
  if (lower.includes('captain')) return { color: '#4F8EF7', icon: 'anchor' };
  if (lower.includes('ambassador')) return { color: '#34D399', icon: 'handshake' };
  if (lower.includes('inquisitor')) return { color: '#F4C04E', icon: 'magnify' };
  if (lower.includes('contessa')) return { color: '#E23A5E', icon: 'shield-crown' };
  if (lower.includes('doubt')) return { color: '#E23A5E', icon: 'flag-outline' };
  if (lower.includes('allow')) return { color: '#34D399', icon: 'check' };
  if (lower.includes('block')) return { color: '#A855F7', icon: 'shield-outline' };
  if (lower.includes('nice play')) return { color: '#F4C04E', icon: 'thumb-up-outline' };
  return { color: '#F4C04E' }; // Default is gold
}

export function PlayerSeat({ player, isMe, selectable, waiting, reaction, fill, onSelect }: Props) {
  const dead = player.eliminated;
  const borderColor = player.isCurrentTurn ? COUP.gold : selectable ? COUP.crimson : COUP.border;
  const reactionConfig = reaction ? getReactionColorAndIcon(reaction) : { color: COUP.gold };


  const factionBadge = player.allegiance ? (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: player.allegiance === 'loyalist' ? 'rgba(79, 142, 247, 0.12)' : 'rgba(226, 58, 94, 0.12)',
        borderWidth: 1,
        borderColor: player.allegiance === 'loyalist' ? `${COUP.blue}80` : `${COUP.crimson}80`,
        borderRadius: 8,
        paddingHorizontal: 6,
        paddingVertical: 2,
        boxShadow: player.allegiance === 'loyalist' ? `0 0 4px ${COUP.blue}2E` : `0 0 4px ${COUP.crimson}2E`,
      }}
    >
      <MaterialCommunityIcons
        name={player.allegiance === 'loyalist' ? 'shield-outline' : 'fire'}
        size={10}
        color={player.allegiance === 'loyalist' ? COUP.blue : COUP.crimson}
      />
      <Text
        style={{
          fontFamily: 'SpaceMono_700Bold',
          color: player.allegiance === 'loyalist' ? COUP.blue : COUP.crimson,
          fontSize: 9,
          letterSpacing: 0.5,
        }}
      >
        {player.allegiance.toUpperCase()}
      </Text>
    </View>
  ) : null;

  const inner = (
    <View
      style={{
        flex: fill ? 1 : undefined,
        borderRadius: 14,
        borderWidth: player.isCurrentTurn || selectable ? 2 : 1,
        borderColor,
        backgroundColor: COUP.surface,
        padding: 12,
        opacity: dead ? 0.45 : 1,
        position: 'relative',
        boxShadow: player.isCurrentTurn
          ? `0 0 14px ${COUP.gold}3A`
          : selectable
            ? `0 0 12px ${COUP.crimson}4A`
            : undefined,
      }}
    >
      {/* Current Turn or Target Selection Glow pulses */}
      {player.isCurrentTurn && !dead && (
        <GlowPulse color={COUP.gold} borderRadius={14} borderWidth={2} />
      )}
      {selectable && (
        <GlowPulse color={COUP.crimson} borderRadius={14} borderWidth={2} />
      )}

      {reaction && (
        <View
          style={{
            position: 'absolute',
            top: -36,
            left: 24,
            backgroundColor: 'rgba(20, 10, 20, 0.95)',
            borderWidth: 1.5,
            borderColor: reactionConfig.color,
            borderRadius: 10,
            paddingHorizontal: 10,
            paddingVertical: 5,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            zIndex: 30,
            boxShadow: `0 0 10px ${reactionConfig.color}66`,
          }}
        >
          {reactionConfig.icon && (
            <MaterialCommunityIcons name={reactionConfig.icon} size={12} color={reactionConfig.color} />
          )}
          <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: '#FFFFFF', fontSize: 11 }}>
            {reaction}
          </Text>
          <View
            style={{
              position: 'absolute',
              bottom: -6,
              left: 12,
              width: 10,
              height: 10,
              backgroundColor: 'rgba(20, 10, 20, 0.95)',
              borderLeftWidth: 1.5,
              borderLeftColor: reactionConfig.color,
              borderBottomWidth: 1.5,
              borderBottomColor: reactionConfig.color,
              transform: [{ rotate: '-45deg' }],
            }}
          />
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          {factionBadge}
          <Text
            numberOfLines={1}
            style={{
              fontFamily: 'Outfit_800ExtraBold',
              color: dead ? COUP.muted : COUP.text,
              fontSize: 14,
              letterSpacing: 0.3,
            }}
          >
            {player.displayName}
            {isMe ? ' (you)' : ''}
          </Text>
          {dead && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <MaterialCommunityIcons name="skull-outline" size={12} color={COUP.muted} />
              <Text style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.muted, fontSize: 10 }}>ELIMINATED</Text>
            </View>
          )}
        </View>

        <Coin amount={player.coins} size="sm" showText />
      </View>

      <View style={{ flexDirection: 'row', gap: 6 }}>
        {/* face-down (alive) influence backs */}
        {Array.from({ length: player.influenceCount }).map((_, i) => (
          <CharacterCard key={`back-${i}`} faceDown size="xs" />
        ))}
        {/* revealed (lost) influence */}
        {player.revealedCharacters.map((c, i) => (
          <CharacterCard key={`lost-${i}`} character={c} lost size="xs" />
        ))}
      </View>

      {waiting && !dead && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
          <MaterialCommunityIcons name="timer-sand" size={11} color={COUP.crimson} />
          <Text style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.crimson, fontSize: 10, letterSpacing: 0.5 }}>
            DECIDING…
          </Text>
        </View>
      )}
    </View>
  );

  return selectable && onSelect ? (
    <ScalePressable onPress={onSelect} style={fill ? { flex: 1 } : undefined}>
      {inner}
    </ScalePressable>
  ) : (
    inner
  );
}
