import { Text, View } from 'react-native';
import type { PathCard, PathCardEdges } from '@zuychin-arcade/types';
import { rotateEdges } from '../../lib/placement';

const TUNNEL = '#92400E';
const ARM = '34%';

function Arms({ edges }: { edges: PathCardEdges }) {
  return (
    <>
      {edges.top === 'open' && (
        <View style={{ position: 'absolute', top: 0, height: '50%', width: ARM, alignSelf: 'center', backgroundColor: TUNNEL }} />
      )}
      {edges.bottom === 'open' && (
        <View style={{ position: 'absolute', bottom: 0, height: '50%', width: ARM, alignSelf: 'center', backgroundColor: TUNNEL }} />
      )}
      {edges.left === 'open' && (
        <View style={{ position: 'absolute', left: 0, width: '50%', height: ARM, top: '33%', backgroundColor: TUNNEL }} />
      )}
      {edges.right === 'open' && (
        <View style={{ position: 'absolute', right: 0, width: '50%', height: ARM, top: '33%', backgroundColor: TUNNEL }} />
      )}
      {/* dead ends: cave-in blocking the centre */}
      {!edges.center && (
        <View style={{ position: 'absolute', width: '46%', height: '46%', alignSelf: 'center', top: '27%', backgroundColor: '#3F2A12', borderRadius: 4, borderWidth: 1, borderColor: '#6B7280' }} />
      )}
    </>
  );
}

interface Props {
  card: PathCard;
  rotated?: boolean;
  size?: number;
}

export function PathCardView({ card, rotated = false, size = 44 }: Props) {
  const edges = rotateEdges(card.edges, rotated);
  const emoji =
    card.subtype === 'start' ? '🪜' : card.subtype === 'goal_gold' ? '💰' : card.subtype === 'goal_stone' ? '🪨' : null;

  return (
    <View
      style={{ width: size, height: size }}
      className="overflow-hidden rounded-sm border border-mine-tunnel bg-mine-surface"
    >
      <Arms edges={edges} />
      {emoji && (
        <View className="absolute inset-0 items-center justify-center">
          <Text style={{ fontSize: size * 0.45 }}>{emoji}</Text>
        </View>
      )}
    </View>
  );
}
