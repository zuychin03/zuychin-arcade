import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { router } from 'expo-router';
import type { CoupActionType, CoupCharacter } from '@zuychin-arcade/types';
import { ACTION_META, charactersForVariant } from '@zuychin-arcade/types';
import { useGameStore } from '../../store/useGameStore';
import { getSocket } from '../../hooks/useSocket';
import { clearAuth } from '../../lib/storage';
import { PlayerSeat } from '../../components/coup/PlayerSeat';
import { CharacterCard } from '../../components/coup/CharacterCard';
import { GameLog } from '../../components/coup/GameLog';
import { Countdown } from '../../components/coup/Countdown';
import { NeonButton } from '../../components/ui/NeonButton';
import { COUP, OVERLAY_FILL, neonText } from '../../constants/theme';

const ACTION_LABELS: Record<string, { label: string; emoji: string; hint: string }> = {
  income: { label: 'Income', emoji: '🪙', hint: '+1' },
  foreign_aid: { label: 'Foreign Aid', emoji: '💰', hint: '+2 · Duke blocks' },
  tax: { label: 'Tax', emoji: '👑', hint: 'Duke · +3' },
  steal: { label: 'Steal', emoji: '⚓', hint: 'Captain · take 2' },
  exchange: { label: 'Exchange', emoji: '🤝', hint: 'Ambassador' },
  assassinate: { label: 'Assassinate', emoji: '🗡️', hint: 'Assassin · -3' },
  coup: { label: 'Coup', emoji: '💥', hint: '-7 · unstoppable' },
};
const BASE_ACTIONS: CoupActionType[] = ['income', 'foreign_aid', 'tax', 'steal', 'exchange', 'assassinate', 'coup'];

const emit = (event: string, payload: unknown) => getSocket()?.emit(event, payload);

