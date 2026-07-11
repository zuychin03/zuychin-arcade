import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ActionCard, ActionSubtype } from '@zuychin-arcade/types';
import { ARCADE, neonBox } from '../../../constants/theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const CARD_DATA: Record<ActionSubtype, { title: string; label: string; icons: IconName[]; color: string }> = {
  sabotage_lantern: { title: 'SABOTAGE', label: 'Break Lamp', icons: ['flashlight'], color: ARCADE.red },
  sabotage_cart: { title: 'SABOTAGE', label: 'Break Cart', icons: ['cart-outline'], color: ARCADE.red },
  sabotage_pickaxe: { title: 'SABOTAGE', label: 'Break Pick', icons: ['pickaxe'], color: ARCADE.red },
  repair_lantern: { title: 'REPAIR', label: 'Fix Lamp', icons: ['flashlight'], color: '#16A34A' },
  repair_cart: { title: 'REPAIR', label: 'Fix Cart', icons: ['cart-outline'], color: '#16A34A' },
  repair_pickaxe: { title: 'REPAIR', label: 'Fix Pick', icons: ['pickaxe'], color: '#16A34A' },
  repair_lantern_cart: { title: 'REPAIR', label: 'Lamp/Cart', icons: ['flashlight','cart-outline'], color: '#16A34A' },
  repair_lantern_pickaxe: { title: 'REPAIR', label: 'Lamp/Pick', icons: ['flashlight','pickaxe'], color: '#16A34A' },
  repair_cart_pickaxe: { title: 'REPAIR', label: 'Cart/Pick', icons: ['cart-outline','pickaxe'], color: '#16A34A' },
  map: { title: 'INTEL', label: 'Map Goal', icons: ['map-outline'], color: '#F5C518' },
  rockfall: { title: 'OBSTRUCT', label: 'Rockfall', icons: ['image-broken-variant'], color: '#6B7280' },
};

interface Props {
  card: ActionCard;
  width?: number;
  height?: number;
}

export function ActionCardView({ card, width = 56, height = 84 }: Props) {
  const data = CARD_DATA[card.subtype];
  const isSabotage = card.subtype.startsWith('sabotage_');
  const minDim = Math.min(width, height);

  return (
    <View
      style={{
        width,
        height,
        backgroundColor: '#130E1F',
        borderRadius: 8,
        borderWidth: 2,
        borderColor: data.color,
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 4,
        ...neonBox(data.color, 6),
      }}
    >
      {/* Category header */}
      <Text
        style={{
          fontSize: minDim * 0.15,
          fontWeight: '900',
          color: data.color,
          letterSpacing: 0.5,
          textAlign: 'center',
          marginTop: 2,
        }}
      >
        {data.title}
      </Text>

      {/* Main icon with glowing indicator */}
      <View
        style={{
          width: minDim * 0.55,
          height: minDim * 0.55,
          borderRadius: 99,
          backgroundColor: `${data.color}15`,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: `${data.color}40`,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 1 }}>{data.icons.map((icon) => <MaterialCommunityIcons key={icon} name={icon} size={minDim * (data.icons.length > 1 ? 0.22 : 0.32)} color={data.color} />)}</View>
        {isSabotage && (
          <MaterialCommunityIcons name={isSabotage ? 'alert-circle' : 'wrench'} size={minDim * 0.2} color={isSabotage ? ARCADE.red : '#16A34A'} style={{ position: 'absolute', right: -2, bottom: -2 }} />
        )}
        {card.subtype.startsWith('repair_') && (
          <MaterialCommunityIcons name={isSabotage ? 'alert-circle' : 'wrench'} size={minDim * 0.2} color={isSabotage ? ARCADE.red : '#16A34A'} style={{ position: 'absolute', right: -2, bottom: -2 }} />
        )}
      </View>

      {/* Title description */}
      <Text
        numberOfLines={1}
        style={{
          color: '#EDEAFB',
          fontSize: minDim * 0.14,
          fontWeight: '800',
          textAlign: 'center',
          marginBottom: 4,
        }}
      >
        {data.label}
      </Text>
    </View>
  );
}
