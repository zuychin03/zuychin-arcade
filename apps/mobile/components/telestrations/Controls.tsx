import { TYPOGRAPHY } from '../../constants/typography';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScalePressable } from '../ui/ScalePressable';
import { TELESTRATIONS as C } from './palette';

export const typography = StyleSheet.create({
  title: { fontFamily: TYPOGRAPHY.display.fontFamily, fontSize: 26, color: C.text },
  heading: { fontFamily: TYPOGRAPHY.heading.fontFamily, fontSize: 21, color: C.accent },
  body: { fontFamily: TYPOGRAPHY.body.fontFamily, fontSize: 16, lineHeight: 24, color: C.text },
  muted: { fontFamily: TYPOGRAPHY.body.fontFamily, fontSize: 16, lineHeight: 24, color: C.muted },
  input: { minHeight: 64, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.panel, color: C.text, fontFamily: TYPOGRAPHY.body.fontFamily, fontSize: 16, lineHeight: 24, textAlignVertical: 'top' },
});
export function BookButton({ label, onPress, disabled = false, selected, quiet = false, testID, icon }: { label: string; onPress: () => void; disabled?: boolean; selected?: boolean; quiet?: boolean; testID?: string; icon?: ReactNode }) {
  const filled = selected === true || !quiet && selected === undefined;
  return <ScalePressable testID={testID} accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 48, minWidth: 48, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: filled ? C.accent : C.border, backgroundColor: filled ? C.accent : C.panel, opacity: disabled ? 0.5 : 1 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 0 }}>
      {icon}<Text style={{ ...TYPOGRAPHY.control, flexShrink: 1, textAlign: 'center', color: filled ? C.bg : C.text }}>{label}</Text>
    </View>
  </ScalePressable>;
}
