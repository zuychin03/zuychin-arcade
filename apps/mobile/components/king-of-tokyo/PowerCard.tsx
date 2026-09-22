import { useRef, type ComponentProps } from 'react';
import { Platform, Text, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { KingOfTokyoMarketCard, KingOfTokyoOwnedPowerCard } from '@zuychin-arcade/types';
import { KING_OF_TOKYO_POWER_CARD_BY_ID } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { CardSurface } from '../ui/CardSurface';
import { TokyoPowerArtwork } from './TokyoPowerArtwork';
import { TOKYO } from '../../constants/theme';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type Card = KingOfTokyoMarketCard | KingOfTokyoOwnedPowerCard;

const CATEGORY_STYLE: Record<string, { color: string; icon: IconName }> = {
  attack: { color: TOKYO.danger, icon: 'fire' },
  defense: { color: TOKYO.cyan, icon: 'shield-star-outline' },
  dice: { color: '#B58CFF', icon: 'dice-multiple' },
  energy: { color: TOKYO.energy, icon: 'lightning-bolt' },
  healing: { color: '#55E59A', icon: 'heart-pulse' },
  market: { color: '#FF9E5E', icon: 'storefront-outline' },
  victory: { color: TOKYO.lime, icon: 'trophy-outline' },
  wild: { color: '#FF73C6', icon: 'creation' },
};

interface Props {
  card: Card;
  compact?: boolean;
  standalone?: boolean;
  columnWidth?: number | '100%';
  onTextScale?: (scale: number) => void;
  actionLabel?: string;
  actionDisabled?: boolean;
  selected?: boolean;
  selectedAccessibilityLabel?: string;
  selectedInstruction?: string;
  selectedActionLabel?: string;
  selectedActionHint?: string;
  onAction?: () => void;
}

export function PowerCard({
  card,
  compact = false,
  standalone = false,
  columnWidth,
  onTextScale,
  actionLabel,
  actionDisabled,
  selected,
  selectedAccessibilityLabel,
  selectedInstruction,
  selectedActionLabel,
  selectedActionHint,
  onAction,
}: Props) {
  const headingRef = useRef<Text>(null);
  const { fontScale = 1 } = useWindowDimensions();
  const inCollection = !standalone && columnWidth !== undefined;
  const definition = KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId];
  const visual = CATEGORY_STYLE[definition.category] ?? CATEGORY_STYLE.wild;
  const counters = 'counters' in card ? card.counters : 0;
  const heading = (
    <View style={compact ? { marginTop: 8, minWidth: 0 } : { flex: 1, minWidth: 0 }}>
      <Text
        ref={headingRef}
        onLayout={() => {
          if (!onTextScale) return;
          const scale = Platform.OS === 'web' && typeof window !== 'undefined' && headingRef.current
            ? Number.parseFloat(window.getComputedStyle(headingRef.current as unknown as Element).fontSize) / (compact ? 15 : 17)
            : fontScale;
          if (Number.isFinite(scale)) onTextScale(Math.max(1, scale));
        }}
        accessibilityRole="header"
        style={{
          fontFamily: 'Outfit_800ExtraBold',
          color: TOKYO.text,
          fontSize: compact ? 15 : 17,
          lineHeight: compact ? 20 : 23,
          flexShrink: 1,
        }}
      >
        {definition.name}
      </Text>
      <Text
        style={{
          fontFamily: 'SpaceMono_700Bold',
          color: visual.color,
          fontSize: 11,
          marginTop: 2,
        }}
      >
        {definition.kind.toUpperCase()} · {definition.category.toUpperCase()}
      </Text>
    </View>
  );

  return (
    <View testID={`tokyo-power-card-${card.instanceId}`} style={{ minWidth: 0, maxWidth: '100%', width: standalone ? '100%' : columnWidth, flexGrow: standalone || inCollection ? 0 : 1, flexShrink: standalone || inCollection ? 0 : 1, flexBasis: standalone || inCollection ? 'auto' : compact ? 180 : 240, paddingBottom: 4 }}>
      <CardSurface fill={!standalone} radius={14} faceColor={TOKYO.panel} edgeColor="#030B08" highlightColor={selected ? visual.color : `${visual.color}66`} selected={selected} depth={4}>
      <View style={{ padding: compact ? 10 : 13 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: compact ? 'space-between' : undefined, gap: 9 }}>
        <View
          style={{
            width: 35,
            height: 35,
            borderRadius: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: `${visual.color}20`,
            borderWidth: 1,
            borderColor: visual.color,
          }}
        >
          <MaterialCommunityIcons name={visual.icon} size={19} color={visual.color} />
        </View>
        {!compact && heading}
        <View accessible accessibilityLabel={`Printed cost ${definition.cost} energy`} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 3, minWidth: 36, maxWidth: '100%', padding: 5, borderRadius: 10, backgroundColor: TOKYO.bg, borderTopWidth: 1, borderTopColor: '#000000', borderBottomWidth: 1, borderBottomColor: `${TOKYO.energy}55` }}>
          <MaterialCommunityIcons name="lightning-bolt" size={15} color={TOKYO.energy} />
          <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: TOKYO.energy, fontSize: 17 }}>
            {definition.cost}
          </Text>
        </View>
      </View>
      {compact && heading}
      <View testID={`tokyo-power-art-${card.instanceId}`} style={{ width: '100%', maxWidth: compact ? 144 : 176, alignSelf: 'center', marginTop: 10, borderRadius: 10, overflow: 'hidden' }}>
        <TokyoPowerArtwork category={definition.category} icon={visual.icon} color={visual.color} />
      </View>

      <Text
        style={{
          maxWidth: '100%',
          flexShrink: 1,
          fontFamily: 'Outfit_400Regular',
          color: TOKYO.text,
          fontSize: 14,
          lineHeight: 21,
          marginTop: 9,
        }}
      >
        {definition.effect}
      </Text>

      {counters > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 7 }}>
          <MaterialCommunityIcons name="counter" size={13} color={TOKYO.cyan} />
          <Text style={{ flexShrink: 1, fontFamily: 'SpaceMono_700Bold', color: TOKYO.cyan, fontSize: 12 }}>
            {counters} COUNTER{counters === 1 ? '' : 'S'}
          </Text>
        </View>
      )}

      {selected && (
        <View
          testID={`tokyo-power-selection-${card.instanceId}`}
          accessible
          accessibilityLabel={selectedAccessibilityLabel ?? `${definition.name} is armed. Choose a die, or activate this card again to cancel.`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 }}
        >
          <MaterialCommunityIcons name="target" size={14} color={visual.color} />
          <Text style={{ flexShrink: 1, fontFamily: 'Outfit_700Bold', color: visual.color, fontSize: 13, lineHeight: 19 }}>
            {selectedInstruction ?? 'ARMED · CHOOSE A DIE'}
          </Text>
        </View>
      )}

      {actionLabel && onAction && (
        <ScalePressable
          disabled={actionDisabled}
          onPress={onAction}
          accessibilityLabel={`${selected ? selectedActionLabel ?? 'Armed, cancel' : actionLabel}: ${definition.name}`}
          accessibilityHint={selected ? selectedActionHint ?? 'Cancel this armed power without changing a die' : `${definition.effect} Printed cost ${definition.cost} energy.`}
          accessibilityState={{ selected: Boolean(selected), disabled: Boolean(actionDisabled) }}
          style={{
            marginTop: 10,
            borderRadius: 10,
            paddingVertical: 8,
            paddingHorizontal: 10,
            minHeight: 48,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: actionDisabled ? TOKYO.surface : `${visual.color}20`,
            borderWidth: 1,
            borderColor: actionDisabled ? TOKYO.border : visual.color,
            opacity: actionDisabled ? 0.72 : 1,
          }}
        >
          <Text style={{ maxWidth: '100%', flexShrink: 1, textAlign: 'center', fontFamily: 'Outfit_800ExtraBold', color: actionDisabled ? TOKYO.muted : visual.color, fontSize: 13, lineHeight: 19 }}>
            {selected ? selectedActionLabel ?? 'CANCEL ARMED POWER' : actionLabel}
          </Text>
        </ScalePressable>
      )}
      </View>
      </CardSurface>
    </View>
  );
}
