import { useRef } from 'react';
import type { DrawingInputProps } from './DrawingInput';
import { normalisePoint, type Point } from './drawingModel';

export default function DrawingInput({ disabled, children, onPoint, onEnd, onCursor }: DrawingInputProps) {
  const pointer = useRef<number | null>(null);
  const cursor = useRef<Point>([2048, 2048]);
  const penDown = useRef(false);
  const emit = (event: React.PointerEvent<HTMLDivElement>, start: boolean) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = normalisePoint(event.clientX - bounds.left, event.clientY - bounds.top, bounds.width, bounds.height);
    if (!disabled && point) onPoint(point, start);
  };
  const end = () => { pointer.current = null; onEnd(); };
  return <div data-testid="telestrations-drawing-input" tabIndex={disabled ? -1 : 0} role="group"
    aria-label="Drawing paper" aria-disabled={disabled}
    aria-description="Draw with mouse, pen or touch. Keyboard: arrows move, Space lifts or lowers the pen, Enter makes a dot. Tab leaves the paper."
    onPointerDown={event => {
      if (disabled || pointer.current !== null || event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus(); pointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId); emit(event, true);
    }}
    onPointerMove={event => { if (pointer.current === event.pointerId) emit(event, false); }}
    onPointerUp={event => { if (pointer.current === event.pointerId) { emit(event, false); end(); } }}
    onPointerCancel={event => { if (pointer.current === event.pointerId) end(); }}
    onLostPointerCapture={event => { if (pointer.current === event.pointerId) end(); }}
    onFocus={() => onCursor?.(cursor.current)} onBlur={() => { penDown.current = false; onCursor?.(null); onEnd(); }}
    onKeyDown={event => {
      if (disabled) return;
      const shifts: Record<string, Point> = { ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] };
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (event.repeat) return;
        if (event.key === 'Enter') { onPoint(cursor.current, true); onEnd(); }
        else { penDown.current = !penDown.current; if (penDown.current) onPoint(cursor.current, true); else onEnd(); }
      } else if (shifts[event.key]) {
        event.preventDefault(); const shift = shifts[event.key];
        cursor.current = [Math.max(0, Math.min(4095, cursor.current[0] + shift[0])), Math.max(0, Math.min(4095, cursor.current[1] + shift[1]))];
        onCursor?.(cursor.current); if (penDown.current) onPoint(cursor.current, false);
      }
    }} style={{ width: '100%', aspectRatio: '1', overflow: 'hidden', touchAction: disabled ? 'auto' : 'none', cursor: disabled ? 'default' : 'crosshair', outlineOffset: 4 }}>{children}</div>;
}
