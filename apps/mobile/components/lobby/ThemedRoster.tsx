import { Text, View } from 'react-native';
import Animated, { FadeInLeft } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Player } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { ARCADE, COUP, MINE } from '../../constants/theme';

type RosterVariant = 'saboteur' | 'coup';

interface Props {
  variant: RosterVariant;
  players: Player[];
  maxPlayers: number;
  canKick: boolean;
  onKick: (playerId: string) => void;
}

const SABOTEUR_ACCENTS = [MINE.gold, ARCADE.cyan, '#E58A3A', '#A78BFA', '#55D68B', '#E76A7A'];
const COUP_ACCENTS = [COUP.crimson, COUP.gold, COUP.purple, COUP.blue, COUP.green, '#D870B5'];

function accentFor(id: string, colors: readonly string[]): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return colors[hash % colors.length];
}

export function ThemedRoster({ variant, players, maxPlayers, canKick, onKick }: Props) {
  const coup = variant === 'coup';
  const palette = coup
    ? { surface: COUP.surface, border: COUP.border, text: COUP.text, muted: COUP.muted, danger: COUP.crimson, count: COUP.crimson }
    : { surface: MINE.surface, border: ARCADE.border, text: ARCADE.text, muted: ARCADE.muted, danger: ARCADE.red, count: MINE.gold };
  const accents = coup ? COUP_ACCENTS : SABOTEUR_ACCENTS;

  return (
    <View style={{ borderRadius: 18, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, padding: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <MaterialCommunityIcons name={coup ? 'account-group-outline' : 'hard-hat'} size={15} color={palette.count} />
          <Text style={{ fontFamily: 'Outfit_700Bold', color: palette.muted, fontSize: 11, letterSpacing: 2 }}>
            {coup ? 'THE COURT' : 'DIG CREW'}
          </Text>
        </View>
        <Text style={{ fontFamily: 'SpaceMono_700Bold', color: palette.count, fontSize: 10 }}>
          {players.length}/{maxPlayers}
        </Text>
      </View>

      {players.map((player, index) => {
        const accent = accentFor(player.playerId, accents);
        const initial = player.displayName.trim().charAt(0).toUpperCase() || '?';
        return (
          <Animated.View
            key={player.playerId}
            entering={FadeInLeft.delay(index * 60).springify().damping(18)}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 11,
                paddingVertical: 7,
                opacity: player.isConnected ? 1 : 0.52,
              }}
            >
              <View style={{ width: 44, height: 44 }}>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: coup ? 13 : 22,
                    borderWidth: 1.5,
                    borderColor: accent,
                    backgroundColor: `${accent}1F`,
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: [{ rotate: coup ? '0deg' : '-3deg' }],
                  }}
                >
                  {coup ? (
                    <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: accent, fontSize: 18 }}>{initial}</Text>
                  ) : (
                    <MaterialCommunityIcons name="pickaxe" size={21} color={accent} />
                  )}
                </View>
                <View
                  style={{
                    position: 'absolute',
                    right: -1,
                    bottom: -1,
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: player.isConnected ? COUP.green : palette.muted,
                    borderWidth: 2,
                    borderColor: palette.surface,
                  }}
                />
              </View>

              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text numberOfLines={1} style={{ fontFamily: 'Outfit_800ExtraBold', color: palette.text, fontSize: 15, flexShrink: 1 }}>
                    {player.displayName}
                  </Text>
                  {player.isHost ? <MaterialCommunityIcons name="crown" size={14} color={palette.count} /> : null}
                </View>
                <Text style={{ fontFamily: 'SpaceMono_400Regular', color: player.hasLeft ? palette.danger : accent, fontSize: 9, marginTop: 2, letterSpacing: 0.8 }}>
                  {player.hasLeft ? 'LEFT' : player.isHost ? 'ROOM HOST' : player.isConnected ? (coup ? 'COURTIER READY' : 'CREW READY') : 'OFFLINE'}
                </Text>
              </View>

              {canKick && !player.isHost && player.isConnected && !player.hasLeft ? (
                <ScalePressable
                  accessibilityLabel={`Remove ${player.displayName}`}
                  onPress={() => onKick(player.playerId)}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    borderWidth: 1,
                    borderColor: `${palette.danger}66`,
                    backgroundColor: `${palette.danger}16`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons name="close" size={17} color={palette.danger} />
                </ScalePressable>
              ) : null}
            </View>
          </Animated.View>
        );
      })}

      {players.length < maxPlayers ? (
        <View
          style={{
            marginTop: 7,
            borderRadius: 12,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: palette.border,
            paddingVertical: 9,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: palette.muted, fontSize: 9 }}>
            {maxPlayers - players.length} OPEN SEAT{maxPlayers - players.length === 1 ? '' : 'S'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
