import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TELESTRATIONS_LIMITS, TELESTRATIONS_PALETTE, type TelestrationsDrawing } from '@zuychin-arcade/types';
import { showDialog } from '../../lib/dialog';
import { CardSurface } from '../ui/CardSurface';
import { ScalePressable } from '../ui/ScalePressable';
import { BookButton, typography as T } from './Controls';
import { Drawing } from './Drawing';
import DrawingInput from './DrawingInput';
import { appendPoint, INK_NAMES, pointCount, type Point } from './drawingModel';
import { TELESTRATIONS as C } from './palette';

export function DrawingEditor({ value, onChange, disabled }: { value: TelestrationsDrawing; onChange: (drawing: TelestrationsDrawing) => void; disabled: boolean }) {
  const [color, setColor] = useState(1);
  const [width, setWidth] = useState(1);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [precise, setPrecise] = useState(false);
  const [penDown, setPenDown] = useState(false);
  const [limit, setLimit] = useState(false);
  const current = useRef(value); current.current = value;
  const allowed = useRef(!disabled); allowed.current = !disabled;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const change = (drawing: TelestrationsDrawing) => { current.current = drawing; setLimit(false); onChange(drawing); };
  const point = (position: Point, start: boolean) => {
    if (!allowed.current) return;
    const next = appendPoint(current.current, position, color, width, start);
    if (next === current.current) { if (start || current.current.strokes.at(-1)!.points.length >= 256 || pointCount(current.current) >= 1024) setLimit(true); return; }
    change(next);
  };
  const move = (dx: number, dy: number) => {
    const next: Point = [Math.max(0, Math.min(4095, (cursor?.[0] ?? 2048) + dx)), Math.max(0, Math.min(4095, (cursor?.[1] ?? 2048) + dy))];
    setCursor(next); if (penDown) point(next, false);
  };
  return <View style={{ gap: 16 }}>
    <CardSurface radius={12} faceColor={C.paper} edgeColor="#65778C" highlightColor="#E5F5FF" depth={4}>
      <DrawingInput disabled={disabled} onPoint={point} onEnd={() => {}} onCursor={setCursor}>
        <Drawing drawing={value} cursor={cursor} />
      </DrawingInput>
    </CardSurface>
    <Text style={T.muted}>Draw pictures, not letters or numbers. Only this paper captures drawing gestures.</Text>
    <View accessibilityLabel="Ink colours" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {TELESTRATIONS_PALETTE.map((ink, index) => <ScalePressable key={ink} testID={`telestrations-ink-${index}`} disabled={disabled} accessibilityLabel={`${INK_NAMES[index]} ink`} accessibilityState={{ selected: color === index }} onPress={() => setColor(index)}
        style={{ width: 48, height: 48, borderRadius: 12, borderWidth: color === index ? 2 : 1, borderColor: color === index ? C.accent : C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.panel }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: ink, alignItems: 'center', justifyContent: 'center' }}>
          {color === index ? <MaterialCommunityIcons name="check" size={20} color={index === 1 ? '#FFFFFF' : '#171923'} /> : null}
        </View>
      </ScalePressable>)}
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {['Fine', 'Medium', 'Bold'].map((label, index) => <BookButton key={label} label={`${label} pen`} selected={width === index} disabled={disabled} onPress={() => setWidth(index)} />)}
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <BookButton label="Undo stroke" quiet disabled={disabled || !value.strokes.length} onPress={() => change({ strokes: current.current.strokes.slice(0, -1) })} />
      <BookButton label="Clear drawing" quiet disabled={disabled || !value.strokes.length} onPress={() => showDialog('Clear this drawing?', 'This removes every stroke from your current draft.', [
        { text: 'KEEP DRAWING', style: 'cancel' },
        { text: 'CLEAR', style: 'destructive', onPress: () => { if (mounted.current && allowed.current) change({ strokes: [] }); } },
      ])} />
    </View>
    <Text accessibilityLiveRegion="polite" style={T.muted}>{limit ? 'Stroke or drawing limit reached. Lift your pen, undo a stroke or submit your drawing.' : `${pointCount(value)}/${TELESTRATIONS_LIMITS.points} points · ${value.strokes.length}/${TELESTRATIONS_LIMITS.strokes} strokes`}</Text>
    <BookButton label={precise ? 'Hide direction controls' : 'Show direction controls'} quiet onPress={() => { setPrecise(!precise); setCursor(precise ? null : [2048, 2048]); setPenDown(false); }} />
    {precise ? <View style={{ gap: 8 }}>
      <Text style={T.muted}>Move the ring, then lower the pen to draw. With a keyboard, focus the paper and use arrows and Space.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <BookButton label="Move left" quiet disabled={disabled} onPress={() => move(-80, 0)} />
        <BookButton label="Move up" quiet disabled={disabled} onPress={() => move(0, -80)} />
        <BookButton label="Move down" quiet disabled={disabled} onPress={() => move(0, 80)} />
        <BookButton label="Move right" quiet disabled={disabled} onPress={() => move(80, 0)} />
        <BookButton label={penDown ? 'Lift pen' : 'Lower pen'} selected={penDown} disabled={disabled} onPress={() => { if (!penDown) point(cursor ?? [2048, 2048], true); setPenDown(!penDown); }} />
      </View>
    </View> : null}
  </View>;
}
