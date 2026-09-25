import { RulesReferenceSheet, type RuleSection } from '../ui/RulesReferenceSheet';
import { DIXIT as C } from '../../constants/theme';
import { DixitRulesGuide } from './RulesGuide';

const SECTIONS: RuleSection[] = [
  {
    "title": "Read the votes, then score",
    "icon": "counter",
    "entries": [
      {
        "title": "Some votes correct",
        "body": "Storyteller: 3. Each correct vote: 3, so two correct votes earn 6."
      },
      {
        "title": "Every vote correct",
        "body": "Storyteller: 0. Every other player: 4."
      },
      {
        "title": "No votes correct",
        "body": "Storyteller: 0. Every other player: 2."
      },
      {
        "title": "Decoy points and unanimous votes",
        "body": "In every case, each vote attracted by your own image adds 1 point. There is no cap on these decoy points. “Every vote correct” means both votes from every voter, not just one correct vote each."
      }
    ]
  },
  {
    "title": "Three players and the next story",
    "icon": "account-group-outline",
    "entries": [
      {
        "title": "A table for three",
        "body": "Use seven cards each instead of six. Each non-storyteller submits two images, making a five-image table. Both of your images are ineligible for your votes. The same two-vote scoring applies."
      },
      {
        "title": "Keep the story moving",
        "body": "The first inspired player volunteers to tell the first story. After each reveal, everyone confirms they are ready. Refill hands, then move the storyteller clockwise. There is no countdown."
      }
    ]
  },
  {
    "title": "Leaving and this edition",
    "icon": "information-outline",
    "entries": [
      {
        "title": "Leaving and reconnecting",
        "body": "Leaving or failing to reconnect before the grace period expires forfeits your seat. An unfinished round is cancelled without points; settled points stay. With fewer than three players, the game ends without a winner."
      },
      {
        "title": "This edition",
        "body": "This private prototype follows the 2024 Odyssey base rules with original illustrations. Older optional voting, Party and Team variants are not part of this edition."
      }
    ]
  }
];

export function DixitReferenceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  if (!visible) return null;
  return <RulesReferenceSheet visible={visible} onClose={onClose} gameTitle="Dixit Odyssey" subtitle="2024 base edition · 3–12 storytellers · two votes each" icon="cards-outline" palette={{ ...C, background: C.bg }} sections={SECTIONS}>
    <DixitRulesGuide />
  </RulesReferenceSheet>;
}
