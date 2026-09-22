import { Platform, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { CardSurface } from '../ui/CardSurface';
import { CitadelsDistrictArtwork, citadelsDistrictIcons } from './CitadelsDistrictArtwork';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CitadelsDistrictCard, CitadelsRole } from '@zuychin-arcade/types';
import { CITADELS_ROLE_BY_ID } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { CITADELS } from '../../constants/theme';

export const DISTRICT_COLOR = {
  noble: CITADELS.gold,
  religious: '#7DB9FF',
  trade: CITADELS.emerald,
  military: CITADELS.crimson,
  unique: CITADELS.violet,
} as const;

export const CITADELS_CARD_WIDTH = { district: { compact: 176, regular: 208 }, role: { compact: 180, regular: 208 } } as const;

export function citadelsCardWidth(kind: 'district' | 'role', compact: boolean, fontScale = 1, viewportWidth = 375) {
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  return Math.min(Math.max(128, viewportWidth - 64), CITADELS_CARD_WIDTH[kind][compact ? 'compact' : 'regular'] * scale);
}

function useCardSizing(kind: 'district' | 'role', compact: boolean): ViewStyle {
  const { width: viewportWidth, fontScale } = useWindowDimensions();
  return {
    width: citadelsCardWidth(kind, compact, Platform.OS === 'web' ? 1 : fontScale, viewportWidth),
    maxWidth: Math.max(128, viewportWidth - 64), flexShrink: 0, alignSelf: 'stretch',
    ...(Platform.OS === 'web' ? { minWidth: 'min-content' as unknown as number } : {}),
  };
}

function SelectionCue({ color }: { color: string }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
    <MaterialCommunityIcons name="check-circle" size={18} color={color} accessible={false} />
    <Text style={{ fontFamily: 'Outfit_700Bold', color, fontSize: 14, lineHeight: 20 }}>Selected</Text>
  </View>;
}

interface DistrictProps {
  card: CitadelsDistrictCard;
  compact?: boolean;
  disabled?: boolean;
  selected?: boolean;
  onPress?: () => void;
  actionLabel?: string;
}

export function CitadelsDistrictView({ card, compact = false, disabled = false, selected = false, onPress, actionLabel }: DistrictProps) {
  const sizing = useCardSizing('district', compact);
  const color = DISTRICT_COLOR[card.color];
  const description = `${card.name}, ${card.cost} gold, ${card.color} district.${card.effectText ? ` ${card.effectText}` : ''}`;
  const accessibilityLabel = actionLabel ? `${actionLabel}. ${description}` : description;
  const content = (
    <View testID={`citadels-district-card-${card.id}`} accessible={!onPress} accessibilityLabel={!onPress ? accessibilityLabel : undefined} style={{ ...sizing, ...(onPress ? { flexGrow: 1 } : {}), transform: [{ translateY: selected ? -4 : 0 }] }}>
      <CardSurface fill width="100%" radius={14} faceColor={CITADELS.surface} edgeColor={CITADELS.bg} highlightColor={selected ? color : `${color}88`} depth={3} selected={selected} disabled={disabled && Boolean(onPress)}>
        <View style={{ padding: 12, gap: 10 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, flexShrink: 1 }}>
              <MaterialCommunityIcons name={citadelsDistrictIcons[card.color]} size={19} color={color} accessible={false} />
              <Text style={{ fontFamily: 'Outfit_700Bold', color, fontSize: 14, lineHeight: 20 }}>{card.color[0].toUpperCase() + card.color.slice(1)}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: `${CITADELS.gold}16` }}>
              <Text style={{ fontFamily: 'SpaceMono_700Bold', color: CITADELS.gold, fontSize: 18, lineHeight: 24 }}>{card.cost}</Text>
              <Text style={{ fontFamily: 'Outfit_700Bold', color: CITADELS.gold, fontSize: 13, lineHeight: 19 }}>gold</Text>
            </View>
          </View>
          <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: CITADELS.text, fontSize: compact ? 16 : 18, lineHeight: compact ? 22 : 24 }}>{card.name}</Text>
          <View testID={`citadels-district-art-${card.id}`} style={{ width: '100%', borderRadius: 10, overflow: 'hidden' }}>
            <CitadelsDistrictArtwork category={card.color} color={color} compact={compact} />
          </View>
          {card.effectText ? <Text style={{ fontFamily: 'Outfit_400Regular', color: CITADELS.text, fontSize: compact ? 14 : 15, lineHeight: compact ? 20 : 22 }}>{card.effectText}</Text> : null}
          {selected ? <SelectionCue color={color} /> : null}
          {actionLabel && !(selected && actionLabel === 'SELECTED') ? <Text style={{ fontFamily: 'Outfit_800ExtraBold', color, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 2 }}>{actionLabel}</Text> : null}
        </View>
      </CardSurface>
    </View>
  );
  return onPress ? <ScalePressable disabled={disabled} accessibilityLabel={accessibilityLabel} accessibilityState={{ selected, disabled }} onPress={onPress} style={{ ...sizing, minHeight: 48 }}>{content}</ScalePressable> : content;
}

