export function restoreCoupActionFocus(label: string, ownsDecision: () => boolean): void {
  if (!ownsDecision()) return;
  const controls = document.querySelectorAll<HTMLElement>('#coup-decision-panel [role="button"]');
  const action = Array.from(controls).find((control) => control.getAttribute('aria-label') === label);
  action?.focus({ preventScroll: true });
  action?.scrollIntoView({ block: 'nearest' });
}
