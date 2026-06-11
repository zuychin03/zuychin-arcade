import { useEffect } from 'react';
import { Alert, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { router } from 'expo-router';
import { MIN_PLAYERS } from '@zuychin-arcade/types';
import { useGameStore } from '../../store/useGameStore';
import { getSocket } from '../../hooks/useSocket';
import { kickPlayer } from '../../lib/api';
import { clearAuth } from '../../lib/storage';
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
    Alert.alert('Kick player', `Remove ${target?.displayName} from the room?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Kick',
        style: 'destructive',
        onPress: () => void kickPlayer(room.roomCode, token, targetId).catch(() => undefined),
      },
    ]);
  };

  if (!room) {
    return (
      <View className="flex-1 items-center justify-center bg-arcade-bg">
        <Text className="text-arcade-muted">Connecting…</Text>
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
            label={canStart ? '▶ START GAME' : `NEED ${MIN_PLAYERS}+ PLAYERS`}
            color={ARCADE.pink}
            disabled={!canStart}
            onPress={() => getSocket()?.emit('start_game', {})}
          />
        ) : (
          <View className="items-center rounded-2xl border border-arcade-border bg-arcade-surface py-4">
            <Text className="text-arcade-muted">Waiting for host to start…</Text>
          </View>
        )}
        <NeonButton label="LEAVE ROOM" color={ARCADE.red} variant="ghost" onPress={onLeave} />
      </Animated.View>
    </View>
  );
}
