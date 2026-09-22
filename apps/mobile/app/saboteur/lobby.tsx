import { MIN_PLAYERS } from '@zuychin-arcade/types';
import { RemainingLobby } from '../../components/remaining/RemainingLobby';
import { SaboteurMark } from '../../components/saboteur/SaboteurArtwork';
import { SaboteurReferenceSheet } from '../../components/saboteur/ReferenceSheet';
import { SABOTEUR_PALETTE } from '../../components/saboteur/palette';
import { useGameStore } from '../../store/useGameStore';

export default function LobbyScreen() {
  const ready = useGameStore((state) => Boolean(state.publicState && state.privateState && !state.saboteurSyncing));
  return <RemainingLobby base="/saboteur" gameName="Saboteur" minPlayers={MIN_PLAYERS}
    mark={<SaboteurMark size={58} />}
    briefing="Miners race for gold while secret saboteurs derail the dig. Connect tunnels, repair allies and decide who can be trusted. The deliberate 5 × 9 cap keeps every route observable. New secret roles are dealt each round; the richest player after three rounds wins. The rulebook explains the digital adaptations."
    gameReady={ready}
    renderRules={(visible, onClose) => <SaboteurReferenceSheet visible={visible} onClose={onClose} />}
    palette={SABOTEUR_PALETTE} />;
}
