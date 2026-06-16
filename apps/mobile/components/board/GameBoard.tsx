import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import type { BoardPosition, GoalStatus, PlacedCard } from '@zuychin-arcade/types';
import { BOARD } from '@zuychin-arcade/types';
import { BoardCell } from './BoardCell';

const CELL_WIDTH = 46;
const CELL_HEIGHT = 69;

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

  // Compute active bounding box to dynamically crop empty rows and columns
  const boundaries = useMemo(() => {
    // Standard playable board is row 0 to 8, col 2 to 6
    let minRow = 0;
    let maxRow = 8;
    let minCol = 2;
    let maxCol = 6;

    // Expand to cover placed cards
    for (const pc of board) {
      minRow = Math.min(minRow, pc.position.row);
      maxRow = Math.max(maxRow, pc.position.row);
      minCol = Math.min(minCol, pc.position.col);
      maxCol = Math.max(maxCol, pc.position.col);
    }

    // Expand to cover highlighted valid targets
    for (const key of validTargets) {
      const [r, c] = key.split(',').map(Number);
      minRow = Math.min(minRow, r);
      maxRow = Math.max(maxRow, r);
      minCol = Math.min(minCol, c);
      maxCol = Math.max(maxCol, c);
    }

    // Expand to cover action targets (rockfall, map peeks)
    for (const key of actionTargets) {
      const [r, c] = key.split(',').map(Number);
      minRow = Math.min(minRow, r);
      maxRow = Math.max(maxRow, r);
      minCol = Math.min(minCol, c);
      maxCol = Math.max(maxCol, c);
    }

    // Add 1 cell of padding for smooth play/panning, clamped to absolute layout limits
    minRow = Math.max(0, minRow - 1);
    maxRow = Math.min(BOARD.rows - 1, maxRow + 1);
    minCol = Math.max(0, minCol - 1);
    maxCol = Math.min(BOARD.cols - 1, maxCol + 1);

    return { minRow, maxRow, minCol, maxCol };
  }, [board, validTargets, actionTargets]);

  const rowIndexes = useMemo(() => {
    const arr = [];
    for (let r = boundaries.minRow; r <= boundaries.maxRow; r++) arr.push(r);
    return arr;
  }, [boundaries]);

  const colIndexes = useMemo(() => {
    const arr = [];
    for (let c = boundaries.minCol; c <= boundaries.maxCol; c++) arr.push(c);
    return arr;
  }, [boundaries]);

  return (
    <ScrollView className="flex-1 bg-mine-bg" contentContainerStyle={{ padding: 12, alignItems: 'center', justifyContent: 'center' }}>
      <ScrollView horizontal contentContainerStyle={{ alignItems: 'center', justifyContent: 'center' }}>
        <View className="items-center justify-center">
          {rowIndexes.map((row) => (
            <View key={row} className="flex-row">
              {colIndexes.map((col) => {
                const k = `${row},${col}`;
                return (
                  <BoardCell
                    key={k}
                    placed={cells.get(k) ?? null}
                    goal={goalMap.get(k) ?? null}
                    isValidTarget={validTargets.has(k)}
                    isActionTarget={actionTargets.has(k)}
                    width={CELL_WIDTH}
                    height={CELL_HEIGHT}
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
