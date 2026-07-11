import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInUp } from 'react-native-reanimated';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BoardPosition, PathCard, Tool } from '@zuychin-arcade/types';
import { useGameStore } from '../../store/useGameStore';
import { getSocket } from '../../hooks/useSocket';
import { clearAuth } from '../../lib/storage';
import { showDialog } from '../../lib/dialog';
import { validPlacements } from '../../lib/placement';
import { GameBoard } from '../../components/saboteur/board/GameBoard';
import { PlayerStatusBar } from '../../components/saboteur/board/PlayerStatusBar';
import { PathCardView } from '../../components/saboteur/cards/PathCardView';
import { ActionCardView } from '../../components/saboteur/cards/ActionCardView';
import { HandCard } from '../../components/saboteur/cards/HandCard';
import { RoleRevealOverlay } from '../../components/saboteur/overlays/RoleRevealOverlay';
import { RoundEndOverlay } from '../../components/saboteur/overlays/RoundEndOverlay';
import { GoldPickOverlay } from '../../components/saboteur/overlays/GoldPickOverlay';
import { GameOverOverlay } from '../../components/saboteur/overlays/GameOverOverlay';
import { NeonButton } from '../../components/ui/NeonButton';
import { ARCADE, neonText } from '../../constants/theme';

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
  const lastPeekCountRef = useRef<number | null>(null);

  const isHost = room?.players.find((p) => p.playerId === playerId)?.isHost ?? false;
  const isMyTurn = publicState?.currentTurnPlayerId === playerId;
  const selectedCard = privateState?.hand.find((c) => c.id === selectedCardId) ?? null;

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onRejected = ({ reason }: { reason: string }) => showDialog('Not allowed', reason);
    socket.on('action_rejected', onRejected);
    return () => {
      socket.off('action_rejected', onRejected);
    };
  }, []);

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

  useEffect(() => {
    const peeks = privateState?.peekedGoals;
    if (!peeks) return;
    if (lastPeekCountRef.current === null) {
      lastPeekCountRef.current = peeks.length;
      return;
    }
    if (peeks.length > lastPeekCountRef.current) {
      lastPeekCountRef.current = peeks.length;
      const last = peeks[peeks.length - 1];
      setPeekMessage(last.isGold ? 'That goal is the GOLD!' : 'Just worthless stone…');
      const t = setTimeout(() => setPeekMessage(null), 3500);
      return () => clearTimeout(t);
    }
    lastPeekCountRef.current = peeks.length;
  }, [privateState?.peekedGoals]);

  const myGoldPickValue =
    publicState?.goldDistribution?.steps.find((s) => s.playerId === playerId)?.chosenCard ?? null;
  useEffect(() => {
    if (myGoldPickValue !== null) {
      showDialog('Gold collected!', `You drew a nugget card worth ${myGoldPickValue} gold!`);
    }
  }, [myGoldPickValue]);

  const unrevealedGoals = useMemo(
    () => (publicState ? publicState.goals.filter((g) => !g.revealed).map((g) => g.position) : []),
    [publicState],
  );

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
      <View className="flex-1 items-center justify-center gap-6 bg-arcade-bg">
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted }}>Loading game…</Text>
        <Pressable
          onPress={() => {
            getSocket()?.disconnect();
            void clearAuth();
            useGameStore.getState().clearAll();
            router.replace('/');
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><MaterialCommunityIcons name="arrow-left" size={14} color={ARCADE.blue} /><Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.blue, fontSize: 12 }}>BACK TO ARCADE</Text></View>
        </Pressable>
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
      showDialog('Repair which tool?', undefined, [
        ...dualTools.map((tool) => ({
          text: tool.toUpperCase(),
          onPress: () => {
            getSocket()?.emit('play_action', { cardId: selectedCard.id, targetPlayerId, chosenTool: tool });
            clearSelection();
          },
        })),
        { text: 'CANCEL', style: 'cancel' as const },
      ]);
      return;
    }
    getSocket()?.emit('play_action', { cardId: selectedCard.id, targetPlayerId });
    clearSelection();
  };

  const onPass = () => {
    if (!selectedCard) {
      showDialog('Pass turn', 'Select the card you want to discard first, then tap Pass. You will draw a new card.');
      return;
    }
    showDialog('Pass turn', 'Discard the selected card, draw a new one and pass?', [
      { text: 'CANCEL', style: 'cancel' },
      {
        text: 'PASS',
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
    router.dismissAll();
    router.replace('/');
  };

  const myGoldPick =
    publicState.status === 'round_end' &&
    publicState.goldDistribution?.currentPickerId === playerId;

  return (
    <View className="flex-1 bg-arcade-bg pt-12">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pb-3">
        <Text style={{ fontFamily: 'Outfit_800ExtraBold', letterSpacing: 1, ...neonText(ARCADE.cyan, 8) }}>
          ROUND {publicState.round}/3
        </Text>
        
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MaterialCommunityIcons name="cards-playing-outline" size={13} color={ARCADE.muted} />
            <Text style={{ fontFamily: 'SpaceMono_700Bold', color: ARCADE.muted, fontSize: 12 }}>{publicState.deckSize}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MaterialCommunityIcons name="delete-outline" size={13} color={ARCADE.muted} />
            <Text style={{ fontFamily: 'SpaceMono_700Bold', color: ARCADE.muted, fontSize: 12 }}>{publicState.discardSize}</Text>
          </View>
        </View>

        <Pressable
          onPress={() => setShowRole(true)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
        >
          <MaterialCommunityIcons
            name={privateState.role === 'saboteur' ? 'emoticon-devil-outline' : 'pickaxe'}
            size={13}
            color={privateState.role === 'saboteur' ? ARCADE.red : '#F5C518'}
          />
          <Text
            style={{
              fontFamily: 'Outfit_800ExtraBold',
              fontSize: 12,
              ...neonText(privateState.role === 'saboteur' ? ARCADE.red : '#F5C518', 8),
            }}
          >
            {privateState.role === 'saboteur' ? 'SABOTEUR' : 'MINER'}
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
          <Animated.Text
            entering={FadeIn}
            style={{ fontFamily: 'Outfit_700Bold', paddingBottom: 4, textAlign: 'center', fontSize: 12, ...neonText(ARCADE.red, 6) }}
          >
            Tap a player to target
          </Animated.Text>
        )}
        <PlayerStatusBar
          players={publicState.players}
          myPlayerId={playerId}
          selectable={Boolean(needsPlayerTarget)}
          onSelect={onPlayerSelect}
        />
      </View>

      {/* Zone C: hand */}
      <View className="flex-[30] px-2 pt-1">
        <View className="flex-row items-center justify-between px-2">
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, fontSize: 12 }}>
            {isMyTurn ? 'Your turn' : `Waiting for ${
              publicState.players.find((p) => p.isCurrentTurn)?.displayName ?? '…'
            }`}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {selectedCard?.type === 'path' && (
              <NeonButton
                label="ROTATE"
                color={ARCADE.purple}
                variant="outline"
                icon={<MaterialCommunityIcons name="sync" size={14} color={ARCADE.purple} />}
                onPress={() => useGameStore.getState().toggleRotated()}
              />
            )}
            <NeonButton
              label="PASS"
              color={ARCADE.pink}
              variant={isMyTurn ? 'solid' : 'outline'}
              disabled={!isMyTurn}
              icon={<MaterialCommunityIcons name="skip-forward" size={14} color={isMyTurn ? ARCADE.bg : ARCADE.muted} />}
              onPress={onPass}
            />
          </View>
        </View>
        <ScrollView horizontal contentContainerStyle={{ gap: 8, padding: 8, alignItems: 'center' }}>
          {privateState.hand.map((card) => {
            const selected = card.id === selectedCardId;
            return (
              <HandCard
                key={card.id}
                selected={selected}
                onPress={() => useGameStore.getState().setSelectedCard(selected ? null : card.id)}
              >
                {card.type === 'path' ? (
                  <PathCardView card={card} rotated={selected && rotated} width={56} height={84} />
                ) : (
                  <ActionCardView card={card} width={56} height={84} />
                )}
              </HandCard>
            );
          })}
          {privateState.hand.length === 0 && (
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, paddingHorizontal: 16 }}>No cards left this round</Text>
          )}
        </ScrollView>
      </View>

      {/* Map peek toast */}
      {peekMessage && (
        <Animated.View
          entering={SlideInUp.springify().damping(16)}
          style={{
            position: 'absolute',
            left: 32,
            right: 32,
            top: 96,
            zIndex: 40,
            alignItems: 'center',
            borderRadius: 16,
            borderWidth: 1,
            borderColor: ARCADE.border,
            backgroundColor: 'rgba(0, 0, 0, 0.95)',
            padding: 16,
            boxShadow: `0 0 16px ${ARCADE.purple}66`,
          }}
        >
          <Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 17, ...neonText('#F5C518', 10) }}>{peekMessage}</Text>
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, fontSize: 12, marginTop: 4 }}>(only you saw this)</Text>
        </Animated.View>
      )}

      {/* Overlays */}
      {showRole && publicState.status === 'playing' && (
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}
          onPress={() => setShowRole(false)}
        >
          <RoleRevealOverlay role={privateState.role} round={publicState.round} />
        </Pressable>
      )}
      {publicState.status === 'round_end' && <RoundEndOverlay state={publicState} />}
      {myGoldPick && publicState.goldDistribution && (
        <GoldPickOverlay
          cardCount={publicState.goldDistribution.availableCardCount}
          onPick={(cardIndex) => getSocket()?.emit('choose_gold', { cardIndex })}
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
