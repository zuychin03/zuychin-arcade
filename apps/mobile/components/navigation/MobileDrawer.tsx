import { useEffect } from 'react';
import { BackHandler, Platform, View, Text, StyleSheet, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { Easing, SlideInLeft, SlideOutLeft, FadeIn, FadeOut } from 'react-native-reanimated';
import { ARCADE } from '../../constants/theme';
import ZuychinLogo from './ZuychinLogo';
import { useWebModalFocus } from '../../hooks/useWebModalFocus';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import { useMeasuredTextScale } from '../../hooks/useMeasuredTextScale';

const DRAWER_ID = 'arcade-mobile-navigation';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

type NavItemProps = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  isActive: boolean;
  onPress: () => void;
};

function NavItem({ icon, label, isActive, onPress }: NavItemProps) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected: isActive }}
      aria-current={Platform.OS === 'web' && isActive ? 'page' : undefined}
      onPress={onPress}
      style={[styles.navItem, isActive && styles.navItemActive]}
    >
      <MaterialCommunityIcons
        name={icon}
        size={20}
        color={isActive ? ARCADE.pink : ARCADE.muted}
        style={{ marginRight: 16 }}
      />
      <Text style={[styles.navLabel, isActive ? styles.navLabelActive : styles.navLabelInactive]}>{label}</Text>
    </Pressable>
  );
}

export default function MobileDrawer({ isOpen, onClose }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const reduceMotion = useReducedMotionPreference();
  const { fontScale } = useWindowDimensions();
  const { textRef, onTextLayout, textScale } = useMeasuredTextScale(18, fontScale);
  useWebModalFocus(isOpen, DRAWER_ID, onClose);

  useEffect(() => {
    if (!isOpen || Platform.OS === 'web') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]}>
      <Animated.View 
        entering={reduceMotion ? undefined : FadeIn}
        exiting={reduceMotion ? undefined : FadeOut}
        style={StyleSheet.absoluteFill}
      >
        <Pressable
          accessibilityLabel="Close navigation menu"
          accessibilityRole="button"
          style={[StyleSheet.absoluteFill, styles.backdrop]}
          onPress={onClose}
        />
      </Animated.View>
      
      <Animated.View
        accessibilityViewIsModal
        accessibilityLabel="Arcade navigation"
        aria-modal
        entering={reduceMotion ? undefined : SlideInLeft.duration(300).easing(Easing.out(Easing.cubic))}
        exiting={reduceMotion ? undefined : SlideOutLeft.duration(200)}
        nativeID={DRAWER_ID}
        role="dialog"
        style={styles.drawer}
      >
        <ScrollView style={styles.scroll} contentContainerStyle={{ flexGrow: 1 }}>
          <View style={styles.drawerHeader}>
            <View style={styles.headerControls}>
              <View testID="drawer-brand-lockup" style={styles.brandLockup}>
                <ZuychinLogo color={ARCADE.pink} height={32 * textScale} style={{ flexShrink: 0 }} />
                <View style={styles.logoWords}>
                  <Text ref={textRef} onLayout={onTextLayout} style={styles.logoText}>ZUYCHIN</Text>
                  <Text style={styles.logoSub}>ARCADE</Text>
                </View>
              </View>
              <Pressable
                accessibilityLabel="Close navigation menu"
                accessibilityRole="button"
                hitSlop={8}
                onPress={onClose}
                style={styles.closeButton}
              >
                <MaterialCommunityIcons name="close" size={24} color={ARCADE.text} />
              </Pressable>
            </View>
          </View>

          <View style={styles.navContainer}>
            <NavItem icon="controller-classic" label="Hub" isActive={pathname === '/'} onPress={() => { router.push('/'); onClose(); }} />
            <NavItem icon="trophy-outline" label="Ranks" isActive={pathname === '/leaderboard'} onPress={() => { router.push('/leaderboard'); onClose(); }} />
            <NavItem icon="account-circle-outline" label="Profile" isActive={pathname === '/profile'} onPress={() => { router.push('/profile'); onClose(); }} />
            <NavItem icon="information-outline" label="About" isActive={pathname === '/about'} onPress={() => { router.push('/about'); onClose(); }} />
            <NavItem icon="shield-lock-outline" label="Privacy" isActive={pathname === '/privacy'} onPress={() => { router.push('/privacy'); onClose(); }} />
          </View>
          <View nativeID="pwa-sidebar-controls" style={{ marginTop: 'auto', width: '100%' }} />
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '82%',
    maxWidth: 320,
    backgroundColor: ARCADE.panel,
    borderRightWidth: 1,
    borderRightColor: ARCADE.border,
  },
  drawerHeader: {
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 8,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  headerControls: {
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  brandLockup: {
    maxWidth: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
  },
  logoWords: {
    minWidth: 0,
    maxWidth: '100%',
    flexShrink: 0,
  },
  closeButton: {
    minWidth: 48,
    minHeight: 48,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: ARCADE.text,
    fontSize: 18,
    fontFamily: 'Outfit_800ExtraBold',
    letterSpacing: 1,
    lineHeight: 20,
  },
  logoSub: {
    color: ARCADE.cyan,
    fontSize: 10,
    fontFamily: 'SpaceMono_700Bold',
    letterSpacing: 1,
    lineHeight: 12,
  },
  navContainer: {
    paddingBottom: 16,
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
  navLabel: {
    flex: 1,
    minWidth: 0,
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
