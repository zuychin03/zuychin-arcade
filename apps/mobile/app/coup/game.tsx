import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CoupActionType, CoupCharacter } from '@zuychin-arcade/types';
import { ACTION_META, charactersForVariant } from '@zuychin-arcade/types';
import { useGameStore } from '../../store/useGameStore';
import { getSocket } from '../../hooks/useSocket';
import { clearAuth } from '../../lib/storage';
import { PlayerSeat } from '../../components/coup/PlayerSeat';
import { CharacterCard } from '../../components/coup/CharacterCard';
import { GameLog } from '../../components/coup/GameLog';
import { Countdown } from '../../components/coup/Countdown';
import { ReferenceSheet, ReferencePanel } from '../../components/coup/ReferenceSheet';
import { NeonButton } from '../../components/ui/NeonButton';
import { Coin } from '../../components/ui/Coin';
import { COUP, OVERLAY_FILL, neonText } from '../../constants/theme';

const ACTION_LABELS: Record<CoupActionType, { label: string; hint: string }> = {
  income: { label: 'Income', hint: '+1 coin' },
  foreign_aid: { label: 'Foreign Aid', hint: '+2 coins (Duke blocks)' },
  tax: { label: 'Tax', hint: 'Duke · +3 coins' },
  steal: { label: 'Steal', hint: 'Captain · take 2 coins' },
  exchange: { label: 'Exchange', hint: 'Ambassador · swap 2' },
  assassinate: { label: 'Assassinate', hint: 'Assassin · pay 3' },
  coup: { label: 'Coup', hint: 'pay 7 · target loses 1 card' },
  convert: { label: 'Convert', hint: 'pay 1 (self) / 2 (other)' },
  embezzle: { label: 'Embezzle', hint: 'no Duke · take Reserve' },
  inquisitor_exchange: { label: 'Exchange', hint: 'Inquisitor · swap 1' },
  inquisitor_examine: { label: 'Examine', hint: 'Inquisitor · inspect card' },
};

const ACTION_ICONS: Record<CoupActionType, keyof typeof MaterialCommunityIcons.glyphMap> = {
  income: 'cash-multiple',
  foreign_aid: 'bank-transfer-in',
  tax: 'crown',
  steal: 'anchor',
  exchange: 'handshake',
  assassinate: 'sword',
  coup: 'flash-alert',
  convert: 'swap-horizontal',
  embezzle: 'bank-minus',
  inquisitor_exchange: 'handshake',
  inquisitor_examine: 'magnify',
};

const emit = (event: string, payload: unknown) => getSocket()?.emit(event, payload);

