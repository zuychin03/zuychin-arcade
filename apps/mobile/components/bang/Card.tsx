import { Platform, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BangCard, BangCardName, BangRole } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { CardSurface } from '../ui/CardSurface';
import { BangCardArtwork, BANG_CARD_EMBLEM } from './CardArtwork';
import { BANG } from '../../constants/theme';

export const BANG_CARD_DETAILS: Record<BangCardName, { name: string; kind: string; effect: string }> = {
  bang: { name: 'BANG!', kind: 'Attack · weapon range', effect: 'Aim at one player within your weapon range. They must avoid the shot or lose 1 life.' },
  missed: { name: 'Missed!', kind: 'Response', effect: 'Cancel a shot aimed at you. Calamity Janet may also use this card as BANG!.' },
  beer: { name: 'Beer', kind: 'Heal · self', effect: 'Recover 1 life, up to your maximum. May save you from elimination. No healing with only 2 players alive.' },
  saloon: { name: 'Saloon', kind: 'Heal · all players', effect: 'Every living player, including you, recovers 1 life. Cannot be used to avoid elimination.' },
  stagecoach: { name: 'Stagecoach', kind: 'Draw', effect: 'Draw 2 cards from the deck.' },
  wells_fargo: { name: 'Wells Fargo', kind: 'Draw', effect: 'Draw 3 cards from the deck.' },
  general_store: { name: 'General Store', kind: 'Shared choice', effect: 'Reveal one card per living player. You choose first, then each player clockwise chooses one.' },
  panic: { name: 'Panic!', kind: 'Take a card · distance 1', effect: 'Take a random hand card or a chosen card in play from a reachable player. Weapon range does not help.' },
  cat_balou: { name: 'Cat Balou', kind: 'Discard a card · any distance', effect: 'Discard a random hand card or a chosen card in play from the selected player.' },
  gatling: { name: 'Gatling', kind: 'Attack · everyone else', effect: 'Every other living player must avoid a shot or lose 1 life. Does not use your BANG! allowance.' },
  indians: { name: 'Indians!', kind: 'Attack · everyone else', effect: 'Every other living player must discard BANG! or lose 1 life. Missed! and Barrel do not help.' },
  duel: { name: 'Duel', kind: 'Challenge · any distance', effect: 'Your target discards BANG!, then you alternate. The first player who stops loses 1 life.' },
  barrel: { name: 'Barrel', kind: 'Equipment · defence', effect: 'When a shot targets you, you may draw a check. A heart cancels one required Missed!.' },
  dynamite: { name: 'Dynamite', kind: 'Equipment · danger', effect: 'At the start of your turn, spades 2–9 explode for 3 damage. Otherwise pass it clockwise.' },
  scope: { name: 'Scope', kind: 'Equipment · distance', effect: 'You see other players at a distance reduced by 1, with a minimum distance of 1.' },
  mustang: { name: 'Mustang', kind: 'Equipment · distance', effect: 'Other players see you at a distance increased by 1. Your view of them is unchanged.' },
  jail: { name: 'Jail', kind: 'Equipment · any distance', effect: 'Put another player in Jail, except the Sheriff. On their next turn, hearts free them; otherwise they skip it.' },
  volcanic: { name: 'Volcanic', kind: 'Weapon · range 1', effect: 'You may play any number of BANG! cards this turn while this weapon is in play. Replaces your weapon.' },
  schofield: { name: 'Schofield', kind: 'Weapon · range 2', effect: 'Your BANG! cards can reach distance 2. Replaces your current weapon.' },
  remington: { name: 'Remington', kind: 'Weapon · range 3', effect: 'Your BANG! cards can reach distance 3. Replaces your current weapon.' },
  rev_carabine: { name: 'Rev. Carabine', kind: 'Weapon · range 4', effect: 'Your BANG! cards can reach distance 4. Replaces your current weapon.' },
  winchester: { name: 'Winchester', kind: 'Weapon · range 5', effect: 'Your BANG! cards can reach distance 5. Replaces your current weapon.' },
};

export const BANG_ROLE_GUIDE: Record<BangRole, { name: string; goal: string }> = {
  sheriff: { name: 'Sheriff', goal: 'Eliminate every Outlaw and the Renegade. You win together with the Deputies.' },
  deputy: { name: 'Deputy', goal: 'Protect the Sheriff. You share the Law’s victory, even if you are eliminated.' },
  outlaw: { name: 'Outlaw', goal: 'Eliminate the Sheriff. If the Renegade becomes the only survivor, the Renegade wins instead.' },
  renegade: { name: 'Renegade', goal: 'Be the only survivor. Keep the Sheriff alive until you can defeat them last.' },
};

