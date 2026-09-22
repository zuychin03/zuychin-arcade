import { useEffect, useRef } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import type { CoupLogEntry } from '@zuychin-arcade/types';
import { COUP } from '../../constants/theme';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';

export function GameLog({ log }: { log: CoupLogEntry[] }) {
  const ref = useRef<ScrollView>(null);
  const followLatest = useRef(true);
  const reducedMotion = useReducedMotionPreference();
  useEffect(() => {
    if (followLatest.current) ref.current?.scrollToEnd({ animated: !reducedMotion });
  }, [log.length, reducedMotion]);

  return (
    <View
      accessibilityLabel={`Table log. Latest update: ${log.at(-1)?.text ?? 'No actions yet'}`}
      accessibilityLiveRegion="polite"
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: COUP.border,
        backgroundColor: COUP.surface,
        paddingHorizontal: 12,
        paddingVertical: 8,
        maxHeight: 108,
      }}
    >
      <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.muted, fontSize: 12, letterSpacing: 2, marginBottom: 4 }}>
        TABLE LOG
      </Text>
      <ScrollView ref={ref} showsVerticalScrollIndicator
        {...(Platform.OS === 'web' ? { tabIndex: 0, role: 'region' as const } : {})}
        accessibilityLabel="Scrollable table log"
        onScroll={({ nativeEvent }) => { followLatest.current = nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >= nativeEvent.contentSize.height - 24; }} scrollEventThrottle={100}>
        {log.length === 0 && (
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 13, lineHeight: 20 }}>
            No actions yet.
          </Text>
        )}
        {log.slice(-30).map((e) => (
          <Text key={e.id} style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.text, fontSize: 13, lineHeight: 20 }}>
            {e.text}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}
