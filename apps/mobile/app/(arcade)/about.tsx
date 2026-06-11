import { Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { ARCADE, neonText } from '../../constants/theme';

export default function AboutScreen() {
  return (
    <View className="flex-1 bg-arcade-bg px-6 pt-16">
      <Text style={{ textAlign: 'center', fontSize: 24, fontWeight: '900', letterSpacing: 4, ...neonText(ARCADE.pink, 12) }}>
        ABOUT
      </Text>
      
      <Animated.View
        entering={FadeInUp.delay(100).springify().damping(16)}
        className="mt-10 rounded-2xl border border-arcade-border bg-arcade-surface p-5"
      >
        <Text style={{ fontFamily: 'SpaceMono_700Bold', color: ARCADE.text, fontSize: 14, marginBottom: 8 }}>About zuychin-arcade</Text>
        <Text style={{ color: ARCADE.muted, fontSize: 14, lineHeight: 20, fontFamily: 'SpaceMono_400Regular' }}>
          This is a private arcade. Join a room with your friends using a 4-7 character
          code. Game results land on the high-score board. More gamespaces coming soon.
        </Text>
      </Animated.View>
    </View>
  );
}
