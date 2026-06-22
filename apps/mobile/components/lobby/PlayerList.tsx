import { Text, View } from 'react-native';
import Animated, { FadeInLeft } from 'react-native-reanimated';
import type { Player } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { ARCADE } from '../../constants/theme';

interface Props {
  players: Player[];
  maxPlayers: number;
  canKick: boolean;
  onKick: (playerId: string) => void;
}

const ONLINE = '#34D399';
const AVATAR_COLORS = [ARCADE.pink, ARCADE.purple, ARCADE.blue, ARCADE.cyan, ARCADE.violet, ARCADE.red];

/** Stable per-player color so each avatar keeps its hue across renders. */
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function PlayerList({ players, maxPlayers, canKick, onKick }: Props) {
  return (
    <View className="rounded-2xl border border-arcade-border bg-arcade-surface p-4">
      <Text className="mb-2 text-xs font-bold tracking-widest text-arcade-muted">
        PLAYERS ({players.length}/{maxPlayers})
      </Text>
      {players.map((p, i) => {
        const color = colorFor(p.playerId);
        const initial = p.displayName.trim().charAt(0).toUpperCase() || '?';
        return (
          <Animated.View
            key={p.playerId}
            entering={FadeInLeft.delay(i * 60).springify().damping(18)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
              {/* avatar with a presence dot */}
              <View style={{ width: 38, height: 38 }}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    borderWidth: 1.5,
                    borderColor: color,
                    backgroundColor: `${color}26`,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: p.isConnected ? 1 : 0.5,
                  }}
                >
                  <Text style={{ fontFamily: 'Outfit_800ExtraBold', color, fontSize: 16 }}>{initial}</Text>
                </View>
                <View
                  style={{
                    position: 'absolute',
                    right: -1,
                    bottom: -1,
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: p.isConnected ? ONLINE : ARCADE.muted,
                    borderWidth: 2,
                    borderColor: ARCADE.surface,
                  }}
                />
              </View>

              {/* name + host badge */}
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: 'Outfit_700Bold',
                      fontSize: 15,
                      color: p.isConnected ? ARCADE.text : ARCADE.muted,
                      flexShrink: 1,
                    }}
                  >
                    {p.displayName}
                  </Text>
                  {p.isHost && (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 3,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: `${ARCADE.cyan}66`,
                        backgroundColor: `${ARCADE.cyan}1F`,
                        paddingHorizontal: 6,
                        paddingVertical: 1,
                      }}
                    >
                      <Text style={{ fontSize: 9 }}>👑</Text>
                      <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: ARCADE.cyan, fontSize: 9, letterSpacing: 1 }}>
                        HOST
                      </Text>
                    </View>
                  )}
                </View>
                {!p.isConnected && (
                  <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, fontSize: 10 }}>offline</Text>
                )}
              </View>
            </View>

            {/* kick button */}
            {canKick && !p.isHost && (
              <ScalePressable
                onPress={() => onKick(p.playerId)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: `${ARCADE.red}59`,
                  backgroundColor: `${ARCADE.red}1A`,
                }}
              >
                <Text style={{ color: ARCADE.red, fontFamily: 'Outfit_800ExtraBold', fontSize: 15, lineHeight: 17 }}>
                  ✕
                </Text>
              </ScalePressable>
            )}
          </Animated.View>
        );
      })}
    </View>
  );
}
