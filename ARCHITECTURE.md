# Architecture

This document explains how zuychin-arcade is put together: the monorepo, the
shared types package, the thirteen authoritative game engines, the socket protocol,
the mobile app, and the patterns to follow when adding a game. Saboteur supplies
the detailed engine and protocol examples below.

## System overview

```
┌─────────────────────┐         REST (fetch)          ┌──────────────────────────┐
│  apps/mobile        │  POST /rooms/create|join      │  apps/server             │
│  Expo / React Native│──────────────────────────────▶│  Fastify 5               │
│                     │   ← JWT + room snapshot       │                          │
│  zustand store      │                               │  RoomStore (in-memory)   │
│  useSocket hook     │   Socket.IO (websocket,       │  Per-game pure engines  │
│                     │   JWT in handshake auth)      │                          │
│                     │◀─────────────────────────────▶│  Socket.IO 4             │
└─────────────────────┘  game_state / private_state   └───────────┬──────────────┘
                          place_card / play_action…               │ optional
                                                                  ▼
                                                       ┌──────────────────────┐
                                                       │  Supabase (Postgres) │
                                                       │  game_sessions       │
                                                       │  player_results      │
                                                       │  leaderboard (view)  │
                                                       └──────────────────────┘
```

Three principles drive the design:

1. **The server is fully authoritative.** All game state lives on the server;
   the client only renders what it is sent and submits intents. Secret
   information (hands, roles, map peeks) is never broadcast - it goes to the
   owning player's socket only.
2. **No accounts.** Identity is a per-room JWT minted when a player creates or
   joins a room. There is no user table anywhere; the leaderboard groups by
   display name, fuzzily, for fun.
3. **Everything ephemeral except results.** Rooms and games are in-memory.
   Only finished-game results are written to Supabase (and only if configured).

---

## Monorepo & build pipeline

pnpm workspaces (`apps/*`, `packages/*`) orchestrated by Turborepo
(`turbo.json`: `build` depends on `^build` and caches `dist/**`; `dev` is
persistent/uncached). Root `tsconfig.base.json` sets strict mode,
`module: ESNext`, `moduleResolution: bundler` for all workspaces.

### `packages/types` ships TypeScript source

`@zuychin-arcade/types` has **no build step** - its `main`/`types` point
straight at `src/index.ts`. Consumers handle that differently:

- **Server dev** (`tsx watch`): tsx transpiles the imported TS on the fly.
  This is why the package needs `"type": "module"` - without it tsx mangles
  the module format and named runtime exports (`ROLE_TABLE`, `BOARD`, …)
  disappear at runtime.
- **Server prod build**: `tsup` with `noExternal: ['@zuychin-arcade/types']`
  bundles the package's source into `apps/server/dist/index.js` (ESM,
  `node20`). Plain `tsc` was deliberately abandoned because it won't compile
  a dependency's `.ts` sources.
- **Mobile**: Metro just bundles the TS source like any other module.

If you add another shared TS-source package, add it to `noExternal` in
`apps/server/tsup.config.ts` and give it `"type": "module"`.

### Shared contracts (`packages/types`)

Each implemented game has its own contracts and constants, exported from
`src/index.ts`. The following files illustrate the shared room and Saboteur split:

| File | Contents |
| --- | --- |
| `room.ts` | `Player`, `RoomPublicState` (lobby-level state) |
| `auth.ts` | `JwtPayload`, `JoinRoomPayload`, `JoinRoomResponse` |
| `saboteur.ts` | every game-state and socket-payload contract: cards, board positions, `SaboteurPublicState` / `SaboteurPrivateState`, `PlaceCardPayload`, … |
| `saboteur-constants.ts` | verified rules data: `ROLE_TABLE`, `getHandSize`, `ACTION_CARD_COUNTS`, `GOLD_NUGGET_CARDS`, `SABOTEUR_REWARDS`, `BOARD` geometry, `MIN_PLAYERS`/`MAX_PLAYERS`, `ROUNDS_PER_GAME` |

The key split to understand is **server-private vs public vs per-player
state** (all defined in `saboteur.ts`):

- `PlayerGameState` - server-side only, contains `role`, `hand`, `peekedGoals`. Never serialized to clients in full.
- `SaboteurPublicState` - shared board, unrevealed goal placeholders, deck/discard counts, hand sizes, tools, turn pointer and round-end data. Gold totals are public only at game over.
- `SaboteurPrivateState` - the owning player's role, hand, Map peeks and gold total. Available draft values appear only for the current picker.

---

## Server (`apps/server`)

### Bootstrap (`src/index.ts`)

