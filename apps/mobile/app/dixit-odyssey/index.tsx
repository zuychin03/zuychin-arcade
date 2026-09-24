import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RemainingLanding } from '../../components/remaining/RemainingLanding';
import { GameCover } from '../../components/ui/GameCover';
import { DixitReferenceSheet } from '../../components/dixit/ReferenceSheet';
import { DIXIT } from '../../constants/theme';

export default function DixitLanding() {
  const mark = <MaterialCommunityIcons name="cards-outline" size={64} color={DIXIT.accent} />;
  return <RemainingLanding gameId="dixit_odyssey" base="/dixit-odyssey" title="DIXIT ODYSSEY" presentation="illustrated"
    tagline="One image. A clue only some will understand. Find the storyteller’s vision among your friends’ dreams."
    tags={['3–12 PLAYERS', 'VISUAL STORYTELLING', 'TWO SECRET VOTES']} createLabel="BEGIN A STORY"
    mark={mark} hero={<GameCover nativeID="dixit-entrance-art" source={require('../../assets/game-art/dixit-odyssey-hero.webp')} fallback={mark} />}
    renderRules={(visible, onClose) => <DixitReferenceSheet visible={visible} onClose={onClose} />} palette={DIXIT} />;
}
