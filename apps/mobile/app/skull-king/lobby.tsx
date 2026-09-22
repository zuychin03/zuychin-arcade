import { SKULL_KING_MIN_PLAYERS } from '@zuychin-arcade/types';
import { RemainingLobby } from '../../components/remaining/RemainingLobby';
import { SkullKingMark } from '../../components/skull-king/SkullKingArtwork';
import { SkullKingReferenceSheet } from '../../components/skull-king/ReferenceSheet';
import { SKULL_KING_PALETTE } from '../../components/skull-king/palette';
import { useGameStore } from '../../store/useGameStore';

export default function SkullKingLobby() {
  const ready = useGameStore((state) => Boolean(state.skullKingPublic && state.skullKingPrivate && !state.skullKingSyncing));
  return <RemainingLobby base="/skull-king" gameName="Skull King" minPlayers={SKULL_KING_MIN_PLAYERS}
    mark={<SkullKingMark size={58} />} gameReady={ready}
    briefing="Inspect your hand, lock a secret bid, then win exactly that many tricks. Ten rounds, a 70-card base deck and capture bonuses for exact bids. Eight-player voyages deal eight cards in the final two rounds."
    renderRules={(visible, onClose) => <SkullKingReferenceSheet visible={visible} onClose={onClose} />}
    palette={SKULL_KING_PALETTE} />;
}