A single Fastify instance with an explicit browser-origin allowlist; Socket.IO
enforces the same policy during its handshake and attaches to the same
HTTP server (`app.server`), so REST and WebSocket share one port (`PORT`,
default 3001). REST bodies are capped at 16 KiB and Socket.IO messages at 64
KiB. Two registration calls wire everything:
`registerRoomRoutes(app, io)` and `registerSocketHandlers(io)`.

### Identity: per-room JWTs (`utils/jwt.ts`)

`POST /rooms/create` and `/rooms/join` mint a JWT with
`{ playerId, roomCode, displayName, isHost }`, 24h expiry, signed with HS256
using a minimum 32-byte `JWT_SECRET`, fixed issuer and audience claims. The
server fails to start when the secret or origin allowlist is absent. The only
fallback requires `ARCADE_INSECURE_LOCAL_DEV=true`, forces a loopback bind, and
accepts browser origins only from localhost or loopback IPs. The token is the
player's *only* credential: authenticated REST routes check it in the
`Authorization` header, and every socket connection must present it in
`handshake.auth.token`. Room-bearing REST responses use `Cache-Control:
no-store`.

### Room registry (`store/RoomStore.ts`)

A `Map<roomCode, ServerRoom>` singleton. `ServerRoom` holds a salted scrypt
password hash (nullable), `hostPlayerId`, a `Map<playerId, ServerPlayer>`
(player + current `socketId`), lobby/in_game/finished `status`, the
tagged `game: RoomGame | null`, activity timestamps, and a shared `timer` handle
for timed transitions. Each game retains its own authoritative state shape.

- Room codes use eight cryptographically random, unambiguous base-32
  characters, e.g. `7KPM-R4TX` (40 bits of entropy and 10 collision retries).
  Lookups are case-insensitive (`get` upper-cases).
