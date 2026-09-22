import { useCallback, useState, type ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useMeasuredLayoutWidth } from '../../hooks/useMeasuredLayoutWidth';

const GAP = 9;

export function tokyoPowerColumns(width: number, compact = false, textScale = 1) {
  const scale = Number.isFinite(textScale) ? Math.max(1, textScale) : 1;
  if (!Number.isFinite(width) || width <= 0) return { columns: 1, columnWidth: '100%' as const };
  const columns = Math.max(1, Math.floor((width + GAP) / ((compact ? 180 : 240) * scale + GAP)));
  return { columns, columnWidth: Math.floor((width - GAP * (columns - 1)) / columns * 1000) / 1000 };
}

interface Props {
  compact?: boolean;
  children: (layout: { columnWidth: number | '100%'; onTextScale: (scale: number) => void }) => ReactNode;
}

export function PowerCardCollection({ compact = false, children }: Props) {
  const { fontScale = 1 } = useWindowDimensions();
  const { layoutRef, onLayout, width } = useMeasuredLayoutWidth();
  const [measuredScale, setMeasuredScale] = useState(1);
  const onTextScale = useCallback((scale: number) => {
    if (Number.isFinite(scale) && scale >= 1) setMeasuredScale(scale);
  }, []);
  const nativeScale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  const { columnWidth } = tokyoPowerColumns(width, compact, Math.max(nativeScale, measuredScale));
  return <View ref={layoutRef} testID="tokyo-power-collection" onLayout={onLayout} style={{ minWidth: 0, width: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: GAP }}>
    {children({ columnWidth, onTextScale })}
  </View>;
}
