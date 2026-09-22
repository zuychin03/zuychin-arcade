import { useCallback, useRef, useState } from 'react';
import { Platform, type LayoutChangeEvent, type View } from 'react-native';

export function useMeasuredLayoutWidth() {
  const layoutRef = useRef<View>(null);
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    let next = event.nativeEvent.layout.width;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        // RNW's layout event uses integer offsetWidth, which can overflow a fractional track.
        const measured = (layoutRef.current as unknown as Element | null)?.getBoundingClientRect?.().width;
        if (typeof measured === 'number' && Number.isFinite(measured) && measured > 0) next = measured;
      } catch {
        // Retain the native measurement when the DOM node is unavailable.
      }
    }
    if (Number.isFinite(next) && next > 0) setWidth(next);
  }, []);
  return { layoutRef, onLayout, width };
}
