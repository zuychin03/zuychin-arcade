import { Pressable, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { GoalStatus, PeekedGoal, PlacedCard } from '@zuychin-arcade/types';
import { PathCardView } from '../cards/PathCardView';
import { CardBack } from '../cards/CardBack';
import { GlowPulse } from '../../ui/GlowPulse';
import { ARCADE } from '../../../constants/theme';

interface Props {
  placed: PlacedCard | null;
  goal: GoalStatus | null;
  peekedGoal: PeekedGoal | null;
  isValidTarget: boolean;
  isActionTarget: boolean;
  isInteractive: boolean;
  row: number;
  col: number;
  width: number;
  height: number;
  onPress: () => void;
}

export function BoardCell({
  placed,
  goal,
  peekedGoal,
  isValidTarget,
  isActionTarget,
  isInteractive,
  row,
  col,
  width,
  height,
  onPress,
}: Props) {
  const innerW = width - 2;
  const innerH = height - 2;
  const cellContent = placed
    ? placed.card.subtype === 'start'
      ? 'start card'
      : placed.card.subtype === 'goal_gold'
        ? 'revealed gold goal'
        : placed.card.subtype === 'goal_stone'
          ? 'revealed stone goal'
          : 'tunnel card'
    : goal
      ? 'hidden goal'
      : 'empty space';
  const targetState = isValidTarget || isActionTarget ? ' Legal target.' : isInteractive ? ' Not a legal target.' : '';
  const privateKnowledge = peekedGoal ? ` Your private map says ${peekedGoal.isGold ? 'gold' : 'stone'}.` : '';
  const openings = placed ? Object.entries(placed.card.edges).filter(([edge, value]) => edge !== 'center' && value === 'open').map(([edge]) => edge).join(', ') : '';
  const paths = placed ? ` Openings: ${openings || 'none'}. ${placed.card.edges.center ? 'Connected centre.' : 'Dead end, centre blocked.'}` : '';
  const legal = isInteractive && (isValidTarget || isActionTarget);
  return (
    <Pressable
      nativeID={`saboteur-cell-${row}-${col}`}
      accessibilityRole={legal ? 'button' : 'image'}
      accessibilityLabel={`Board row ${row + 1}, column ${col - 1}: ${cellContent}.${paths}${targetState}${privateKnowledge}`}
      accessibilityState={{ disabled: !legal, selected: isValidTarget || isActionTarget }}
      disabled={!legal}
      onPress={onPress}
      style={{ width, height, padding: 1 }}
    >
      {placed ? (
        <View style={{ width: innerW, height: innerH }}>
          <PathCardView card={placed.card} width={innerW} height={innerH} depth={1} />
          {isActionTarget && <GlowPulse color={ARCADE.red} borderRadius={6} />}
        </View>
      ) : goal && !goal.revealed ? (
        <View style={{ width: innerW, height: innerH }}>
          <CardBack width={innerW} height={innerH} icon="help" depth={1} />
          {isActionTarget && <GlowPulse color={ARCADE.cyan} borderRadius={6} />}
          {peekedGoal && (
            <View
              style={{
                position: 'absolute',
                right: 2,
                top: 2,
                width: 20,
                height: 20,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#0B0716',
                borderWidth: 1,
                borderColor: peekedGoal.isGold ? '#F5C518' : '#9CA3AF',
              }}
            >
              <MaterialCommunityIcons
                name={peekedGoal.isGold ? 'gold' : 'image-filter-hdr'}
                size={12}
                color={peekedGoal.isGold ? '#F5C518' : '#B8BEC9'}
              />
            </View>
          )}
        </View>
      ) : (
        <View
          style={{
            width: innerW, height: innerH, alignItems: 'center', justifyContent: 'center',
            borderRadius: 6, borderWidth: 1,
            borderTopColor: '#09070E', borderLeftColor: '#09070E',
            borderBottomColor: '#49384A', borderRightColor: '#382B3C',
            backgroundColor: isValidTarget ? '#15303B' : '#17121F',
          }}
        >
          {isValidTarget && <><MaterialCommunityIcons name="plus" size={22} color={ARCADE.cyan} /><GlowPulse color={ARCADE.cyan} borderRadius={6} /></>}
        </View>
      )}
    </Pressable>
  );
}
