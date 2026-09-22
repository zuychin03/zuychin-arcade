import { CITADELS_MIN_PLAYERS } from '@zuychin-arcade/types';
import { RemainingLobby } from '../../components/remaining/RemainingLobby';
import { CitadelsMark } from '../../components/citadels/CitadelsArtwork';
import { CitadelsReferenceSheet } from '../../components/citadels/ReferenceSheet';
import { CITADELS_PALETTE } from '../../components/citadels/palette';
import { useGameStore } from '../../store/useGameStore';

export default function CitadelsLobby() {
  const ready = useGameStore((state) => Boolean(state.citadelsPublic && state.citadelsPrivate && !state.citadelsSyncing));
  return <RemainingLobby base="/citadels" gameName="Citadels" minPlayers={CITADELS_MIN_PLAYERS}
    mark={<CitadelsMark size={58} />} gameReady={ready}
    briefing="Secretly draft one of eight characters each round and build a seven-district city. Leaving a live court forfeits your seat. Fewer than four eligible builders ends the court without a winner."
    renderRules={(visible, onClose) => <CitadelsReferenceSheet visible={visible} onClose={onClose} />}
    palette={CITADELS_PALETTE} />;
}
