import { View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ARCADE } from '../../constants/theme';
import ZuychinLogo from './ZuychinLogo';
import { useMeasuredTextScale } from '../../hooks/useMeasuredTextScale';

type Props = {
  onMenuPress: () => void;
};

export default function MobileHeader({ onMenuPress }: Props) {
  const { width, fontScale } = useWindowDimensions();
  const { textRef, onTextLayout, textScale } = useMeasuredTextScale(18, fontScale);
  const separateControls = width < 136 + 156 * textScale;
  return (
    <BlurView intensity={20} tint="dark" style={[styles.header, separateControls && { paddingTop: 60 }]}>
      <Pressable
        accessibilityHint="Opens the arcade navigation"
        accessibilityLabel="Open navigation menu"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onMenuPress}
        style={[styles.menuButton, separateControls && { position: 'absolute', top: 6, left: 12 }]}
      >
        <MaterialCommunityIcons name="menu" size={24} color={ARCADE.text} />
      </Pressable>
      <View testID="header-brand-lockup" style={styles.titleContainer}>
        <ZuychinLogo color={ARCADE.pink} height={32 * textScale} style={{ flexShrink: 0 }} />
        <View testID="header-brand-words" style={styles.words}>
          <Text ref={textRef} onLayout={onTextLayout} style={styles.title}>ZUYCHIN</Text>
          <Text style={styles.titleSub}>ARCADE</Text>
        </View>
      </View>
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[styles.menuButton, separateControls && { position: 'absolute', top: 6, right: 12 }]}
      />
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
    lineHeight: 20,
    fontFamily: 'Outfit_800ExtraBold',
    letterSpacing: 1,
  },
  titleSub: {
    maxWidth: '100%',
    flexShrink: 1,
    color: ARCADE.cyan,
    fontSize: 10,
    lineHeight: 12,
    fontFamily: 'SpaceMono_700Bold',
    letterSpacing: 1,
  },
  words: {
    maxWidth: '100%',
    flexShrink: 0,
    alignItems: 'flex-start',
  },
});