export default function CoupGameScreen() {
  const pub = useGameStore((s) => s.coupPublic);
  const priv = useGameStore((s) => s.coupPrivate);
  const myId = useGameStore((s) => s.playerId);

  const [targeting, setTargeting] = useState<CoupActionType | null>(null);
  const [keepSel, setKeepSel] = useState<number[]>([]);
  const [showRef, setShowRef] = useState(false);
  const [activeReactions, setActiveReactions] = useState<Record<string, string>>({});
  const [showTaunts, setShowTaunts] = useState(false);
  const [seatsWidth, setSeatsWidth] = useState(0);
  const { width: winWidth } = useWindowDimensions();
  const isWide = winWidth >= 900; // desktop-ish: action dock becomes a right sidebar
  const isXWide = winWidth >= 1180; // extra-wide: reference shows as a persistent panel too

  const phase = pub?.pending.phase;

  // Reset transient UI when the turn/phase situation changes
  useEffect(() => {
    setTargeting(null);
    setKeepSel([]);
  }, [phase, pub?.currentTurnPlayerId]);

  // Listen to transient reactions broadcast from server
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onReaction = ({ playerId, reaction }: { playerId: string; reaction: string }) => {
      setActiveReactions((prev) => ({ ...prev, [playerId]: reaction }));
      setTimeout(() => {
        setActiveReactions((prev) => {
          const next = { ...prev };
          delete next[playerId];
          return next;
        });
      }, 3000);
    };

    socket.on('reaction_received', onReaction);
    return () => {
      socket.off('reaction_received', onReaction);
    };
  }, []);

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
      case 'awaiting_examine':
        return `${actor} is examining target card…`;
      default:
        return '';
    }
  };

  const getPhaseIcon = (): keyof typeof MaterialCommunityIcons.glyphMap => {
    switch (pending.phase) {
      case 'awaiting_action_challenge':
      case 'awaiting_block_challenge':
        return 'alert-decagram-outline';
      case 'awaiting_block':
        return 'shield-alert-outline';
      case 'awaiting_lose_influence':
        return 'skull-outline';
      case 'awaiting_exchange':
      case 'awaiting_examine':
        return 'cards-outline';
      default:
        return 'timer-sand';
    }
  };

  const onLeave = () => {
    getSocket()?.disconnect();
    void clearAuth();
    useGameStore.getState().clearAll();
    router.dismissAll();
    router.replace('/');
  };

  // Tint the situation banner by what kind of decision is in the air.
  const bannerAccent =
    pending.phase.includes('challenge')
      ? COUP.crimson
      : pending.phase === 'awaiting_block'
        ? COUP.purple
        : pending.phase === 'awaiting_lose_influence'
          ? COUP.crimson
          : COUP.gold;

  const myFaceDown = priv.influences.filter((i) => !i.revealed).map((i) => i.character);
  const gameOver = pending.phase === 'game_over' || pub.status === 'game_over';
  const iAmHost = pub.players[0]?.playerId === myId; // turn order starts with the host

  const actionGroup = getActionsForVariant(pub.variant);

  // Responsive player grid — fit as many seats per row as the width allows.
  const SEAT_GAP = 10;
  const MIN_SEAT_W = 168;
  const seatCols = seatsWidth > 0 ? Math.max(1, Math.floor((seatsWidth + SEAT_GAP) / (MIN_SEAT_W + SEAT_GAP))) : 1;
  const seatW = seatsWidth > 0 ? Math.floor((seatsWidth - SEAT_GAP * (seatCols - 1)) / seatCols) : undefined;

  return (
    <View className="flex-1 bg-coup-bg" style={{ flexDirection: isWide ? 'row' : 'column' }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: 52, gap: 12, paddingBottom: 36 }}>
        {/* header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}><MaterialCommunityIcons name="drama-masks" size={21} color={COUP.crimson} /><Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 18, ...neonText(COUP.crimson, 10) }}>COUP</Text></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {pub.variant === 'reformation' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MaterialCommunityIcons name="bank" size={14} color={COUP.gold} />
                <Text style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.gold, fontSize: 13 }}>{pub.treasuryReserve}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialCommunityIcons name="cards-playing-outline" size={14} color={COUP.muted} />
              <Text style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.muted, fontSize: 13 }}>{pub.deckSize}</Text>
            </View>
            {!isXWide && (
              <Pressable
                onPress={() => setShowRef(true)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: COUP.border,
                  backgroundColor: COUP.panel,
                  paddingHorizontal: 9,
                  paddingVertical: 5,
                }}
              >
                <MaterialCommunityIcons name="book-open-variant" size={11} color={COUP.muted} />
                <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.muted, fontSize: 11 }}>Rules</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* current situation banner */}
        <Animated.View
          entering={FadeIn.duration(250)}
          key={`${pending.phase}-${pending.actorId}-${pending.blockerId}`}
          style={{
            borderRadius: 12,
            borderWidth: 1,
            borderColor: `${bannerAccent}99`,
            borderLeftWidth: 3,
            borderLeftColor: bannerAccent,
            backgroundColor: COUP.panel,
            padding: 12,
            gap: 8,
            boxShadow: `0 0 12px ${bannerAccent}2E`,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
            <MaterialCommunityIcons name={getPhaseIcon()} size={16} color={bannerAccent} />
            <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.text, fontSize: 14 }}>{describe()}</Text>
          </View>
          {pending.deadline != null && <Countdown deadline={pending.deadline} />}
        </Animated.View>

        {/* players — responsive grid: more seats per row as the width grows */}
        <View
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            setSeatsWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
          }}
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SEAT_GAP }}
        >
          {pub.players.map((p) => {
            const selectable = targeting != null && p.playerId !== myId && !p.eliminated;
            return (
              <View key={p.playerId} style={{ width: seatW ?? '100%' }}>
                <PlayerSeat
                  player={p}
                  isMe={p.playerId === myId}
                  fill
                  selectable={selectable}
                  waiting={pending.waitingOn.includes(p.playerId)}
                  reaction={activeReactions[p.playerId]}
                  onSelect={
                    selectable
                      ? () => {
                          act(targeting!, p.playerId);
                          setTargeting(null);
                        }
                      : undefined
                  }
                />
              </View>
            );
          })}
        </View>

        {/* your influence */}
        <View style={{ marginTop: 4, marginBottom: 12, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.muted, fontSize: 10, letterSpacing: 2 }}>
              YOUR INFLUENCE
            </Text>
            <Coin amount={myCoins} size="md" showText />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {priv.influences.map((inf, i) => (
              <CharacterCard key={i} character={inf.character} lost={inf.revealed} size="md" />
            ))}
          </View>
        </View>

        {/* Collapsible Taunts Reaction Tray */}
        <View style={{ marginVertical: 4 }}>
          <GameLog log={pub.log} />
          <Pressable
            onPress={() => setShowTaunts(!showTaunts)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 22,
              marginBottom: showTaunts ? 8 : 2,
              paddingVertical: 4,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialCommunityIcons name="bullhorn-outline" size={13} color={COUP.muted} />
              <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.muted, fontSize: 10, letterSpacing: 1.5 }}>
                TAUNT ENEMIES
              </Text>
            </View>
            <MaterialCommunityIcons name={showTaunts ? 'chevron-up' : 'chevron-down'} size={14} color={COUP.muted} />
          </Pressable>

          {showTaunts && (
            <Animated.View entering={FadeIn.duration(200)}>
              <ScrollView style={{ maxHeight: 132 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {getTauntsForVariant(pub.variant).map((taunt) => (
                  <Pressable
                    key={taunt.text}
                    onPress={() => getSocket()?.emit('player_reaction', { reaction: taunt.text })}
                    style={{
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: `${taunt.color}66`,
                      backgroundColor: `${taunt.color}14`,
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }}
                  >
                    <MaterialCommunityIcons name={taunt.icon} size={11} color={taunt.color} />
                    <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.text, fontSize: 11 }}>{taunt.label}</Text>
                  </Pressable>
                ))}
                </View>
              </ScrollView>
            </Animated.View>
          )}
        </View>
      </ScrollView>

      {/* action / response dock — bottom bar on narrow, right sidebar on wide */}
      {!gameOver && (
        <Animated.View
          entering={(isWide ? FadeIn : FadeInUp).duration(250)}
          style={
            isWide
              ? { maxWidth: 400, borderLeftWidth: 1, borderLeftColor: COUP.border, backgroundColor: COUP.surface, padding: 14, gap: 10 }
              : { borderTopWidth: 1, borderTopColor: COUP.border, backgroundColor: COUP.surface, padding: 14, gap: 10 }
          }
        >
          {/* my turn */}
          {isMyTurn && targeting == null && (
            <ScrollView style={isWide ? { flex: 1 } : { maxHeight: 350 }} showsVerticalScrollIndicator={false}>
              <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.gold, fontSize: 13, letterSpacing: 1, marginBottom: 8 }}>
                YOUR TURN {mustCoup ? ' · 10+ coins — you must Coup' : ''}
              </Text>
              
              <View style={{ gap: 12 }}>
                {/* 1. General Actions */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.muted, fontSize: 9, letterSpacing: 1 }}>
                    GENERAL ACTIONS (NO CLAIM)
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {actionGroup.general.map((a) => renderActionButton(a, myCoins, mustCoup, act, setTargeting))}
                  </View>
                </View>

                {/* 2. Character Claims */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.muted, fontSize: 9, letterSpacing: 1 }}>
                    CHARACTER CLAIMS (CHALLENGEABLE)
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {actionGroup.character.map((a) => renderActionButton(a, myCoins, mustCoup, act, setTargeting))}
                  </View>
                </View>

                {/* 3. Reformation Faction (If active) */}
                {pub.variant === 'reformation' && (
                  <View style={{ gap: 6 }}>
                    <Text style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.muted, fontSize: 9, letterSpacing: 1 }}>
                      FACTION ACTIONS (REFORMATION)
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {actionGroup.reformation.map((a) => {
                        if (a === 'convert') {
                          const disabledSelf = mustCoup || myCoins < 1;
                          const disabledOther = mustCoup || myCoins < 2;
                          return (
                            <View key="convert-split" style={{ flexDirection: 'row', width: '100%', gap: 6 }}>
                              <View style={{ flex: 1 }}>
                                <NeonButton
                                  label="Convert Self"
                                  color={COUP.gold}
                                  variant="outline"
                                  disabled={disabledSelf}
                                  icon={<MaterialCommunityIcons name="swap-horizontal" size={13} color={COUP.gold} />}
                                  onPress={() => act('convert', myId)}
                                />
                                <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 9, textAlign: 'center', marginTop: 2 }}>
                                  Cost: 1 coin
                                </Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <NeonButton
                                  label="Convert Other"
                                  color={COUP.gold}
                                  variant="outline"
                                  disabled={disabledOther}
                                  icon={<MaterialCommunityIcons name="swap-horizontal" size={13} color={COUP.gold} />}
                                  onPress={() => setTargeting('convert')}
                                />
                                <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 9, textAlign: 'center', marginTop: 2 }}>
                                  Cost: 2 coins
                                </Text>
                              </View>
                            </View>
                          );
                        }
                        return renderActionButton(a, myCoins, mustCoup, act, setTargeting);
                      })}
                    </View>
                  </View>
                )}
              </View>
            </ScrollView>
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
                <NeonButton
                  label="CHALLENGE"
                  color={COUP.crimson}
                  icon={<MaterialCommunityIcons name="flag-outline" size={16} color={COUP.text} />}
                  onPress={() => respond('challenge')}
                />
              </View>
              <View style={{ flex: 1 }}>
                <NeonButton
                  label="ALLOW"
                  color={COUP.green}
                  variant="outline"
                  icon={<MaterialCommunityIcons name="check" size={16} color={COUP.green} />}
                  onPress={() => respond('pass')}
                />
              </View>
            </View>
          )}

          {/* response: block window */}
          {waitingOnMe && pending.phase === 'awaiting_block' && (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {blockChars.map((c) => (
                  <View key={c} style={{ flexGrow: 1, minWidth: '46%' }}>
                    <NeonButton
                      label={`BLOCK (${c})`}
                      color={COUP.purple}
                      icon={<MaterialCommunityIcons name="shield-outline" size={15} color={COUP.text} />}
                      onPress={() => respond('block', c)}
                    />
                  </View>
                ))}
              </View>
              <NeonButton
                label="ALLOW"
                color={COUP.green}
                variant="outline"
                icon={<MaterialCommunityIcons name="check" size={15} color={COUP.green} />}
                onPress={() => respond('pass')}
              />
            </View>
          )}

          {/* response: challenge the block */}
          {waitingOnMe && pending.phase === 'awaiting_block_challenge' && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <NeonButton
                  label="CHALLENGE BLOCK"
                  color={COUP.crimson}
                  icon={<MaterialCommunityIcons name="flag-outline" size={16} color={COUP.text} />}
                  onPress={() => respond('challenge')}
                />
              </View>
              <View style={{ flex: 1 }}>
                <NeonButton
                  label="ALLOW"
                  color={COUP.green}
                  variant="outline"
                  icon={<MaterialCommunityIcons name="check" size={16} color={COUP.green} />}
                  onPress={() => respond('pass')}
                />
              </View>
            </View>
          )}

          {/* lose influence */}
          {waitingOnMe && pending.phase === 'awaiting_lose_influence' && (
            <>
              <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.crimson, fontSize: 13, marginBottom: 4 }}>
                Choose an influence to lose
              </Text>
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
              <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.gold, fontSize: 13, marginBottom: 4 }}>
                Keep {priv.exchange.keepCount} — tap to choose
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
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
                icon={<MaterialCommunityIcons name="checkbox-marked-circle-outline" size={15} color={COUP.gold} />}
                onPress={() => emit('coup:exchange', { keep: keepSel.map((i) => priv.exchange!.pool[i]) })}
              />
            </>
          )}

          {/* Inquisitor Examine Overlay */}
          {waitingOnMe && pending.phase === 'awaiting_examine' && priv.examine && (
            <>
              <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.gold, fontSize: 13, marginBottom: 4 }}>
                EXAMINED CARD (Target: {priv.examine.targetName})
              </Text>
              <View style={{ alignItems: 'center', marginVertical: 12 }}>
                <CharacterCard character={priv.examine.character} size="lg" />
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <NeonButton
                    label="RETURN CARD"
                    color={COUP.green}
                    variant="outline"
                    icon={<MaterialCommunityIcons name="check" size={15} color={COUP.green} />}
                    onPress={() => emit('coup:examine', { forceSwap: false })}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <NeonButton
                    label="FORCE SWAP"
                    color={COUP.crimson}
                    icon={<MaterialCommunityIcons name="swap-horizontal" size={15} color={COUP.text} />}
                    onPress={() => emit('coup:examine', { forceSwap: true })}
                  />
                </View>
              </View>
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

      {/* reference — persistent panel, right of the action dock, on extra-wide screens */}
      {!gameOver && isXWide && <ReferencePanel variant={pub.variant} style={{ maxWidth: 400 }} />}

      {/* game over */}
      {gameOver && (
        <Animated.View entering={FadeIn.duration(400)} style={OVERLAY_FILL}>
          <MaterialCommunityIcons name={pub.winnerId === myId ? 'crown-outline' : 'drama-masks'} size={64} color={COUP.gold} />
          <Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 26, ...neonText(COUP.gold, 16), marginTop: 8 }}>
            {pub.winnerId === myId ? 'YOU WIN!' : `${nameOf(pub.winnerId)} WINS`}
          </Text>
          <View style={{ width: 240, gap: 10, marginTop: 28 }}>
            {iAmHost && <NeonButton label="PLAY AGAIN" icon={<MaterialCommunityIcons name="play" size={16} color={COUP.bg} />} color={COUP.crimson} onPress={() => emit('start_game', {})} />}
            <NeonButton label="BACK TO HUB" color={COUP.blue} variant="outline" onPress={onLeave} />
          </View>
        </Animated.View>
      )}

      <ReferenceSheet visible={showRef && !isXWide} variant={pub.variant} onClose={() => setShowRef(false)} />
    </View>
  );
}

