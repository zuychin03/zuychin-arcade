import { View, Text, StyleSheet, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ARCADE } from '../../constants/theme';
import ZuychinLogo from './ZuychinLogo';

type Props = {
  onMenuPress: () => void;
};

export default function MobileHeader({ onMenuPress }: Props) {
  return (
    <BlurView intensity={20} tint="dark" style={styles.header}>
      <Pressable
        accessibilityHint="Opens the arcade navigation"
        accessibilityLabel="Open navigation menu"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onMenuPress}
        style={styles.menuButton}
      >
        <MaterialCommunityIcons name="menu" size={24} color={ARCADE.text} />
      </Pressable>
      <View style={styles.titleContainer}>
        <ZuychinLogo color={ARCADE.pink} height={30} style={{ flexShrink: 0 }} />
        <Text style={styles.title}>ZUYCHIN</Text>
        <Text style={styles.titleSub}>ARCADE</Text>
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 60,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: ARCADE.border,
    backgroundColor: ARCADE.surfaceTranslucent,
  },
  menuButton: {
    width: 48,
    minHeight: 48,
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleContainer: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 8,
    rowGap: 2,
  },
  title: {
    maxWidth: '100%',
    flexShrink: 1,
    color: ARCADE.text,
    fontSize: 18,
    fontFamily: 'Outfit_800ExtraBold',
    letterSpacing: 1,
  },
  titleSub: {
    maxWidth: '100%',
    flexShrink: 1,
    color: ARCADE.cyan,
    fontSize: 14,
    fontFamily: 'SpaceMono_700Bold',
    letterSpacing: 1,
  },
});
