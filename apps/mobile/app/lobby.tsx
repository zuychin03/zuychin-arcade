import { useEffect } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { MIN_PLAYERS } from '@zuychin-arcade/types';
import { useGameStore } from '../store/useGameStore';
import { getSocket } from '../hooks/useSocket';
import { kickPlayer } from '../lib/api';
import { clearAuth } from '../lib/storage';
import { RoomCodeDisplay } from '../components/lobby/RoomCodeDisplay';
import { PlayerList } from '../components/lobby/PlayerList';

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
      router.replace('/game');
    }
  }, [room?.status, publicState]);

  const onLeave = () => {
    getSocket()?.disconnect();
    void clearAuth();
    useGameStore.getState().clearAll();
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
      <View className="flex-1 items-center justify-center bg-mine-bg">
        <Text className="text-mine-stone">Connecting…</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 gap-4 bg-mine-bg p-5">
      <RoomCodeDisplay roomCode={room.roomCode} hasPassword={room.hasPassword} />
      <PlayerList
        players={room.players}
        maxPlayers={room.maxPlayers}
        canKick={isHost}
        onKick={onKick}
      />

      {isHost ? (
        <Pressable
          className={`items-center rounded-xl py-4 ${canStart ? 'bg-mine-gold' : 'bg-mine-stone/40'}`}
          disabled={!canStart}
          onPress={() => getSocket()?.emit('start_game', {})}
        >
          <Text className="text-lg font-bold text-mine-bg">
            {canStart ? 'Start Game' : `Need ${MIN_PLAYERS}+ players`}
          </Text>
        </Pressable>
      ) : (
        <View className="items-center rounded-xl bg-mine-surface py-4">
          <Text className="text-mine-stone">Waiting for host…</Text>
        </View>
      )}

      <Pressable className="items-center py-2" onPress={onLeave}>
        <Text className="text-mine-danger">Leave Room</Text>
      </Pressable>
    </View>
  );
}
