import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

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
        style={{ position: 'absolute', top: edgeDepth, bottom: -edgeDepth, left: 0, right: 0, borderRadius: radius, backgroundColor: edgeColor, boxShadow: selected ? `0 6px 14px rgba(0,0,0,0.48), 0 2px 12px ${highlightColor}` : '0 5px 10px rgba(0,0,0,0.38)' }}
      />
      <View testID="card-surface-face" pointerEvents="box-none" style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, borderRadius: radius, overflow: 'hidden', backgroundColor: faceColor, boxShadow: 'inset 1px 1px 1px rgba(255,255,255,0.18), inset -1px -2px 2px rgba(0,0,0,0.48)' }}>
        {children}
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: selected ? highlightColor : 'rgba(255,255,255,0.06)', borderTopColor: highlightColor, borderLeftColor: highlightColor, opacity: selected ? 1 : 0.8 }]}
        >
          <LinearGradient colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.01)', 'rgba(0,0,0,0.08)']} locations={[0, 0.38, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: radius }]} />
          <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ position: 'absolute', left: Math.max(6, radius), right: Math.max(6, radius), bottom: 1, borderTopWidth: 1, borderTopColor: highlightColor, opacity: selected ? 0.85 : 0.45 }} />
        </View>
      </View>
    </View>
  );
}
