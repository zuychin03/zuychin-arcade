import type { CoupCharacter } from '@zuychin-arcade/types';
import { COUP, COUP_CHARACTER_COLOR } from './theme';

export interface CharacterRef {
  name: string;
  action: string;
  blocks: string;
}

export const CHARACTER_REF: Record<CoupCharacter, CharacterRef> = {
  duke: { name: 'Duke', action: 'Tax: take 3 coins', blocks: 'Foreign Aid' },
  assassin: { name: 'Assassin', action: 'Assassinate: pay 3, target risks one influence', blocks: 'Nothing' },
  captain: { name: 'Captain', action: 'Steal: take up to 2 coins from a player', blocks: 'Stealing' },
  ambassador: { name: 'Ambassador', action: 'Exchange: draw 2, keep your current face-down influence count, return the rest', blocks: 'Stealing' },
  contessa: { name: 'Contessa', action: 'No action', blocks: 'Assassination' },
  inquisitor: { name: 'Inquisitor', action: 'Exchange 1, or examine one rival influence', blocks: 'Stealing' },
};

export interface ActionRef {
  name: string;
  detail: string;
  tag: string;
  tagColor: string;
}

export const GENERAL_ACTIONS: ActionRef[] = [
  { name: 'Income', detail: 'Take 1 coin.', tag: 'safe', tagColor: COUP.green },
  { name: 'Foreign Aid', detail: 'Take 2 coins.', tag: 'Duke blocks', tagColor: COUP.purple },
  { name: 'Coup', detail: 'Pay 7 - a player loses an influence.', tag: 'unblockable', tagColor: COUP.crimson },
];

export const REFORMATION_ACTIONS: ActionRef[] = [
  { name: 'Convert', detail: 'Pay 1 (self) or 2 (another) into the Treasury to switch allegiance.', tag: 'reformation', tagColor: COUP.gold },
  { name: 'Embezzle', detail: 'Take all Treasury coins - you claim to hold no Duke.', tag: 'challengeable', tagColor: COUP.crimson },
];

export const RULES_NOTES: { title: string; body: string }[] = [
  { title: 'Goal', body: 'Be the last player with influence. Lose both your cards and you are out.' },
  { title: 'Challenge', body: 'Challenge a character claim before it resolves. The claimant may prove it and swap that card, making the challenger lose influence, or concede and lose influence without revealing their hand.' },
  { title: 'Block', body: 'Eligible players may claim a listed blocker. Any player may Duke-block Foreign Aid; a targeted player may block Steal or Assassinate. Blocks can be challenged.' },
  { title: 'Coins', body: 'At 10+ coins you must Coup. A Coup costs 7 and cannot be challenged or blocked. Eliminated players return their coins to the Treasury.' },
  { title: 'Assassination', body: 'Pay 3 when declaring it. The claim may be challenged, then the target may Contessa-block. The 3 coins stay spent if blocked. If the Assassin claim is successfully challenged, the 3 coins are returned.' },
  { title: 'Double danger', body: 'If the assassination target challenges Assassin and loses, they lose one influence for the failed challenge, then the assassination resolves immediately without a Contessa block. If someone else loses that challenge, the target may still claim Contessa. If a Contessa claimant concedes or cannot prove the block, they lose one influence and the assassination resolves.' },
];

export { COUP_CHARACTER_COLOR };