export default function CoupGameScreen() {
  const pub = useGameStore((s) => s.coupPublic);
  const priv = useGameStore((s) => s.coupPrivate);
  const myId = useGameStore((s) => s.playerId);

  const [targeting, setTargeting] = useState<CoupActionType | null>(null);
  const [keepSel, setKeepSel] = useState<number[]>([]);

  const phase = pub?.pending.phase;
  // reset transient UI when the situation changes
  useEffect(() => {
    setTargeting(null);
    setKeepSel([]);
  }, [phase, pub?.currentTurnPlayerId]);

  if (!pub || !priv || !myId) {
    return (
      <View className="flex-1 items-center justify-center bg-coup-bg">
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted }}>Connecting…</Text>
      </View>
    );
  }

  const me = pub.players.find((p) => p.playerId === myId);
  const pending = pub.pending;
  const nameOf = (id: string | null) => (id && pub.players.find((p) => p.playerId === id)?.displayName) || '?';
  const isMyTurn = pub.currentTurnPlayerId === myId && pending.phase === 'awaiting_action';
  const waitingOnMe = pending.waitingOn.includes(myId);
  const blockChars = pending.action
    ? ACTION_META[pending.action].blockableBy.filter((c) => charactersForVariant(pub.variant).includes(c))
    : [];
  const myCoins = me?.coins ?? 0;
  const mustCoup = myCoins >= 10;

  const act = (action: CoupActionType, targetPlayerId?: string) => emit('coup:action', { action, targetPlayerId });
  const respond = (response: 'challenge' | 'block' | 'pass', blockCharacter?: CoupCharacter) =>
    emit('coup:respond', { response, blockCharacter });

  const describe = (): string => {
    const a = pending.action;
    const actor = nameOf(pending.actorId);
    const label = a ? ACTION_LABELS[a]?.label ?? a : '';
    switch (pending.phase) {
      case 'awaiting_action':
        return `${nameOf(pub.currentTurnPlayerId)} is choosing an action…`;
      case 'awaiting_action_challenge':
        return `${actor} claims ${pending.claimedCharacter?.toUpperCase()} — ${label}`;
      case 'awaiting_block':
        if (a === 'foreign_aid') return `${actor} takes Foreign Aid — anyone may block with the Duke`;
        return `${actor} → ${label} on ${nameOf(pending.targetId)} — target may block`;
      case 'awaiting_block_challenge':
        return `${nameOf(pending.blockerId)} claims ${pending.blockCharacter?.toUpperCase()} to block`;
      case 'awaiting_lose_influence':
        return `${nameOf(pending.losingPlayerId)} loses an influence (${pending.loseReason?.replace(/_/g, ' ')})`;
      case 'awaiting_exchange':
        return `${actor} is exchanging cards with the court…`;
      default:
        return '';
    }
  };

  const onLeave = () => {
    getSocket()?.disconnect();
    void clearAuth();
    useGameStore.getState().clearAll();
    router.dismissAll();
    router.replace('/');
  };

  const myFaceDown = priv.influences.filter((i) => !i.revealed).map((i) => i.character);
  const gameOver = pending.phase === 'game_over' || pub.status === 'game_over';
  const iAmHost = pub.players[0]?.playerId === myId; // turn order starts with the host

  return (
    <View className="flex-1 bg-coup-bg">
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 52, gap: 12, paddingBottom: 36 }}>
        {/* header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 18, ...neonText(COUP.crimson, 10) }}>🎭 COUP</Text>
          <View style={{ flexDirection: 'row', gap: 14 }}>
            {pub.variant === 'reformation' && (
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.gold, fontSize: 12 }}>🏦 {pub.treasuryReserve}</Text>
            )}
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 12 }}>🂠 {pub.deckSize}</Text>
          </View>
        </View>

        {/* current situation banner */}
        <Animated.View
          entering={FadeIn.duration(250)}
          key={`${pending.phase}-${pending.actorId}-${pending.blockerId}`}
          style={{ borderRadius: 12, borderWidth: 1, borderColor: COUP.border, backgroundColor: COUP.panel, padding: 12, gap: 8 }}
        >
          <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.text, fontSize: 14, textAlign: 'center' }}>{describe()}</Text>
          {pending.deadline != null && <Countdown deadline={pending.deadline} />}
        </Animated.View>

        {/* players */}
        <View style={{ gap: 8 }}>
          {pub.players.map((p) => {
            const selectable = targeting != null && p.playerId !== myId && !p.eliminated;
            return (
              <PlayerSeat
                key={p.playerId}
                player={p}
                isMe={p.playerId === myId}
                selectable={selectable}
                waiting={pending.waitingOn.includes(p.playerId)}
                onSelect={
                  selectable
                    ? () => {
                        act(targeting!, p.playerId);
                        setTargeting(null);
                      }
                    : undefined
                }
              />
            );
          })}
        </View>

        {/* your influence */}
        <View>
          <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.muted, fontSize: 10, letterSpacing: 2, marginBottom: 6 }}>
            YOUR INFLUENCE
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {priv.influences.map((inf, i) => (
              <CharacterCard key={i} character={inf.character} lost={inf.revealed} size="sm" />
            ))}
          </View>
        </View>

        <GameLog log={pub.log} />
      </ScrollView>

      {/* action / response dock */}
      {!gameOver && (
        <Animated.View
          entering={FadeInUp.duration(250)}
          style={{ borderTopWidth: 1, borderTopColor: COUP.border, backgroundColor: COUP.surface, padding: 14, gap: 10 }}
        >
          {/* my turn */}
          {isMyTurn && targeting == null && (
            <>
              <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.gold, fontSize: 13, letterSpacing: 1 }}>
                YOUR TURN{mustCoup ? ' · 10+ coins — you must Coup' : ''}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {BASE_ACTIONS.map((a) => {
                  const meta = ACTION_META[a];
                  const info = ACTION_LABELS[a];
                  const disabled =
                    (mustCoup && a !== 'coup') ||
                    myCoins < meta.cost ||
                    (a === 'assassinate' && myCoins < 3) ||
                    (a === 'coup' && myCoins < 7);
                  return (
                    <View key={a} style={{ width: '48%' }}>
                      <NeonButton
                        label={`${info.emoji} ${info.label}`}
                        color={a === 'coup' || a === 'assassinate' ? COUP.crimson : a === 'tax' || a === 'exchange' ? COUP.purple : COUP.blue}
                        variant="outline"
                        disabled={disabled}
                        onPress={() => (meta.needsTarget ? setTargeting(a) : act(a))}
                      />
                      <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 9, textAlign: 'center', marginTop: 2 }}>
                        {info.hint}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* my turn — selecting a target */}
          {isMyTurn && targeting != null && (
            <>
              <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.gold, fontSize: 13 }}>
                Tap a player to {ACTION_LABELS[targeting].label.toLowerCase()}…
              </Text>
              <NeonButton label="CANCEL" color={COUP.muted} variant="ghost" onPress={() => setTargeting(null)} />
            </>
          )}

          {/* response: action challenge */}
          {waitingOnMe && pending.phase === 'awaiting_action_challenge' && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <NeonButton label="🚩 CHALLENGE" color={COUP.crimson} onPress={() => respond('challenge')} />
              </View>
              <View style={{ flex: 1 }}>
                <NeonButton label="✓ ALLOW" color={COUP.green} variant="outline" onPress={() => respond('pass')} />
              </View>
            </View>
          )}

          {/* response: block window */}
          {waitingOnMe && pending.phase === 'awaiting_block' && (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {blockChars.map((c) => (
                  <View key={c} style={{ flexGrow: 1, minWidth: '46%' }}>
                    <NeonButton label={`🛡️ BLOCK (${c})`} color={COUP.purple} onPress={() => respond('block', c)} />
                  </View>
                ))}
              </View>
              <NeonButton label="✓ ALLOW" color={COUP.green} variant="outline" onPress={() => respond('pass')} />
            </View>
          )}

          {/* response: challenge the block */}
          {waitingOnMe && pending.phase === 'awaiting_block_challenge' && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <NeonButton label="🚩 CHALLENGE BLOCK" color={COUP.crimson} onPress={() => respond('challenge')} />
              </View>
              <View style={{ flex: 1 }}>
                <NeonButton label="✓ ALLOW" color={COUP.green} variant="outline" onPress={() => respond('pass')} />
              </View>
            </View>
          )}

          {/* lose influence */}
          {waitingOnMe && pending.phase === 'awaiting_lose_influence' && (
            <>
              <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.crimson, fontSize: 13 }}>Choose an influence to lose</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {myFaceDown.map((c, i) => (
                  <CharacterCard key={i} character={c} size="md" onPress={() => emit('coup:lose_influence', { character: c })} />
                ))}
              </View>
            </>
          )}

          {/* exchange */}
          {waitingOnMe && pending.phase === 'awaiting_exchange' && priv.exchange && (
            <>
              <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.gold, fontSize: 13 }}>
                Keep {priv.exchange.keepCount} — tap to choose
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {priv.exchange.pool.map((c, i) => (
                  <CharacterCard
                    key={i}
                    character={c}
                    size="md"
                    selected={keepSel.includes(i)}
                    onPress={() =>
                      setKeepSel((sel) =>
                        sel.includes(i)
                          ? sel.filter((x) => x !== i)
                          : sel.length < priv.exchange!.keepCount
                            ? [...sel, i]
                            : sel,
                      )
                    }
                  />
                ))}
              </View>
              <NeonButton
                label={`CONFIRM (${keepSel.length}/${priv.exchange.keepCount})`}
                color={COUP.gold}
                disabled={keepSel.length !== priv.exchange.keepCount}
                onPress={() => emit('coup:exchange', { keep: keepSel.map((i) => priv.exchange!.pool[i]) })}
              />
            </>
          )}

          {/* spectating / waiting on others */}
          {!isMyTurn && !waitingOnMe && (
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 12, textAlign: 'center' }}>
              {me?.eliminated ? 'You are out — spectating.' : `Waiting for ${pending.waitingOn.map(nameOf).join(', ') || '…'}`}
            </Text>
          )}
        </Animated.View>
      )}

      {/* game over */}
      {gameOver && (
        <Animated.View entering={FadeIn.duration(400)} style={OVERLAY_FILL}>
          <Text style={{ fontSize: 64 }}>{pub.winnerId === myId ? '👑' : '🎭'}</Text>
          <Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 26, ...neonText(COUP.gold, 16), marginTop: 8 }}>
            {pub.winnerId === myId ? 'YOU WIN!' : `${nameOf(pub.winnerId)} WINS`}
          </Text>
          <View style={{ width: 240, gap: 10, marginTop: 28 }}>
            {iAmHost && <NeonButton label="▶ PLAY AGAIN" color={COUP.crimson} onPress={() => emit('start_game', {})} />}
            <NeonButton label="BACK TO HUB" color={COUP.blue} variant="outline" onPress={onLeave} />
          </View>
        </Animated.View>
      )}
    </View>
  );
}
