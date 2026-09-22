import { useEffect, useMemo, useRef } from 'react';
import { Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import type { BoardPosition, GoalStatus, PeekedGoal, PlacedCard } from '@zuychin-arcade/types';
import { BOARD } from '@zuychin-arcade/types';
import { BoardCell } from './BoardCell';
import { ARCADE, MINE } from '../../../constants/theme';
import { NeonButton } from '../../ui/NeonButton';
import { useReducedMotionPreference } from '../../../hooks/useReducedMotionPreference';

interface Props {
  board: PlacedCard[];
  goals: GoalStatus[];
  validTargets: Set<string>;          // 'row,col' placement spots
  actionTargets: Set<string>;         // 'row,col' rockfall/map targets
  peekedGoals: PeekedGoal[];
  round: number;
  interactionActive: boolean;
  availableWidth?: number;
  scrollViewportHeight?: number;
  onCellPress: (pos: BoardPosition) => void;
}

export function GameBoard({
  board,
  goals,
  validTargets,
  actionTargets,
  peekedGoals,
  round,
  interactionActive,
  availableWidth,
  scrollViewportHeight,
  onCellPress,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const reducedMotion = useReducedMotionPreference();
  const { width: viewportWidth } = useWindowDimensions();
  const cellWidth = Math.min(64, Math.max(48, Math.floor(((availableWidth ?? viewportWidth) - 36) / 5)));
  const cellHeight = Math.round(cellWidth * 1.44);
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

  const peekMap = useMemo(() => {
    const map = new Map<string, PeekedGoal>();
    for (const peek of peekedGoals) {
      const key = `${peek.position.row},${peek.position.col}`;
      if (goalMap.get(key)?.revealed === false) map.set(key, peek);
    }
    return map;
  }, [goalMap, peekedGoals]);

  const { minRow, maxRow, minCol, maxCol } = BOARD.playableBounds;

  const rowIndexes = useMemo(() => {
    const arr = [];
    for (let r = minRow; r <= maxRow; r++) arr.push(r);
    return arr;
  }, [maxRow, minRow]);

  const colIndexes = useMemo(() => {
    const arr = [];
    for (let c = minCol; c <= maxCol; c++) arr.push(c);
    return arr;
  }, [maxCol, minCol]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [round]);

  const goalName = (col: number) => {
    if (col === minCol) return 'LEFT';
    if (col === maxCol) return 'RIGHT';
    return 'CENTRE';
  };

  return (
    <View nativeID="saboteur-board" style={{ flex: scrollViewportHeight === undefined ? 1 : undefined, backgroundColor: MINE.bg }}>
      <View
        style={{
          minHeight: 28,
          paddingHorizontal: 10,
          paddingVertical: 5,
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          borderBottomWidth: 1,
          borderBottomColor: `${ARCADE.border}88`,
          backgroundColor: ARCADE.bg,
        }}
      >
        <Text style={{ fontFamily: 'Outfit_700Bold', color: ARCADE.muted, fontSize: 12 }}>
          5 × 9 PLAY AREA
        </Text>
        <NeonButton label="START" color={ARCADE.cyan} variant="ghost" onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: !reducedMotion })} />
        <NeonButton label="GOALS" color={MINE.gold} variant="ghost" onPress={() => scrollRef.current?.scrollToEnd({ animated: !reducedMotion })} />
        {Array.from(peekMap.values()).map((peek) => (
          <View
            key={`${peek.position.row},${peek.position.col}`}
            accessible
            accessibilityLabel={`Private map knowledge: ${goalName(peek.position.col)} goal is ${peek.isGold ? 'gold' : 'stone'}. Openings ${Object.entries(peek.edges).filter(([edge, value]) => edge !== 'center' && value === 'open').map(([edge]) => edge).join(', ')}`}
            style={{
              borderRadius: 7,
              borderWidth: 1,
              borderColor: peek.isGold ? MINE.gold : MINE.stone,
              backgroundColor: peek.isGold ? `${MINE.gold}18` : `${MINE.stone}22`,
              paddingHorizontal: 6,
              paddingVertical: 2,
            }}
          >
            <Text style={{ fontFamily: 'Outfit_700Bold', color: peek.isGold ? MINE.gold : '#B8BEC9', fontSize: 12 }}>
              PRIVATE MAP · {goalName(peek.position.col)} {peek.isGold ? 'GOLD' : 'STONE'}
            </Text>
            <Text style={{ color: ARCADE.text, fontSize: 12 }}>Opens {Object.entries(peek.edges).filter(([edge, value]) => edge !== 'center' && value === 'open').map(([edge]) => edge).join(', ')}</Text>
          </View>
        ))}
      </View>
      <ScrollView
        ref={scrollRef}
        tabIndex={Platform.OS === 'web' ? 0 : undefined}
        role={Platform.OS === 'web' ? 'region' : undefined}
        accessibilityLabel="Mine board, nine rows and five columns. Scroll to inspect every row."
        style={scrollViewportHeight === undefined ? { flex: 1 } : { height: scrollViewportHeight, flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ minHeight: '100%', paddingVertical: 8, alignItems: 'center', justifyContent: 'flex-start' }}
        showsVerticalScrollIndicator
      >
        <View style={{ alignItems: 'center', justifyContent: 'center', padding: 3, borderRadius: 9, borderWidth: 2, borderColor: '#4E3843', borderTopColor: '#8C6955', borderBottomColor: '#1A111D', backgroundColor: '#302332' }}>
          {rowIndexes.map((row) => (
            <View key={row} className="flex-row">
              {colIndexes.map((col) => {
                const k = `${row},${col}`;
                return (
                  <BoardCell
                    key={k}
                    placed={cells.get(k) ?? null}
                    goal={goalMap.get(k) ?? null}
                    peekedGoal={peekMap.get(k) ?? null}
                    isValidTarget={validTargets.has(k)}
                    isActionTarget={actionTargets.has(k)}
                    isInteractive={interactionActive}
                    row={row}
                    col={col}
                    width={cellWidth}
                    height={cellHeight}
                    onPress={() => onCellPress({ row, col })}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
