import { useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Slot } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ARCADE } from '../../constants/theme';
import Sidebar from '../../components/navigation/Sidebar';
import MobileHeader from '../../components/navigation/MobileHeader';
import MobileDrawer from '../../components/navigation/MobileDrawer';
import AnimatedBackground from '../../components/ui/AnimatedBackground';

export default function ArcadeLayout() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <View style={styles.container}>
      <AnimatedBackground />

      <SafeAreaView style={styles.safeArea} edges={['top', 'right', 'bottom', 'left']}>
        {isDesktop ? (
          <View style={styles.layout}>
            <Sidebar />
            <View style={styles.content}>
              <Slot />
            </View>
          </View>
        ) : (
          <View style={styles.layoutMobile}>
            <MobileHeader onMenuPress={() => setDrawerOpen(true)} />
            <View style={styles.content}>
              <Slot />
            </View>
            <MobileDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ARCADE.bg,
  },
  layout: {
    flex: 1,
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
  },
  layoutMobile: {
    flex: 1,
    flexDirection: 'column',
  },
  content: {
    flex: 1,
    overflow: 'hidden',
  },
});
