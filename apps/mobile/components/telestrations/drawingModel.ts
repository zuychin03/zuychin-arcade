import { TELESTRATIONS_LIMITS as L, type TelestrationsDrawing } from '@zuychin-arcade/types';
export const EMPTY_DRAWING: TelestrationsDrawing = { strokes: [] };
export const PEN_WIDTHS = [18, 38, 70] as const;
export const INK_NAMES = ['White', 'Black', 'Rose', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple'] as const;
export type Point = [number, number];
export function normalisePoint(x: number, y: number, width: number, height: number): Point | null {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return [Math.round(Math.max(0, Math.min(1, x / width)) * L.coordinate), Math.round(Math.max(0, Math.min(1, y / height)) * L.coordinate)];
}
export function pointCount(drawing: TelestrationsDrawing): number { return drawing.strokes.reduce((total, s) => total + s.points.length, 0); }
export function drawingFits(drawing: TelestrationsDrawing): boolean {
  return drawing.strokes.length <= L.strokes && pointCount(drawing) <= L.points && JSON.stringify(drawing).length <= L.drawingBytes;
}
export function appendPoint(drawing: TelestrationsDrawing, point: Point, color: number, width: number, start: boolean): TelestrationsDrawing {
  const previous = drawing.strokes.at(-1);
  if (!start && previous?.points.at(-1)?.every((n, i) => n === point[i])) return drawing;
  if (start || !previous) {
    const next = { strokes: [...drawing.strokes, { color, width, points: [point] }] };
    return drawingFits(next) ? next : drawing;
  }
  if (previous.points.length >= L.pointsPerStroke) return drawing;
  const next = { strokes: [...drawing.strokes.slice(0, -1), { ...previous, points: [...previous.points, point] }] };
  return drawingFits(next) ? next : drawing;
}
