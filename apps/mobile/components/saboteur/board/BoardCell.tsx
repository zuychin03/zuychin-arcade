import { Pressable, View } from 'react-native';
import type { GoalStatus, PlacedCard } from '@zuychin-arcade/types';
import { PathCardView } from '../cards/PathCardView';
import { CardBack } from '../cards/CardBack';
import { GlowPulse } from '../../ui/GlowPulse';
import { ARCADE } from '../../../constants/theme';

interface Props {
  placed: PlacedCard | null;
  goal: GoalStatus | null;
  isValidTarget: boolean;     // highlighted placement spot for the selected card
  isActionTarget: boolean;    // highlighted target for rockfall / map
  width: number;
  height: number;
  onPress: () => void;
}

export function BoardCell({ placed, goal, isValidTarget, isActionTarget, width, height, onPress }: Props) {
  const innerW = width - 2;
  const innerH = height - 2;
  return (
    <Pressable onPress={onPress} style={{ width, height, padding: 1 }}>
      {placed ? (
        <View style={{ width: innerW, height: innerH }}>
          <PathCardView card={placed.card} width={innerW} height={innerH} />
          {isActionTarget && <GlowPulse color={ARCADE.red} borderRadius={6} />}
        </View>
      ) : goal && !goal.revealed ? (
        <View style={{ width: innerW, height: innerH }}>
          <CardBack width={innerW} height={innerH} icon="help" />
          {isActionTarget && <GlowPulse color={ARCADE.cyan} borderRadius={6} />}
        </View>
      ) : (
        <View
          style={{ width: innerW, height: innerH }}
          className={
            isValidTarget
              ? 'rounded-md bg-arcade-cyan/15'
              : 'rounded-md border border-arcade-border/30 bg-[#0B0716]/30'
          }
        >
          {isValidTarget && <GlowPulse color={ARCADE.cyan} borderRadius={6} />}
        </View>
      )}
    </Pressable>
  );
}
