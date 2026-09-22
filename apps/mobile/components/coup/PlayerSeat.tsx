import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CoupPublicPlayer, Player } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { CharacterCard } from './CharacterCard';
import { Coin } from './Coin';
import { COUP } from '../../constants/theme';

interface Props {
  player: CoupPublicPlayer;
  isMe: boolean;
  selectable?: boolean;
  waiting?: boolean;
  reaction?: string;
  fill?: boolean;
  presence?: Pick<Player, 'isConnected' | 'hasLeft'>;
  onSelect?: () => void;
}

function getReactionColorAndIcon(reaction: string): { color: string; icon?: keyof typeof MaterialCommunityIcons.glyphMap } {
  const lower = reaction.toLowerCase();
  if (lower.includes('duke')) return { color: COUP.purple, icon: 'crown' };
  if (lower.includes('assassin')) return { color: '#F97316', icon: 'sword' };
  if (lower.includes('captain')) return { color: '#4F8EF7', icon: 'anchor' };
  if (lower.includes('ambassador')) return { color: '#34D399', icon: 'handshake' };
  if (lower.includes('inquisitor')) return { color: '#F4C04E', icon: 'magnify' };
  if (lower.includes('contessa')) return { color: COUP.crimson, icon: 'shield-crown' };
  if (lower.includes('doubt')) return { color: COUP.crimson, icon: 'flag-outline' };
  if (lower.includes('allow')) return { color: '#34D399', icon: 'check' };
  if (lower.includes('block')) return { color: COUP.purple, icon: 'shield-outline' };
  if (lower.includes('nice play')) return { color: '#F4C04E', icon: 'thumb-up-outline' };
  return { color: '#F4C04E' };
}

export function PlayerSeat({ player, isMe, selectable, waiting, reaction, fill, presence, onSelect }: Props) {
  const dead = player.eliminated;
  const hasLeft = player.forfeited || (presence?.hasLeft ?? false);
  const offline = !hasLeft && presence?.isConnected === false;
  const unavailable = dead || hasLeft;
  const borderColor = player.isCurrentTurn ? COUP.gold : selectable ? COUP.crimson : COUP.border;
  const reactionConfig = reaction ? getReactionColorAndIcon(reaction) : { color: COUP.gold };
  const status = player.forfeited ? 'FORFEITED' : hasLeft ? 'LEFT' : dead ? 'ELIMINATED' : offline ? 'RECONNECTING' : null;
  const accessibilityLabel = [
    `${player.displayName}${isMe ? ', you' : ''}`,
    `${player.coins} coin${player.coins === 1 ? '' : 's'}`,
    `${player.influenceCount} hidden influence${player.influenceCount === 1 ? '' : 's'}`,
    player.revealedCharacters.length > 0 ? `revealed ${player.revealedCharacters.join(', ')}` : null,
    status?.toLowerCase(),
    player.isCurrentTurn && !unavailable ? 'current turn' : null,
    waiting && !unavailable ? 'deciding' : null,
    selectable ? 'available target' : null,
  ].filter(Boolean).join('. ');

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
      accessible={!selectable}
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
      style={{
        flex: fill ? 1 : undefined,
        borderRadius: 14,
        borderWidth: player.isCurrentTurn || selectable ? 2 : 1,
        borderColor,
        backgroundColor: COUP.surface,
        padding: 12,
        position: 'relative',
      }}
    >
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
        <View style={{ gap: 6, flex: 1, minWidth: 0, marginRight: 8 }}>
          {factionBadge}
          <Text
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
          {status && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <MaterialCommunityIcons
                name={hasLeft ? 'exit-to-app' : offline ? 'connection' : 'skull-outline'}
                size={12}
                color={hasLeft || dead ? COUP.muted : COUP.gold}
              />
              <Text style={{ flexShrink: 1, minWidth: 0, fontFamily: 'SpaceMono_700Bold', color: hasLeft || dead ? COUP.muted : COUP.gold, fontSize: 11 }}>
                {status}
              </Text>
            </View>
          )}
        </View>

        <Coin amount={player.coins} size="sm" showText />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 7, borderRadius: 8, backgroundColor: COUP.bg, borderTopWidth: 2, borderTopColor: '#10060E', borderBottomWidth: 1, borderBottomColor: COUP.border }}>
        {Array.from({ length: player.influenceCount }).map((_, i) => (
          <CharacterCard key={`back-${i}`} faceDown size="xs" accessibilityLabel={`${player.displayName}, hidden influence ${i + 1}`} />
        ))}
        {player.revealedCharacters.map((c, i) => (
          <CharacterCard key={`lost-${i}`} character={c} lost size="xs" accessibilityLabel={`${player.displayName}, revealed ${c}`} />
        ))}
      </View>

      {player.isCurrentTurn && !unavailable ? <Text style={{ marginTop: 7, fontFamily: 'Outfit_700Bold', color: COUP.gold, fontSize: 12, lineHeight: 18 }}>Current turn</Text> : null}
      {selectable ? <Text style={{ marginTop: 7, fontFamily: 'Outfit_700Bold', color: COUP.crimson, fontSize: 12, lineHeight: 18 }}>Choose target</Text> : null}

      {player.revealedCharacters.length > 0 && (
        <Text style={{ color: COUP.muted, fontFamily: 'Outfit_400Regular', fontSize: 12, lineHeight: 17, marginTop: 6 }}>
          Lost: {player.revealedCharacters.join(', ')}
        </Text>
      )}

      {waiting && !unavailable && (
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
    <ScalePressable
      onPress={onSelect}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Select this player as the action target"
      accessibilityState={{ disabled: unavailable }}
      style={fill ? { flex: 1, minHeight: 48 } : { minHeight: 48 }}
    >
      {inner}
    </ScalePressable>
  ) : (
    inner
  );
}
