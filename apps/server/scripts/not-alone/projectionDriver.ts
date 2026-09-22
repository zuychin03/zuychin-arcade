import type {
  NotAloneActionKind,
  NotAlonePrivateState,
  NotAlonePublicState,
  NotAloneResolvePayload,
} from '@zuychin-arcade/types';

export interface ProjectionCommand {
  event: string;
  action: Exclude<NotAloneActionKind, 'start'>;
  payload: Record<string, unknown>;
}

// Each decision receives one seat's wire projections, never the engine or another hand.
export function chooseProjectionCommand(
  game: NotAlonePublicState,
  mine: NotAlonePrivateState,
): ProjectionCommand | null {
  if (game.status !== 'playing' || game.revision !== mine.revision) return null;
  const command = (action: ProjectionCommand['action'], payload: Record<string, unknown> = {}): ProjectionCommand => ({
    event: `notalone:${action.replaceAll('_', '-')}`,
    action,
    payload: { ...payload, expectedRevision: mine.revision },
  });
  if (mine.cardChoice) return command('card_choice', mine.cardChoice.kind === 'artefact_order'
    ? { placeIndexes: mine.cardChoice.placeIndexes }
    : { placeIds: mine.cardChoice.placeOptions.slice(0, mine.cardChoice.count) });
  if (mine.canChooseSurvivalCard) return command('survival_choice', { cardId: mine.survivalChoiceCards[0] });
  if (mine.canChooseRiver) return command('river_choice', { explorePlaceId: mine.selectedPlaces[0] });
  if (mine.canSelect) {
    const choices = mine.placeHand.filter((id) => !game.selectionBlockedPlaces.includes(id));
    if (choices.length < mine.requiredSelectionCount && mine.canGiveUp) return command('give_up');
    if (choices.length >= mine.requiredSelectionCount) {
      const offset = game.roundNumber % choices.length;
      const rotated = [...choices.slice(offset), ...choices.slice(0, offset)];
      return command('select', { placeIds: rotated.slice(0, mine.requiredSelectionCount) });
    }
  }
  if (mine.canPass) return command('pass');
  if (mine.canBeginHunt) return command('begin_hunt');
  if (mine.canReveal) return command('reveal');
  if (mine.canBeginReckoning) return command('begin_reckoning');
  if (mine.canEndTurn) return command('end_turn');
  if (mine.canHunt && game.phase === 'creature_planning') {
    if (mine.canLockHunt) return command('lock_hunt');
    const place = ((game.roundNumber + 2) % 5) + 1;
    if (game.huntTokens.creature.length === 0) return command('place_token', { token: 'creature', placeIds: [place] });
    if (game.artemiaAvailable && game.huntTokens.artemia.length === 0) {
      return command('place_token', { token: 'artemia', placeIds: [(place % 5) + 1] });
    }
  }
  if (mine.canResolve && mine.resolutionOptions) {
    const options = mine.resolutionOptions;
    const payload: NotAloneResolvePayload = {
      mode: 'recover',
      placeIds: options.stage === 'place' && options.canRecoverPlace
        ? options.recoverablePlaceIds.slice(0, options.recoverCount) : [],
      expectedRevision: mine.revision,
    };
    if (options.screamDiscardCount === 2) {
      payload.huntChoice = 'discard';
      payload.huntPlaceIds = options.screamDiscardPlaceIds.slice(0, 2);
    } else if (options.canLoseWillForScream) payload.huntChoice = 'will';
    if (options.toxinSurvivalCardIds.length) payload.huntSurvivalCardId = options.toxinSurvivalCardIds[0];
    if (options.mustUsePlacePower && options.canUsePlacePower) {
      payload.mode = 'power';
      delete payload.placeIds;
      if ([1, 2, 6].includes(options.effectivePlaceId)) payload.placeIds = options.powerRecoverablePlaceIds.slice(0, options.powerRecoveryCount);
      if (options.effectivePlaceId === 4) payload.choice = options.beachChoices[0];
      if (options.effectivePlaceId === 5) payload.targetPlaceId = options.roverPlaceIds[0];
      if (options.effectivePlaceId === 9) {
        payload.choice = options.sourceChoices[0];
        if (payload.choice === 'will') payload.targetPlayerId = options.healTargetPlayerIds[0];
      }
    }
    return command('resolve', { ...payload });
  }
  return null;
}
