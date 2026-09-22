import { useRef, useState, type ReactNode } from 'react';
import { Image, StyleSheet, View, type ColorValue, type ImageSourcePropType } from 'react-native';
import { ARCADE } from '../../constants/theme';

interface Props {
  source: ImageSourcePropType;
  nativeID?: string;
  aspectRatio?: number;
  fallback?: ReactNode;
  backgroundColor?: ColorValue;
}

export function GameCover({ source, nativeID, aspectRatio = 1.5, fallback, backgroundColor = ARCADE.surface }: Props) {
  const [failedSource, setFailedSource] = useState<ImageSourcePropType | null>(null);
  const currentSource = useRef(source);
  currentSource.current = source;
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1.5;
  return (
    <View nativeID={nativeID} pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: '100%', aspectRatio: ratio, backgroundColor }}>
      {failedSource === source ? fallback : <Image source={source} resizeMode="contain" accessible={false} alt="" style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} onError={() => { if (currentSource.current === source) setFailedSource(source); }} />}
    </View>
  );
}
