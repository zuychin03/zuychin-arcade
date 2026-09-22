import type {
  LibertaliaChoicePayload, LibertaliaPrivateState, LibertaliaPublicState, LibertaliaSelectPayload,
} from '@zuychin-arcade/types';

export type ProjectionCommand =
  | { action: 'select'; event: 'libertalia:select'; payload: LibertaliaSelectPayload }
  | { action: 'choice'; event: 'libertalia:choice'; payload: LibertaliaChoicePayload };

export function chooseProjectionCommand(publicState: LibertaliaPublicState, privateState: LibertaliaPrivateState): ProjectionCommand | null {
  if (publicState.gameId !== 'libertalia' || privateState.gameId !== 'libertalia'
    || publicState.roomCode !== privateState.roomCode || publicState.revision !== privateState.revision
    || publicState.status !== 'playing') return null;
  const expectedRevision = publicState.revision;
  if (privateState.pendingChoice) {
    const choice = privateState.pendingChoice;
    if (choice.playerId !== privateState.playerId) throw new Error('Private choice has a foreign owner');
    const options = [...choice.options];
    const offset = options.length ? (publicState.day + publicState.voyage) % options.length : 0;
    const ordered = [...options.slice(offset), ...options.slice(0, offset)];
    const count = choice.optional ? choice.min : Math.max(choice.min, 1);
    return { action: 'choice', event: 'libertalia:choice', payload: {
      choiceId: choice.id, optionIds: ordered.slice(0, count).map((option) => option.id), expectedRevision,
    } };
  }
  if (privateState.canSelect && privateState.selectedRank === null && privateState.hand.length > 0) {
    const rank = privateState.hand[(publicState.day + publicState.voyage) % privateState.hand.length]!;
    return { action: 'select', event: 'libertalia:select', payload: { rank, expectedRevision } };
  }
  return null;
}
