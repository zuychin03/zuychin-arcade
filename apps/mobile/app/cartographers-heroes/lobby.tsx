import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RemainingLobby } from '../../components/remaining/RemainingLobby';
import { CartographersReferenceSheet } from '../../components/cartographers/ReferenceSheet';
import { CARTOGRAPHERS as C } from '../../components/cartographers/palette';
import { useGameStore } from '../../store/useGameStore';
export default function CartographersLobby() {
  const ready = useGameStore(state => Boolean(state.cartographersPublic && state.cartographersPrivate && !state.cartographersSyncing));
  const side = useGameStore(state => state.room?.config.cartographersMapSide ?? 'C');
  return <RemainingLobby base="/cartographers-heroes" gameName="Cartographers Heroes" minPlayers={1} gameReady={ready} palette={C}
    briefing={`Everyone charts map ${side}. Choose shapes together, pass maps for ambushes and score two objectives each season. Start alone for the official solo challenge, or invite up to 100 cartographers.`}
    mark={<MaterialCommunityIcons name="map-outline" size={56} color={C.accent} />}
    renderRules={(visible, onClose) => <CartographersReferenceSheet visible={visible} onClose={onClose} />} />;
}
