import { useRef, type ReactNode } from 'react';
import { View, type GestureResponderEvent } from 'react-native';
import { normalisePoint, type Point } from './drawingModel';
export interface DrawingInputProps { disabled: boolean; children: ReactNode; onPoint: (point: Point, start: boolean) => void; onEnd: () => void; onCursor?: (point: Point | null) => void }
export default function DrawingInput({ disabled, children, onPoint, onEnd }: DrawingInputProps) {
  const dimensions = useRef({ width: 1, height: 1 });
  const emit = (event: GestureResponderEvent, start: boolean) => {
    if (disabled || event.nativeEvent.touches.length > 1) return;
    const point = normalisePoint(event.nativeEvent.locationX, event.nativeEvent.locationY, dimensions.current.width, dimensions.current.height);
    if (point) onPoint(point, start);
  };
  return <View testID="telestrations-drawing-input" accessibilityLabel="Drawing paper. Draw with one finger, or use the direction controls below."
    onLayout={event => { dimensions.current = event.nativeEvent.layout; }}
    onStartShouldSetResponder={() => !disabled} onMoveShouldSetResponder={() => !disabled}
    onResponderGrant={e => emit(e, true)} onResponderMove={e => emit(e, false)} onResponderRelease={onEnd}
    onResponderTerminate={onEnd} onResponderTerminationRequest={() => false}
    style={{ width: '100%', aspectRatio: 1, overflow: 'hidden' }}>{children}</View>;
}
