import { Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SkullKingCard as Card, SkullKingPlayedCard } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { SKULL_KING } from '../../constants/theme';
import { CardSurface } from '../ui/CardSurface';
import { SkullKingCardArtwork, SkullKingSuitArtwork } from './SkullKingCardArtwork';
import type { IntrinsicCardFaceSizing } from '../../hooks/useIntrinsicCardHeight';
import { useMeasuredTextScale } from '../../hooks/useMeasuredTextScale';

const SUIT_COLOR = { green: '#42D392', purple: '#B69DFF', yellow: '#FFD566', black: '#9AAAB4' } as const;
const LABEL: Record<Card['kind'], string> = { number: '', pirate: 'PIRATE', tigress: 'TIGRESS', skull_king: 'SKULL KING', mermaid: 'MERMAID', escape: 'ESCAPE' };
export const SKULL_CARD_WIDTH = { compact: 120, regular: 148 } as const;

export function skullKingCardWidth(compact: boolean, fontScale = 1, viewportWidth = 375) {
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  const limit = Math.max(120, viewportWidth - 64);
  return Math.min(limit, (compact ? SKULL_CARD_WIDTH.compact : SKULL_CARD_WIDTH.regular) * scale);
}

export function skullKingCardLabel(card: Card | SkullKingPlayedCard): string {
  if (card.kind === 'number') return `${card.suit} ${card.rank}`;
  if (card.kind === 'tigress' && 'tigressMode' in card && card.tigressMode) return `Tigress as ${card.tigressMode}`;
  return LABEL[card.kind].toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function SkullKingCardView({
  card,
  compact = false,
  disabled = false,
  selected = false,
  onPress,
  faceSizing,
}: {
  card: Card | SkullKingPlayedCard;
  compact?: boolean;
  disabled?: boolean;
  selected?: boolean;
  onPress?: () => void;
  faceSizing?: IntrinsicCardFaceSizing;
}) {
  const { width: viewportWidth, fontScale } = useWindowDimensions();
  const { textScale, textRef, onTextLayout } = useMeasuredTextScale(card.kind === 'number' ? 18 : 16, fontScale);
  const width = skullKingCardWidth(compact, textScale, viewportWidth);
  const sizing: ViewStyle = { width, maxWidth: Math.max(120, viewportWidth - 64), minWidth: 0, flexShrink: 0 };
  const color = card.kind === 'number'
    ? SUIT_COLOR[card.suit!]
    : card.kind === 'skull_king'
      ? SKULL_KING.gold
      : card.kind === 'mermaid'
        ? SKULL_KING.cyan
        : card.kind === 'escape'
          ? SKULL_KING.muted
          : SKULL_KING.coral;
  const label = skullKingCardLabel(card);
  const resolvedMode = card.kind === 'tigress' && 'tigressMode' in card ? card.tigressMode : null;
  const content = (
    <View
      testID={`skull-card-${card.id}`}
      accessible={!onPress}
      accessibilityLabel={!onPress ? label : undefined}
      style={{ ...sizing, ...(onPress ? { flexGrow: 1 } : {}), ...(faceSizing ? { minHeight: faceSizing.minimumHeight } : {}), transform: [{ translateY: selected ? -4 : 0 }] }}
    >
      <CardSurface fill width="100%" radius={14} faceColor={SKULL_KING.panel} edgeColor={SKULL_KING.bg} highlightColor={selected ? SKULL_KING.teal : `${color}88`} selected={selected} disabled={disabled} depth={3}>
        <View key={faceSizing?.measurementKey} onLayout={faceSizing ? event => faceSizing.onMeasure(event.nativeEvent.layout.height) : undefined} style={{ minHeight: compact ? 170 : 198, flexShrink: 0 }}>
          {card.kind === 'number' ? <>
            <View style={{ paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
              <Text ref={textRef} onLayout={onTextLayout} style={{ fontFamily: 'SpaceMono_700Bold', color, fontSize: 18, lineHeight: 24 }}>{card.rank}</Text>
              <MaterialCommunityIcons name={card.suit === 'black' ? 'cards-spade' : 'water'} size={20} color={color} accessible={false} />
            </View>
            <View testID={`skull-art-${card.id}`} style={{ width: '100%' }}>
              <SkullKingSuitArtwork suit={card.suit!} color={color} />
            </View>
            <Text style={{ paddingHorizontal: 10, paddingVertical: 8, fontFamily: 'Outfit_700Bold', color, fontSize: 14, lineHeight: 19, textAlign: 'center' }}>{card.suit!.toUpperCase()}</Text>
          </> : <>
            <View testID={`skull-art-${card.id}`} style={{ width: '100%' }}><SkullKingCardArtwork kind={card.kind} color={color} /></View>
            <Text ref={textRef} onLayout={onTextLayout} style={{ paddingHorizontal: 10, paddingVertical: 8, fontFamily: 'Outfit_800ExtraBold', color: SKULL_KING.text, fontSize: 16, lineHeight: 21, textAlign: 'center' }}>{skullKingCardLabel({ id: card.id, kind: card.kind })}</Text>
            {resolvedMode ? <Text style={{ paddingHorizontal: 10, paddingBottom: 8, fontFamily: 'Outfit_700Bold', color, fontSize: 14, lineHeight: 19, textAlign: 'center' }}>AS {resolvedMode.toUpperCase()}</Text> : null}
          </>}
          {selected ? <View style={{ paddingHorizontal: 10, paddingBottom: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <MaterialCommunityIcons name="check-circle" size={16} color={SKULL_KING.teal} accessible={false} />
            <Text style={{ fontFamily: 'Outfit_700Bold', color: SKULL_KING.teal, fontSize: 14, lineHeight: 19 }}>SELECTED</Text>
          </View> : null}
        </View>
      </CardSurface>
    </View>
  );
  return onPress ? (
    <ScalePressable
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={`Play ${label}`}
      accessibilityHint={disabled ? 'This card cannot be played now' : 'Plays this card into the current trick'}
      accessibilityState={{ disabled, selected }}
      style={{ ...sizing, minHeight: 48 }}
    >
      {content}
    </ScalePressable>
  ) : content;
}
