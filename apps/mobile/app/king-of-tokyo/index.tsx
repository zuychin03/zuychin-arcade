import { RemainingLanding } from '../../components/remaining/RemainingLanding';
import { TokyoMark } from '../../components/king-of-tokyo/TokyoArtwork';
import { GameCover } from '../../components/ui/GameCover';
import { KingOfTokyoReferenceSheet } from '../../components/king-of-tokyo/ReferenceSheet';
import { TOKYO_PALETTE } from '../../components/king-of-tokyo/palette';

export default function KingOfTokyoLanding() {
  return <RemainingLanding gameId="king_of_tokyo" base="/king-of-tokyo" title="KING OF TOKYO" presentation="illustrated"
    tagline="Roll, smash and seize Tokyo. Build your monster from the 66-card power deck and race to 20 victory points."
    tags={['ROLL AND REROLL', 'CONTROL TOKYO', '2–6 PLAYERS']} createLabel="ENTER TOKYO"
    mark={<TokyoMark size={68} />}
    hero={<GameCover nativeID="tokyo-entrance-art" source={require('../../assets/game-art/tokyo-hero.webp')} fallback={<TokyoMark size={100} />} />}
    renderRules={(visible, onClose) => <KingOfTokyoReferenceSheet visible={visible} onClose={onClose} />}
    palette={TOKYO_PALETTE} />;
}
