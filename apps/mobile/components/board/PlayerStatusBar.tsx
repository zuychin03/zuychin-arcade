import { Pressable, ScrollView, Text, View } from 'react-native';
import type { PublicPlayerState, Tool } from '@zuychin-arcade/types';

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
    <ScrollView horizontal className="grow-0 bg-mine-surface" contentContainerStyle={{ padding: 6, gap: 6 }}>
      {players.map((p) => (
        <Pressable
          key={p.playerId}
          disabled={!selectable}
          onPress={() => onSelect(p.playerId)}
          className={`min-w-[86px] rounded-lg px-2 py-1.5 ${
            p.isCurrentTurn ? 'border-2 border-mine-gold bg-mine-tunnel/50' : 'border border-mine-stone/30 bg-mine-bg'
          } ${selectable ? 'border-2 border-dashed border-mine-danger' : ''}`}
        >
          <Text numberOfLines={1} className="text-xs font-semibold text-white">
            {p.playerId === myPlayerId ? '⭐ ' : ''}
            {p.displayName}
          </Text>
          <View className="mt-1 flex-row items-center gap-1">
            <Text className="text-[10px] text-mine-stone">🃏{p.handSize}</Text>
            <Text className="text-[10px] text-mine-gold">🪙{p.goldCollected}</Text>
          </View>
          <View className="mt-0.5 flex-row gap-1">
            {TOOLS.map(({ tool, icon }) => {
              const broken = p.brokenTools.includes(tool);
              return (
                <Text key={tool} style={{ opacity: broken ? 1 : 0.45, fontSize: 11 }}>
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
