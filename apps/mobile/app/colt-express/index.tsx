import { RemainingLanding } from '../../components/remaining/RemainingLanding';
import { ColtMark } from '../../components/remaining/RemainingArtwork';
import { ColtReferenceSheet } from '../../components/colt/ReferenceSheet';
import { GameCover } from '../../components/ui/GameCover';
import { COLT } from '../../constants/theme';

export default function ColtLanding() {
  return <RemainingLanding gameId="colt_express" base="/colt-express" title="COLT EXPRESS" presentation="illustrated"
    tagline="Program the perfect train robbery, then watch every move, shot, punch, and mistake unfold across two levels."
    tags={['ACTION PROGRAMMING', 'MOVING TRAIN', '2–6 PLAYERS']} createLabel="BOARD THE TRAIN"
    mark={<ColtMark size={68} />}
    hero={<GameCover nativeID="colt-entrance-art" source={require('../../assets/game-art/colt-hero.webp')} fallback={<ColtMark size={100} />} />}
    renderRules={(visible, onClose) => <ColtReferenceSheet visible={visible} onClose={onClose} />}
    palette={{ ...COLT, accent: COLT.ember, secondary: COLT.gold }} />;
}
