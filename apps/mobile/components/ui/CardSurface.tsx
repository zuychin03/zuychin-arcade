import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

export interface CardSurfaceProps {
  children: ReactNode;
  width?: ViewStyle['width'];
  height?: ViewStyle['height'];
  fill?: boolean;
  radius?: number;
  faceColor?: string;
  edgeColor?: string;
  highlightColor?: string;
  depth?: number;
  selected?: boolean;
  disabled?: boolean;
}

// Depth extends below the face without changing layout or the parent's hit target.
export function CardSurface({
  children,
  width,
  height,
  fill = false,
  radius = 8,
  faceColor = '#241B36',
  edgeColor = '#100B18',
  highlightColor = 'rgba(255,255,255,0.28)',
  depth = 3,
  selected = false,
  disabled = false,
}: CardSurfaceProps) {
  const edgeDepth = Number.isFinite(depth) ? Math.min(4, Math.max(0, depth)) : 3;
  return (
    <View accessible={false} pointerEvents="box-none" style={{ width, height, minWidth: 0, ...(fill ? { flexGrow: 1 } : {}), opacity: disabled ? 0.65 : 1 }}>
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={{ position: 'absolute', top: edgeDepth, bottom: -edgeDepth, left: 0, right: 0, borderRadius: radius, backgroundColor: edgeColor, boxShadow: '0 3px 6px rgba(0,0,0,0.24)' }}
      />
      <View pointerEvents="box-none" style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, borderRadius: radius, overflow: 'hidden', backgroundColor: faceColor }}>
        {children}
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: selected ? highlightColor : 'transparent', borderTopColor: highlightColor, borderLeftColor: highlightColor, opacity: selected ? 1 : 0.65 }]}
        />
      </View>
    </View>
  );
}
