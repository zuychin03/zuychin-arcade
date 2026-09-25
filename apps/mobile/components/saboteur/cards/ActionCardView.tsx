import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ActionCard, ActionSubtype } from '@zuychin-arcade/types';
import { LinearGradient } from 'expo-linear-gradient';
import { ARCADE } from '../../../constants/theme';
import { CardSurface } from '../../ui/CardSurface';
import { ActionArtwork } from './ActionArtwork';

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
  rockfall: { title: 'OBSTRUCT', label: 'Rockfall', icons: ['bomb'], color: '#B8BEC9' },
};

interface Props {
  card: ActionCard;
  width?: number;
  height?: number;
  fill?: boolean;
}

export function saboteurHandCardSize(nativeFontScale = 1, headingFontSize = 12) {
  const nativeScale = Number.isFinite(nativeFontScale) ? nativeFontScale : 1;
  const webScale = Number.isFinite(headingFontSize) ? headingFontSize / 12 : 1;
  const scale = Math.max(1, nativeScale, webScale);
  return { width: 76 * scale, height: 114 * scale };
}

export function ActionCardView({ card, width = 56, height = 84, fill = false }: Props) {
  const data = CARD_DATA[card.subtype];
  const isSabotage = card.subtype.startsWith('sabotage_');
  const minDim = Math.min(width, height);
  // Physical enlargement must not multiply the user's text enlargement again.
  const typeBasis = Math.min(76, minDim);

  return (
    <CardSurface fill={fill} width={width} depth={3} radius={8} faceColor="#241B2B" edgeColor="#100C16" highlightColor="#BBA082">
    <LinearGradient colors={['#3C303B', '#211925', '#17131D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{
        width,
        minHeight: height,
        ...(fill ? { flexGrow: 1 } : {}),
        gap: 4,
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Text
        style={{
          fontSize: Math.max(11, typeBasis * 0.15),
          alignSelf: 'stretch',
          flexShrink: 0,
          minWidth: 0,
          fontFamily: 'Outfit_800ExtraBold',
          color: data.color,
          letterSpacing: 0.5,
          textAlign: 'center',
          marginTop: 2,
          paddingHorizontal: 4,
        }}
      >
        {data.title}
      </Text>

      <View
        style={{
          width,
          height: width,
          flexShrink: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActionArtwork subtype={card.subtype} size={width} icons={data.icons} color={data.color} />
        {isSabotage && (
          <MaterialCommunityIcons name="alert-circle" size={minDim * 0.2} color={ARCADE.red} style={{ position: 'absolute', right: 4, bottom: 4 }} />
        )}
        {card.subtype.startsWith('repair_') && (
          <MaterialCommunityIcons name="wrench" size={minDim * 0.2} color="#16A34A" style={{ position: 'absolute', right: 4, bottom: 4 }} />
        )}
      </View>

      <Text
        style={{
          color: '#EDEAFB',
          alignSelf: 'stretch',
          flexShrink: 0,
          minWidth: 0,
          fontSize: Math.max(12, typeBasis * 0.16),
          fontFamily: 'Outfit_800ExtraBold',
          textAlign: 'center',
          marginBottom: 4,
          paddingHorizontal: 4,
        }}
      >
        {data.label}
      </Text>
    </LinearGradient>
    </CardSurface>
  );
}
