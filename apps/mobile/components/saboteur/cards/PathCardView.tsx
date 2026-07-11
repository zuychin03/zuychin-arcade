import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import type { PathCard, PathCardEdges } from '@zuychin-arcade/types';
import { rotateEdges } from '../../../lib/placement';
import { MINE, neonBox } from '../../../constants/theme';
const PATH_BG = '#352314';
const PATH_HIGHLIGHT = '#5A3820';
const ROCK_EDGE = '#79502F';
const ROCK_SHADOW = '#24150D';
const BEAM_COLOR = '#9A5D2D';
interface ArmsProps {
  edges: PathCardEdges;
  width: number;
  height: number;
}
type Direction = 'top' | 'right' | 'bottom' | 'left';
function Arms({ edges, width, height }: ArmsProps) {
  const halfW = width / 2;
  const halfH = height / 2;
  const outerHalf = width * 0.24;
  const innerHalf = width * 0.155;
  const directions: Direction[] = ['top', 'right', 'bottom', 'left'];
  const openDirections = directions.filter((direction) => edges[direction] === 'open');
  const armPath = (direction: Direction, radius: number) => {
    const irregular = radius * 0.12;
    switch (direction) {
      case 'top':
        return `M ${halfW - radius} 0 L ${halfW + radius} 0 L ${halfW + radius - irregular} ${halfH * 0.38} L ${halfW + radius + irregular} ${halfH * 0.72} L ${halfW + radius * 0.9} ${halfH + radius} L ${halfW - radius * 0.92} ${halfH + radius} L ${halfW - radius - irregular} ${halfH * 0.7} L ${halfW - radius + irregular} ${halfH * 0.36} Z`;
      case 'bottom':
        return `M ${halfW - radius * 0.92} ${halfH - radius} L ${halfW + radius * 0.9} ${halfH - radius} L ${halfW + radius + irregular} ${halfH * 1.3} L ${halfW + radius - irregular} ${halfH * 1.66} L ${halfW + radius} ${height} L ${halfW - radius} ${height} L ${halfW - radius + irregular} ${halfH * 1.64} L ${halfW - radius - irregular} ${halfH * 1.28} Z`;
      case 'left':
        return `M 0 ${halfH - radius} L 0 ${halfH + radius} L ${halfW * 0.36} ${halfH + radius - irregular} L ${halfW * 0.7} ${halfH + radius + irregular} L ${halfW + radius} ${halfH + radius * 0.9} L ${halfW + radius} ${halfH - radius * 0.92} L ${halfW * 0.7} ${halfH - radius - irregular} L ${halfW * 0.35} ${halfH - radius + irregular} Z`;
      case 'right':
        return `M ${halfW - radius} ${halfH - radius * 0.92} L ${halfW - radius} ${halfH + radius * 0.9} L ${halfW * 1.3} ${halfH + radius + irregular} L ${halfW * 1.65} ${halfH + radius - irregular} L ${width} ${halfH + radius} L ${width} ${halfH - radius} L ${halfW * 1.65} ${halfH - radius + irregular} L ${halfW * 1.3} ${halfH - radius - irregular} Z`;
    }
  };
  const centerPath = (radius: number) =>
    `M ${halfW} ${halfH - radius * 1.05} C ${halfW + radius * 0.72} ${halfH - radius * 1.1}, ${halfW + radius * 1.1} ${halfH - radius * 0.5}, ${halfW + radius} ${halfH} C ${halfW + radius * 1.08} ${halfH + radius * 0.65}, ${halfW + radius * 0.5} ${halfH + radius * 1.08}, ${halfW} ${halfH + radius} C ${halfW - radius * 0.72} ${halfH + radius * 1.08}, ${halfW - radius * 1.08} ${halfH + radius * 0.52}, ${halfW - radius} ${halfH} C ${halfW - radius * 1.08} ${halfH - radius * 0.62}, ${halfW - radius * 0.5} ${halfH - radius * 1.08}, ${halfW} ${halfH - radius * 1.05} Z`;
  return (
    <>
      <Svg width={width} height={height} style={{ position: 'absolute' }}>
        {openDirections.map((direction) => (
          <Path
            key={`${direction}-rock`}
            d={armPath(direction, outerHalf)}
            fill={ROCK_EDGE}
            stroke={ROCK_SHADOW}
            strokeWidth={1}
          />
        ))}
        {edges.center && <Path d={centerPath(outerHalf * 1.12)} fill={ROCK_EDGE} />}
        {openDirections.map((direction) => (
          <Path key={`${direction}-floor`} d={armPath(direction, innerHalf)} fill={PATH_BG} />
        ))}
        {edges.center && <Path d={centerPath(innerHalf * 1.22)} fill={PATH_BG} />}
        {edges.top === 'open' && (
          <>
            <Line x1={halfW - innerHalf * 0.7} y1={height * 0.06} x2={halfW - innerHalf * 0.5} y2={height * 0.38} stroke={PATH_HIGHLIGHT} strokeWidth={1.2} strokeLinecap="round" />
            <Circle cx={halfW + innerHalf * 0.45} cy={height * 0.2} r={Math.max(0.8, width * 0.025)} fill={ROCK_EDGE} />
          </>
        )}
        {edges.bottom === 'open' && (
          <>
            <Line x1={halfW + innerHalf * 0.55} y1={height * 0.62} x2={halfW + innerHalf * 0.72} y2={height * 0.93} stroke={PATH_HIGHLIGHT} strokeWidth={1.2} strokeLinecap="round" />
            <Circle cx={halfW - innerHalf * 0.42} cy={height * 0.8} r={Math.max(0.8, width * 0.025)} fill={ROCK_EDGE} />
          </>
        )}
        {edges.left === 'open' && (
          <>
            <Circle cx={width * 0.2} cy={halfH + innerHalf * 0.38} r={Math.max(0.8, width * 0.025)} fill={ROCK_EDGE} />
          </>
        )}
        {edges.right === 'open' && (
          <>
            <Circle cx={width * 0.8} cy={halfH - innerHalf * 0.35} r={Math.max(0.8, width * 0.025)} fill={ROCK_EDGE} />
          </>
        )}
        {!edges.center && (
          <>
            {/* A dense cave-in silhouette closes every route into the center. */}
            <Path
              d={'M ' + (halfW - outerHalf * 1.16) + ' ' + (halfH + outerHalf * 0.88) + ' L ' + (halfW - outerHalf * 1.1) + ' ' + (halfH - outerHalf * 0.08) + ' L ' + (halfW - outerHalf * 0.72) + ' ' + (halfH - outerHalf * 0.72) + ' L ' + (halfW - outerHalf * 0.2) + ' ' + (halfH - outerHalf * 0.52) + ' L ' + (halfW + outerHalf * 0.18) + ' ' + (halfH - outerHalf * 0.92) + ' L ' + (halfW + outerHalf * 0.68) + ' ' + (halfH - outerHalf * 0.66) + ' L ' + (halfW + outerHalf * 1.12) + ' ' + (halfH - outerHalf * 0.04) + ' L ' + (halfW + outerHalf * 1.16) + ' ' + (halfH + outerHalf * 0.88) + ' Z'}
              fill="#1D120C"
              stroke={ROCK_SHADOW}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />

            {/* Large angular boulders, layered front-to-back. */}
            <Path
              d={'M ' + (halfW - outerHalf * 1.08) + ' ' + (halfH + outerHalf * 0.62) + ' L ' + (halfW - outerHalf * 1.02) + ' ' + (halfH - outerHalf * 0.18) + ' L ' + (halfW - outerHalf * 0.72) + ' ' + (halfH - outerHalf * 0.7) + ' L ' + (halfW - outerHalf * 0.28) + ' ' + (halfH - outerHalf * 0.52) + ' L ' + (halfW - outerHalf * 0.12) + ' ' + (halfH + outerHalf * 0.24) + ' L ' + (halfW - outerHalf * 0.48) + ' ' + (halfH + outerHalf * 0.7) + ' Z'}
              fill="#765038"
              stroke="#B07A50"
              strokeWidth={1.2}
              strokeLinejoin="round"
            />
            <Path
              d={'M ' + (halfW - outerHalf * 0.44) + ' ' + (halfH + outerHalf * 0.72) + ' L ' + (halfW - outerHalf * 0.5) + ' ' + (halfH - outerHalf * 0.2) + ' L ' + (halfW - outerHalf * 0.14) + ' ' + (halfH - outerHalf * 0.88) + ' L ' + (halfW + outerHalf * 0.38) + ' ' + (halfH - outerHalf * 0.68) + ' L ' + (halfW + outerHalf * 0.62) + ' ' + (halfH + outerHalf * 0.16) + ' L ' + (halfW + outerHalf * 0.26) + ' ' + (halfH + outerHalf * 0.78) + ' Z'}
              fill="#936444"
              stroke="#C28B5C"
              strokeWidth={1.3}
              strokeLinejoin="round"
            />
            <Path
              d={'M ' + (halfW + outerHalf * 0.26) + ' ' + (halfH + outerHalf * 0.72) + ' L ' + (halfW + outerHalf * 0.38) + ' ' + (halfH - outerHalf * 0.42) + ' L ' + (halfW + outerHalf * 0.74) + ' ' + (halfH - outerHalf * 0.66) + ' L ' + (halfW + outerHalf * 1.08) + ' ' + (halfH - outerHalf * 0.06) + ' L ' + (halfW + outerHalf * 1.02) + ' ' + (halfH + outerHalf * 0.66) + ' Z'}
              fill="#68452F"
              stroke="#A8734C"
              strokeWidth={1.2}
              strokeLinejoin="round"
            />

            {/* Fractures help the largest rocks read as rough stone at card size. */}
            <Path
              d={'M ' + (halfW - outerHalf * 0.08) + ' ' + (halfH - outerHalf * 0.56) + ' L ' + (halfW + outerHalf * 0.04) + ' ' + (halfH - outerHalf * 0.16) + ' L ' + (halfW - outerHalf * 0.12) + ' ' + (halfH + outerHalf * 0.08)}
              fill="none"
              stroke="#4D3022"
              strokeWidth={1.1}
              strokeLinecap="round"
            />
            <Path
              d={'M ' + (halfW - outerHalf * 0.78) + ' ' + (halfH - outerHalf * 0.3) + ' L ' + (halfW - outerHalf * 0.58) + ' ' + (halfH + outerHalf * 0.02) + ' L ' + (halfW - outerHalf * 0.76) + ' ' + (halfH + outerHalf * 0.3)}
              fill="none"
              stroke="#41291D"
              strokeWidth={1}
              strokeLinecap="round"
            />
          </>
        )}
      </Svg>
    </>
  );
}
interface Props {
  card: PathCard;
  rotated?: boolean;
  width?: number;
  height?: number;
}
export function PathCardView({ card, rotated = false, width = 44, height = 66 }: Props) {
  const edges = rotateEdges(card.edges, rotated);
  const renderSpecialNode = () => {
    const minDim = Math.min(width, height);
    if (card.subtype === 'start') {
      return (
        <View
          style={{
            width: minDim * 0.48,
            height: minDim * 0.42,
            borderRadius: minDim * 0.21,
            backgroundColor: ROCK_SHADOW,
            borderWidth: 2,
            borderColor: ROCK_EDGE,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {/* Ladder emerging from the central mine shaft */}
          <View
            style={{
              width: 8,
              height: '135%',
              borderLeftWidth: 2,
              borderRightWidth: 2,
              borderColor: BEAM_COLOR,
            }}
          >
            <View style={{ width: '100%', height: 1.5, backgroundColor: BEAM_COLOR, marginTop: 3 }} />
            <View style={{ width: '100%', height: 1.5, backgroundColor: BEAM_COLOR, marginTop: 4 }} />
            <View style={{ width: '100%', height: 1.5, backgroundColor: BEAM_COLOR, marginTop: 4 }} />
            <View style={{ width: '100%', height: 1.5, backgroundColor: BEAM_COLOR, marginTop: 4 }} />
          </View>
        </View>
      );
    }
    if (card.subtype === 'goal_gold') {
      return (
        <View
          style={{
            width: minDim * 0.8,
            height: minDim * 0.8,
            borderRadius: 8,
            backgroundColor: '#2D1A00',
            borderWidth: 2,
            borderColor: MINE.gold,
            alignItems: 'center',
            justifyContent: 'center',
            ...neonBox(MINE.gold, 8),
          }}
        >
          <MaterialCommunityIcons name="cash-multiple" size={minDim * 0.48} color={MINE.gold} />
        </View>
      );
    }
    if (card.subtype === 'goal_stone') {
      return (
        <View
          style={{
            width: minDim * 0.75,
            height: minDim * 0.75,
            borderRadius: 8,
            backgroundColor: '#1F2937',
            borderWidth: 2,
            borderColor: MINE.stone,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name="image-broken-variant" size={minDim * 0.44} color={MINE.stone} />
        </View>
      );
    }
    return null;
  };
  return (
    <View
      style={{ width, height }}
      className="overflow-hidden rounded-md border border-mine-surface bg-[#1E142B]"
    >
      <Arms edges={edges} width={width} height={height} />
      {card.subtype !== 'tunnel' && (
        <View className="absolute inset-0 items-center justify-center">
          {renderSpecialNode()}
        </View>
      )}
    </View>
  );
}
