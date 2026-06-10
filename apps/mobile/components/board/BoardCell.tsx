import { Pressable, View } from 'react-native';
import type { GoalStatus, PlacedCard } from '@zuychin-arcade/types';
import { PathCardView } from '../cards/PathCardView';
import { CardBack } from '../cards/CardBack';

interface Props {
  placed: PlacedCard | null;
  goal: GoalStatus | null;
  isValidTarget: boolean;     // highlighted placement spot for the selected card
  isActionTarget: boolean;    // highlighted target for rockfall / map
  size: number;
  onPress: () => void;
}

export function BoardCell({ placed, goal, isValidTarget, isActionTarget, size, onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={{ width: size, height: size, padding: 1 }}>
      {placed ? (
        <View
          className={isActionTarget ? 'rounded-sm border-2 border-mine-danger' : ''}
          style={{ width: size - 2, height: size - 2 }}
        >
          <PathCardView card={placed.card} size={size - (isActionTarget ? 6 : 2)} />
        </View>
      ) : goal && !goal.revealed ? (
        <View
          className={isActionTarget ? 'rounded-sm border-2 border-mine-gold' : ''}
          style={{ width: size - 2, height: size - 2 }}
        >
          <CardBack size={size - (isActionTarget ? 6 : 2)} label="❓" />
        </View>
      ) : (
        <View
          style={{ width: size - 2, height: size - 2 }}
          className={
            isValidTarget
              ? 'rounded-sm border-2 border-mine-gold bg-mine-gold/20'
              : 'rounded-sm border border-mine-surface/60'
          }
        />
      )}
    </Pressable>
  );
}