- `getRoomPublicState()` strips `socketId` before anything leaves the server.
- A `setInterval` (unref'd, every 30 min) deletes rooms idle for > 4 hours
  and clears their pending round timers. **Restarting the server loses all
  rooms**; clients must recover when reconnection finds that their session's
  room no longer exists.

### REST endpoints (`routes/room.ts`)

| Endpoint | Auth | Purpose / notable rules |
| --- | --- | --- |
| `POST /rooms/create` | - | validates a 1-20 code-point visible display name, creates room (+optional password), registers host, returns `JoinRoomResponse` (token + room snapshot), 201 |
| `POST /rooms/join` | - | password check (403), lobby-only (409 once in game), game/variant-specific capacity (409), case-insensitive duplicate-name rejection (409); emits `room_updated` to the room |
| `GET /rooms/:roomCode` | Bearer JWT, room member only | room snapshot used to restore a saved session without exposing room rosters to code enumeration |
| `POST /rooms/:roomCode/kick` | Bearer JWT, host only | removes target (never the host), emits `player_kicked` to the victim's socket and `room_updated` to the room |
| `POST /rooms/:roomCode/leave` | Bearer JWT, room member only | leaves the lobby/table or marks an active player as a non-reconnecting forfeit |
| `GET /leaderboard` | - | top-50 leaderboard rows; `[]` only for a successful empty query, 503 when unavailable |
| `GET /health` | - | `{ ok: true }` (for uptime pings) |

Note that join/create happen over REST *before* any socket exists - the
socket connection is step two, authenticated by the token from step one.
REST requests have a bounded per-IP fixed-window quota, with tighter create,
join-IP, and existing-room join quotas. Password derivation and verification
are capped at four concurrent operations per server process.

### Socket layer (`socket/handlers.ts` + per-game `game/<name>/socketHandlers.ts`)

**Connection middleware** verifies the JWT and stashes the payload on
`socket.data.auth`; invalid/missing tokens are refused with an
`INVALID_TOKEN` connect error (which the client treats as "session dead").
On connection the socket joins the Socket.IO room named by `roomCode`, the
player's `socketId`/`isConnected` are updated, and `room_updated` is
broadcast. On disconnect, the player is marked disconnected (but **stays in
the room** - reconnection is just connecting again with the same token).
Each connection is capped at 120 client events per 10 seconds. Reactions have
a tighter six-per-five-second quota and must match the server allowlist.

**Client → server events, Saboteur example** (all validated against `socket.data.auth`; every
game event re-resolves the room and replies with `action_rejected { reason }`
on any failure):

| Event | Payload | Server behavior |
| --- | --- | --- |
| `start_game` | absent or `{}` | host-only, 3–10 eligible connected players, lobby or finished game; runs `initGame()`, broadcasts state |
| `place_card` | `{ cardId, position, rotated, expectedRevision }` | engine `placeCard()` |
| `play_action` | `{ cardId, targetPlayerId?, targetPosition?, chosenTool?, expectedRevision }` | engine `playAction()` |
| `pass_turn` | `{ discardCardId?, expectedRevision }` | engine `passTurn()` |
| `choose_gold` | `{ cardIndex, expectedRevision }` | engine `chooseGold()` during gold distribution - cards are face-down, picked by index; the value is revealed only after the pick |
| `request_state` | - | re-sends `room_updated`, `game_state`, `private_state` to this socket (reconnection/refresh) |

`start_game` is dispatched to the room's game handler. Other games have their
own action names, player limits and payload contracts; the table is not a
universal game API. Stale move revisions are rejected without applying the move.

**Server → client events, Saboteur example:**

| Event | Audience | Payload |
| --- | --- | --- |
| `room_updated` | room | `RoomPublicState` |
| `game_state` | room | `SaboteurPublicState` |
| `private_state` | one socket | `SaboteurPrivateState` (hand, role, peeks) |
| `role_reveal` | room | all roles, at round end |
| `saboteur:action_accepted` | sending socket | `{ action, revision }`, semantic acknowledgement of an accepted command |
| `action_rejected` | one socket | `{ reason }` - the only error channel for game moves |
| `player_kicked` | one socket | `{}` |
| `server_error` | one socket | `{ message }` - room/player vanished (e.g. server restarted) |

**The state-emission pattern** is the heart of the visibility model
(`emitGameState` in `game/saboteur/socketHandlers.ts`): after every successful engine call,
broadcast `toPublicState(state)` to the room, then loop over connected
players and send each their own `toPrivateState(state, playerId)`. The
projections in `game/saboteur/publicState.ts` are the **only** code that
serializes engine state for clients; if you add fields to the engine state,
decide there whether they are public, private, or server-only. Public roles
are included only once `status` is `round_end`/`game_over`.

**Round transitions are timer-driven** (`handleRoundTransition`): when the
engine reaches `round_end` *and* gold distribution is complete, the server
emits `role_reveal` and schedules `advanceRound()` after
`ROUND_END_PAUSE_MS` (12s) so clients can show the round-end overlay. The
timer handle lives on the room (`timer`) so cleanup can cancel it.
If `advanceRound` ends the game (after round 3), the room flips to
`finished`, results are persisted (fire-and-forget `saveGameResult`), and a
final `game_state` carries `winnerIds`. The host can then `start_game` again
with the same lobby.

### Saboteur engine (`src/game/saboteur/`)

The engine is **pure TypeScript with no IO** - it never imports Fastify,
Socket.IO, or Supabase. Every mutation goes through an exported function that
takes the state + actor + intent and returns
`EngineResult = { ok: true } | { ok: false; reason: string }`. Invalid moves
mutate nothing. This is what makes the simulation test possible.

| File | Responsibility |
| --- | --- |
| `engine.ts` | state shape (`SaboteurServerState`), round setup, turn order, the four move functions (`placeCard`, `playAction`, `passTurn`, `chooseGold`), round/game end, `advanceRound` |
| `boardValidator.ts` | board geometry: edge matching, start-connectivity (BFS over `traversableSet`), `validatePlacement`, `isGoalReached`, `hasAnyLegalPlacement` |
| `deck.ts` | physical deck composition: 40 path cards (31 connecting + 9 dead ends), 27 action cards, 28 nugget cards; start/goal card factories; Fisher–Yates `shuffle` |
| `goldDistribution.ts` | miners-win nugget draft (winner first, counter-clockwise, miners only) and saboteur reward table |
| `publicState.ts` | projections to `SaboteurPublicState` / `SaboteurPrivateState` (see above) |

**Board model.** The legal board is capped at five columns (2–6) by nine rows
(0–8), with a start at `(0,4)` and goals at row 8, columns 2/4/6. The larger
9×13 `BOARD` dimensions are framing coordinates, not permission to overflow
the playable area. This vertical capped layout is a deliberate mobile
adaptation. Each path card has four edges (`open`/`closed`) and
a `center` flag - `center: false` is a dead-end card: you can connect *to* it
but paths never continue *through* it. Rotation is exactly 180° (swap
top↔bottom, left↔right); the server stores edges **already rotated**, so
everything downstream (validation, rendering) reads edges literally.

**Placement legality** (`validatePlacement`): in bounds, cell empty, not a
face-down goal cell, every shared edge with a neighbour matches
(open↔open / closed↔closed), at least one neighbour, and at least one open
edge faces an open edge of a card in the start-connected traversable network
(no floating tunnel islands).

**Goal reveal** (`revealReachedGoals`): a reachable goal exposes its actual
card and effective edges. Stone goals are mirrored corners, not four-way
junctions. The server chooses its legal half-turn orientation towards the
approach; the printed exception permits mismatched neighbouring edges at
reveal. Later placement reads those effective edges literally. Revealing
the gold goal ends the round immediately. A private Map peek includes the
goal face and paths without broadcasting them to other players. A Map may
inspect the same still-hidden goal again without duplicating private history.
Once revealed, its public board paths replace the obsolete private display.

**Turn flow.** Turn order is lobby join order. A turn is exactly one of:
place a path card (forbidden while *any* of your tools is broken), play an
action card, or pass (discard one card face-down). **Every** variant ends by
drawing a card (official rules; deliberate deviation from spec §8).
`advanceTurn` skips players with empty hands; when the deck is empty *and*
all hands are empty, the round ends in the saboteurs' favor.

**Action cards** (`dispatchAction`): sabotage (break one named tool on
another player; can't stack the same broken tool), repair (fix a broken tool
on any player - dual-repair cards require `chosenTool`), map (privately peek
at one face-down goal → recorded in `peekedGoals`), rockfall (remove one
*tunnel* card from the board - never start/goal cards; note the board is not
re-validated for connectivity afterwards, matching the physical game where
disconnected fragments simply remain).

**Scoring.** One shared 28-card nugget deck persists across all 3 rounds
(`goldDeck`). Miners win → `initGoldDistribution` draws one nugget card per
miner and the draft proceeds from the winning placer counter-clockwise
(backwards through turn order). The current picker privately inspects the
remaining values and chooses an index (`chooseGold`); public state exposes
only `availableCardCount`. Saboteur rewards use `SABOTEUR_REWARDS` and remove
cards of the corresponding value from the same finite deck. Reward rates
use that round's dealt roles, while forfeited players receive nothing.
Historical forfeited roles do not affect a later round. Exact personal
totals remain private until game over. After round 3, eligible players with
the most gold share victory (`winnerIds`).

**Role dealing** (`setupRound`): the official `ROLE_TABLE` pool contains one
more card than players. It is shuffled, one role is dealt per player, and one
card remains unseen. Only a zero-saboteur deal is repeated, so variable role
counts remain possible without an opposition-free digital round. The next
round's starter is the player left of whoever played or discarded the final
card.

**Departures.** Explicit leave or expired reconnect grace removes a seat
from active play immediately. Its hand is discarded; it receives no further
turns, deals or gold and cannot win. Historical seat information remains
available. With fewer than three active players, the game ends with
`terminationReason: 'not_enough_players'`, no winners and no saved competitive
result. Departure batches are settled before gameplay commands and round
timers so overdue players cannot receive late rewards.

**Synchronisation.** Saboteur public/private projections identify the game,
room and revision; private state also identifies its player. Gameplay
commands require `expectedRevision` and receive sender-only acknowledgements.
Revisions stay monotonic across rematches. The client buffers partial pairs,
adopts matching snapshots atomically and blocks actions while synchronising.

### Four-game expansion engines

The four new engines follow the same server-authoritative pattern under
`src/game/`: pure state transitions, viewer-specific projections and separate
socket handlers. Shared contracts and component inventories live in
`packages/types/src`. They reuse the existing authenticated room lifecycle,
reconnect grace, monotonic revisions and results writer.

| Game | Room options and main state boundary |
| --- | --- |
| Feed the Kraken | 5–11 seats; `krakenJourney` selects quick or long. Hidden factions, private navigation hands and character choices stay out of public state. Sealed bids and ritual responses use explicit action windows. |
| Telestrations | 4–12 seats; `telestrationsScoringMode`, `telestrationsCategory` and `telestrationsDirection`. Each seat receives only its current assignment and authorised predecessor page; the public reveal advances one page at a time. |
| Cartographers Heroes | 1–100 seats; `cartographersMapSide` selects C or D. A common explore deck drives simultaneous private maps. Only the map owner or currently authorised ambush placer receives editable terrain. |
| Dixit Odyssey | 3–12 seats; 2024 base rules. Private hands and submissions become an anonymous voting gallery, then an attributed scoring reveal. Three-player rounds use two decoys per non-storyteller. |

**Kraken privacy.** Every uprising opens the same public ritual phase even if
the Cult Leader is no longer aboard or has no available choice. Every aboard seat owes a
private response; public state exposes neither responder identity nor a
readiness count. Effects settle after all responses. The Leader's gun allocation
uses the supply snapshot at that window's opening. Bid and ritual submissions
may cross revisions only within their original action window; other actions
require the current revision. A forfeited navigation officer's committed cards
resolve automatically without granting a voluntary-refusal redraw.

**Drawing bounds.** Telestrations stores normalised vector strokes, not image
uploads: at most 96 strokes, 1,024 total points, 256 points per stroke and 16 KiB
per drawing. The renderer uses eight colours and three stroke widths. Drafts
are fenced by assignment window, seat token and draft revision, preserving
reload recovery without allowing a stale draft to overwrite a later handoff.
Socket broadcasts coalesce within one event-loop turn. Original prompt offers
come from a per-game shuffled pool, exhausted before refill. Its pool and seed
are server-only; category mode accepts player-written prompts instead.

**Large maps.** Cartographers coalesces room emissions with a room-keyed pending
callback rather than broadcasting a full room for every simultaneous placement.
Public frames do not contain all 100 maps. At game over, an authenticated
`cartographers:inspect_map` request retrieves one selected result map. The large
room's join limits permit 120 requests per minute per IP and per room; general
REST limits and the four-operation password concurrency bound still apply.

**Image identity.** Dixit's engine stores 84 stable card identifiers. The client
maps each identifier to a distinct original illustration and accessible
description in `components/dixit/artwork.ts`. No generated text or artwork
determines rules or scoring. Asset checks enforce deck completeness, distinct
content hashes, dimensions, budgets and provenance sidecars.

### Persistence (`lib/supabase.ts`, `lib/saveGameResult.ts`, `supabase.sql`)

The Supabase client is `null` when env vars are unset; result writes are disabled
and leaderboard reads return HTTP 503 (local dev needs no database). At game over
the server calls the service-role-only `record_game_result` function, atomically
inserting one session and all player results. It reuses one generated UUID across
up to three attempts, each with a ten-second request timeout, so an ambiguous
committed response cannot duplicate scores. Permanent failures stop immediately.
Exhausted retries are logged without player data; no durable outbox is present,
so a prolonged outage or process shutdown can still lose an unsaved result.
The checked-in SQL revokes anon and
authenticated access to raw rows and leaderboard views, so public clients
cannot forge results or enumerate player identifiers. `leaderboard` is a SQL
view grouping by `display_name`; the mobile app never talks to Supabase
directly and instead uses the server's `GET /leaderboard` endpoint.

### Simulation test (`scripts/saboteur/simulate.ts`)

`pnpm --filter @zuychin-arcade/server simulate:saboteur` runs deterministic
full games at every supported count (3–10), departure scenarios and focused
rule cases. It checks legal placement, card and nugget conservation, private
information, role dealing and termination through the production engine.
Run it after engine or constants changes. Simulation-policy win rates are
not a measurement of human game balance.

### Socket smoke test (`scripts/saboteur/smoke.ts`)

`pnpm --filter @zuychin-arcade/server smoke:saboteur` runs the isolated
HTTP/Socket.IO integration suite on ephemeral ports and refuses configured
hosted persistence. It covers creation, lobby controls, complete matches
and rematches at 3–10 players, private projections, revisions, reconnect and
forfeits. No separately running server is needed.

---

## Mobile app (`apps/mobile`)

Expo SDK 56, React Native 0.85, React 19. Managed workflow - no `android/`
/`ios/` directories are checked in; the app runs in Expo Go or via EAS builds.

### Navigation (expo-router, file-based)

`index.js` installs the shared web Back dispatcher before importing
`expo-router/entry`, following [Expo's custom-entry convention](https://docs.expo.dev/router/installation/).
Screen guards register the current confirmation handler and preserve the
router's committed history identity. A late capture listener alone does not
precede an already registered window `popstate` listener. Native platforms
do not install this browser dispatcher.

```
app/
├── _layout.tsx          root Stack; mounts useSocket() once; rehydrates auth
│                        from platform session storage before routes render; mounts
│                        the global <ArcadeDialogHost /> on top of the Stack
├── (arcade)/            the arcade hub - responsive chrome
│   ├── _layout.tsx      ≥768px: persistent Sidebar; below: MobileHeader +
│   │                    slide-in MobileDrawer (components/navigation/), over
│   │                    an AnimatedBackground
│   ├── index.tsx        game hub - session-resume banner + game tiles
│   ├── leaderboard.tsx  fetches GET /leaderboard via the server
│   ├── profile.tsx      display name, session info
│   └── about.tsx        about the arcade
└── saboteur/            the Saboteur game - own Stack, loaded only when entered
    ├── _layout.tsx      Stack with game-specific header styling
    ├── index.tsx        landing: name entry + create room (+optional password)
    ├── join.tsx         join by room code
    ├── lobby.tsx        player list, host controls (kick, start)
    └── game.tsx         board, hand, private choices and result overlays
```

The hub/game split is the **template for future games**: each game lives in
its own route group under `app/<game>/` and is only mounted when the player
selects it from the hub. Game-agnostic chrome (navigation, leaderboard,
profile) stays in `(arcade)/`.

### State management

One Zustand store (`store/useGameStore.ts`) holds auth (`token`, `playerId`,
`displayName`, `roomCode`), the room snapshot, each game's public/private
projections and transient UI selection (`selectedCardId`, `rotated`).
Saboteur, Coup, BANG!, Skull King, Citadels, Not Alone, Libertalia, Colt Express,
Feed the Kraken, Telestrations, Cartographers Heroes and Dixit Odyssey
adopt matching public/private revisions atomically and block actions while a
pair is incomplete or reconnecting. The four expansion games share
`lib/revisionPair.ts` for room/player identity checks and monotonic pair adoption.
King of Tokyo uses one viewer-specific frame,
including private Lab offers and preferences; it requires matching room/viewer
identity and a non-decreasing revision, and fences actions until reconnect refreshes it.
There is no client-side
game logic in the store - it is a passive mirror of server emissions.
`clearAll()` resets everything on leave/kick/expiry. Adopting a different
token, player or room also clears every old projection and selection atomically;
refreshing the same identity preserves its current display.

`lib/storage.ts` keeps web auth in tab-scoped `sessionStorage` under `za:auth`
and native auth in SecureStore under `za.auth`. Only the last display name
uses AsyncStorage (`za:displayName`). Auth reads, writes and removals are
serialised; token-matched cleanup cannot erase a replacement session.
`lib/tokenUtils.ts` decodes the JWT client-side purely to check `exp` -
expired sessions are discarded instead of restored. The **root layout**
rehydrates this bundle into the store before any route renders, so a web
refresh landing directly on `/saboteur/game` reconnects instead of hanging.

### Dialogs (`lib/dialog.ts` + `components/ui/ArcadeDialog.tsx`)

React Native's `Alert.alert` is a **no-op on react-native-web**, so all
confirms and error popups go through `showDialog(title, message?, buttons?)`
- a tiny zustand store rendered by `<ArcadeDialogHost />`, which is mounted
once in the root layout above the navigator. It mirrors the `Alert` button
contract (`default` / `cancel` / `destructive`), supports 1–n buttons, and
tapping the backdrop acts as cancel. Never import `Alert` in app code.

### Networking

Two channels, mirroring the server:

- **REST** (`lib/api.ts`): thin typed `fetch` wrapper over
  create/join/getRoom/kick/leave/leaderboard. Error bodies' `message` fields are
  surfaced as `Error`s for `showDialog` popups. Base URL: `EXPO_PUBLIC_SERVER_URL`
  (`constants/config.ts`). This must be an explicit HTTP(S) origin with no
  credentials, path, query or fragment; production requires HTTPS. Development
  browser clients can use `http://localhost:3001`; devices need the machine's
  reachable LAN address. Missing configuration fails immediately.
- **Socket.IO** (`hooks/useSocket.ts`): a module-level singleton socket,
  owned by a hook mounted **once in the root layout**. It connects whenever
  the store has a token (websocket transport, unbounded reconnect attempts
  with 2–10-second backoff) and tears down when the token clears. Incoming
  audited-game frames are fenced by socket/session, game, room and private-player identity.
  On reconnect it emits `request_state`. Terminal session errors disconnect,
  await token-matched credential removal and then clear state and route home;
  failed removal remains retryable. The eight paired-state games' action hooks
  send revisioned commands and wait for semantic acknowledgements and paired server state.
  King of Tokyo uses the same acknowledgement fence with its single viewer-owned
  frame. Changed preferences advance its revision; an unchanged preference may
  acknowledge the existing revision. Rematches retain monotonic revisions.
  Gameplay does not use optimistic state mutations.

### Client-side placement preview (`lib/placement.ts`)

A deliberate, contained duplication of the server's board validator, used
*only* to highlight legal cells when a path card is selected (`validPlacements`
returns the set of legal cells for a card + rotation). The server remains
authoritative - an out-of-sync client just gets `action_rejected`. **If you
change placement rules in `boardValidator.ts`, update `placement.ts` to
match** (the highlight going stale is the failure mode, not cheating).

### Theming

`constants/theme.ts` defines the shared arcade and per-game palettes.
`tailwind.config.js` also exposes arcade, mine and Coup colours for class-based
styles. Navigators, animated styles and text shadows use the exported constants:

- `arcade.*` - neon red/purple/blue hub chrome on near-black violet. All hub
  and future-game chrome should use these tokens.
- `mine.*` - Saboteur's in-game board palette (gold/stone/tunnel) tinted to
  sit on the arcade background.
- `COUP`, `TOKYO`, `SKULL_KING`, `CITADELS`, `NOT_ALONE`, `BANG`, `LIBERTALIA`
  and `COLT` preserve the other games' distinct colour systems.

`neonText()` / `neonBox()` in `theme.ts` produce the glow effects, and
`OVERLAY_FILL` is the shared full-screen-centered backdrop style - overlays
use it as an explicit style prop because **NativeWind classNames are
unreliable on reanimated `Animated.View`s** (positioning classes can be
silently dropped). `components/ui/` holds the reusable primitives
(`NeonButton`, `GlowPulse`, `ScalePressable`, `GameTile`, `ArcadeDialog`,
`AnimatedBackground`). NativeWind v4 with `darkMode: 'class'` (the app is
always dark; the class strategy avoids NativeWind's media-query crash).
Components are grouped into per-game folders plus shared `board/`, `cards/`,
`lobby/`, `overlays/`, `navigation/` and `ui/` domains.

Shared `CardSurface` renders the raised face and edge; its opt-in `fill` lets
comparable faces stretch within a row. `CardGrid` derives columns from measured
available width and keeps trailing cards at the same column width. Full text
sets intrinsic height instead of being clamped. Compact pieces, regular cards,
horizontal hand rails and public tokens retain their distinct proportions;
matching a family does not mean giving every game's piece one fixed size.
See the [component gallery guide](tools/card-gallery/README.md) and
[testing guide](docs/TESTING.md) for validation scope.

---

## Key flows end-to-end

**Create & join.** Landing screen → `POST /rooms/create` → save
`{ token, playerId, roomCode, displayName }` through the auth-storage helper
(web sessionStorage or native SecureStore) + store →
the token's arrival makes `useSocket` connect → socket middleware verifies
JWT → socket joins the room → everyone gets `room_updated` → lobby renders.
Joining is identical via `POST /rooms/join`.

**A turn.** Player taps a hand card (store: `selectedCardId`) → legal cells
highlight via `lib/placement.ts` → tap a cell → `emit('place_card', { cardId,
position, rotated, expectedRevision })` → server: auth/revision validation → engine `placeCard()` → on failure
`action_rejected { reason }` back to that socket only; on success
`game_state` to the room and fresh `private_state` to each player, followed by
`saboteur:action_accepted { action, revision }` to the sender → clients adopt
a matching pair and re-render.

**Round end.** Engine flips to `round_end` (gold reached / deck+hands empty)
→ if miners won, the gold draft runs via `choose_gold` events until complete
→ server emits `role_reveal` and starts the 12s timer → overlay shows
roles/nuggets → timer fires `advanceRound()` → next round's `game_state`
(or game over: room `finished`, results persisted, `winnerIds` set).

**Reconnect / resume.** App restart (or a web page refresh on any route) →
the root layout loads unexpired auth from the platform-specific store →
socket reconnects with the same token → `request_state` pulls the current
viewer-owned snapshot. Temporary transport failures preserve credentials;
confirmed expired or unavailable sessions use the recovery flow. Disconnect
reserves a seat for a 30-second grace period, after which shared lifecycle
recovery marks it departed. BANG!, Saboteur, Coup, King of Tokyo, Skull King,
Citadels, Not Alone, Libertalia and Colt Express apply
their user-approved immediate-forfeit rules, including their distinct
no-winner conditions. Explicit leave skips the grace period. Their different
retirement boundaries must be checked in the contracts below, not inferred
from the shared forfeiture flag.

Skull King retains a forfeited seat only until its current round finishes,
using deterministic legal cards without further scoring or victory eligibility.
The next deal removes that seat from the rotation while preserving its historical
scores. Fewer than three eligible captains ends immediately without a winner;
the unfinished round is not scored and no competitive result is saved.

Citadels retains a forfeited seat only through the current round, using legal
automatic choices without scoring or victory eligibility. Before the next
draft, its hand returns to the deck bottom and its ID leaves `turnOrder`.
`players` retains the historical city and gold, but archived seats cannot be
targeted or receive later resources. The crown passes clockwise to an eligible
builder immediately on forfeiture. Below four eligible players, the engine
sets `terminationReason: 'not_enough_players'`, clears pending choices and
ends immediately with no winner, final scoring or competitive result.

Not Alone retains an ineligible Hunted seat only through the current round,
then removes it from both active orders while preserving the original track
goals. A forfeited Creature loses to any remaining eligible Hunted; an eligible
Creature wins if no Hunted remain. Simultaneous departure of everyone ends with
no winner. Result construction excludes forfeited participants.

Libertalia retires a forfeited seat immediately during selection, or after
legal automatic settlement of its already revealed day. `players` retains its
history, while `turnOrder` controls active participation. `voyagePlayerCount`
and prepared `lootDays` stay fixed until the next voyage. Archived crew do not
become targets or influence later ability ownership. One eligible survivor wins
with `endReason: 'forfeit'`; zero survivors produce no winner or saved result.
Gameplay commands require a revision; rematches continue that revision sequence.
The client adopts room- and player-owned public/private frames atomically.

Night settlement records Wind Nymph owners before any night effects, including
current-day forfeits but excluding already retired ships. Conflicting copies
discard locally when each owner resolves them. Ordinary night effects finish
before Freed Prisoner choices; a committed Witch copy survives later removal of
the copied source. The latter and empty-hand continuation are disclosed
interpretations, not claims of explicit publisher FAQ coverage.

Colt Express's three-to-six-player setup accepts unique public character claims
before placement and dealing. A stale or conflicting claim is rejected without
mutation. Two-player team selection, secret formation and reserve phases remain
separate. Public/private frames include room identity; private frames also carry
viewer identity, and the client adopts only matching monotonic revisions.

A Colt forfeit immediately removes victory eligibility and future programming.
Only already-committed actions settle automatically. The bandits retire before
the next round, or immediately during setup when no actions are committed.
`initialPlayerCount`, the train and two-bandit mode remain fixed for that robbery.
One eligible survivor wins by forfeit; zero survivors produce no winner or saved
competitive result. Natural results use the same score calculation for winners,
public totals and result writes. Rematches continue the room revision sequence.

---

## Design decisions & rule deviations

These decisions include both printed rules and explicitly disclosed digital
adaptations. The current Saboteur rules baseline is AMIGO version 4.0 (2025);
do not restore superseded behaviour from earlier design notes:

1. **Pass/discard draws a card.** Official rules: every turn ends with a
   draw. An earlier implementation note said otherwise and was overridden.
2. **Every round has a saboteur.** The official "deal players + 1, set one
   aside" process is used, including its variable saboteur count. Only a
   zero-saboteur result is rerolled because an opposition-free digital round
   has no social-deduction game.
3. **Leaderboard goes through the server** (`GET /leaderboard`), not from
   mobile to Supabase directly - keeps Supabase keys off the client entirely.
4. **The board is capped at 5 by 9 cells**, as requested for mobile use.
   Printed goal paths are preserved; the previous four-way stone-goal
   approximation was removed at the user's request.
5. **tsup bundles the types package** into the server build instead of plain
   tsc (the types package ships TS source).
6. **`packages/types` requires `"type": "module"`** or tsx loses named
   runtime exports.
7. **Immediate Saboteur forfeits.** A departed seat is removed from play;
   fewer than three active players ends the match without a winner. This
   user-selected digital policy replaces passive autoplay and rewards.

Open deployment constraints: rooms and live game state are process-local, so
restart recovery and horizontal scaling are not supported yet. Room passwords
are salted with scrypt before entering process memory, but active rooms still
need durable snapshots and fenced ownership. Until those land, production must
use one always-on server replica and advertise active games as ephemeral. The UI intentionally avoids
optimistic gameplay mutations so the authoritative server revision remains
visible.

---

## Adding a new game to the arcade

The Saboteur implementation defines the pattern:

1. **Contracts first** - add `packages/types/src/<game>.ts` (+ constants
   file) with the server-private state, the public/private projections, and
   the socket payloads. Export from `index.ts`.
2. **Pure engine** - `apps/server/src/game/<game>/` with an `engine.ts`
   exporting `init…()` and move functions returning `EngineResult`. No IO
   imports. Add a simulation script and run it.
3. **Projections** - a `publicState.ts` deciding field-by-field what is
   broadcast vs per-socket.
4. **Socket handlers** - extend the existing `RoomGame` tagged union and add
   a per-game handler module; keep the
   `applyEngineCall` pattern (reject → `action_rejected`, succeed → broadcast
   public + per-socket private).
5. **Mobile route group** - `app/<game>/` with its own `_layout.tsx`,
   landing/lobby/game screens; a `GameTile` on the Arcade tab linking in.
   Use `arcade.*` chrome tokens plus a game-specific palette like `mine.*`.
6. **Reuse** the lobby/room layer as-is - rooms, JWTs, kick, and
   `room_updated` are already game-agnostic.

## Known limitations / future work

- **Deployment is pending** - nothing is on Render/Supabase/EAS yet, and the
  app has not been tested on a physical device.
- Rooms don't survive server restarts; there is no state snapshotting.
- One Socket.IO process only - no Redis adapter, no horizontal scale.
- The fixed-window abuse controls are process-local and assume the required
  single server replica. They are not a substitute for edge-level controls.
- Engine simulations and focused socket/UI smoke tests exist, but full
  cross-browser, physical-device, and production-network E2E coverage remains
  incomplete. [Testing](docs/TESTING.md) distinguishes reproducible checks from
  browser, native and release acceptance.
- `RoomStore.cleanup()` is time-based only; an abandoned in-game room lives
  for 4 idle hours.
