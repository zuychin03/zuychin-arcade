import { COUP_LIMITS } from '@zuychin-arcade/types';
import { RemainingLobby } from '../../components/remaining/RemainingLobby';
import { CoupTableMark } from '../../components/coup/CoupTableMark';
import { ReferenceSheet } from '../../components/coup/ReferenceSheet';
import { COUP_PALETTE } from '../../components/coup/palette';
import { useGameStore } from '../../store/useGameStore';

export default function CoupLobbyScreen() {
  const ready = useGameStore((state) => Boolean(state.coupPublic && state.coupPrivate && !state.coupSyncing));
  return <RemainingLobby base="/coup" gameName="Coup" minPlayers={COUP_LIMITS.base.min}
    mark={<CoupTableMark />}
    briefing="Two hidden influences. Claim any character, tell the truth or bluff, and decide which claims to challenge. Earn coins, block attacks and eliminate every rival influence. Base Coup rules, with timed digital response windows explained in the rulebook."
    gameReady={ready}
    renderRules={(visible, onClose) => <ReferenceSheet visible={visible} variant="base" onClose={onClose} />}
    palette={COUP_PALETTE} />;
}
