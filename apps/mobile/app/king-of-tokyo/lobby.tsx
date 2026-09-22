import { KING_OF_TOKYO_MIN_PLAYERS } from '@zuychin-arcade/types';
import { RemainingLobby } from '../../components/remaining/RemainingLobby';
import { TokyoMark } from '../../components/king-of-tokyo/TokyoArtwork';
import { KingOfTokyoReferenceSheet } from '../../components/king-of-tokyo/ReferenceSheet';
import { TOKYO_PALETTE } from '../../components/king-of-tokyo/palette';
import { useGameStore } from '../../store/useGameStore';

export default function KingOfTokyoLobby() {
  const ready = useGameStore((state) => Boolean(state.kingOfTokyoPublic && !state.kingOfTokyoSyncing));
  return <RemainingLobby base="/king-of-tokyo" gameName="King of Tokyo" minPlayers={KING_OF_TOKYO_MIN_PLAYERS}
    mark={<TokyoMark size={58} />} gameReady={ready}
    briefing="The first match begins with an all-player Smash roll-off. Reach 20 victory points and survive the turn, or be the last living monster. Current publisher base rules, 66 power cards. Temporary disconnections preserve your seat; leaving or expired reconnect grace forfeits it."
    renderRules={(visible, onClose) => <KingOfTokyoReferenceSheet visible={visible} onClose={onClose} />}
    palette={TOKYO_PALETTE} />;
}
