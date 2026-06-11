import { Pressable, ScrollView, Text, View } from 'react-native';
import type { PublicPlayerState, Tool } from '@zuychin-arcade/types';
import { GlowPulse } from '../ui/GlowPulse';
import { ARCADE } from '../../constants/theme';

const TOOLS: Array<{ tool: Tool; icon: string }> = [
  { tool: 'lantern', icon: '🔦' },
  { tool: 'pickaxe', icon: '⛏️' },
  { tool: 'cart', icon: '🛒' },
];

interface Props {
  players: PublicPlayerState[];
  myPlayerId: string | null;
  selectable: boolean;            // true while picking a sabotage/repair target
  onSelect: (playerId: string) => void;
}

export function PlayerStatusBar({ players, myPlayerId, selectable, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      className="grow-0 border-y border-arcade-border bg-arcade-surface"
      contentContainerStyle={{ padding: 6, gap: 6 }}
    >
      {players.map((p) => (
        <Pressable
          key={p.playerId}
          disabled={!selectable}
          onPress={() => onSelect(p.playerId)}
          style={{
            minWidth: 88,
            borderRadius: 10,
            paddingHorizontal: 8,
            paddingVertical: 6,
            backgroundColor: p.isCurrentTurn ? ARCADE.panel : ARCADE.bg,
            borderWidth: 1,
            borderColor: p.isCurrentTurn ? ARCADE.cyan : ARCADE.border,
          }}
        >
          {p.isCurrentTurn && <GlowPulse color={ARCADE.cyan} borderRadius={10} borderWidth={1.5} />}
          {selectable && <GlowPulse color={ARCADE.red} borderRadius={10} borderWidth={1.5} />}
          <Text numberOfLines={1} className="text-xs font-semibold text-arcade-text">
            {p.playerId === myPlayerId ? '⭐ ' : ''}
            {p.displayName}
          </Text>
          <View className="mt-1 flex-row items-center gap-1.5">
            <Text className="text-[10px] text-arcade-muted">🃏{p.handSize}</Text>
            <Text className="text-[10px]" style={{ color: '#F5C518' }}>
              🪙{p.goldCollected}
            </Text>
          </View>
          <View className="mt-0.5 flex-row gap-1">
            {TOOLS.map(({ tool, icon }) => {
              const broken = p.brokenTools.includes(tool);
              return (
                <Text key={tool} style={{ opacity: broken ? 1 : 0.4, fontSize: 11 }}>
                  {icon}
                  {broken ? '🚫' : ''}
                </Text>
              );
            })}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
