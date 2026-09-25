import { RulesReferenceSheet, type RuleSection } from '../ui/RulesReferenceSheet';
import { TELESTRATIONS as C } from './palette';
import { TelestrationsRulesGuide } from './RulesGuide';

const SECTIONS: RuleSection[] = [
  {
    "title": "Drawing, guessing and passing",
    "icon": "draw",
    "entries": [
      {
        "title": "One page, one interpretation",
        "body": "Draw only pictures, with no letters or numbers. Do not leave a blank page. Guess the previous drawing, not an earlier word you remember. A guess cannot be empty or just a question mark."
      },
      {
        "title": "Lock in together",
        "body": "Lock in when ready. Everyone finishes before the books pass together. This 2025 edition has no countdown. Saved drafts return after reconnecting; keep the page open if work has not saved yet."
      }
    ]
  },
  {
    "title": "Reveal and scoring",
    "icon": "book-open-variant",
    "entries": [
      {
        "title": "Reveal the whole book",
        "body": "Each owner reveals their book in order, starting with the secret. Once the last page is visible, the owner can review any page and make the human judgements below."
      },
      {
        "title": "Friendly",
        "body": "Favourite drawing: +1 to its artist. Favourite guess: +1 to its author. Final guess matches the secret: +1 to the owner."
      },
      {
        "title": "Competitive",
        "body": "For each guess matching the secret or the preceding guess: +1 to the guesser and +1 to the preceding artist. A final secret match also gives the owner +1."
      },
      {
        "title": "Just for laughs",
        "body": "Reveal every book without points. The prototype still plays three rounds; no winner is named."
      },
      {
        "title": "Settling the round",
        "body": "Points settle only after every book is scored. After three full rounds, the highest total wins. Tied leaders share the win. The app never decides whether two ideas mean the same thing."
      }
    ]
  },
  {
    "title": "Leaving and digital adaptations",
    "icon": "information-outline",
    "entries": [
      {
        "title": "Leaving changes the table",
        "body": "Leaving, or missing the reconnect grace period, immediately forfeits your seat. An unfinished round is cancelled, including its provisional points, and starts again with the remaining players. Settled scores stay. Fewer than four players ends the game without a winner."
      },
      {
        "title": "This edition",
        "body": "Private prototype of the 2025 12-player rules. Digital adaptations: 72 original prompts in a shuffled pool, exhausted before reuse; three offers per player, three casual rounds, and the forfeit policy above."
      }
    ]
  }
];

export function TelestrationsReferenceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  if (!visible) return null;
  return <RulesReferenceSheet visible={visible} onClose={onClose} gameTitle="Telestrations" subtitle="2025 edition · 4–12 players · three rounds" icon="book-open-variant" palette={{ ...C, background: C.bg }} sections={SECTIONS}>
    <TelestrationsRulesGuide />
  </RulesReferenceSheet>;
}
