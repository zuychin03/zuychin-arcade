import { RemainingLanding } from '../../components/remaining/RemainingLanding';
import { SaboteurMark } from '../../components/saboteur/SaboteurArtwork';
import { GameCover } from '../../components/ui/GameCover';
import { SaboteurReferenceSheet } from '../../components/saboteur/ReferenceSheet';
import { SABOTEUR_PALETTE } from '../../components/saboteur/palette';

export default function SaboteurLanding() {
  return <RemainingLanding gameId="saboteur" base="/saboteur" title="SABOTEUR" presentation="illustrated"
    tagline="Dig towards the gold, protect your tools, and decide who you trust. Someone in the mine is working against you."
    tags={['SECRET ROLES', '3–10 PLAYERS', '3 ROUNDS']} createLabel="OPEN THE MINE"
    mark={<SaboteurMark size={68} />} hero={<GameCover nativeID="saboteur-entrance-art" source={require('../../assets/game-art/saboteur-hero.webp')} />}
    renderRules={(visible, onClose) => <SaboteurReferenceSheet visible={visible} onClose={onClose} />}
    palette={SABOTEUR_PALETTE} />;
}
