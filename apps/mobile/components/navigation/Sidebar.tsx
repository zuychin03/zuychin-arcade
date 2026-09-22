import { Platform, View, Text, StyleSheet, Pressable, ScrollView, type ViewStyle } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { ARCADE } from '../../constants/theme';
import ZuychinLogo from './ZuychinLogo';

type NavItemProps = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  route: string;
  isActive: boolean;
};

function NavItem({ icon, label, route, isActive }: NavItemProps) {
  const router = useRouter();

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: isActive ? ARCADE.panel : 'transparent',
    borderColor: isActive ? ARCADE.pink : 'transparent',
    borderLeftWidth: 4,
  }));

  const textStyle = useAnimatedStyle(() => ({
    color: isActive ? ARCADE.pink : ARCADE.muted,
    fontWeight: isActive ? '800' : '600',
  }));

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected: isActive }}
      aria-current={Platform.OS === 'web' && isActive ? 'page' : undefined}
      onPress={() => router.push(route as any)}
    >
      <Animated.View style={[styles.navItem, animatedStyle]}>
        <MaterialCommunityIcons
          name={icon}
          size={20}
          color={isActive ? ARCADE.pink : ARCADE.muted}
          style={{ marginRight: 16 }}
        />
        <Animated.Text style={[styles.navLabel, textStyle]}>{label}</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <BlurView intensity={20} tint="dark" style={styles.sidebar}>
      <View style={styles.logoContainer}>
        <ZuychinLogo color={ARCADE.pink} height={44} style={{ flexShrink: 0 }} />
        <View style={styles.logoWords}>
          <Text style={styles.logoText}>ZUYCHIN</Text>
          <Text style={styles.logoSub}>ARCADE</Text>
        </View>
      </View>

      <ScrollView style={styles.navContainer} contentContainerStyle={{ paddingBottom: 16 }}>
        <NavItem icon="controller-classic" label="Hub" route="/" isActive={pathname === '/'} />
        <NavItem icon="trophy-outline" label="Ranks" route="/leaderboard" isActive={pathname === '/leaderboard'} />
        <NavItem icon="account-circle-outline" label="Profile" route="/profile" isActive={pathname === '/profile'} />
        <NavItem icon="information-outline" label="About" route="/about" isActive={pathname === '/about'} />
        <NavItem icon="shield-lock-outline" label="Privacy" route="/privacy" isActive={pathname === '/privacy'} />
      </ScrollView>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 260,
    ...(Platform.OS === 'web' ? { minWidth: 'min-content' as ViewStyle['minWidth'], flexShrink: 0 } : {}),
    height: '100%',
    borderRightWidth: 1,
    borderRightColor: ARCADE.border,
    paddingTop: 40,
    backgroundColor: ARCADE.surfaceTranslucent,
  },
  logoContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 40,
    gap: 12,
  },
  logoWords: {
    minWidth: 0,
    maxWidth: '100%',
    flexShrink: 1,
    ...(Platform.OS === 'web' ? { minWidth: 'max-content' as ViewStyle['minWidth'], flexShrink: 0 } : {}),
  },
  logoText: {
    color: ARCADE.text,
    fontSize: 24,
    fontFamily: 'Outfit_800ExtraBold',
    letterSpacing: 2,
    lineHeight: 28,
  },
  logoSub: {
    color: ARCADE.cyan,
    fontSize: 12,
    fontFamily: 'SpaceMono_700Bold',
    letterSpacing: 4,
    lineHeight: 16,
  },
  navContainer: {
    flex: 1,
    minHeight: 0,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  navLabel: {
    fontSize: 18,
    fontFamily: 'Outfit_700Bold',
  },
});
