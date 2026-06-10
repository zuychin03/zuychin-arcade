import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { BoardPosition, PathCard, Tool } from '@zuychin-arcade/types';
import { useGameStore } from '../store/useGameStore';
import { getSocket } from '../hooks/useSocket';
import { clearAuth } from '../lib/storage';
import { validPlacements } from '../lib/placement';
import { GameBoard } from '../components/board/GameBoard';
import { PlayerStatusBar } from '../components/board/PlayerStatusBar';
import { PathCardView } from '../components/cards/PathCardView';
import { ActionCardView } from '../components/cards/ActionCardView';
import { RoleRevealOverlay } from '../components/overlays/RoleRevealOverlay';
import { RoundEndOverlay } from '../components/overlays/RoundEndOverlay';
import { GoldPickOverlay } from '../components/overlays/GoldPickOverlay';
import { GameOverOverlay } from '../components/overlays/GameOverOverlay';

export default function GameScreen() {
  const publicState = useGameStore((s) => s.publicState);
  const privateState = useGameStore((s) => s.privateState);
  const playerId = useGameStore((s) => s.playerId);
  const room = useGameStore((s) => s.room);
  const selectedCardId = useGameStore((s) => s.selectedCardId);
  const rotated = useGameStore((s) => s.rotated);

  const [showRole, setShowRole] = useState(false);
  const [peekMessage, setPeekMessage] = useState<string | null>(null);
  const lastRoundRef = useRef(0);
  const lastPeekCountRef = useRef(0);

  const isHost = room?.players.find((p) => p.playerId === playerId)?.isHost ?? false;
  const isMyTurn = publicState?.currentTurnPlayerId === playerId;
  const selectedCard = privateState?.hand.find((c) => c.id === selectedCardId) ?? null;

  // Surface rejected moves from the server
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onRejected = ({ reason }: { reason: string }) => Alert.alert('Not allowed', reason);
    socket.on('action_rejected', onRejected);
    return () => {
      socket.off('action_rejected', onRejected);
    };
  }, []);

  // Role reveal for 3.5s at each round start
  useEffect(() => {
    if (!publicState || !privateState) return;
    if (publicState.status === 'playing' && publicState.round !== lastRoundRef.current) {
      lastRoundRef.current = publicState.round;
      lastPeekCountRef.current = 0;
      setShowRole(true);
      const t = setTimeout(() => setShowRole(false), 3500);
      return () => clearTimeout(t);
    }
  }, [publicState, privateState]);

  // Map peek toast when a new goal has been seen
  useEffect(() => {
    const peeks = privateState?.peekedGoals ?? [];
    if (peeks.length > lastPeekCountRef.current) {
      lastPeekCountRef.current = peeks.length;
      const last = peeks[peeks.length - 1];
      setPeekMessage(last.isGold ? '💰 That goal is the GOLD!' : '🪨 Just worthless stone…');
      const t = setTimeout(() => setPeekMessage(null), 3500);
      return () => clearTimeout(t);
    }
  }, [privateState?.peekedGoals]);

  const unrevealedGoals = useMemo(
    () => (publicState ? publicState.goals.filter((g) => !g.revealed).map((g) => g.position) : []),
    [publicState],
  );

  // Board highlights for the selected card
  const validTargets = useMemo(() => {
    if (!publicState || !selectedCard || selectedCard.type !== 'path' || !isMyTurn) return new Set<string>();
    return validPlacements(publicState.board, unrevealedGoals, selectedCard as PathCard, rotated);
  }, [publicState, selectedCard, rotated, isMyTurn, unrevealedGoals]);

  const actionTargets = useMemo(() => {
    const targets = new Set<string>();
    if (!publicState || !selectedCard || selectedCard.type !== 'action' || !isMyTurn) return targets;
    if (selectedCard.subtype === 'map') {
      for (const g of unrevealedGoals) targets.add(`${g.row},${g.col}`);
    } else if (selectedCard.subtype === 'rockfall') {
      for (const p of publicState.board) {
        if (p.card.subtype === 'tunnel') targets.add(`${p.position.row},${p.position.col}`);
      }
    }
    return targets;
  }, [publicState, selectedCard, isMyTurn, unrevealedGoals]);

  const needsPlayerTarget =
    isMyTurn &&
    selectedCard?.type === 'action' &&
    (selectedCard.subtype.startsWith('sabotage_') || selectedCard.subtype.startsWith('repair_'));

  if (!publicState || !privateState) {
    return (
      <View className="flex-1 items-center justify-center bg-mine-bg">
        <Text className="text-mine-stone">Loading game…</Text>
      </View>
    );
  }

  const clearSelection = () => useGameStore.getState().setSelectedCard(null);

  const onCellPress = (pos: BoardPosition) => {
    if (!selectedCard || !isMyTurn) return;
    const k = `${pos.row},${pos.col}`;
    if (selectedCard.type === 'path' && validTargets.has(k)) {
      getSocket()?.emit('place_card', { cardId: selectedCard.id, position: pos, rotated });
      clearSelection();
    } else if (selectedCard.type === 'action' && actionTargets.has(k)) {
      getSocket()?.emit('play_action', { cardId: selectedCard.id, targetPosition: pos });
      clearSelection();
    }
  };

  const onPlayerSelect = (targetPlayerId: string) => {
    if (!selectedCard || selectedCard.type !== 'action') return;
    const sub = selectedCard.subtype;
    const dualTools = sub.startsWith('repair_') ? (sub.slice('repair_'.length).split('_') as Tool[]) : [];
    if (sub.startsWith('repair_') && dualTools.length === 2) {
      Alert.alert('Repair which tool?', undefined, [
        ...dualTools.map((tool) => ({
          text: tool,
          onPress: () => {
            getSocket()?.emit('play_action', { cardId: selectedCard.id, targetPlayerId, chosenTool: tool });
            clearSelection();
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
      return;
    }
    getSocket()?.emit('play_action', { cardId: selectedCard.id, targetPlayerId });
    clearSelection();
  };

  const onPass = () => {
    if (!selectedCard) {
      Alert.alert('Pass turn', 'Select the card you want to discard first, then tap Pass.');
      return;
    }
    Alert.alert('Pass turn', 'Discard the selected card and pass?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Pass',
        onPress: () => {
          getSocket()?.emit('pass_turn', { discardCardId: selectedCard.id });
          clearSelection();
        },
      },
    ]);
  };

  const onLeave = () => {
    getSocket()?.disconnect();
    void clearAuth();
    useGameStore.getState().clearAll();
    router.replace('/');
  };

  const myGoldPick =
    publicState.status === 'round_end' &&
    publicState.goldDistribution?.currentPickerId === playerId;

  return (
    <View className="flex-1 bg-mine-bg pt-12">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pb-2">
        <Text className="font-bold text-mine-gold">Round {publicState.round}/3</Text>
        <Text className="text-xs text-mine-stone">
          Deck {publicState.deckSize} · Discard {publicState.discardSize}
        </Text>
        <Pressable onPress={() => setShowRole(true)}>
          <Text
            className={`text-xs font-bold ${
              privateState.role === 'saboteur' ? 'text-mine-danger' : 'text-mine-gold'
            }`}
          >
            {privateState.role === 'saboteur' ? '😈 SABOTEUR' : '⛏️ MINER'}
          </Text>
        </Pressable>
      </View>

      {/* Zone A: board */}
      <View className="flex-[55]">
        <GameBoard
          board={publicState.board}
          goals={publicState.goals}
          validTargets={validTargets}
          actionTargets={actionTargets}
          onCellPress={onCellPress}
        />
      </View>

      {/* Zone B: player status */}
      <View className="flex-[15] justify-center">
        {needsPlayerTarget && (
          <Text className="pb-1 text-center text-xs text-mine-danger">
            Tap a player to target with “{selectedCard?.type === 'action' ? selectedCard.subtype.replace(/_/g, ' ') : ''}”
          </Text>
        )}
        <PlayerStatusBar
          players={publicState.players}
          myPlayerId={playerId}
          selectable={Boolean(needsPlayerTarget)}
          onSelect={onPlayerSelect}
        />
      </View>

      {/* Zone C: hand */}
      <View className="flex-[30] border-t border-mine-surface px-2 pt-1">
        <View className="flex-row items-center justify-between px-2">
          <Text className="text-xs text-mine-stone">
            {isMyTurn ? '🟢 Your turn' : `Waiting for ${
              publicState.players.find((p) => p.isCurrentTurn)?.displayName ?? '…'
            }`}
          </Text>
          <View className="flex-row gap-2">
            {selectedCard?.type === 'path' && (
              <Pressable
                className="rounded-md bg-mine-tunnel px-3 py-1"
                onPress={() => useGameStore.getState().toggleRotated()}
              >
                <Text className="text-xs font-bold text-white">↻ Rotate</Text>
              </Pressable>
            )}
            <Pressable
              className={`rounded-md px-3 py-1 ${isMyTurn ? 'bg-mine-stone/60' : 'bg-mine-stone/20'}`}
              disabled={!isMyTurn}
              onPress={onPass}
            >
              <Text className="text-xs font-bold text-white">Pass</Text>
            </Pressable>
          </View>
        </View>
        <ScrollView horizontal contentContainerStyle={{ gap: 8, padding: 8, alignItems: 'center' }}>
          {privateState.hand.map((card) => {
            const selected = card.id === selectedCardId;
            return (
              <Pressable
                key={card.id}
                onPress={() => useGameStore.getState().setSelectedCard(selected ? null : card.id)}
                className={selected ? 'rounded-lg border-2 border-mine-gold p-0.5' : 'p-1'}
              >
                {card.type === 'path' ? (
                  <PathCardView card={card} rotated={selected && rotated} size={64} />
                ) : (
                  <ActionCardView card={card} size={56} />
                )}
              </Pressable>
            );
          })}
          {privateState.hand.length === 0 && (
            <Text className="px-4 text-mine-stone">No cards left this round</Text>
          )}
        </ScrollView>
      </View>

      {/* Map peek toast */}
      {peekMessage && (
        <View className="absolute left-8 right-8 top-24 z-40 items-center rounded-xl bg-black/90 p-4">
          <Text className="text-lg font-bold text-mine-gold">{peekMessage}</Text>
          <Text className="mt-1 text-xs text-mine-stone">(only you saw this)</Text>
        </View>
      )}

      {/* Overlays */}
      {showRole && publicState.status === 'playing' && (
        <Pressable className="absolute inset-0 z-50" onPress={() => setShowRole(false)}>
          <RoleRevealOverlay role={privateState.role} round={publicState.round} />
        </Pressable>
      )}
      {publicState.status === 'round_end' && <RoundEndOverlay state={publicState} />}
      {myGoldPick && publicState.goldDistribution && (
        <GoldPickOverlay
          availableCards={publicState.goldDistribution.availableCards}
          onPick={(value) => getSocket()?.emit('choose_gold', { cardValue: value })}
        />
      )}
      {publicState.status === 'game_over' && (
        <GameOverOverlay
          state={publicState}
          isHost={isHost}
          onPlayAgain={() => getSocket()?.emit('start_game', {})}
          onLeave={onLeave}
        />
      )}
    </View>
  );
}
