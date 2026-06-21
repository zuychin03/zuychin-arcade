# Implementation plan — Coup + Reformation (game #2)

Status: **planning**. This document is the design + delivery plan for adding
**Coup** (with the **Reformation** expansion) as the second game in the arcade
hub. It assumes the patterns in [ARCHITECTURE.md](./ARCHITECTURE.md) and the
"adding a new game" recipe there.

The headline: Coup is *not* a harder Saboteur. The rules are simpler, but the
**interaction model is fundamentally different** — and that difference is the
whole engineering job. Read [§3](#3-the-core-problem-interactive-response-windows)
first.

---

## 1. Scope — two variants, two delivery phases

Coup ships as **two selectable variants**, chosen by the **room owner at room
creation** (a `variant` toggle in the create flow). They are built and shipped
in two phases — Phase 1 (base) is a complete, playable game on its own; Phase 2
adds the Reformation layer on top.

**Variant A — Base Coup** *(delivery Phase 1)*

- 5 characters: **Duke, Assassin, Captain, Ambassador, Contessa**.
- General actions: **Income, Foreign Aid, Coup**.
- Character actions: **Tax, Assassinate, Steal, Exchange**.
- **Challenges** and **blocks (counteractions)**, with bluffing.
- **2–6 players.** No allegiances. Last player standing wins.

**Variant B — Reformation + Inquisitor** *(delivery Phase 2)*

- Everything in base, plus:
- **Allegiances** (Loyalist / Reformist) and allegiance-based targeting
  restrictions.
- **Convert**, **Embezzle**, and the **Treasury Reserve**.
- The **Inquisitor replaces the Ambassador** — weaker exchange (draw 1, not 2)
  plus an *examine* power (look at an opponent's card, optionally force a swap).
- **2–10 players.**

> The engine is built **variant-aware from the start** (Phase 1 designs the
> seams the Reformation layer slots into), but Phase 1 only exercises the base
> path. The phase state machine is identical across variants; Reformation only
> *adds* actions (Convert, Embezzle), the allegiance dimension, and the
> Ambassador→Inquisitor swap. (Should you later want Reformation *without* the
> Inquisitor, that becomes a trivial sub-toggle — but the default Reformation
> variant uses it.)

Win condition for **both** variants (verified across sources): **last player
with influence wins.** There is *no* separate team victory. Allegiance only
restricts who you may attack; once all surviving players share an allegiance the
restriction lifts and the game finishes as a free-for-all.

---

## 2. Rules reference (researched, verified 2026-06-21)

Cross-checked against the sources in [§10](#10-sources). This is the spec the
engine must satisfy.

### Components & setup

- Court deck: **3 copies of each character** (15 cards) for 2–6 players;
  **4 copies each** for 7–8; **5 copies each** for 9–10.
- Each player starts with **2 influence** (face-down character cards) and
  **2 coins** (1 coin in the 2-player base variant).
- **Influence** = your face-down cards. Losing influence = flip one face-up
  (owner chooses which); face-up cards are public and dead. **0 influence ⇒
  eliminated.**
- Reformation: each player also gets an **allegiance** (Loyalist/Reformist),
  assigned by alternating around the table from the first player. The
  **Treasury Reserve** starts empty.

### Actions

| Action | Cost | Effect | Claim? | Challengeable | Blockable by |
| --- | --- | --- | --- | --- | --- |
| Income | — | +1 coin | no | no | — |
| Foreign Aid | — | +2 coins | no | no | **Duke** |
| Coup | 7 | target loses 1 influence | no | no | — (unstoppable) |
| Tax | — | +3 coins | Duke | yes | — |
| Assassinate | 3 | target loses 1 influence | Assassin | yes | **Contessa** |
| Steal | — | take up to 2 coins from target | Captain | yes | **Captain / Ambassador** |
| Exchange | — | draw 2 from court, keep any, return 2 | Ambassador | yes | — |
| **Convert** | 1 self / 2 other → **Reserve** | flip an allegiance card | no | no | — |
| **Embezzle** | — | take **all** Reserve coins | "I have **no** Duke" | yes (reverse) | — |

- **Mandatory coup:** if you **start your turn with ≥10 coins**, your only legal
  action is Coup.
- **Steal** from a target with 1 coin takes 1; with 0 takes 0.
- **Embezzle is a *reverse* claim:** the actor claims they do **not** hold a
  Duke. A challenger claims they **do**. If the actor in fact has no Duke, the
  challenger loses an influence; if they secretly hold a Duke, the actor loses
  one (and the Reserve is untouched).

### Challenge & block resolution (the important bit)

A turn resolves through up to four windows, in this exact order:

```
1. Actor declares an action (+ target if needed).
2. CHALLENGE WINDOW on the action      (character-claim actions only)
      → if challenged: actor must reveal the claimed card.
          • has it    → challenger loses 1 influence; actor shuffles the
                        revealed card into the deck and draws a replacement;
                        action proceeds to step 3.
          • lacks it  → actor loses 1 influence; action FAILS; any prepaid
                        cost (e.g. Assassinate's 3) is refunded.
      → if nobody challenges: proceed to step 3.
3. BLOCK WINDOW                          (blockable actions only)
      Eligible blocker(s) may claim a blocking character, or pass.
      (Foreign Aid: ANY other player may block with Duke.
       Assassinate / Steal: only the TARGET may block.)
      → if nobody blocks: action resolves (step 5).
4. CHALLENGE WINDOW on the block
      Anyone (incl. the original actor) may challenge the block, or pass.
      → block holds  → original action is countered (does NOT resolve).
      → block fails   → blocker loses 1 influence; original action resolves.
5. Apply the action's effect.
```

Consequences to model carefully:

- **Double influence loss:** challenging an Assassinate and losing costs you
  the challenge **and** the assassination — you can be knocked out in one turn.
  Same if you bluff a Contessa block and get challenged.
- A successfully challenged **action** is fully reverted incl. coin refund. A
  successfully challenged **block** means the action goes through.
- Income, Coup, Convert have **no challenge window**. Foreign Aid has no
  challenge window but **does** have a block window. Coup has neither.

### Reformation targeting restriction

You may **not** Coup, Assassinate, Steal from, or block the Foreign Aid of a
player with the **same allegiance** — *unless every living player shares one
allegiance*, in which case all restrictions lift. **Convert** is exempt (it's
how allegiances change) and may target anyone, including yourself.

### Inquisitor (optional variant)

Replaces all Ambassadors. (a) **Exchange:** draw **1** card, optionally swap
into your hand, return 1. (b) **Examine:** pick an opponent; they reveal one
face-down card to you privately; you may force them to swap it for a fresh draw
or hand it back. Still blocks Steal. Both are challengeable Inquisitor claims.

---

## 3. The core problem: interactive response windows

Saboteur's engine only ever takes input from **the current turn player**
(`requireTurn`). Every move is self-contained and resolves immediately. The
socket layer reflects this: one player emits, the engine mutates, everyone gets
the new state.

Coup breaks that assumption. When you declare **Tax**, the engine cannot
resolve it until **every other living player** has had the chance to challenge.
A block can come from a different player than the actor, and a block can itself
be challenged by a third player. The engine therefore needs:

1. A **pending-resolution state machine** — the game spends most of its time
   *between* turns, waiting on responses, not on the active player.
2. **Multi-player response collection** with a resolution rule.
3. **Server-driven timeouts** so one AFK player can't freeze the table.
4. Several **owner-specific sub-decisions** (which influence to lose; which
   cards to keep on Exchange; the Inquisitor examine decision).

This is the bulk of the work and the main source of risk. Everything else
(actions, coins, deck) is bookkeeping. The plan below treats the state machine
as the centerpiece.

### Proposed phase machine

A discriminated `pending` object on the game state. Phases:

| Phase | Who acts | Resolves when |
| --- | --- | --- |
| `awaiting_action` | current player | they declare an action |
| `awaiting_action_challenge` | all other living players | someone challenges, or all pass |
| `awaiting_block` | eligible blocker(s) | someone blocks, or all eligible pass |
| `awaiting_block_challenge` | everyone except blocker | someone challenges, or all pass |
| `awaiting_lose_influence` | the losing player | they pick a card to reveal (auto if 1 left) |
| `awaiting_exchange` | the actor | they choose which drawn cards to keep |
| `awaiting_examine` | the Inquisitor (variant) | they decide keep/force-swap |
| `game_over` | — | one player remains |

**Response-window rule (challenge & block):** the window stays open until
*either* one player responds with challenge/block, *or* every eligible player
has explicitly passed. First responder wins priority (a second simultaneous
challenge is redundant — the outcome is identical). A per-room **auto-pass timer
(30s)** passes for anyone who hasn't responded, so the game never stalls; the
remaining time is projected to clients for a visible countdown. This reuses the
existing per-room timer concept (today's `nextRoundTimer`).

The `pending` object carries: `action`, `actorId`, `targetId?`,
`claimedCharacter?`, `blockerId?`, `blockCharacter?`, and a
`Set<playerId>` of who still needs to respond. Projection to clients describes
the current window so the UI can render the right prompt.

---

## 4. Shared types — `packages/types`

New files, exported from `index.ts` (keep the existing public/private split):

**`coup.ts`**

- `CoupVariant = 'base' | 'reformation'` — chosen at room creation; carried on
  the game state and consumed by setup, action legality, and projection.
- `CoupCharacter = 'duke' | 'assassin' | 'captain' | 'ambassador' | 'contessa' | 'inquisitor'`
  (base never deals `inquisitor`; reformation deals it in place of `ambassador`).
- `Allegiance = 'loyalist' | 'reformist'` (reformation only; `null` in base).
- `CoupActionType` — the union from the actions table (`income`, `foreign_aid`,
  `coup`, `tax`, `assassinate`, `steal`, `exchange`, `convert`, `embezzle`,
  `inquisitor_exchange`, `inquisitor_examine`).
- `Influence = { character: CoupCharacter; revealed: boolean }`
- **Server-only** `CoupPlayerState` — `influences: Influence[]`, `coins`,
  `allegiance`, `eliminated`. (Face-down characters never leave the server in
  full.)
- **Public** `CoupPublicState` — per player: `coins`, `allegiance`,
  `influenceCount` (alive), `revealedCharacters` (face-up only), `eliminated`;
  plus `treasuryReserve`, `deckSize`, `currentTurnPlayerId`, the projected
  `pending` window (phase + who it's waiting on + the claim being made), the
  action `log`, and `winnerId`.
- **Private** `CoupPrivateState` — this player's own `influences` (the
  face-down characters), plus transient `exchangeDraw?` / `examineResult?`.
- Socket payloads: `CoupActionPayload`, `CoupRespondPayload`
  (`'challenge' | 'block' | 'pass'`, + `blockCharacter?`),
  `CoupLoseInfluencePayload`, `CoupExchangePayload`, `CoupExaminePayload`.

**`coup-constants.ts`**

- `COUP_MIN_PLAYERS = 2`, `COUP_MAX_PLAYERS = 10`.
- `copiesPerCharacter(playerCount)` → 3 / 4 / 5.
- `STARTING_COINS`, `STARTING_INFLUENCE = 2`, costs (`COUP_COST = 7`,
  `ASSASSINATE_COST = 3`, `TAX_GAIN = 3`, `CONVERT_SELF = 1`,
  `CONVERT_OTHER = 2`, `MANDATORY_COUP_AT = 10`).
- `BLOCKERS` map (action → blocking characters), `ACTION_META`
  (challengeable? / blockable? / needs target?).

This mirrors `saboteur.ts` / `saboteur-constants.ts` exactly, so the
public/private projection and per-socket emission already understood by the
mobile store apply unchanged.

---

## 5. Multi-game refactor (the room layer)

Today the room layer is Saboteur-bound. Minimal, surgical changes to make it
host two games (the lobby/room/JWT/kick layer is already game-agnostic):

1. **Bind a game (and variant) to a room at creation.** Add
   `gameId: 'saboteur' | 'coup'` to `POST /rooms/create` (default `'saboteur'`
   for backward compat) plus an optional game-specific `config` (for Coup,
   `{ variant: 'base' | 'reformation' }`), and store both on `ServerRoom`. This
   is cleaner than choosing at `start_game` because lobby UI, player limits, and
   the resume route differ per game. The mobile `/coup` route group passes
   `gameId: 'coup'` and the owner's chosen `variant` to `createRoom`; the lobby
   surfaces the variant so joiners see which game they're in.
2. **Generalize `ServerRoom.gameState`.** Replace `SaboteurServerState | null`
   with a tagged union:
   ```ts
   type RoomGame =
     | { id: 'saboteur'; state: SaboteurServerState }
     | { id: 'coup'; state: CoupServerState };
   // ServerRoom.game: RoomGame | null
   ```
   Rename `nextRoundTimer` → a generic `timer` (both games need one room timer).
3. **Dispatch socket events by game.** `registerSocketHandlers` already calls
   `registerGameHandlers(io, socket)`. Split into
   `registerSaboteurHandlers` / `registerCoupHandlers`, and register based on
   `room.game?.id` (or register both but guard each by id). Coup's events are
   namespaced (`coup:action`, `coup:respond`, …) so there's no collision.
4. **Per-game player limits.** `start_game` currently hardcodes `MIN_PLAYERS`
   (3). Switch to a per-game min/max lookup (Coup min 2). Room join already caps
   at `MAX_PLAYERS = 10`, which is fine for both.
5. **`RoomPublicState`** gains `gameId` so the client knows which lobby/game UI
   to render and where the resume banner should route.

Everything else in `RoomStore`, `routes/room.ts`, auth, and reconnection is
reused as-is.

---

## 6. New code — server, mobile, persistence

### Server engine — `apps/server/src/game/coup/`

Pure, no-IO TypeScript (same discipline as `game/saboteur/`):

| File | Responsibility |
| --- | --- |
| `engine.ts` | `CoupServerState`, `initGame`, the phase machine, and the action/response entry points (`declareAction`, `respond`, `loseInfluence`, `chooseExchange`, `decideExamine`), each returning `EngineResult` |
| `deck.ts` | build the court deck by player count, shuffle (reuse Saboteur's Fisher–Yates), draw/return helpers |
| `actions.ts` | per-action validation (cost, target legality incl. allegiance restriction, mandatory-coup) and effect application |
| `resolution.ts` | challenge/block window transitions and outcome logic (reveal, lose-influence routing, refunds) |
| `allegiance.ts` | setup assignment + the "can A target B?" predicate (incl. the all-same-allegiance lift) |
| `publicState.ts` | `toPublicState` / `toPrivateState` projections (the only serialization boundary) |

Engine entry points are all `(state, playerId, payload) → EngineResult`, so the
socket handler stays as thin as Saboteur's `applyEngineCall`.

### Server socket — `apps/server/src/socket/coupHandlers.ts`

Mirror `gameHandlers.ts`: `coup:action`, `coup:respond`,
`coup:lose_influence`, `coup:exchange`, `coup:examine`, plus reuse
`start_game` / `request_state`. After every successful engine call: broadcast
`game_state` (public) to the room and per-socket `private_state`, exactly like
Saboteur. Arm/disarm the room auto-pass timer on entering/leaving a response
window.

### Mobile — `apps/mobile/app/coup/`

Route group mirroring `saboteur/` (the hub→game template):

- `_layout.tsx`, `index.tsx` (name + create/join), `join.tsx`,
  `lobby.tsx` (reuse `PlayerList`, `RoomCodeDisplay`), `game.tsx`.
- `game.tsx` is the centerpiece: a **table view** of player seats (coins,
  allegiance badge, face-down backs + revealed face-up cards, turn highlight),
  your own two influence cards at the bottom, an **action bar** with target
  selection, and a prominent **action log** (essential for a bluffing game).
- Overlays driven by the projected `pending` phase: **ResponsePrompt**
  (Challenge / Block / Allow with a countdown), **LoseInfluence** picker,
  **Exchange** selector, **Examine** dialog, **GameOver**.

New components — `apps/mobile/components/coup/`: `PlayerSeat`, `InfluenceCard`,
`CoinPile`, `AllegianceBadge`, `ActionBar`, `ResponsePrompt`, `GameLog`,
`ExchangeOverlay`, `LoseInfluenceOverlay`. Reuse `CardBack`, `NeonButton`,
`ScalePressable`, `ArcadeDialog`, the overlay patterns, and the animated
background.

**Store / socket:** add `coupPublic` / `coupPrivate` slices to
`useGameStore` (or generalize the existing `publicState`/`privateState` into a
tagged `{ game, ... }` value). Reuse the single `useSocket` hook unchanged —
just route the new event names into the store. The action bar emits via
`getSocket()?.emit('coup:action', …)`; **no optimistic updates** (same as
Saboteur — render only what the server sends).

**Theme:** add a `coup.*` palette (royal court — crimson / gold / deep purple)
to `tailwind.config.js` and `constants/theme.ts`, alongside `mine.*`. Add a
Coup tile to the hub (`app/(arcade)/index.tsx` already has a "COMING SOON"
placeholder to replace) and a resume-route branch for `gameId === 'coup'`.

### Persistence & leaderboard

`saveGameResult` and `supabase.sql` are Saboteur-shaped (`total_nuggets`). For
Coup, results are win/loss with no score. Plan:

- Set `game_sessions.game_name = 'coup'` (column already exists, defaults to
  `'saboteur'`), `rounds_played = 1`, `player_count = N`.
- Reuse `player_results` with `total_nuggets = 0`, `won = (playerId === winner)`.
- The combined `leaderboard` view ranks by `total_nuggets`, which is
  meaningless across games. **Recommend** a per-game leaderboard: add a
  `game_name`-filtered view/query and a `?game=` param to `GET /leaderboard`,
  and have each game's Ranks screen request its own. (Decision in [§7](#7-open-decisions).)

### Testing

Mirror Saboteur's simulation discipline — this is the regression net for a
state machine with a lot of branches:

- `apps/server/scripts/simulate-coup.ts` — play many random *legal* games
  across 2–10 players, with random challenge/block responses, asserting
  invariants: coin conservation (bank + reserve + players, minus coup/assassinate
  sinks), influence counts only ever decrease, deck + hands + revealed = total
  cards, no same-allegiance targeting while factions coexist, the machine never
  deadlocks (every window resolves), and exactly one winner. Add to README's
  testing section and the `simulate` convention.
- Extend `scripts/smoke-e2e.ts` with a Coup room: create → start → one full
  action+challenge+block cycle → reconnect.

---

## 7. Phased delivery

Two delivery phases matching the two variants. **Phase 1 ships a complete,
playable base Coup**; Phase 2 layers Reformation + Inquisitor on top and turns
on the room-creation variant toggle. Each stage is independently verifiable;
don't start the next until the previous passes its check (the staged-build style
used elsewhere in this repo).

### Phase 1 — Base Coup (2–6 players, shippable on its own)

> **Status: built (2026-06-21).** All stages below implemented and verified —
> server typechecks, `simulate:coup` (1,250 games / ~1.5M assertions) and the
> Saboteur sim both pass, and `smoke:coup` + `smoke` pass against a live server.
> Mobile typechecks. Reformation (Phase 2) is gated off at the create route.

- **1.0 — types & constants.** `coup.ts` + `coup-constants.ts`, exported,
  including the `CoupVariant` seam (only `'base'` exercised now). Check:
  `pnpm typecheck` green.
- **1.1 — multi-game room refactor.** `gameId` + `config` on create &
  `ServerRoom`, `RoomGame` union, handler dispatch, per-game min/max, `gameId`
  in `RoomPublicState`. Saboteur still fully works. Check: existing `simulate` +
  `smoke-e2e` still pass.
- **1.2 — engine core (no challenges).** Deck, setup, coins, turn order, the
  unchallengeable/unblockable actions (Income, Foreign Aid w/o block, Coup) and
  the character claims resolved *as if true* (Tax, Steal, Assassinate, Exchange)
  + lose-influence + win detection. Check: a reduced `simulate-coup` plays to
  completion.
- **1.3 — the resolution machine.** Challenge + block + block-challenge windows,
  response collection, **30s auto-pass timeout**, refunds, double-loss. This is
  the centerpiece (§3). Check: full `simulate-coup` invariants hold over many
  random games with random responses.
- **1.4 — socket layer.** `coupHandlers.ts`, projections, per-socket private
  state, the auto-pass room timer + projected countdown. Check: extended
  `smoke-e2e` with a Coup room (declare → challenge → block → reconnect).
- **1.5 — mobile.** `/coup` route group, table UI, action bar, response
  prompts, lose-influence + exchange + game-over overlays, `coup.*` theme, hub
  tile. Check: `expo export` bundles; play a real 3-tab web game end-to-end.
- **1.6 — persistence + per-game leaderboard.** Save Coup results
  (`game_name='coup'`, win/loss), add the `?game=` leaderboard query, point the
  Coup Ranks screen at it.

**Phase 1 checkpoint:** a fully playable base Coup reachable from the hub.

### Phase 2 — Reformation + Inquisitor (2–10 players, variant toggle)

- **2.0 — extend types/constants.** `Allegiance`, Convert/Embezzle payloads,
  Inquisitor character + actions, reformation deck sizes (3/4/5 copies), 2–10
  limits.
- **2.1 — allegiance layer.** Setup assignment (alternating), the "can A target
  B?" predicate with the all-same-allegiance lift, applied to Coup / Assassinate
  / Steal / block-Foreign-Aid.
- **2.2 — Convert, Embezzle, Treasury Reserve.** Convert (1 self / 2 other →
  Reserve, flips allegiance), Embezzle incl. the **reverse-challenge** ("I have
  no Duke"), Reserve accounting.
- **2.3 — Inquisitor.** Replaces Ambassador in the reformation deck: draw-1
  exchange + the `awaiting_examine` sub-phase (look at an opponent's card,
  optionally force-swap).
- **2.4 — variant toggle.** Surface `base | reformation` in the `/coup` create
  screen and lobby; raise the room cap to 10 for reformation rooms.
- **2.5 — mobile additions.** Allegiance badges, Treasury Reserve display,
  Convert/Embezzle in the action bar, the examine overlay.
- **2.6 — coverage.** `simulate-coup` runs both variants (base 2–6, reformation
  2–10) under one invariant set.

**Phase 2 checkpoint:** room owner picks base vs Reformation at creation; both
play to completion.

Roughly: Phase 1's stages 1.2–1.3 are the hardest engineering; 1.5 is the
largest surface area; Phase 2 is mostly additive on the seams Phase 1 leaves.

## 8. Reuse vs. new (at a glance)

- **Reuse unchanged:** rooms/JWT/kick/reconnect, `useSocket`, lobby components,
  `EngineResult` discipline, public/private per-socket emission, shuffle,
  overlay/dialog/button primitives, the hub + route-group pattern, the
  `simulate` + `smoke-e2e` conventions.
- **New:** the Coup types, the engine + phase machine, `coupHandlers`, the Coup
  route group + components + theme, a per-game leaderboard query.
- **Generalize (touch carefully):** `ServerRoom.game` union + `gameId`,
  socket dispatch, per-game player limits, `RoomPublicState.gameId`, the store's
  game-state slice, `saveGameResult`/leaderboard.

## 9. Risks

- **State-machine complexity / deadlocks** — the dominant risk. Mitigated by
  the explicit phase table, the simulation harness asserting "every window
  resolves," and building it in Stage 3 *before* any UI.
- **Response timing UX** — windows that wait on humans need clear countdowns and
  an auto-pass fallback, or play drags. Tunable timeout + "Allow" button.
- **Reconnect mid-window** — `request_state` must fully re-describe the pending
  phase (whose response is awaited) so a refreshed client can re-prompt. Covered
  by the projection design and a smoke-test reconnect case.
- **Scope creep from Reformation** — isolated to delivery Phase 2 so it can't
  block shipping a complete base game first.

## 10. Decisions (locked 2026-06-21)

1. **Variants & phasing** — ship **both**, split across two delivery phases:
   Phase 1 = base Coup, Phase 2 = Reformation **with the Inquisitor**. The
   **room owner toggles the variant at room creation**. (§1, §7)
2. **Response window timeout** — **30s auto-pass**, with the remaining time
   projected to clients for a visible countdown. (§3)
3. **Leaderboard** — **separate per-game board** (`?game=` filter); Coup ranks
   by wins, not nuggets. (§6)
4. **Win condition** — **last player standing** for both variants, per official
   rules; allegiance only restricts targeting. (No house-rule team victory.)

---

## 11. Sources

- [Coup official rules — UltraBoardGames](https://www.ultraboardgames.com/coup/game-rules.php)
- [Coup: Reformation official rules — UltraBoardGames](https://ultraboardgames.com/coup/reformation.php)
- [Coup: Reformation rules — Group Games 101](https://groupgames101.com/coup-reformation-rules/)
- [Coup + Reformation faithful online implementation (rules) — thebrown.net](https://coup.thebrown.net/rules.html)
- [Coup: Reformation overview — The Game Rules](https://thegamerules.com/coup-reformation-detail)
