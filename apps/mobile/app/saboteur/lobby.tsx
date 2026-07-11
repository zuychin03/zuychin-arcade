import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { MIN_PLAYERS } from '@zuychin-arcade/types';
import { useGameStore } from '../../store/useGameStore';
import { getSocket } from '../../hooks/useSocket';
import { kickPlayer } from '../../lib/api';
import { clearAuth } from '../../lib/storage';
import { showDialog } from '../../lib/dialog';
import { RoomCodeDisplay } from '../../components/lobby/RoomCodeDisplay';
import { PlayerList } from '../../components/lobby/PlayerList';
import { NeonButton } from '../../components/ui/NeonButton';
import { ARCADE } from '../../constants/theme';

export default function LobbyScreen() {
  const room = useGameStore((s) => s.room);
  const playerId = useGameStore((s) => s.playerId);
  const token = useGameStore((s) => s.token);
  const publicState = useGameStore((s) => s.publicState);

  const isHost = room?.players.find((p) => p.playerId === playerId)?.isHost ?? false;
  const canStart = (room?.playerCount ?? 0) >= MIN_PLAYERS;

  // Navigate to the game when the server starts it
  useEffect(() => {
    if (room?.status === 'in_game' && publicState) {
      router.replace('/saboteur/game');
    }
  }, [room?.status, publicState]);

  const onLeave = () => {
    getSocket()?.disconnect();
    void clearAuth();
    useGameStore.getState().clearAll();
    router.dismissAll();
    router.replace('/');
  };

  const onKick = (targetId: string) => {
    if (!room || !token) return;
    const target = room.players.find((p) => p.playerId === targetId);
    showDialog('Kick player', `Remove ${target?.displayName} from the room?`, [
      { text: 'CANCEL', style: 'cancel' },
      {
        text: 'KICK',
        style: 'destructive',
        onPress: () =>
          void kickPlayer(room.roomCode, token, targetId).catch((err: unknown) =>
            showDialog('Could not kick', err instanceof Error ? err.message : 'Unknown error'),
          ),
      },
    ]);
  };

  if (!room) {
    return (
      <View className="flex-1 items-center justify-center bg-arcade-bg">
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted }}>Connecting…</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 gap-4 bg-arcade-bg p-5">
      <Animated.View entering={FadeInDown.duration(400)}>
        <RoomCodeDisplay roomCode={room.roomCode} hasPassword={room.hasPassword} />
      </Animated.View>
      <Animated.View entering={FadeInUp.delay(100).springify().damping(16)}>
        <PlayerList
          players={room.players}
          maxPlayers={room.maxPlayers}
          canKick={isHost}
          onKick={onKick}
        />
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(200).springify().damping(16)} style={{ gap: 10 }}>
        {isHost ? (
          <NeonButton
            label={canStart ? 'START GAME' : `NEED ${MIN_PLAYERS}+ PLAYERS`}
            color={ARCADE.pink}
            icon={canStart ? <MaterialCommunityIcons name="play" size={16} color={ARCADE.bg} /> : undefined}
            disabled={!canStart}
            onPress={() => getSocket()?.emit('start_game', {})}
          />
        ) : (
          <View className="items-center rounded-2xl border border-arcade-border bg-arcade-surface py-4">
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted }}>Waiting for host to start…</Text>
          </View>
        )}
        <NeonButton label="LEAVE ROOM" color={ARCADE.red} variant="ghost" onPress={onLeave} />
      </Animated.View>
    </View>
  );
}
