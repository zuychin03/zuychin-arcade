export function libertaliaLayout(width: number, fontScale = 1) {
  const available = Number.isFinite(width) ? Math.max(0, width) : 0;
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  return {
    besideTable: available >= (640 + 340) * scale + 20,
    besideResults: available >= (320 + 440) * scale + 20,
  };
}

export function libertaliaScrollOffset(playArea: number, column: number, section: number) {
  return Math.max(0, playArea + column + section);
}
