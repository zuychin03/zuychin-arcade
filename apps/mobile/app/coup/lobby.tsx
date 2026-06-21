import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { router } from 'expo-router';
import { COUP_LIMITS } from '@zuychin-arcade/types';
import { useGameStore } from '../../store/useGameStore';
import { getSocket } from '../../hooks/useSocket';
import { kickPlayer } from '../../lib/api';
import { clearAuth } from '../../lib/storage';
import { showDialog } from '../../lib/dialog';
import { RoomCodeDisplay } from '../../components/lobby/RoomCodeDisplay';
import { PlayerList } from '../../components/lobby/PlayerList';
import { NeonButton } from '../../components/ui/NeonButton';
import { COUP } from '../../constants/theme';

export default function CoupLobbyScreen() {
  const room = useGameStore((s) => s.room);
  const playerId = useGameStore((s) => s.playerId);
  const token = useGameStore((s) => s.token);
  const coupPublic = useGameStore((s) => s.coupPublic);

  const minPlayers = COUP_LIMITS[room?.config.coupVariant ?? 'base'].min;
  const isHost = room?.players.find((p) => p.playerId === playerId)?.isHost ?? false;
  const canStart = (room?.playerCount ?? 0) >= minPlayers;

  useEffect(() => {
    if (room?.status === 'in_game' && coupPublic) {
      router.replace('/coup/game');
    }
  }, [room?.status, coupPublic]);

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
      <View className="flex-1 items-center justify-center bg-coup-bg">
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted }}>Connecting…</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 gap-4 bg-coup-bg p-5">
      <Animated.View entering={FadeInDown.duration(400)}>
        <RoomCodeDisplay roomCode={room.roomCode} hasPassword={room.hasPassword} />
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(80).springify().damping(16)} className="items-center">
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 12 }}>
          🎭 Coup · base rules · {minPlayers}–{room.maxPlayers} players
        </Text>
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(120).springify().damping(16)}>
        <PlayerList players={room.players} maxPlayers={room.maxPlayers} canKick={isHost} onKick={onKick} />
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(200).springify().damping(16)} style={{ gap: 10 }}>
        {isHost ? (
          <NeonButton
            label={canStart ? '▶ START GAME' : `NEED ${minPlayers}+ PLAYERS`}
            color={COUP.crimson}
            disabled={!canStart}
            onPress={() => getSocket()?.emit('start_game', {})}
          />
        ) : (
          <View className="items-center rounded-2xl border border-coup-border bg-coup-surface py-4">
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted }}>Waiting for host to start…</Text>
          </View>
        )}
        <NeonButton label="LEAVE ROOM" color={COUP.crimson} variant="ghost" onPress={onLeave} />
      </Animated.View>
    </View>
  );
}
