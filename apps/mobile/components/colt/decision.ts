import type { ColtAction, ColtPrivateState, ColtPublicState, ColtRoundEvent, RoomPublicState } from '@zuychin-arcade/types';

export function coltLeaveMessage(): string {
  return 'Leaving or letting reconnect grace expire forfeits your eligibility immediately. No new actions are programmed for you. Only your already-programmed actions finish automatically, then your bandit leaves before the next round. One remaining eligible seat wins by forfeit; if nobody remains, there is no winner.';
}
export const COLT_EVENT_HELP: Record<ColtRoundEvent, string> = {
  none: 'No extra event at the end of this round.',
  angry_marshal: 'Round end: the Marshal shoots the roof above him, then moves towards the caboose.',
  braking: 'Round end: roof bandits move one car towards the locomotive.',
  passengers_rebellion: 'Round end: bandits inside receive neutral bullets if the supply can cover the whole affected group.',
  swivel_arm: 'Round end: every roof bandit moves to the caboose roof.',
  take_it_all: 'Round end: a second strongbox appears inside the Marshal’s car.',
  marshal_revenge: 'Round end: bandits on the roof above the Marshal drop their lowest-value purse.',
  hostage_conductor: 'Round end: bandits inside or on the roof of the locomotive gain $250.',
  pickpocketing: 'Round end: a bandit alone in a space may take a purse there.',
};

export const COLT_ACTION_HELP: Record<ColtAction | 'bullet', string> = {
  move: 'At execution, move one car inside, or one to three cars along the roof.',
  floor: 'At execution, switch between the roof and inside of your current car.',
  shoot: 'At execution, shoot a legal bandit in range. Character powers can change targets and effects.',
  punch: 'At execution, punch a bandit in your space, make them drop loot and move to an adjacent car.',
  rob: 'At execution, take one loot token in your exact car and level.',
  marshal: 'At execution, move the Marshal one car inside. Bandits he meets flee to the roof and receive neutral bullets if enough remain for the group.',
  bullet: 'A received bullet occupies your hand but cannot be programmed.',
};
export const COLT_TURN_HELP = {
  standard: 'Standard: program one action face up, or draw three cards instead.',
  tunnel: 'Tunnel: program one action face down, or draw three cards instead.',
  speeding: 'Speed-up: take two consecutive programming actions. Each may be replaced by drawing three cards.',
  switching: 'Reverse order: this programming turn runs counter-clockwise.',
};
export function coltCarName(car: number, count: number): string { return car === 0 ? 'Caboose' : car === count - 1 ? 'Locomotive' : `Car ${car + 1}`; }
export function coltCharacterSetupMessage(game: ColtPublicState, mine: ColtPrivateState): string {
  if (mine.canChooseCharacter) return 'Choose an available character and their power. Each character can be claimed by one player. If another player claims first, refreshed choices will appear.';
  const waiting = game.players.filter(player => !player.forfeited && !player.characterChosen).map(player => player.displayName);
  return waiting.length ? `Your character is confirmed. Waiting for ${waiting.join(', ')} to choose.` : 'All characters are chosen. Preparing the robbery.';
}
export function coltProgramPayload(cardId: string, coverCardId: string | undefined, canHide: boolean, faceDown: boolean): Record<string, unknown> {
  return { cardId, ...(coverCardId ? { coverCardId } : {}), ...(canHide ? { faceDown: coverCardId ? false : faceDown } : {}) };
}
export function coltDecisionKey(game: ColtPublicState | null, mine: ColtPrivateState | null): string | null {
  if (!game || !mine || game.status === 'game_over') return null;
  const prefix = `${game.roomCode}:${mine.playerId}:${game.round}`;
  if (mine.canChooseCharacter) return `${prefix}:character`;
  if (mine.canChooseTeam) return `${prefix}:team`;
  if (mine.canAssignStart) return `${prefix}:setup`;
  if (mine.canReserve) return `${prefix}:reserve`;
  if (mine.canChoose && game.pending) return `${prefix}:choice:${game.executionIndex}:${game.pending.action}:${game.pending.options.map(o => o.id).join('|')}`;
  if (mine.canProgram) return `${prefix}:program:${game.slot}:${game.programmingActionNumber}:${mine.programmedCardIds.length}:${mine.hand.map(c => c.id).join('|')}`;
  return null;
}
export function isColtLeavePromptCurrent(captured: ColtPublicState | null, current: ColtPublicState | null, capturedEpoch: number, epoch: number): boolean {
  return Boolean(captured && current && capturedEpoch === epoch && captured.roomCode === current.roomCode && captured.status === current.status
    && (captured.status !== 'game_over' || captured.revision === current.revision));
}
export function coltRematchMessage(seats: RoomPublicState['players']): string | null {
  if (seats.some(p => !p.isConnected && !p.hasLeft)) return 'Waiting for a bandit to reconnect or their reconnect grace to expire before a rematch.';
  if (seats.filter(p => p.isConnected && !p.hasLeft).length < 2) return 'At least two connected seats are needed for a rematch.';
  return null;
}
