import { type ReactNode } from 'react';
import { View } from 'react-native';
import { useMeasuredLayoutWidth } from '../../hooks/useMeasuredLayoutWidth';

export interface CardGridProps<T> {
  items: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, columnWidth: number, index: number) => ReactNode;
  minCardWidth: number;
  maxCardWidth?: number;
  gap?: number;
  textScale?: number;
  testID?: string;
}

export function cardGridMetrics(availableWidth: number, minCardWidth: number, maxCardWidth?: number, gap = 12, textScale = 1) {
  const scale = Number.isFinite(textScale) ? Math.max(1, textScale) : 1;
  const minimum = (Number.isFinite(minCardWidth) ? Math.max(1, minCardWidth) : 1) * scale;
  const maximum = maxCardWidth !== undefined && Number.isFinite(maxCardWidth) ? Math.max(minimum, maxCardWidth * scale) : Infinity;
  const spacing = Number.isFinite(gap) ? Math.max(0, gap) : 12;
  const available = Number.isFinite(availableWidth) && availableWidth > 0 ? availableWidth : minimum;
  const columns = Math.max(1, Math.floor((available + spacing) / (minimum + spacing)));
  return { columns, columnWidth: Math.min(maximum, (available - spacing * (columns - 1)) / columns), gap: spacing };
}

export function CardGrid<T>({ items, keyExtractor, renderItem, minCardWidth, maxCardWidth, gap = 12, textScale = 1, testID }: CardGridProps<T>) {
  const { layoutRef, onLayout, width: availableWidth } = useMeasuredLayoutWidth();
  const metrics = cardGridMetrics(availableWidth, minCardWidth, maxCardWidth, gap, textScale);
  return <View ref={layoutRef} testID={testID} onLayout={onLayout} style={{ width: '100%', minWidth: 0, maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: metrics.gap, paddingVertical: 4 }}>
    {items.map((item, index) => <View key={keyExtractor(item, index)} style={{ width: metrics.columnWidth, maxWidth: '100%', minWidth: 0, flexShrink: 0 }}>
      {renderItem(item, metrics.columnWidth, index)}
    </View>)}
  </View>;
}
