export function bangLayout(width: number, fontScale = 1) {
  const available = Number.isFinite(width) ? Math.max(0, width) : 0;
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  return {
    besideTable: available >= (560 + 340) * scale + 16,
    besideResults: available >= (320 + 440) * scale + 24,
  };
}

export function bangDecisionOffset(playArea: number, primary: number, decision: number, choice: number, hand = 0) {
  return Math.max(0, playArea + primary + decision + choice + hand);
}
