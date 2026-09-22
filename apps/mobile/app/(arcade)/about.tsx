import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { ARCADE, neonText } from '../../constants/theme';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import { ScalePressable } from '../../components/ui/ScalePressable';

export default function AboutScreen() {
  const router = useRouter();
  const reduceMotion = useReducedMotionPreference();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.title}>ABOUT</Text>

      <Animated.View
        entering={reduceMotion ? undefined : FadeInUp.delay(100).springify().damping(16)}
        style={styles.card}
      >
        <Text style={styles.heading}>About Zuychin Arcade</Text>
        <Text style={styles.body}>
          Zuychin Arcade is a shared tabletop platform for web, iOS and Android. Create a room or join friends with an eight-character code shown as XXXX-XXXX. Finished games can contribute to the ranks when result storage is enabled.
        </Text>
      </Animated.View>

      <ScalePressable
        accessibilityHint="Opens the in-app data practices summary"
        accessibilityLabel="Read privacy summary"
        onPress={() => router.push('/privacy')}
        style={styles.privacyLink}
      >
        <MaterialCommunityIcons name="shield-lock-outline" size={22} color={ARCADE.cyan} />
        <View style={styles.privacyCopy}>
          <Text style={styles.privacyTitle}>PRIVACY SUMMARY</Text>
          <Text style={styles.privacyDescription}>See what the arcade stores on this device and on its server.</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={ARCADE.muted} />
      </ScalePressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: ARCADE.bg,
  },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 48,
  },
  title: {
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 4,
    ...neonText(ARCADE.pink, 12),
  },
  card: {
    marginTop: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ARCADE.border,
    backgroundColor: ARCADE.surface,
    padding: 22,
  },
  heading: {
    marginBottom: 10,
    color: ARCADE.text,
    fontFamily: 'SpaceMono_700Bold',
    fontSize: 14,
  },
  body: {
    color: ARCADE.muted,
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 14,
    lineHeight: 22,
  },
  privacyLink: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ARCADE.border,
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: ARCADE.panel,
  },
  privacyCopy: {
    flex: 1,
    gap: 4,
  },
  privacyTitle: {
    color: ARCADE.cyan,
    fontFamily: 'SpaceMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  privacyDescription: {
    color: ARCADE.muted,
    fontFamily: 'Outfit_400Regular',
    fontSize: 14,
    lineHeight: 19,
  },
});