interface Props {
  card: BangCard;
  selected?: boolean;
  disabled?: boolean;
  status?: string;
  selectionOrder?: number;
  onPress?: () => void;
  idPrefix?: string;
  fluid?: boolean;
  onFocus?: () => void;
}

export function BangCardView({ card, selected = false, disabled = false, status, selectionOrder, onPress, idPrefix = 'hand', fluid = false, onFocus }: Props) {
  const { width, fontScale } = useWindowDimensions();
  const scale = Math.max(1, Number.isFinite(fontScale) ? fontScale : 1);
  const availableWidth = Math.max(1, width - 48);
  const detail = BANG_CARD_DETAILS[card.name];
  const colour = card.name === 'bang' || card.name === 'gatling' || card.name === 'indians' ? BANG.red : BANG.gold;
  const suitIcon = `cards-${card.suit.slice(0, -1)}` as keyof typeof MaterialCommunityIcons.glyphMap;
  const label = `${detail.name}, ${card.rank} of ${card.suit}. ${detail.effect}${selected ? ' Selected.' : ''}${selectionOrder ? ` Selection ${selectionOrder}.` : ''}${status ? ` ${status}.` : ''}`;
  const content = <CardSurface fill radius={14} depth={3} faceColor={selected ? BANG.surface : BANG.panel} edgeColor={BANG.bg} highlightColor={selected ? BANG.gold : `${BANG.sand}88`} selected={selected}>
    <View style={{ padding: 12, gap: 8, minWidth: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: colour, fontSize: 18, lineHeight: 24, flex: 1, minWidth: 0 }}>{detail.name}</Text>
        {selected ? <MaterialCommunityIcons name="check-circle" size={22} color={BANG.gold} accessible={false} /> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontFamily: 'SpaceMono_700Bold', color: BANG.sand, fontSize: 16, lineHeight: 24 }}>{card.rank}</Text>
        <MaterialCommunityIcons name={suitIcon} size={20} color={card.suit === 'hearts' || card.suit === 'diamonds' ? BANG.red : BANG.sand} accessible={false} />
        <Text style={{ fontFamily: 'Outfit_700Bold', color: BANG.sand, fontSize: 14, lineHeight: 20 }}>{card.suit}</Text>
      </View>
    </View>
    <BangCardArtwork name={card.name} />
    <View style={{ padding: 12, gap: 10, minWidth: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
        <MaterialCommunityIcons name={BANG_CARD_EMBLEM[card.name]} size={18} color={BANG.sand} accessible={false} />
        <Text style={{ flex: 1, minWidth: 0, fontFamily: 'Outfit_700Bold', color: BANG.sand, fontSize: 14, lineHeight: 20 }}>{detail.kind}</Text>
      </View>
      <Text style={{ fontFamily: 'Outfit_400Regular', color: BANG.text, fontSize: 15, lineHeight: 22 }}>{detail.effect}</Text>
      {status || selectionOrder || selected ? <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: selected ? BANG.gold : disabled ? BANG.muted : colour, fontSize: 14, lineHeight: 20 }}>{selectionOrder ? `${selectionOrder}. SELECTED` : status || 'SELECTED'}</Text> : null}
    </View>
  </CardSurface>;
  const style: ViewStyle = fluid ? { width: '100%', maxWidth: '100%', minWidth: 0, paddingBottom: 4, flexGrow: 1 }
    : { flexBasis: 200 * scale, flexGrow: 1, maxWidth: Math.min(260 * scale, availableWidth), minWidth: Platform.OS === 'web' ? 'min-content' as unknown as number : Math.min(156 * scale, availableWidth), paddingBottom: 4 };
  return <View nativeID={`bang-card-${idPrefix}-${card.id}`} style={style}>
    {onPress ? <ScalePressable accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} onFocus={disabled ? undefined : onFocus} style={{ width: '100%', minWidth: 0, minHeight: 48, flexGrow: 1 }}>{content}</ScalePressable>
      : <View accessible accessibilityLabel={label} style={{ flexGrow: 1 }}>{content}</View>}
  </View>;
}
