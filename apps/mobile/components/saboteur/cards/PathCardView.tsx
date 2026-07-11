import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { PathCard, PathCardEdges } from '@zuychin-arcade/types';
import { rotateEdges } from '../../../lib/placement';
import { ARCADE, MINE, neonBox } from '../../../constants/theme';

const PATH_BG = '#4D3119'; // Rich dark earth brown for tunnel floor
const BEAM_COLOR = '#8E5225'; // Warm timber brown for shaft support beams
const RAIL_COLOR = '#9CA3AF'; // Steel silver for railway tracks
const TIE_COLOR = '#2E1905'; // Dark wood for railroad ties

interface ArmsProps {
  edges: PathCardEdges;
  width: number;
  height: number;
}

function Arms({ edges, width, height }: ArmsProps) {
  const thick = Math.floor(width * 0.36); // Uniform thickness in pixels
  const halfW = width / 2;
  const halfH = height / 2;
  const pathX = (width - thick) / 2;
  const pathY = (height - thick) / 2;

  // Rail dimensions
  const railGauge = Math.floor(thick * 0.45);
  const railOffsetV = (thick - railGauge) / 2;
  const railOffsetH = (thick - railGauge) / 2;

  return (
    <>
      {/* 1. TUNNEL PATH BASE FLOOR */}
      {edges.top === 'open' && (
        <View style={{ position: 'absolute', top: 0, left: pathX, width: thick, height: halfH, backgroundColor: PATH_BG }} />
      )}
      {edges.bottom === 'open' && (
        <View style={{ position: 'absolute', bottom: 0, left: pathX, width: thick, height: halfH, backgroundColor: PATH_BG }} />
      )}
      {edges.left === 'open' && (
        <View style={{ position: 'absolute', left: 0, top: pathY, height: thick, width: halfW, backgroundColor: PATH_BG }} />
      )}
      {edges.right === 'open' && (
        <View style={{ position: 'absolute', right: 0, top: pathY, height: thick, width: halfW, backgroundColor: PATH_BG }} />
      )}
      {edges.center && (
        <View style={{ position: 'absolute', top: pathY, left: pathX, width: thick, height: thick, backgroundColor: PATH_BG }} />
      )}

      {/* 2. TIMBER SUPPORT BEAMS (SHAFT WALL BORDERS) */}
      {edges.top === 'open' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: pathX, width: 2, height: halfH, backgroundColor: BEAM_COLOR }} />
          <View style={{ position: 'absolute', top: 0, left: pathX + thick - 2, width: 2, height: halfH, backgroundColor: BEAM_COLOR }} />
        </>
      )}
      {edges.bottom === 'open' && (
        <>
          <View style={{ position: 'absolute', bottom: 0, left: pathX, width: 2, height: halfH, backgroundColor: BEAM_COLOR }} />
          <View style={{ position: 'absolute', bottom: 0, left: pathX + thick - 2, width: 2, height: halfH, backgroundColor: BEAM_COLOR }} />
        </>
      )}
      {edges.left === 'open' && (
        <>
          <View style={{ position: 'absolute', left: 0, top: pathY, height: 2, width: halfW, backgroundColor: BEAM_COLOR }} />
          <View style={{ position: 'absolute', left: 0, top: pathY + thick - 2, height: 2, width: halfW, backgroundColor: BEAM_COLOR }} />
        </>
      )}
      {edges.right === 'open' && (
        <>
          <View style={{ position: 'absolute', right: 0, top: pathY, height: 2, width: halfW, backgroundColor: BEAM_COLOR }} />
          <View style={{ position: 'absolute', right: 0, top: pathY + thick - 2, height: 2, width: halfW, backgroundColor: BEAM_COLOR }} />
        </>
      )}

      {/* 3. RAILWAY TRACKS (TIES & STEEL RAILS) */}
      {/* Vertical Tracks */}
      {edges.top === 'open' && (
        <View style={{ position: 'absolute', top: 0, left: pathX + railOffsetV, width: railGauge, height: halfH, overflow: 'hidden' }}>
          {/* Ties */}
          <View style={{ position: 'absolute', top: '15%', left: 0, right: 0, height: 2, backgroundColor: TIE_COLOR }} />
          <View style={{ position: 'absolute', top: '45%', left: 0, right: 0, height: 2, backgroundColor: TIE_COLOR }} />
          <View style={{ position: 'absolute', top: '75%', left: 0, right: 0, height: 2, backgroundColor: TIE_COLOR }} />
          {/* Steel Rails */}
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 1.5, backgroundColor: RAIL_COLOR }} />
          <View style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 1.5, backgroundColor: RAIL_COLOR }} />
        </View>
      )}
      {edges.bottom === 'open' && (
        <View style={{ position: 'absolute', bottom: 0, left: pathX + railOffsetV, width: railGauge, height: halfH, overflow: 'hidden' }}>
          {/* Ties */}
          <View style={{ position: 'absolute', bottom: '15%', left: 0, right: 0, height: 2, backgroundColor: TIE_COLOR }} />
          <View style={{ position: 'absolute', bottom: '45%', left: 0, right: 0, height: 2, backgroundColor: TIE_COLOR }} />
          <View style={{ position: 'absolute', bottom: '75%', left: 0, right: 0, height: 2, backgroundColor: TIE_COLOR }} />
          {/* Steel Rails */}
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 1.5, backgroundColor: RAIL_COLOR }} />
          <View style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 1.5, backgroundColor: RAIL_COLOR }} />
        </View>
      )}

      {/* Horizontal Tracks */}
      {edges.left === 'open' && (
        <View style={{ position: 'absolute', left: 0, top: pathY + railOffsetH, height: railGauge, width: halfW, overflow: 'hidden' }}>
          {/* Ties */}
          <View style={{ position: 'absolute', left: '15%', top: 0, bottom: 0, width: 2, backgroundColor: TIE_COLOR }} />
          <View style={{ position: 'absolute', left: '45%', top: 0, bottom: 0, width: 2, backgroundColor: TIE_COLOR }} />
          <View style={{ position: 'absolute', left: '75%', top: 0, bottom: 0, width: 2, backgroundColor: TIE_COLOR }} />
          {/* Steel Rails */}
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1.5, backgroundColor: RAIL_COLOR }} />
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1.5, backgroundColor: RAIL_COLOR }} />
        </View>
      )}
      {edges.right === 'open' && (
        <View style={{ position: 'absolute', right: 0, top: pathY + railOffsetH, height: railGauge, width: halfW, overflow: 'hidden' }}>
          {/* Ties */}
          <View style={{ position: 'absolute', right: '15%', top: 0, bottom: 0, width: 2, backgroundColor: TIE_COLOR }} />
          <View style={{ position: 'absolute', right: '45%', top: 0, bottom: 0, width: 2, backgroundColor: TIE_COLOR }} />
          <View style={{ position: 'absolute', right: '75%', top: 0, bottom: 0, width: 2, backgroundColor: TIE_COLOR }} />
          {/* Steel Rails */}
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1.5, backgroundColor: RAIL_COLOR }} />
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1.5, backgroundColor: RAIL_COLOR }} />
        </View>
      )}

      {/* Center rail crossings */}
      {edges.center && (edges.top === 'open' || edges.bottom === 'open') && (edges.left === 'open' || edges.right === 'open') && (
        <View style={{ position: 'absolute', top: pathY + railOffsetH, left: pathX + railOffsetV, width: railGauge, height: railGauge }}>
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 1.5, backgroundColor: RAIL_COLOR }} />
          <View style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 1.5, backgroundColor: RAIL_COLOR }} />
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1.5, backgroundColor: RAIL_COLOR }} />
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1.5, backgroundColor: RAIL_COLOR }} />
        </View>
      )}

      {/* 4. DEAD END WALL (CAVE-IN) */}
      {!edges.center && (
        <View
          style={{
            position: 'absolute',
            width: thick + 6,
            height: thick + 6,
            top: pathY - 3,
            left: pathX - 3,
            backgroundColor: '#3F2512',
            borderRadius: 6,
            borderWidth: 2,
            borderColor: BEAM_COLOR,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name="close-thick" size={Math.floor(thick * 0.5)} color="#FF3355" />
        </View>
      )}
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
            width: minDim * 0.75,
            height: minDim * 0.75,
            borderRadius: minDim * 0.375,
            backgroundColor: '#1E1B4B',
            borderWidth: 2,
            borderColor: ARCADE.cyan,
            alignItems: 'center',
            justifyContent: 'center',
            ...neonBox(ARCADE.cyan, 6),
          }}
        >
          {/* Shaft opening with ladder */}
          <View style={{ width: '80%', height: '80%', borderRadius: 99, backgroundColor: '#0B0716', borderStyle: 'dashed', borderWidth: 1, borderColor: ARCADE.muted, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
            {/* Wooden ladder */}
            <View style={{ width: 10, height: '120%', borderLeftWidth: 2, borderRightWidth: 2, borderColor: BEAM_COLOR }}>
              <View style={{ width: '100%', height: 2, backgroundColor: BEAM_COLOR, marginTop: 4 }} />
              <View style={{ width: '100%', height: 2, backgroundColor: BEAM_COLOR, marginTop: 6 }} />
              <View style={{ width: '100%', height: 2, backgroundColor: BEAM_COLOR, marginTop: 6 }} />
              <View style={{ width: '100%', height: 2, backgroundColor: BEAM_COLOR, marginTop: 6 }} />
            </View>
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
