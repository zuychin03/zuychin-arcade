import { useRef, useState, type ReactNode } from 'react';
import { Image, StyleSheet, View, type ColorValue, type ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ARCADE } from '../../constants/theme';

interface Props {
  source: ImageSourcePropType;
  nativeID?: string;
  aspectRatio?: number;
  fallback?: ReactNode;
  backgroundColor?: ColorValue;
  rimColor?: string;
}

export function GameCover({ source, nativeID, aspectRatio = 1.5, fallback, backgroundColor = ARCADE.surface, rimColor }: Props) {
  const [failedSource, setFailedSource] = useState<ImageSourcePropType | null>(null);
  const currentSource = useRef(source);
  currentSource.current = source;
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1.5;
  return (
    <View nativeID={nativeID} pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: '100%', aspectRatio: ratio, backgroundColor }}>
      {failedSource === source ? fallback : <Image source={source} resizeMode="contain" accessible={false} alt="" style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} onError={() => { if (currentSource.current === source) setFailedSource(source); }} />}
      {rimColor ? <View style={[StyleSheet.absoluteFill, { borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,0,0,0.6)', borderBottomColor: rimColor, boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.7)' }]}>
        <LinearGradient colors={['rgba(255,255,255,0.09)', 'transparent', 'rgba(0,0,0,0.28)']} locations={[0, 0.3, 1]} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={{ position: 'absolute', left: 8, right: 8, top: 1, height: 1, backgroundColor: rimColor, opacity: 0.45 }} />
      </View> : null}
    </View>
  );
}
