export type KingOfTokyoCardKind = 'keep' | 'discard';
export type KingOfTokyoCardCategory =
  | 'attack'
  | 'defense'
  | 'dice'
  | 'energy'
  | 'healing'
  | 'market'
  | 'victory'
  | 'wild';

export interface KingOfTokyoPowerCardDefinition {
  id: string;
  name: string;
  cost: number;
  kind: KingOfTokyoCardKind;
  category: KingOfTokyoCardCategory;
  effect: string;
  copies?: number;
}

// Effect copy is deliberately paraphrased. IDs are the authoritative server hooks.
export const KING_OF_TOKYO_POWER_CARDS = [
  { id: 'apartment_building', name: 'Apartment Building', cost: 5, kind: 'discard', category: 'victory', effect: 'Gain 3 victory points.' },
  { id: 'commuter_train', name: 'Commuter Train', cost: 4, kind: 'discard', category: 'victory', effect: 'Gain 2 victory points.' },
  { id: 'corner_store', name: 'Corner Store', cost: 3, kind: 'discard', category: 'victory', effect: 'Gain 1 victory point.' },
  { id: 'drop_from_high_altitude', name: 'Death from Above', cost: 5, kind: 'discard', category: 'wild', effect: 'Gain 2 victory points. Every other monster yields Tokyo, then enter if you are outside.' },
  { id: 'energize', name: 'Energize', cost: 8, kind: 'discard', category: 'energy', effect: 'Gain 9 energy.' },
  { id: 'evacuation_orders', name: 'Evacuation Orders', cost: 7, kind: 'discard', category: 'victory', effect: 'Every other monster loses 5 victory points.', copies: 2 },
  { id: 'flame_thrower', name: 'Flame Thrower', cost: 3, kind: 'discard', category: 'attack', effect: 'Every other monster loses 2 health.' },
  { id: 'frenzy', name: 'Frenzy', cost: 7, kind: 'discard', category: 'wild', effect: 'Take another full turn after the current turn and its end-turn effects finish.' },
  { id: 'gas_refinery', name: 'Gas Refinery', cost: 6, kind: 'discard', category: 'attack', effect: 'Gain 2 victory points; every other monster loses 3 health.' },
  { id: 'heal', name: 'Heal', cost: 3, kind: 'discard', category: 'healing', effect: 'Gain 2 health.' },
  { id: 'high_altitude_bombing', name: 'High Altitude Bombing', cost: 4, kind: 'discard', category: 'attack', effect: 'Every monster, including you, loses 3 health.' },
  { id: 'jet_fighters', name: 'Jet Fighters', cost: 5, kind: 'discard', category: 'victory', effect: 'Gain 5 victory points, then lose 4 health.' },
  { id: 'national_guard', name: 'National Guard', cost: 3, kind: 'discard', category: 'victory', effect: 'Gain 2 victory points, then lose 2 health.' },
  { id: 'nuclear_power_plant', name: 'Nuclear Power Plant', cost: 6, kind: 'discard', category: 'healing', effect: 'Gain 2 victory points and 3 health.' },
  { id: 'skyscraper', name: 'Skyscraper', cost: 6, kind: 'discard', category: 'victory', effect: 'Gain 4 victory points.' },
  { id: 'tanks', name: 'Tanks', cost: 4, kind: 'discard', category: 'victory', effect: 'Gain 4 victory points, then lose 3 health.' },
  { id: 'vast_storm', name: 'Vast Storm', cost: 6, kind: 'discard', category: 'energy', effect: 'Gain 2 victory points; rivals lose 1 energy per 2 energy they hold.' },

  { id: 'acid_attack', name: 'Acid Attack', cost: 6, kind: 'keep', category: 'attack', effect: 'Add one Smash to every final roll.' },
  { id: 'alien_origin', name: 'Alien Origin', cost: 3, kind: 'keep', category: 'market', effect: 'Power cards cost you 1 less energy.' },
  { id: 'alpha_monster', name: 'Alpha Monster', cost: 5, kind: 'keep', category: 'victory', effect: 'After you roll at least one Smash, gain 1 victory point.' },
  { id: 'armor_plating', name: 'Armor Plating', cost: 4, kind: 'keep', category: 'defense', effect: 'Ignore any single packet of exactly 1 health loss.' },
  { id: 'background_dweller', name: 'Background Dweller', cost: 4, kind: 'keep', category: 'dice', effect: 'Reroll a die showing 3 without spending a normal reroll, with no usage limit.' },
  { id: 'burrowing', name: 'Burrowing', cost: 5, kind: 'keep', category: 'attack', effect: 'Add one Smash to your Roll while in Tokyo. The monster that takes your yielded zone loses 1 health.' },
  { id: 'camouflage', name: 'Camouflage', cost: 3, kind: 'keep', category: 'defense', effect: 'For each health you would lose, roll a die; each Heart prevents one.' },
  { id: 'complete_destruction', name: 'Complete Destruction', cost: 3, kind: 'keep', category: 'victory', effect: 'A final roll containing all six faces gains 9 victory points.' },
  { id: 'media_friendly', name: 'Media Friendly', cost: 3, kind: 'keep', category: 'victory', effect: 'Gain 1 victory point whenever you buy a Power card.' },
  { id: 'eater_of_the_dead', name: 'Eater of the Dead', cost: 4, kind: 'keep', category: 'victory', effect: 'Gain 3 victory points whenever another monster reaches 0 health.' },
  { id: 'energy_hoarder', name: 'Energy Hoarder', cost: 3, kind: 'keep', category: 'victory', effect: 'At your turn end, gain 1 victory point per 6 energy you hold.' },
  { id: 'even_bigger', name: 'Even Bigger', cost: 4, kind: 'keep', category: 'healing', effect: 'Increase maximum health by 2 and gain 2 health now. When this Power is lost, reduce your maximum and clamp health to it, without taking damage.' },
  { id: 'extra_head', name: 'Extra Head', cost: 7, kind: 'keep', category: 'dice', effect: 'Roll one additional die.', copies: 2 },
  { id: 'fire_breathing', name: 'Fire Breathing', cost: 4, kind: 'keep', category: 'attack', effect: 'After you roll at least one Smash, each seated neighbor loses 1 health as a separate non-attack effect.' },
  { id: 'freeze_time', name: 'Freeze Time', cost: 5, kind: 'keep', category: 'dice', effect: 'After a final roll with at least three 1s, you may take an extra turn using one fewer die.' },
  { id: 'friend_of_children', name: 'Friend of Children', cost: 3, kind: 'keep', category: 'energy', effect: 'Whenever an effect makes you gain energy, gain 1 extra.' },
  { id: 'giant_brain', name: 'Giant Brain', cost: 5, kind: 'keep', category: 'dice', effect: 'Gain one additional standard reroll each turn.' },
  { id: 'gourmet', name: 'Gourmet', cost: 4, kind: 'keep', category: 'victory', effect: 'A final roll with three 1s gains 2 additional victory points.' },
  { id: 'healing_ray', name: 'Healing Ray', cost: 4, kind: 'keep', category: 'healing', effect: 'Spend rolled Hearts to heal another monster; they pay 2 energy per health, or all remaining energy if they have less.' },
  { id: 'herbivore', name: 'Herbivore', cost: 5, kind: 'keep', category: 'victory', effect: 'At your turn end, gain 1 victory point if you caused no monster, including yourself, to lose health this turn.' },
  { id: 'herd_culler', name: 'Herd Culler', cost: 3, kind: 'keep', category: 'dice', effect: 'Once per turn, change one die to a 1.' },
  { id: 'it_has_a_child', name: 'It Has a Child', cost: 7, kind: 'keep', category: 'defense', effect: 'The first time you would be eliminated, discard your cards and points, then restart outside Tokyo at 10 health.' },
  { id: 'jets', name: 'Jets', cost: 5, kind: 'keep', category: 'defense', effect: 'When you yield Tokyo, suffer no health loss from the Smash that caused the yield.' },
  { id: 'made_in_a_lab', name: 'Made in a Lab', cost: 2, kind: 'keep', category: 'market', effect: 'During your buy step, privately inspect and optionally buy the deck’s top card.' },
  { id: 'metamorph', name: 'Metamorph', cost: 3, kind: 'keep', category: 'market', effect: 'At turn end, sell any of your Keep cards for its printed cost.' },
  { id: 'mimic', name: 'Mimic', cost: 8, kind: 'keep', category: 'wild', effect: 'Copy any monster’s non-Mimic Keep card, including your own; pay 1 energy at your turn start to retarget.' },
  { id: 'battery_monster', name: 'Battery Monster', cost: 3, kind: 'keep', category: 'energy', effect: 'Starts with 6 stored energy; take 2 at the start of each of your turns, then discard it when empty.' },
  { id: 'nova_breath', name: 'Nova Breath', cost: 7, kind: 'keep', category: 'attack', effect: 'Your Smash result targets every other living monster.' },
  { id: 'detritivore', name: 'Detritivore', cost: 4, kind: 'keep', category: 'victory', effect: 'A final roll containing 1, 2, and 3 gains 2 victory points.' },
  { id: 'opportunist', name: 'Opportunist', cost: 3, kind: 'keep', category: 'market', effect: 'Whenever a market card appears, you get a priority chance to buy it.' },
  { id: 'parasitic_tentacles', name: 'Parasitic Tentacles', cost: 4, kind: 'keep', category: 'market', effect: 'During your buy phase, buy a rival’s Keep card by paying its cost to that rival.' },
  { id: 'plot_twist', name: 'Plot Twist', cost: 3, kind: 'keep', category: 'dice', effect: 'Before resolution, change one die to any face, then discard this card.' },
  { id: 'poison_quills', name: 'Poison Quills', cost: 3, kind: 'keep', category: 'attack', effect: 'A final roll with three 2s adds two Smash.' },
  { id: 'poison_spit', name: 'Poison Spit', cost: 4, kind: 'keep', category: 'attack', effect: 'Give a Poison token to each monster wounded by your Smash.' },
  { id: 'psychic_probe', name: 'Psychic Probe', cost: 3, kind: 'keep', category: 'dice', effect: 'After another monster finishes rolling, you may reroll one of their dice; discard this if it becomes a Heart.' },
  { id: 'rapid_healing', name: 'Rapid Healing', cost: 3, kind: 'keep', category: 'healing', effect: 'At any time, spend 2 energy to gain 1 health, even in Tokyo.' },
  { id: 'regeneration', name: 'Regeneration', cost: 4, kind: 'keep', category: 'healing', effect: 'Whenever you gain health, gain 1 extra health, up to your maximum. Each Rapid Healing activation triggers this separately.' },
  { id: 'rooting_for_underdog', name: 'Rooting for the Underdog', cost: 3, kind: 'keep', category: 'victory', effect: 'At your turn end, gain 1 victory point if your score is lower than every other monster.' },
  { id: 'shrink_ray', name: 'Shrink Ray', cost: 6, kind: 'keep', category: 'attack', effect: 'Give a Shrink token to each monster wounded by your Smash; each token removes one die.' },
  { id: 'smoke_cloud', name: 'Smoke Cloud', cost: 4, kind: 'keep', category: 'dice', effect: 'Spend one of 3 Smoke counters for an extra reroll; discard when empty.' },
  { id: 'solar_powered', name: 'Solar Powered', cost: 2, kind: 'keep', category: 'energy', effect: 'At your turn end, gain 1 energy if you have none.' },
  { id: 'spiked_tail', name: 'Spiked Tail', cost: 5, kind: 'keep', category: 'attack', effect: 'If your final roll has a Smash, add one more.' },
  { id: 'stretchy', name: 'Stretchy', cost: 3, kind: 'keep', category: 'dice', effect: 'Spend 2 energy to change one die to any face before resolution.' },
  { id: 'energy_drink', name: 'Energy Drink', cost: 4, kind: 'keep', category: 'dice', effect: 'Spend 1 energy to gain one extra reroll.' },
  { id: 'urbavore', name: 'Urbavore', cost: 4, kind: 'keep', category: 'attack', effect: 'Gain 1 extra point when starting in Tokyo; while there, an attacking roll adds one Smash.' },
  { id: 'making_it_stronger', name: 'We’re Only Making It Stronger!', cost: 3, kind: 'keep', category: 'energy', effect: 'Whenever one effect makes you lose at least 2 health, gain 1 energy.' },
  { id: 'wings', name: 'Wings', cost: 6, kind: 'keep', category: 'defense', effect: 'Spend 2 energy when needed to prevent all health loss for the rest of the current turn.' },
] as const satisfies readonly KingOfTokyoPowerCardDefinition[];

export type KingOfTokyoPowerCardId = (typeof KING_OF_TOKYO_POWER_CARDS)[number]['id'];

export const KING_OF_TOKYO_POWER_CARD_BY_ID = Object.fromEntries(
  KING_OF_TOKYO_POWER_CARDS.map((card) => [card.id, card]),
) as Record<KingOfTokyoPowerCardId, KingOfTokyoPowerCardDefinition>;

export const KING_OF_TOKYO_DECK_SIZE = KING_OF_TOKYO_POWER_CARDS.reduce(
  (sum, card) => sum + ('copies' in card ? card.copies : 1),
  0,
);
