import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { RESPONSE_TIMEOUT_MS } from '@zuychin-arcade/types';
import { COUP } from '../../constants/theme';

/** Thin countdown bar driven by the server-provided pending deadline. */
export function Countdown({ deadline, color = COUP.crimson }: { deadline: number | null; color?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (deadline == null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);

  if (deadline == null) return null;
  const remaining = Math.max(0, deadline - now);
  const frac = Math.max(0, Math.min(1, remaining / RESPONSE_TIMEOUT_MS));
  const secs = Math.ceil(remaining / 1000);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: COUP.border, overflow: 'hidden' }}>
        <View style={{ width: `${frac * 100}%`, height: '100%', backgroundColor: color }} />
      </View>
      <Text style={{ fontFamily: 'SpaceMono_700Bold', color, fontSize: 12, minWidth: 26, textAlign: 'right' }}>{secs}s</Text>
    </View>
  );
}
