import { Pressable, View } from 'react-native';
import type { GoalStatus, PlacedCard } from '@zuychin-arcade/types';
import { PathCardView } from '../cards/PathCardView';
import { CardBack } from '../cards/CardBack';
import { GlowPulse } from '../ui/GlowPulse';
import { ARCADE } from '../../constants/theme';

interface Props {
  placed: PlacedCard | null;
  goal: GoalStatus | null;
  isValidTarget: boolean;     // highlighted placement spot for the selected card
  isActionTarget: boolean;    // highlighted target for rockfall / map
  size: number;
  onPress: () => void;
}

export function BoardCell({ placed, goal, isValidTarget, isActionTarget, size, onPress }: Props) {
  const inner = size - 2;
  return (
    <Pressable onPress={onPress} style={{ width: size, height: size, padding: 1 }}>
      {placed ? (
        <View style={{ width: inner, height: inner }}>
          <PathCardView card={placed.card} size={inner} />
          {isActionTarget && <GlowPulse color={ARCADE.red} borderRadius={3} />}
        </View>
      ) : goal && !goal.revealed ? (
        <View style={{ width: inner, height: inner }}>
          <CardBack size={inner} label="❓" />
          {isActionTarget && <GlowPulse color={ARCADE.cyan} borderRadius={3} />}
        </View>
      ) : (
        <View
          style={{ width: inner, height: inner }}
          className={
            isValidTarget
              ? 'rounded-sm bg-arcade-cyan/15'
              : 'rounded-sm border border-arcade-border/40'
          }
        >
          {isValidTarget && <GlowPulse color={ARCADE.cyan} borderRadius={3} />}
        </View>
      )}
    </Pressable>
  );
}