function getActionsForVariant(variant: 'base' | 'reformation') {
  const general: CoupActionType[] = ['income', 'foreign_aid', 'coup'];
  const character: CoupActionType[] =
    variant === 'base'
      ? ['tax', 'assassinate', 'steal', 'exchange']
      : ['tax', 'assassinate', 'steal', 'inquisitor_exchange', 'inquisitor_examine'];
  const reformation: CoupActionType[] = variant === 'reformation' ? ['convert', 'embezzle'] : [];

  return { general, character, reformation };
}

function renderActionButton(
  a: CoupActionType,
  myCoins: number,
  mustCoup: boolean,
  act: (action: CoupActionType, target?: string) => void,
  setTargeting: (action: CoupActionType | null) => void,
) {
  const meta = ACTION_META[a];
  const info = ACTION_LABELS[a];
  const disabled =
    (mustCoup && a !== 'coup') ||
    myCoins < meta.cost ||
    (a === 'assassinate' && myCoins < 3) ||
    (a === 'coup' && myCoins < 7);

  const isDanger = a === 'coup' || a === 'assassinate';
  const isSpecial = a === 'tax' || a === 'exchange' || a === 'inquisitor_exchange' || a === 'inquisitor_examine';
  const buttonColor = isDanger ? COUP.crimson : isSpecial ? COUP.purple : COUP.blue;

  return (
    <View key={a} style={{ width: '48%', flexGrow: 1, marginBottom: 8 }}>
      <NeonButton
        label={info.label}
        color={buttonColor}
        variant="outline"
        disabled={disabled}
        icon={<MaterialCommunityIcons name={ACTION_ICONS[a]} size={14} color={disabled ? `${buttonColor}50` : buttonColor} />}
        onPress={() => (meta.needsTarget ? setTargeting(a) : act(a))}
      />
      <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 9, textAlign: 'center', marginTop: 2 }}>
        {info.hint}
      </Text>
    </View>
  );
}

