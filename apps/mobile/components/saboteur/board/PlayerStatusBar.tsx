import { Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { PublicPlayerState, Tool } from '@zuychin-arcade/types';
import { GlowPulse } from '../../ui/GlowPulse';
import { Coin } from '../../ui/Coin';
import { ARCADE } from '../../../constants/theme';

const TOOLS: Array<{ tool: Tool; icon: keyof typeof MaterialCommunityIcons.glyphMap }> = [
  { tool: 'lantern', icon: 'flashlight' },
  { tool: 'pickaxe', icon: 'pickaxe' },
  { tool: 'cart', icon: 'cart-outline' },
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
      className="grow-0 border-y border-arcade-border/50 bg-[#0B0716]/80"
      contentContainerStyle={{ padding: 8, gap: 8 }}
      showsHorizontalScrollIndicator={false}
    >
      {players.map((p) => {
        const hasBrokenTools = p.brokenTools.length > 0;
        
        let cardBorderColor: string = ARCADE.border;
        let cardBg = 'rgba(22, 16, 40, 0.6)';
        
        if (p.isCurrentTurn) {
          cardBorderColor = ARCADE.cyan;
          cardBg = 'rgba(31, 24, 56, 0.85)';
        } else if (hasBrokenTools) {
          cardBorderColor = 'rgba(255, 51, 85, 0.4)';
          cardBg = 'rgba(40, 16, 28, 0.5)';
        }

        return (
          <Pressable
            key={p.playerId}
            disabled={!selectable}
            onPress={() => onSelect(p.playerId)}
            style={{
              minWidth: 100,
              borderRadius: 14,
              paddingHorizontal: 10,
              paddingVertical: 8,
              backgroundColor: cardBg,
              borderWidth: 1.5,
              borderColor: cardBorderColor,
            }}
          >
            {p.isCurrentTurn && <GlowPulse color={ARCADE.cyan} borderRadius={14} borderWidth={1.5} />}
            {selectable && <GlowPulse color={ARCADE.pink} borderRadius={14} borderWidth={1.5} />}
            
            {/* Player Name */}
            <Text
              numberOfLines={1}
              style={{
                fontFamily: 'SpaceMono_700Bold',
                color: p.isCurrentTurn ? ARCADE.cyan : ARCADE.text,
                fontSize: 12,
                fontWeight: '800',
              }}
            >
              {p.displayName}
            </Text>

            {/* Hand & Gold indicators */}
            <View className="mt-1.5 flex-row items-center gap-3">
              <View className="flex-row items-center gap-1.5 rounded bg-[#2E2452]/40 px-1.5 py-0.5 border border-arcade-border/30">
                <MaterialCommunityIcons name="cards-playing-outline" size={11} color={ARCADE.muted} />
                <Text style={{ fontFamily: 'SpaceMono_700Bold', color: ARCADE.muted, fontSize: 10 }}>
                  {p.handSize}
                </Text>
              </View>
              <Coin amount={p.goldCollected} size="sm" showText />
            </View>

            {/* Tools badges */}
            <View className="mt-2 flex-row gap-1.5">
              {TOOLS.map(({ tool, icon }) => {
                const broken = p.brokenTools.includes(tool);
                return (
                  <View
                    key={tool}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: broken ? 'rgba(255, 51, 85, 0.15)' : 'rgba(22, 16, 40, 0.4)',
                      borderWidth: 1,
                      borderColor: broken ? ARCADE.red : 'rgba(142, 134, 179, 0.3)',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                    }}
                  >
                    <MaterialCommunityIcons
                      name={icon}
                      size={12}
                      color={broken ? ARCADE.red : ARCADE.muted}
                      style={{ opacity: broken ? 0.75 : 0.9 }}
                    />
                    {broken && (
                      <View
                        style={{
                          position: 'absolute',
                          top: -2,
                          right: -2,
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: ARCADE.red,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <MaterialCommunityIcons name="close" size={6} color="#FFF" />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
