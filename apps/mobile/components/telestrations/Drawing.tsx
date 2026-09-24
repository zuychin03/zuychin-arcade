import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { TELESTRATIONS_PALETTE, type TelestrationsDrawing } from '@zuychin-arcade/types';
import { PEN_WIDTHS, type Point } from './drawingModel';

export function Drawing({ drawing, cursor = null }: { drawing: TelestrationsDrawing; cursor?: Point | null }) {
  return <View pointerEvents="none" style={{ width: '100%', aspectRatio: 1, backgroundColor: '#FFFFFF' }}>
    <Svg width="100%" height="100%" viewBox="0 0 4095 4095" accessible={false}>
      {drawing.strokes.map((stroke, index) => stroke.points.length === 1
        ? <Circle key={index} cx={stroke.points[0][0]} cy={stroke.points[0][1]} r={PEN_WIDTHS[stroke.width] / 2} fill={TELESTRATIONS_PALETTE[stroke.color]} />
        : <Path key={index} d={stroke.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ')} stroke={TELESTRATIONS_PALETTE[stroke.color]} strokeWidth={PEN_WIDTHS[stroke.width]} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
      {cursor ? <Circle cx={cursor[0]} cy={cursor[1]} r={55} stroke="#171923" strokeWidth={12} fill="none" /> : null}
    </Svg>
  </View>;
}