const ROLE_ICON: Record<CitadelsRole, keyof typeof MaterialCommunityIcons.glyphMap> = {
  assassin: 'knife-military',
  thief: 'hand-coin-outline',
  magician: 'magic-staff',
  king: 'crown',
  bishop: 'chess-bishop',
  merchant: 'storefront-outline',
  architect: 'compass-outline',
  warlord: 'shield-sword-outline',
};

function RoleInsignia({ role, color }: { role: CitadelsRole; color: string }) {
  return <View testID={`citadels-role-insignia-${role}`} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ minHeight: 112, alignItems: 'center', justifyContent: 'center', padding: 12 }}>
    <View style={{ position: 'absolute', width: 104, height: 20, bottom: 8, borderRadius: 12, backgroundColor: CITADELS.bg, boxShadow: '0 4px 7px rgba(0,0,0,0.3)' }} />
    <View style={{ width: 84, height: 84, borderRadius: 24, backgroundColor: `${color}18`, borderWidth: 2, borderColor: `${color}88`, borderBottomWidth: 5, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-5deg' }], boxShadow: '0 4px 7px rgba(0,0,0,0.25)' }}>
      <MaterialCommunityIcons name={ROLE_ICON[role]} size={46} color={color} accessible={false} />
    </View>
  </View>;
}

interface RoleProps {
  role: CitadelsRole;
  compact?: boolean;
  disabled?: boolean;
  selected?: boolean;
  onPress?: () => void;
  actionLabel?: string;
}

export function CitadelsRoleCard({ role, compact = false, disabled = false, selected = false, onPress, actionLabel }: RoleProps) {
  const sizing = useCardSizing('role', compact);
  const info = CITADELS_ROLE_BY_ID[role];
  const color = role === 'king' ? CITADELS.gold : role === 'warlord' || role === 'assassin' ? CITADELS.crimson : role === 'merchant' ? CITADELS.emerald : CITADELS.royal;
  const description = `${info.name}, rank ${info.rank}. ${info.summary}`;
  const accessibilityLabel = actionLabel ? `${actionLabel}. ${description}` : description;
  const content = (
    <View testID={`citadels-role-card-${role}`} accessible={!onPress} accessibilityLabel={!onPress ? accessibilityLabel : undefined} style={{ ...sizing, ...(onPress ? { flexGrow: 1 } : {}), transform: [{ translateY: selected ? -4 : 0 }] }}>
      <CardSurface fill width="100%" radius={14} faceColor={CITADELS.surface} edgeColor={CITADELS.bg} highlightColor={selected ? color : `${color}88`} depth={3} selected={selected} disabled={disabled}>
        <View style={{ padding: 12, gap: 10 }}>
          <Text style={{ fontFamily: 'SpaceMono_700Bold', color, fontSize: 18, lineHeight: 24 }}>Rank {info.rank}</Text>
          <RoleInsignia role={role} color={color} />
          <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: CITADELS.text, fontSize: 18, lineHeight: 24, textAlign: 'center' }}>{info.name}</Text>
          <Text style={{ fontFamily: 'Outfit_400Regular', color: CITADELS.text, fontSize: compact ? 14 : 15, lineHeight: compact ? 20 : 22 }}>{info.summary}</Text>
          {selected ? <SelectionCue color={color} /> : null}
          {actionLabel && !(selected && actionLabel === 'SELECTED') ? <Text style={{ fontFamily: 'Outfit_800ExtraBold', color, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 2 }}>{actionLabel}</Text> : null}
        </View>
      </CardSurface>
    </View>
  );
  return onPress ? <ScalePressable disabled={disabled} accessibilityLabel={accessibilityLabel} accessibilityState={{ selected, disabled }} onPress={onPress} style={{ ...sizing, minHeight: 48 }}>{content}</ScalePressable> : content;
}
