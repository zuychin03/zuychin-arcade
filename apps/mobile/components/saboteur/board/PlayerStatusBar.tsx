import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Player, PublicPlayerState } from '@zuychin-arcade/types';
import { NeonButton } from '../../ui/NeonButton';
import { ARCADE, MINE } from '../../../constants/theme';
import { useReducedMotionPreference } from '../../../hooks/useReducedMotionPreference';

interface Props {
  players: PublicPlayerState[];
  presencePlayers: Player[] | null;
  myPlayerId: string | null;
  myGoldCollected: number;
  targeting: boolean;
  eligiblePlayerIds: Set<string>;
  onSelect: (playerId: string) => void;
}

export function PlayerStatusBar({ players, presencePlayers, myPlayerId, myGoldCollected, targeting, eligiblePlayerIds, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [viewport, setViewport] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const reduceMotion = useReducedMotionPreference();
  const renderPlayer = (player: PublicPlayerState) => {
    const presence = presencePlayers?.find((seat) => seat.playerId === player.playerId);
    const left = player.forfeited || Boolean(presencePlayers && (!presence || presence.hasLeft));
    const connected = !left && (presence?.isConnected ?? true);
    const eligible = targeting && eligiblePlayerIds.has(player.playerId);
    const gold = player.goldCollected ?? (player.playerId === myPlayerId ? myGoldCollected : null);
    const tools = player.brokenTools.length ? 'Broken: ' + player.brokenTools.join(', ') : 'All tools working';
    return <Pressable key={player.playerId} nativeID={'saboteur-player-' + player.playerId}
      accessibilityRole={eligible ? 'button' : 'summary'} disabled={!eligible}
      accessibilityLabel={player.displayName + (player.playerId === myPlayerId ? ', you.' : '.') + (left ? ' Has left the game.' : !connected ? ' Reconnecting.' : '') + ' ' + player.handSize + ' cards. ' + tools + '. ' + (gold === null ? 'Gold hidden.' : gold + ' gold.') + (eligible ? ' Eligible target.' : '')}
      accessibilityState={{ disabled: !eligible }}
      onPress={() => onSelect(player.playerId)}
      style={{ width: expanded ? '100%' : 180, minHeight: 108, borderRadius: 12, padding: 12, gap: 5, borderWidth: 2, borderColor: eligible ? ARCADE.pink : player.isCurrentTurn ? ARCADE.cyan : ARCADE.border, backgroundColor: MINE.bg }}>
      <Text style={{ color: player.isCurrentTurn ? ARCADE.cyan : ARCADE.text, fontFamily: 'Outfit_700Bold', fontSize: 15 }}>{player.displayName}{player.playerId === myPlayerId ? ' (you)' : ''}</Text>
      <Text style={{ color: left ? ARCADE.red : ARCADE.muted, fontSize: 12, lineHeight: 17 }}>{left ? 'LEFT · NO LONGER PLAYING' : !connected ? 'RECONNECTING · SEAT RESERVED' : player.isCurrentTurn ? 'CURRENT TURN' : player.handSize + ' cards'}</Text>
      {!left && <Text style={{ color: player.brokenTools.length ? ARCADE.red : ARCADE.text, fontSize: 12, lineHeight: 17 }}>{tools}</Text>}
      <Text style={{ color: gold === null ? ARCADE.muted : MINE.gold, fontSize: 12 }}>{gold === null ? 'Gold hidden until final scores' : gold + ' gold'}</Text>
      {eligible && <Text style={{ color: ARCADE.pink, fontSize: 12, fontFamily: 'Outfit_700Bold' }}>CHOOSE PLAYER</Text>}
    </Pressable>;
  };
  return <View nativeID="saboteur-players" style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: ARCADE.border, padding: 8, gap: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
      <Text accessibilityRole="header" style={{ color: ARCADE.text, fontFamily: 'Outfit_700Bold', fontSize: 15 }}>Players · {players.length}</Text>
      <NeonButton label={expanded ? 'COLLAPSE PLAYERS' : 'VIEW ALL PLAYERS'} color={ARCADE.cyan} variant="ghost" onPress={() => setExpanded(!expanded)} />
    </View>
    {expanded ? <View style={{ gap: 8 }}>{players.map(renderPlayer)}</View> : <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous players" disabled={offset <= 2} accessibilityState={{ disabled: offset <= 2 }}
        onPress={() => scroll.current?.scrollTo({ x: Math.max(0, offset - viewport), animated: !reduceMotion })} style={{ width: 44, minHeight: 80, alignItems: 'center', justifyContent: 'center', opacity: offset > 2 ? 1 : 0.4 }}>
        <MaterialCommunityIcons name="chevron-left" size={24} color={ARCADE.cyan} />
      </Pressable>
      <ScrollView ref={scroll} horizontal style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingBottom: 8 }} showsHorizontalScrollIndicator
        tabIndex={Platform.OS === 'web' ? 0 : undefined} role={Platform.OS === 'web' ? 'region' : undefined} accessibilityLabel="Player roster, scroll sideways or view all players"
        onLayout={(event) => setViewport(event.nativeEvent.layout.width)} onContentSizeChange={setContentWidth}
        onScroll={(event) => setOffset(event.nativeEvent.contentOffset.x)} scrollEventThrottle={16}>
        {players.map(renderPlayer)}
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Next players" disabled={offset + viewport >= contentWidth - 2} accessibilityState={{ disabled: offset + viewport >= contentWidth - 2 }}
        onPress={() => scroll.current?.scrollTo({ x: offset + viewport, animated: !reduceMotion })} style={{ width: 44, minHeight: 80, alignItems: 'center', justifyContent: 'center', opacity: offset + viewport < contentWidth - 2 ? 1 : 0.4 }}>
        <MaterialCommunityIcons name="chevron-right" size={24} color={ARCADE.cyan} />
      </Pressable>
    </View>}
  </View>;
}
