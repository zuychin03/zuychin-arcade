import type { LibertaliaCrewDefinition, LibertaliaLoot } from './libertalia';

export const LIBERTALIA_MIN_PLAYERS = 2;
export const LIBERTALIA_MAX_PLAYERS = 6;
export const LIBERTALIA_RULES_VERSION = 'winds-of-galecrest-calm-v3.0';
export const LIBERTALIA_FORFEIT_DESCRIPTION = 'Leaving or an expired reconnect grace forfeits eligibility immediately. Only an already revealed day is completed automatically; the seat retires before the next selection. Prepared loot and the voyage mode remain unchanged until the next voyage. One eligible admiral wins by forfeit; none means no winner.';
export const LIBERTALIA_NIGHT_DESCRIPTION = 'Digital clash timing: Wind Nymph owners are counted at night start. With multiple owners, each discards their own copy when resolving its ability, preserving their chosen night order. Earlier discards do not make a later owner unique.';
const crew=(rank:number,name:string,phases:LibertaliaCrewDefinition['phases'],summary:string):LibertaliaCrewDefinition=>({rank,name,phases,summary});

/** Calm-side reference text, paraphrased from the physical cards. */
export const LIBERTALIA_CREW:LibertaliaCrewDefinition[]=[
 crew(1,'Scout',['daytime'],'Discard the Scout, then choose and insert another hand card into the island line.'),
 crew(2,'Apprentice',['daytime'],'Use the daytime ability of a character in your ship.'),
 crew(3,'Beggar',['daytime'],'The rightmost character owner gives you 2; that owner gains 1 reputation.'),
 crew(4,'Innkeeper',['daytime'],'Return a character from your ship to your hand.'),
 crew(5,'Cabin Boy',['daytime','dusk'],'If leftmost, gain 3. Do not gain loot this dusk.'),
 crew(6,'Bandit',['daytime'],'Move your reputation to the leftmost space; gain 1 per position lost.'),
 crew(7,'Preacher',['daytime','anchor'],'Keep one loot token, discard the rest and gain 1 reputation per discarded token. Gain 6 at anchor.'),
 crew(8,'Barkeep',['night','anchor'],'Gain 1 at night; at anchor gain 1 more per barrel.'),
 crew(9,'Stowaway',['daytime'],'Gain random bag loot, resolve its dusk ability immediately, then discard the Stowaway.'),
 crew(10,'Explorer',['dusk','anchor'],'Gain 2 reputation after taking a map; one map counts twice for map scoring.'),
 crew(11,'Carpenter',['daytime','anchor'],'Lose half your doubloons, rounded down; gain 10 at anchor.'),
 crew(12,'Officer',['daytime'],'At 12+ doubloons gain 2 reputation; otherwise increase your total to 12.'),
 crew(13,'Smuggler',['daytime'],'Take loot from today and resolve it, then place the Smuggler in your ship.'),
 crew(14,'Bodyguard',['daytime'],'Discard all sabers and hooks from today; gain 2 per discarded token.'),
 crew(15,'Witch',['night','anchor'],'Copy another ship character night ability; return the Witch at anchor if she is your only night-ability character.'),
 crew(16,'Mutineer',['night'],'Discard your lowest-ranked ship character, then gain 2.'),
 crew(17,'Brute',['daytime'],'Discard the rightmost island character; its owner gains 1 reputation.'),
 crew(18,'Gunner',['daytime'],'Discard a character from any ship. Gain 1 reputation if it was yours; lose 1 reputation if it belonged to an opponent.'),
 crew(19,'Necromancer',['daytime'],'Discard a relic to return a character from your graveyard directly to your ship.'),
 crew(20,'Freed Prisoner',['night'],'At the end of the night, gain 1 per higher ship character; discard this card if its activation gains 3+.'),
 crew(21,'Bosun',['daytime'],'Gain 2 per ship character ranked below 21.'),
 crew(22,'Brawler',['daytime','night'],'Discard an opposing Brawler to gain 2 reputation; gain 1 at night.'),
 crew(23,'Thief',['daytime'],'Take loot from an adjacent player, then lose 2 reputation.'),
 crew(24,'Topman',['night'],'Gain 4, then lose 1 per character in your ship.'),
 crew(25,'Recruiter',['daytime'],'Play a hand character directly into your ship.'),
 crew(26,'Cook',['dusk'],'Take a second loot token if the Cook remains on the island. Calm hooks do not remove the Cook.'),
 crew(27,'Watchman',['daytime'],'Swap one of today’s loot tokens with one from tomorrow, if possible.'),
 crew(28,'Armorer',['dusk','night'],'After taking a saber or hook gain 2 reputation; gain 1 nightly per saber and hook.'),
 crew(29,'Infantry',['daytime'],'If rightmost on the island, gain 5.'),
 crew(30,'Merchant',['daytime'],'Discard 1, 2, or 3 identical loot tokens to gain 1, 4, or 9.'),
 crew(31,'Surgeon',['daytime'],'Privately return a graveyard character to your hand.'),
 crew(32,'Treasurer',['anchor'],'Gain 1 per barrel, amulet, and chest.'),
 crew(33,'Gambler',['daytime','anchor'],'Lose 1 per loot token now; gain 6 at anchor.'),
 crew(34,'Aristocrat',['daytime','anchor'],'Gain 2 reputation; at anchor gain 5 if uniquely held, otherwise lose 3.'),
 crew(35,'Collector',['anchor'],'Gain 1/3/5/10 for 2/3/4/5+ different loot types.'),
 crew(36,'Quartermaster',['daytime','anchor'],'Gain 1 per loot token now; lose 6 at anchor.'),
 crew(37,'Wind Nymph',['night'],'If uniquely held, gain 2. Otherwise all Wind Nymphs are discarded, using the disclosed simultaneous-clash timing.'),
 crew(38,'First Mate',['daytime','anchor'],'Lose 1 per ship character now; gain 1 per ship character at anchor.'),
 crew(39,'Captain',['daytime'],'Move reputation to the rightmost space; lose 1 per position gained.'),
 crew(40,'Governor',['daytime'],'Discard your whole ship; gain 1 reputation per discarded character.'),
];
export const LIBERTALIA_LOOT_COUNTS:Record<LibertaliaLoot,number>={map:10,barrel:8,amulet:6,chest:4,hook:6,saber:6,relic:8};
