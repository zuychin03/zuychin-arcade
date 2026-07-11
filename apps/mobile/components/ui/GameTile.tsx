import { Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScalePressable } from './ScalePressable';
import { ARCADE, neonBox, neonText } from '../../constants/theme';

interface Props {
  title: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  subtitle: string;
  accent: string;          // neon color for this game
  locked?: boolean;
  index: number;           // for staggered entrance
  onPress?: () => void;
}

export function GameTile({ title, icon, subtitle, accent, locked, index, onPress }: Props) {
  return (
    <Animated.View entering={FadeInUp.delay(120 * index).springify().damping(16)}>
      <ScalePressable
        onPress={onPress}
        disabled={locked}
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            borderRadius: 18,
            borderWidth: 1.5,
            borderColor: locked ? ARCADE.border : accent,
            backgroundColor: ARCADE.surface,
            padding: 16,
            opacity: locked ? 0.55 : 1,
          },
          !locked ? neonBox(`${accent}55`, 14) : null,
        ]}
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: ARCADE.panel,
            borderWidth: 1,
            borderColor: locked ? ARCADE.border : accent,
          }}
        >
          <MaterialCommunityIcons name={locked ? 'lock-outline' : icon} size={34} color={locked ? ARCADE.muted : accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={locked ? { color: ARCADE.muted, fontSize: 18, fontFamily: 'Outfit_800ExtraBold' } : { fontSize: 18, fontFamily: 'Outfit_800ExtraBold', ...neonText(accent, 8) }}>
            {title}
          </Text>
          <Text style={{ color: ARCADE.muted, marginTop: 3, fontSize: 13, fontFamily: 'SpaceMono_400Regular', letterSpacing: 0.5 }}>{subtitle}</Text>
        </View>
        {!locked && <MaterialCommunityIcons name="chevron-right" size={26} color={accent} />}
      </ScalePressable>
    </Animated.View>
  );
}
