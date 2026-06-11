import { useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Slot } from 'expo-router';
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
  layoutMobile: {
    flex: 1,
    flexDirection: 'column',
  },
  content: {
    flex: 1,
    overflow: 'hidden',
  },
});
