import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import type { BoardPosition, GoalStatus, PlacedCard } from '@zuychin-arcade/types';
import { BOARD } from '@zuychin-arcade/types';
import { BoardCell } from './BoardCell';

const CELL = 48;

interface Props {
  board: PlacedCard[];
  goals: GoalStatus[];
  validTargets: Set<string>;          // 'row,col' placement spots
  actionTargets: Set<string>;         // 'row,col' rockfall/map targets
  onCellPress: (pos: BoardPosition) => void;
}

export function GameBoard({ board, goals, validTargets, actionTargets, onCellPress }: Props) {
  const cells = useMemo(() => {
    const m = new Map<string, PlacedCard>();
    for (const p of board) m.set(`${p.position.row},${p.position.col}`, p);
    return m;
  }, [board]);

  const goalMap = useMemo(() => {
    const m = new Map<string, GoalStatus>();
    for (const g of goals) m.set(`${g.position.row},${g.position.col}`, g);
    return m;
  }, [goals]);

  return (
    <ScrollView className="flex-1 bg-mine-bg" contentContainerStyle={{ padding: 8 }}>
      <ScrollView horizontal>
        <View>
          {Array.from({ length: BOARD.rows }, (_, row) => (
            <View key={row} className="flex-row">
              {Array.from({ length: BOARD.cols }, (_, col) => {
                const k = `${row},${col}`;
                return (
                  <BoardCell
                    key={k}
                    placed={cells.get(k) ?? null}
                    goal={goalMap.get(k) ?? null}
                    isValidTarget={validTargets.has(k)}
                    isActionTarget={actionTargets.has(k)}
                    size={CELL}
                    onPress={() => onCellPress({ row, col })}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
}
