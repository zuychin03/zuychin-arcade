import { Text, View } from 'react-native';
import type { ActionCard, ActionSubtype } from '@zuychin-arcade/types';

const LABELS: Record<ActionSubtype, { icon: string; label: string; color: string }> = {
  sabotage_lantern: { icon: '🔦💥', label: 'Break lamp', color: '#DC2626' },
  sabotage_cart: { icon: '🛒💥', label: 'Break cart', color: '#DC2626' },
  sabotage_pickaxe: { icon: '⛏️💥', label: 'Break pick', color: '#DC2626' },
  repair_lantern: { icon: '🔦✨', label: 'Fix lamp', color: '#16A34A' },
  repair_cart: { icon: '🛒✨', label: 'Fix cart', color: '#16A34A' },
  repair_pickaxe: { icon: '⛏️✨', label: 'Fix pick', color: '#16A34A' },
  repair_lantern_cart: { icon: '🔦🛒', label: 'Fix lamp/cart', color: '#16A34A' },
  repair_lantern_pickaxe: { icon: '🔦⛏️', label: 'Fix lamp/pick', color: '#16A34A' },
  repair_cart_pickaxe: { icon: '🛒⛏️', label: 'Fix cart/pick', color: '#16A34A' },
  map: { icon: '🗺️', label: 'Map', color: '#F5C518' },
  rockfall: { icon: '🪨💥', label: 'Rockfall', color: '#6B7280' },
};

interface Props {
  card: ActionCard;
  size?: number;
}

export function ActionCardView({ card, size = 64 }: Props) {
  const def = LABELS[card.subtype];
  return (
    <View
      style={{ width: size, height: size * 1.4, borderColor: def.color }}
      className="items-center justify-center rounded-md border-2 bg-mine-surface p-1"
    >
      <Text style={{ fontSize: size * 0.3 }}>{def.icon}</Text>
      <Text style={{ color: def.color, fontSize: size * 0.16 }} className="mt-1 text-center font-bold">
        {def.label}
      </Text>
    </View>
  );
}
