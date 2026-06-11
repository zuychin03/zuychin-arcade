import { View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import Animated, { Easing, SlideInLeft, SlideOutLeft, FadeIn, FadeOut } from 'react-native-reanimated';
import { ARCADE } from '../../constants/theme';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

type NavItemProps = {
  emoji: string;
  label: string;
  route: string;
  isActive: boolean;
  onPress: () => void;
};

function NavItem({ emoji, label, route, isActive, onPress }: NavItemProps) {
  return (
    <Pressable onPress={onPress}>
      <View style={[styles.navItem, isActive && styles.navItemActive]}>
        <Text style={styles.navEmoji}>{emoji}</Text>
        <Text style={[styles.navLabel, isActive ? styles.navLabelActive : styles.navLabelInactive]}>{label}</Text>
      </View>
    </Pressable>
  );
}

export default function MobileDrawer({ isOpen, onClose }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { height } = useWindowDimensions();

  if (!isOpen) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]}>
      <Animated.View 
        entering={FadeIn} 
        exiting={FadeOut}
        style={StyleSheet.absoluteFill}
      >
        <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} />
      </Animated.View>
      
      <Animated.View 
        entering={SlideInLeft.duration(300).easing(Easing.out(Easing.exp))}
        exiting={SlideOutLeft.duration(200)}
        style={[styles.drawer, { height }]}
      >
        <View style={styles.logoContainer}>
          <Text style={styles.logoEmoji}>🕹️</Text>
          <View>
            <Text style={styles.logoText}>ZUYCHIN</Text>
            <Text style={styles.logoSub}>ARCADE</Text>
          </View>
        </View>

        <View style={styles.navContainer}>
          <NavItem emoji="🕹️" label="Hub" route="/" isActive={pathname === '/'} onPress={() => { router.push('/'); onClose(); }} />
          <NavItem emoji="🏆" label="Ranks" route="/leaderboard" isActive={pathname === '/leaderboard'} onPress={() => { router.push('/leaderboard'); onClose(); }} />
          <NavItem emoji="👾" label="Profile" route="/profile" isActive={pathname === '/profile'} onPress={() => { router.push('/profile'); onClose(); }} />
          <NavItem emoji="ℹ️" label="About" route="/about" isActive={pathname === '/about'} onPress={() => { router.push('/about'); onClose(); }} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  drawer: {
    width: 280,
    backgroundColor: ARCADE.panel,
    borderRightWidth: 1,
    borderRightColor: ARCADE.border,
    paddingTop: 60,
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
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  navItemActive: {
    backgroundColor: ARCADE.surfaceTranslucent,
    borderLeftWidth: 4,
    borderLeftColor: ARCADE.pink,
  },
  navEmoji: {
    fontSize: 24,
    marginRight: 16,
  },
  navLabel: {
    fontSize: 18,
    fontFamily: 'Outfit_700Bold',
  },
  navLabelActive: {
    color: ARCADE.pink,
  },
  navLabelInactive: {
    color: ARCADE.muted,
  },
});
