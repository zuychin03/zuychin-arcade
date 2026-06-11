import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { BlurView } from 'expo-blur';
import { ARCADE } from '../../constants/theme';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

type NavItemProps = {
  emoji: string;
  label: string;
  route: string;
  isActive: boolean;
};

function NavItem({ emoji, label, route, isActive }: NavItemProps) {
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
    <Pressable onPress={() => router.push(route as any)}>
      <Animated.View style={[styles.navItem, animatedStyle]}>
        <Text style={styles.navEmoji}>{emoji}</Text>
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
        <Text style={styles.logoEmoji}>🕹️</Text>
        <View>
          <Text style={styles.logoText}>ZUYCHIN</Text>
          <Text style={styles.logoSub}>ARCADE</Text>
        </View>
      </View>

      <View style={styles.navContainer}>
        <NavItem emoji="🕹️" label="Hub" route="/" isActive={pathname === '/'} />
        <NavItem emoji="🏆" label="Ranks" route="/leaderboard" isActive={pathname === '/leaderboard'} />
        <NavItem emoji="👾" label="Profile" route="/profile" isActive={pathname === '/profile'} />
        <NavItem emoji="ℹ️" label="About" route="/about" isActive={pathname === '/about'} />
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 260,
    height: '100%',
    borderRightWidth: 1,
    borderRightColor: ARCADE.border,
    paddingTop: 40,
    backgroundColor: ARCADE.surfaceTranslucent,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 40,
    gap: 12,
  },
  logoEmoji: {
    fontSize: 36,
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
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  navEmoji: {
    fontSize: 24,
    marginRight: 16,
  },
  navLabel: {
    fontSize: 18,
    fontFamily: 'Outfit_700Bold',
  },
});
