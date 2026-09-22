const assert = require('node:assert/strict');

const OWN_VIEW_METHOD = 'Automated ordinary-server own-view natural policy. Every gameplay choice uses only the acting seat projected public state and owned private frame. Central scheduling, privacy assertions and focus instrumentation still observe synthetic clients. No coordinated catch/escape plan, engine seeding, independent human play or winner guarantee. Survival reactions are passed; mandatory card, River, Hunt and Place choices use projected legal options.';

function assertOwnViewMode({ ownView, focusOnly, focusStabilityOnly, fixtureRun }) {
  assert(!ownView || !(focusOnly || focusStabilityOnly || fixtureRun), 'Own-view natural mode is incompatible with focus-only or seeded fixture modes');
}

function ownViewPolicy(state, mine) {
  assert(state && mine && state.gameId === 'not_alone' && mine.gameId === 'not_alone', 'Not Alone projections required');
  assert(state.viewerPlayerId === mine.playerId && state.roomCode === mine.roomCode && state.revision === mine.revision, 'Policy requires paired projections owned by the acting seat');
  const me = state.players.find(player => player.playerId === mine.playerId);
  assert(me && me.role === mine.role, 'Acting role must match the projected public seat');
  const blocked = new Set(state.selectionBlockedPlaces);
  const available = mine.placeHand.filter(place => !blocked.has(place));
  const seatOffset = [...mine.playerId].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  const rotate = values => {
    const offset = values.length ? (seatOffset + state.roundNumber) % values.length : 0;
    return [...values.slice(offset), ...values.slice(0, offset)];
  };
  const priority = [4, 8, 5, 1, 10, 2, 3, 7, 9, 6];
  const explorationPlaces = rotate(available).sort((a, b) => {
    const score = place => (state.disabledPlaces.includes(place) ? 10 : 0) + Math.floor(priority.indexOf(place) / 3);
    return score(a) - score(b);
  }).slice(0, mine.requiredSelectionCount);

  const hunted = state.players.filter(player => player.role === 'hunted' && !player.forfeited && player.handCount > 0);
  const candidatePlaces = rotate([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(place => !blocked.has(place)));
  const plausible = (player, place) => {
    const disclosed = mine.revealedHuntedHands?.[player.playerId];
    if (disclosed?.length) return disclosed.includes(place) ? 2 : 0;
    if (player.discard.includes(place)) return 0;
    return place <= 5 || player.revealedPlaces.includes(place) ? 1 : 0;
  };
  candidatePlaces.sort((a, b) => hunted.reduce((sum, player) => sum + plausible(player, b) - plausible(player, a), 0));
  const destination = candidatePlaces[0] ?? 1;
  const tokenDanger = place => Object.values(state.huntTokens).filter(places => places.includes(place)).length;
  const riverChoice = [...mine.selectedPlaces].sort((a, b) => tokenDanger(a) - tokenDanger(b))[0] ?? null;
  const resolution = mine.resolutionOptions;
  const usePower = Boolean(resolution?.canUsePlacePower && (resolution.mustUsePlacePower ||
    !resolution.canRecoverPlace || ![2, 6].includes(resolution.effectivePlaceId) || resolution.powerRecoveryCount > 0 || resolution.canReturnPlayedPlace));
  const rover = [8, 10, 7, 9, 6].find(place => resolution?.roverPlaceIds.includes(place)) ?? resolution?.roverPlaceIds[0] ?? null;
  return {
    explorationPlaces,
    giveUp: Boolean(mine.canSelect && explorationPlaces.length < mine.requiredSelectionCount && mine.canGiveUp),
    huntCardId: mine.role === 'creature' ? mine.playableHuntCardIds.find(card => card !== 'flashback') ?? mine.playableHuntCardIds[0] ?? null : null,
    creatureDestination: destination,
    artemiaDestination: candidatePlaces.find(place => place !== destination) ?? destination,
    cardChoicePlaces: mine.cardChoice?.placeOptions.slice(0, mine.cardChoice.count) ?? [],
    cardChoiceIndexes: mine.cardChoice?.placeIndexes.slice(0, mine.cardChoice.count) ?? [],
    survivalChoiceCardId: mine.survivalChoiceCards[0] ?? null,
    riverChoice,
    resolution: { usePower, rover },
    passSurvival: true,
  };
}

module.exports = { ownViewPolicy, assertOwnViewMode, OWN_VIEW_METHOD };
