import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RemainingLobby } from '../../components/remaining/RemainingLobby';
import { DixitReferenceSheet } from '../../components/dixit/ReferenceSheet';
import { useGameStore } from '../../store/useGameStore';
import { DIXIT } from '../../constants/theme';

export default function DixitLobby() {
  const ready = useGameStore(state => Boolean(state.dixitPublic && state.dixitPrivate && !state.dixitSyncing));
  return <RemainingLobby base="/dixit-odyssey" gameName="Dixit Odyssey" minPlayers={3} gameReady={ready}
    briefing="2024 Odyssey base rules with original illustrations. The first inspired player tells a story; everyone else chooses a matching image and casts two secret votes. At three players, each voter contributes two images."
    mark={<MaterialCommunityIcons name="cards-outline" size={56} color={DIXIT.accent} />} palette={DIXIT}
    renderRules={(visible, onClose) => <DixitReferenceSheet visible={visible} onClose={onClose} />} />;
}
