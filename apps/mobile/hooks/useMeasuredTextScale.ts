import { useRef, useState } from 'react';
import { Platform, type Text } from 'react-native';

export function useMeasuredTextScale(baseFontSize: number, nativeFontScale = 1) {
  const textRef = useRef<Text>(null);
  const [measuredScale, setMeasuredScale] = useState(1);
  const nativeScale = Number.isFinite(nativeFontScale) ? Math.max(1, nativeFontScale) : 1;

  function onTextLayout() {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !textRef.current
      || !Number.isFinite(baseFontSize) || baseFontSize <= 0) return;
    const fontSize = Number.parseFloat(window.getComputedStyle(textRef.current as unknown as Element).fontSize);
    if (Number.isFinite(fontSize) && fontSize > 0) setMeasuredScale(Math.max(1, fontSize / baseFontSize));
  }

  return { textRef, onTextLayout, textScale: Math.max(nativeScale, Platform.OS === 'web' ? measuredScale : 1) };
}
