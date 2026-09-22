export function rapidHealingPreview(health: number, maxHealth: number, activations: number, healingPerActivation: number, damage: number) {
  const healed = Math.min(maxHealth - health, activations * healingPerActivation);
  return { healed, remainingHealth: Math.max(0, health + healed - damage) };
}
