import { Text, View } from 'react-native';
import Animated, { FadeInLeft } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Player } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { TOKYO } from '../../constants/theme';
import { MonsterAvatar, monsterProfile } from './MonsterAvatar';

interface Props {
  players: Player[];
  maxPlayers: number;
  canKick: boolean;
  onKick: (playerId: string) => void;
}

export function TokyoRoster({ players, maxPlayers, canKick, onKick }: Props) {
  const activePlayers = players.filter((player) => !player.hasLeft);
  const connectedPlayers = activePlayers.filter((player) => player.isConnected).length;
  return (
    <View style={{ borderRadius: 18, borderWidth: 1, borderColor: TOKYO.border, backgroundColor: TOKYO.surface, padding: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
        <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_700Bold', color: TOKYO.muted, fontSize: 12, letterSpacing: 1.5, flexShrink: 1 }}>MONSTER ROSTER</Text>
        <Text accessibilityLabel={`${connectedPlayers} connected monsters, ${activePlayers.length} active seats, ${maxPlayers} maximum`} style={{ fontFamily: 'SpaceMono_700Bold', color: TOKYO.cyan, fontSize: 11 }}>{connectedPlayers} ONLINE · {activePlayers.length}/{maxPlayers}</Text>
      </View>
      {players.map((player, index) => {
        const profile = monsterProfile(player.playerId, index);
        return (
          <Animated.View
            key={player.playerId}
            entering={FadeInLeft.delay(index * 60).springify().damping(18)}
          >
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 54 }}
          >
            <View
              accessible
              accessibilityLabel={`${player.displayName}. ${profile.name}. ${player.isHost ? 'Host. ' : ''}${player.hasLeft ? 'Left the room.' : player.isConnected ? 'Connected.' : 'Offline and reconnecting.'}`}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11 }}
            >
              <View style={{ opacity: player.hasLeft ? 0.52 : player.isConnected ? 1 : 0.7 }}>
                <MonsterAvatar seed={player.playerId} profileIndex={index} size={45} />
                <View style={{ position: 'absolute', right: 0, bottom: 0, width: 11, height: 11, borderRadius: 6, backgroundColor: player.hasLeft ? TOKYO.danger : player.isConnected ? TOKYO.lime : TOKYO.muted, borderWidth: 2, borderColor: TOKYO.surface }} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text numberOfLines={1} style={{ fontFamily: 'Outfit_800ExtraBold', color: player.hasLeft ? TOKYO.muted : TOKYO.text, fontSize: 15, flexShrink: 1 }}>{player.displayName}</Text>
                  {player.isHost && <MaterialCommunityIcons name="crown" size={14} color={TOKYO.energy} />}
                </View>
                <Text style={{ fontFamily: 'SpaceMono_700Bold', color: player.hasLeft ? TOKYO.danger : player.isConnected ? profile.accent : TOKYO.muted, fontSize: 11, marginTop: 2, letterSpacing: 0.8 }}>
                  {player.hasLeft ? 'LEFT' : player.isConnected ? profile.name.toUpperCase() : 'RECONNECTING'}
                </Text>
              </View>
            </View>
            {canKick && !player.isHost && !player.hasLeft && (
              <ScalePressable
                accessibilityLabel={`Remove ${player.displayName}`}
                accessibilityHint="Removes this reserved seat from the lobby"
                onPress={() => onKick(player.playerId)}
                style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: `${TOKYO.danger}66`, backgroundColor: `${TOKYO.danger}16`, alignItems: 'center', justifyContent: 'center' }}
              >
                <MaterialCommunityIcons name="close" size={17} color={TOKYO.danger} />
              </ScalePressable>
            )}
          </View>
          </Animated.View>
        );
      })}
    </View>
  );
}
