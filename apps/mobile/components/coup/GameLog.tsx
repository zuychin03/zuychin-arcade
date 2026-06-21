import { useEffect, useRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { CoupLogEntry } from '@zuychin-arcade/types';
import { COUP } from '../../constants/theme';

export function GameLog({ log }: { log: CoupLogEntry[] }) {
  const ref = useRef<ScrollView>(null);
  useEffect(() => {
    ref.current?.scrollToEnd({ animated: true });
  }, [log.length]);

  return (
    <View
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
      <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.muted, fontSize: 10, letterSpacing: 2, marginBottom: 4 }}>
        TABLE LOG
      </Text>
      <ScrollView ref={ref} showsVerticalScrollIndicator={false}>
        {log.slice(-30).map((e) => (
          <Text key={e.id} style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.text, fontSize: 11, lineHeight: 16 }}>
            {e.text}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}
