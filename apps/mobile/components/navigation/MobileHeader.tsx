import { View, Text, StyleSheet, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import { ARCADE } from '../../constants/theme';

type Props = {
  onMenuPress: () => void;
};

export default function MobileHeader({ onMenuPress }: Props) {
  return (
    <BlurView intensity={20} tint="dark" style={styles.header}>
      <Pressable onPress={onMenuPress} style={styles.menuButton}>
        <Text style={styles.menuIcon}>☰</Text>
      </Pressable>
      <View style={styles.titleContainer}>
        <Text style={styles.titleEmoji}>🕹️</Text>
        <Text style={styles.title}>ZUYCHIN</Text>
        <Text style={styles.titleSub}> ARCADE</Text>
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: ARCADE.border,
    backgroundColor: ARCADE.surfaceTranslucent,
  },
  menuButton: {
    paddingHorizontal: 20,
    height: '100%',
    justifyContent: 'center',
  },
  menuIcon: {
    color: ARCADE.text,
    fontSize: 24,
  },
  titleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: 44, // Offset the hamburger menu to keep title centered
  },
  titleEmoji: {
    fontSize: 20,
    marginRight: 6,
  },
  title: {
    color: ARCADE.text,
    fontSize: 18,
    fontFamily: 'Outfit_800ExtraBold',
    letterSpacing: 1,
  },
  titleSub: {
    color: ARCADE.cyan,
    fontSize: 14,
    fontFamily: 'SpaceMono_700Bold',
    letterSpacing: 1,
  },
});