function getTauntsForVariant(variant: 'base' | 'reformation') {
  const basic = [
    { label: 'I am Duke!', text: 'I have a Duke!', icon: 'crown' as const, color: '#A855F7' },
    { label: 'I am Assassin!', text: 'I have Assassin!', icon: 'sword' as const, color: '#C2410C' },
    { label: 'I am Captain!', text: 'I have Captain!', icon: 'anchor' as const, color: '#4F8EF7' },
  ];

  const middle =
    variant === 'base'
      ? { label: 'I am Ambassador!', text: 'I have Ambassador!', icon: 'handshake' as const, color: '#34D399' }
      : { label: 'I am Inquisitor!', text: 'I have Inquisitor!', icon: 'magnify' as const, color: '#F4C04E' };

  const rest = [
    { label: 'I am Contessa!', text: 'I have Contessa!', icon: 'shield-crown' as const, color: '#E23A5E' },
    { label: 'Doubt it!', text: 'Doubt it!', icon: 'flag-outline' as const, color: '#E23A5E' },
    { label: 'Allow!', text: 'Allowing', icon: 'check' as const, color: '#34D399' },
    { label: 'Block!', text: 'Blocking', icon: 'shield-outline' as const, color: '#A855F7' },
    { label: 'Nice play!', text: 'Nice play!', icon: 'thumb-up-outline' as const, color: '#F4C04E' },
  ];

  return [...basic, middle, ...rest];
}
