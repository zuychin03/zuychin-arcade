import { useState, type ReactNode } from 'react';
import { Platform, Pressable, Text, View, type ImageSourcePropType } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GameCover } from './GameCover';
import { ARCADE } from '../../constants/theme';

interface Props {
  title: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  artwork?: ReactNode;
  coverSource?: ImageSourcePropType;
  coverNativeID?: string;
  nativeID?: string;
  players?: string;
  compact?: boolean;
  horizontalCover?: boolean;
  subtitle: string;
  accent: string;
  locked?: boolean;
  width?: number;
  onPress?: () => void;
}

export function GameTile({ title, icon, artwork, coverSource, coverNativeID, nativeID, players, compact = false, horizontalCover = false, subtitle, accent, locked, width, onPress }: Props) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const inlineMark = compact && !coverSource;
  const rowCover = horizontalCover && !!coverSource && !locked;
  const mark = (
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: inlineMark ? 48 : '100%', height: inlineMark ? 48 : undefined, flexShrink: 0, aspectRatio: inlineMark ? undefined : 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: inlineMark ? undefined : ARCADE.panel }}>
      {locked ? <MaterialCommunityIcons name="lock-outline" size={inlineMark ? 32 : 56} color={ARCADE.muted} /> : artwork ?? <MaterialCommunityIcons name={icon} size={inlineMark ? 32 : 64} color={accent} />}
    </View>
  );
  return (
    <View style={{ width: width ?? '100%', minWidth: 0 }}>
      <Pressable
        nativeID={nativeID}
        onPress={onPress}
        disabled={locked}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!locked }}
        accessibilityLabel={`${title}. ${players ? players + ' · ' : ''}${subtitle}`}
        accessibilityHint={locked ? undefined : 'View rules, create a room or join a game.'}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed }) => ({
          flex: 1, minWidth: 0, minHeight: 48, flexDirection: rowCover ? 'row' : 'column',
          borderRadius: 16, borderWidth: 1,
          borderColor: !locked && (hovered || focused) ? accent : ARCADE.border,
          backgroundColor: !locked && pressed ? ARCADE.panel : ARCADE.surface,
          opacity: locked ? 0.55 : 1,
          ...(Platform.OS === 'web' && focused && !locked ? { outlineStyle: 'solid', outlineColor: ARCADE.cyan, outlineWidth: 2, outlineOffset: 3 } as const : {}),
        })}
      >
        {!inlineMark && <View pointerEvents="none" style={{ width: rowCover ? '35%' : undefined, maxWidth: rowCover ? 180 : undefined, flexShrink: 0, alignSelf: rowCover ? 'center' : undefined, margin: rowCover ? 12 : undefined, marginRight: rowCover ? 0 : undefined, borderRadius: rowCover ? 10 : undefined, borderTopLeftRadius: rowCover ? 10 : 15, borderTopRightRadius: rowCover ? 10 : 15, overflow: 'hidden' }}>
          {coverSource && !locked ? <GameCover source={coverSource} nativeID={coverNativeID} fallback={mark} /> : mark}
        </View>}
        <View style={{ padding: width !== undefined && width < 300 ? 12 : 16, gap: 10, minWidth: 0, flex: rowCover ? 1 : undefined }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {inlineMark ? mark : null}
            <Text style={{ flex: 1, minWidth: 0, color: locked ? ARCADE.muted : ARCADE.text, fontFamily: 'Outfit_800ExtraBold', fontSize: 22 }}>{title}</Text>
          </View>
          {players || !locked ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {players ? <Text style={{ flex: 1, minWidth: 0, color: locked ? ARCADE.muted : accent, fontFamily: 'SpaceMono_400Regular', fontSize: 14, lineHeight: 21 }}>{players}</Text> : <View style={{ flex: 1 }} />}
            {!locked && <MaterialCommunityIcons name="chevron-right" size={22} color={accent} accessible={false} />}
          </View> : null}
          <Text style={{ color: ARCADE.muted, fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24 }}>{subtitle}</Text>
        </View>
      </Pressable>
    </View>
  );
}
