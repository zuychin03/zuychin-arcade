import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RemainingLobby } from '../../components/remaining/RemainingLobby';
import { KrakenReferenceSheet } from '../../components/kraken/ReferenceSheet';
import { KRAKEN as C } from '../../components/kraken/palette';
import { useGameStore } from '../../store/useGameStore';
export default function Lobby() {
  const ready = useGameStore(s => Boolean(s.krakenPublic && s.krakenPrivate && !s.krakenSyncing));
  const long = useGameStore(s => s.room?.config.krakenJourney === 'long');
  return <RemainingLobby base="/feed-the-kraken" gameName="Feed the Kraken" minPlayers={long ? 7 : 5} gameReady={ready} palette={C} briefing={`${long ? 'Long: 7' : 'Quick: 5'}–11 players. Secret factions, gun mutinies and a shared voyage. Keep your private screen hidden. Character windows pass clockwise; only the captain appoints the navigation team.`} mark={<MaterialCommunityIcons name="ferry" size={56} color={C.accent} />} renderRules={(visible, onClose) => <KrakenReferenceSheet visible={visible} onClose={onClose} />} />;
}
