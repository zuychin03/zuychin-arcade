import { RemainingLobby } from '../../components/remaining/RemainingLobby';
import { LibertaliaMark } from '../../components/remaining/RemainingArtwork';
import { LibertaliaReferenceSheet } from '../../components/libertalia/ReferenceSheet';
import { useGameStore } from '../../store/useGameStore';
import { LIBERTALIA } from '../../constants/theme';
import { LIBERTALIA_MIN_PLAYERS } from '@zuychin-arcade/types';

export default function Page() {
  const ready = useGameStore(s => Boolean(s.libertaliaPublic && s.libertaliaPrivate && !s.libertaliaSyncing));
  return <RemainingLobby base="/libertalia" gameName="Libertalia" minPlayers={LIBERTALIA_MIN_PLAYERS}
    mark={<LibertaliaMark size={58} />} briefing="Winds of Galecrest, calm-side loot, 2–6 players. All admirals receive the same new crew each voyage. Secret selections reveal together; low ranks resolve by day and high ranks claim loot at dusk. Inspect the full face-up voyage loot before choosing."
    gameReady={ready} renderRules={(visible, onClose) => <LibertaliaReferenceSheet visible={visible} onClose={onClose} />}
    palette={{ ...LIBERTALIA, accent: LIBERTALIA.sky, secondary: LIBERTALIA.gold }} />;
}
