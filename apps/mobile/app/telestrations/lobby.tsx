import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RemainingLobby } from '../../components/remaining/RemainingLobby';
import { TelestrationsReferenceSheet } from '../../components/telestrations/ReferenceSheet';
import { useGameStore } from '../../store/useGameStore';
import { TELESTRATIONS as C } from '../../components/telestrations/palette';
export default function TelestrationsLobby() {
  const ready = useGameStore(s => Boolean(s.telestrationsPublic && s.telestrationsPrivate && !s.telestrationsSyncing));
  const config = useGameStore(s => s.room?.config);
  const mode = config?.telestrationsScoringMode ?? 'friendly';
  return <RemainingLobby base="/telestrations" gameName="Telestrations" minPlayers={4} gameReady={ready} palette={C}
    briefing={`4–12 players. Three untimed rounds with ${mode === 'none' ? 'no scoring' : `${mode} scoring`}. Books pass ${config?.telestrationsDirection === -1 ? 'anticlockwise' : 'clockwise'}. ${config?.telestrationsCategory ? `Invent a secret within “${config.telestrationsCategory}”.` : 'Choose from original prompt offers.'} Odd tables pass before their first drawing; even tables draw their own secret first.`}
    mark={<MaterialCommunityIcons name="draw" size={56} color={C.accent} />}
    renderRules={(visible, onClose) => <TelestrationsReferenceSheet visible={visible} onClose={onClose} />} />;
}
