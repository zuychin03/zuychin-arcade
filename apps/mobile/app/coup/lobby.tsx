import { COUP_LIMITS } from '@zuychin-arcade/types';
import { RemainingLobby } from '../../components/remaining/RemainingLobby';
import { CoupTableMark } from '../../components/coup/CoupTableMark';
import { ReferenceSheet } from '../../components/coup/ReferenceSheet';
import { COUP_PALETTE } from '../../components/coup/palette';
import { useGameStore } from '../../store/useGameStore';

export default function CoupLobbyScreen() {
  const ready = useGameStore((state) => Boolean(state.coupPublic && state.coupPrivate && !state.coupSyncing));
  const variant = useGameStore((state) => state.room?.config.coupVariant ?? 'base');
  return <RemainingLobby base="/coup" gameName={variant === 'base' ? 'Base Coup · 2–6 players' : 'Reformation + Inquisitor · 2–10 players'} minPlayers={COUP_LIMITS[variant].min}
    mark={<CoupTableMark />}
    briefing={variant === 'base' ? 'Two hidden influences. Claim any character, bluff and challenge the court. Base Coup uses five characters, including the Ambassador.' : 'The Inquisitor replaces the Ambassador. The starting player chooses an allegiance, then sides alternate around the table. Convert sides, take the Treasury and examine rival influence. Only one player wins.'}
    gameReady={ready}
    renderRules={(visible, onClose) => <ReferenceSheet visible={visible} variant={variant} onClose={onClose} />}
    palette={COUP_PALETTE} />;
}
