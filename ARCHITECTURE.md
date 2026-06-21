# Architecture

This document explains how zuychin-arcade is put together: the monorepo, the
shared types package, the authoritative game server, the socket protocol, the
Saboteur engine, the mobile app, and the patterns to follow when adding a new
game to the hub.

## System overview

```
┌─────────────────────┐         REST (fetch)          ┌──────────────────────────┐
│  apps/mobile        │  POST /rooms/create|join      │  apps/server             │
│  Expo / React Native│──────────────────────────────▶│  Fastify 5               │
│                     │   ← JWT + room snapshot       │                          │
│  zustand store      │                               │  RoomStore (in-memory)   │
│  useSocket hook     │   Socket.IO (websocket,       │  Saboteur engine (pure)  │
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
   information (hands, roles, map peeks) is never broadcast — it goes to the
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

`@zuychin-arcade/types` has **no build step** — its `main`/`types` point
straight at `src/index.ts`. Consumers handle that differently:

- **Server dev** (`tsx watch`): tsx transpiles the imported TS on the fly.
  This is why the package needs `"type": "module"` — without it tsx mangles
  the module format and named runtime exports (`ROLE_TABLE`, `BOARD`, …)
  disappear at runtime.
- **Server prod build**: `tsup` with `noExternal: ['@zuychin-arcade/types']`
  bundles the package's source into `apps/server/dist/index.js` (ESM,
  `node20`). Plain `tsc` was deliberately abandoned because it won't compile
  a dependency's `.ts` sources.
- **Mobile**: Metro just bundles the TS source like any other module.

If you add another shared TS-source package, add it to `noExternal` in
`apps/server/tsup.config.ts` and give it `"type": "module"`.

### What's in `packages/types`

| File | Contents |
| --- | --- |
| `room.ts` | `Player`, `RoomPublicState` (lobby-level state) |
| `auth.ts` | `JwtPayload`, `JoinRoomPayload`, `JoinRoomResponse` |
| `saboteur.ts` | every game-state and socket-payload contract: cards, board positions, `SaboteurPublicState` / `SaboteurPrivateState`, `PlaceCardPayload`, … |
| `saboteur-constants.ts` | verified rules data: `ROLE_TABLE`, `getHandSize`, `ACTION_CARD_COUNTS`, `GOLD_NUGGET_CARDS`, `SABOTEUR_REWARDS`, `BOARD` geometry, `MIN_PLAYERS`/`MAX_PLAYERS`, `ROUNDS_PER_GAME` |

The key split to understand is **server-private vs public vs per-player
state** (all defined in `saboteur.ts`):

- `PlayerGameState` — server-side only, contains `role`, `hand`, `peekedGoals`. Never serialized to clients in full.
- `SaboteurPublicState` — broadcast to the whole room: board, goal statuses (`isGold: null` while face-down), deck/discard counts, per-player `handSize` (count, not cards), broken tools, gold totals, turn pointer, round-end data.
- `SaboteurPrivateState` — sent only to the owning socket: `role`, `hand`, `peekedGoals`.

---

## Server (`apps/server`)

### Bootstrap (`src/index.ts`)

A single Fastify instance with permissive CORS; Socket.IO attaches to the same
HTTP server (`app.server`), so REST and WebSocket share one port (`PORT`,
default 3001). Two registration calls wire everything:
`registerRoomRoutes(app, io)` and `registerSocketHandlers(io)`.

### Identity: per-room JWTs (`utils/jwt.ts`)

`POST /rooms/create` and `/rooms/join` mint a JWT with
`{ playerId, roomCode, displayName, isHost }`, 24h expiry, signed with
`JWT_SECRET` (an insecure dev fallback is used, with a console warning, when
unset). The token is the player's *only* credential: REST `kick` checks it in
the `Authorization` header, and every socket connection must present it in
`handshake.auth.token`.

### Room registry (`store/RoomStore.ts`)

A `Map<roomCode, ServerRoom>` singleton. `ServerRoom` holds the password
(plain text, nullable), `hostPlayerId`, a `Map<playerId, ServerPlayer>`
(player + current `socketId`), lobby/in_game/finished `status`, the
`gameState` (engine state or null), activity timestamps, and the
`nextRoundTimer` handle.

- Room codes are mining-themed, e.g. `GOLD-42` (`utils/roomCode.ts`: word +
  2-digit number, 10 attempts to avoid collisions). Lookups are
  case-insensitive (`get` upper-cases).
- `getRoomPublicState()` strips `socketId` before anything leaves the server.
- A `setInterval` (unref'd, every 30 min) deletes rooms idle for > 4 hours
  and clears their pending round timers. **Restarting the server loses all
  rooms** — connected clients get `server_error` and are disconnected.

### REST endpoints (`routes/room.ts`)

| Endpoint | Auth | Purpose / notable rules |
| --- | --- | --- |
| `POST /rooms/create` | — | validates display name (`^[A-Za-z0-9 ]{1,20}$`), creates room (+optional password), registers host, returns `JoinRoomResponse` (token + room snapshot), 201 |
| `POST /rooms/join` | — | password check (403), lobby-only (409 once in game), max 10 players (409), case-insensitive duplicate-name rejection (409); emits `room_updated` to the room |
| `GET /rooms/:roomCode` | — | public room snapshot |
| `POST /rooms/:roomCode/kick` | Bearer JWT, host only | removes target (never the host), emits `player_kicked` to the victim's socket and `room_updated` to the room |
| `GET /leaderboard` | — | top-50 rows from the Supabase `leaderboard` view; `[]` when Supabase is unconfigured or errors |
| `GET /health` | — | `{ ok: true }` (for uptime pings) |

Note that join/create happen over REST *before* any socket exists — the
socket connection is step two, authenticated by the token from step one.

### Socket layer (`socket/handlers.ts` + per-game `game/<name>/socketHandlers.ts`)

**Connection middleware** verifies the JWT and stashes the payload on
`socket.data.auth`; invalid/missing tokens are refused with an
`INVALID_TOKEN` connect error (which the client treats as "session dead").
On connection the socket joins the Socket.IO room named by `roomCode`, the
player's `socketId`/`isConnected` are updated, and `room_updated` is
broadcast. On disconnect, the player is marked disconnected (but **stays in
the room** — reconnection is just connecting again with the same token).

**Client → server events** (all validated against `socket.data.auth`; every
game event re-resolves the room and replies with `action_rejected { reason }`
on any failure):

| Event | Payload | Server behavior |
| --- | --- | --- |
| `start_game` | — | host-only, ≥ 3 players, lobby or finished game; runs `initGame()`, broadcasts state |
| `place_card` | `{ cardId, position, rotated }` | engine `placeCard()` |
| `play_action` | `{ cardId, targetPlayerId?, targetPosition?, chosenTool? }` | engine `playAction()` |
| `pass_turn` | `{ discardCardId? }` | engine `passTurn()` |
| `choose_gold` | `{ cardIndex }` | engine `chooseGold()` during gold distribution — cards are face-down, picked by index; the value is revealed only after the pick |
| `request_state` | — | re-sends `room_updated`, `game_state`, `private_state` to this socket (reconnection/refresh) |

**Server → client events:**

| Event | Audience | Payload |
| --- | --- | --- |
| `room_updated` | room | `RoomPublicState` |
| `game_state` | room | `SaboteurPublicState` |
| `private_state` | one socket | `SaboteurPrivateState` (hand, role, peeks) |
| `role_reveal` | room | all roles, at round end |
| `action_rejected` | one socket | `{ reason }` — the only error channel for game moves |
| `player_kicked` | one socket | `{}` |
| `server_error` | one socket | `{ message }` — room/player vanished (e.g. server restarted) |

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
timer handle lives on the room (`nextRoundTimer`) so cleanup can cancel it.
If `advanceRound` ends the game (after round 3), the room flips to
`finished`, results are persisted (fire-and-forget `saveGameResult`), and a
final `game_state` carries `winnerIds`. The host can then `start_game` again
with the same lobby.

### Saboteur engine (`src/game/saboteur/`)

The engine is **pure TypeScript with no IO** — it never imports Fastify,
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

**Board model.** The board is a sparse list of `PlacedCard`s on a 9×13 grid
(`BOARD` in constants): start card at `(0,4)`, three face-down goals at row 8,
columns 2/4/6 (the mine is oriented vertically; rows extend past the goal row
so tunnels can overflow). Each path card has four edges (`open`/`closed`) and
a `center` flag — `center: false` is a dead-end card: you can connect *to* it
but paths never continue *through* it. Rotation is exactly 180° (swap
top↔bottom, left↔right); the server stores edges **already rotated**, so
everything downstream (validation, rendering) reads edges literally.

**Placement legality** (`validatePlacement`): in bounds, cell empty, not a
face-down goal cell, every shared edge with a neighbour matches
(open↔open / closed↔closed), at least one neighbour, and at least one open
edge faces an open edge of a card in the start-connected traversable network
(no floating tunnel islands).

**Goal reveal** (`revealReachedGoals`): after each placement, any face-down
goal adjacent to the traversable network via a facing open edge is flipped. A
revealed goal becomes a board card open on all four sides, which can chain-
reveal further goals (hence the loop). Revealing the gold goal ends the round
for the miners immediately.

**Turn flow.** Turn order is lobby join order. A turn is exactly one of:
place a path card (forbidden while *any* of your tools is broken), play an
action card, or pass (discard one card face-down). **Every** variant ends by
drawing a card (official rules; deliberate deviation from spec §8).
`advanceTurn` skips players with empty hands; when the deck is empty *and*
all hands are empty, the round ends in the saboteurs' favor.

**Action cards** (`dispatchAction`): sabotage (break one named tool on
another player; can't stack the same broken tool), repair (fix a broken tool
on any player — dual-repair cards require `chosenTool`), map (privately peek
at one face-down goal → recorded in `peekedGoals`), rockfall (remove one
*tunnel* card from the board — never start/goal cards; note the board is not
re-validated for connectivity afterwards, matching the physical game where
disconnected fragments simply remain).

**Scoring.** One shared 28-card nugget deck persists across all 3 rounds
(`goldDeck`). Miners win → `initGoldDistribution` draws one nugget card per
miner and the draft proceeds from the winning placer counter-clockwise
(backwards through turn order), each picker taking one face-down card by
index (`chooseGold`) — the public state exposes only `availableCardCount`,
never the values. Saboteurs win → flat rewards from `SABOTEUR_REWARDS`
(1 saboteur → 4 nuggets, 2–3 → 3, 4 → 2). After round 3, the player(s) with
the most gold share victory (`winnerIds`).

**Role dealing** (`setupRound`): exactly `ROLE_TABLE[n].saboteurs` saboteurs
are dealt each round; the remaining players are miners. (The tabletop
"players + 1 cards, one set aside" variant could leave zero saboteurs, which
plays badly in a digital game.) The next round's starter is the player left
of whoever placed the last path card.

### Persistence (`lib/supabase.ts`, `lib/saveGameResult.ts`, `supabase.sql`)

The Supabase client is `null` when env vars are unset; every persistence path
checks for that and no-ops (local dev needs no database). At game over the
server inserts one `game_sessions` row and one `player_results` row per
player, using the anon key under permissive RLS policies (anonymous
insert/read — acceptable for a private friends-only deployment, not for
public exposure). `leaderboard` is a SQL view grouping by `display_name`;
the mobile app never talks to Supabase directly — it goes through the
server's `GET /leaderboard`.

### Simulation test (`scripts/saboteur/simulate.ts`)

`pnpm --filter @zuychin-arcade/server simulate:saboteur` plays 240 full games (30 per
player count, 3–10) choosing uniformly among legal moves, asserting invariants
throughout (legal placements only, conserved card counts, role table
adherence, gold totals, termination). It exercises the engine through the
same exported functions the socket handlers call. **Run it after any engine
or constants change** — it is the project's primary regression net.

### Socket smoke test (`scripts/saboteur/smoke.ts`)

`pnpm --filter @zuychin-arcade/server smoke:saboteur` drives a
real running server (default `http://localhost:3002`, override with
`SMOKE_PORT`) end-to-end over HTTP + Socket.IO: creates a 3-player room, joins,
starts the game, asserts exactly one saboteur, plays six discard+draw+pass
turns, then simulates a browser refresh (fresh socket, same JWT,
`request_state`) and asserts the full state is restored. Start a server first
— the script does not boot one. Run it after changes to the socket handlers,
auth, or room store.

---

## Mobile app (`apps/mobile`)

Expo SDK 56, React Native 0.85, React 19. Managed workflow — no `android/`
/`ios/` directories are checked in; the app runs in Expo Go or via EAS builds.

### Navigation (expo-router, file-based)

```
app/
├── _layout.tsx          root Stack; mounts useSocket() once; rehydrates auth
│                        from AsyncStorage before any route renders; mounts
│                        the global <ArcadeDialogHost /> on top of the Stack
├── (arcade)/            the arcade hub — responsive chrome
│   ├── _layout.tsx      ≥768px: persistent Sidebar; below: MobileHeader +
│   │                    slide-in MobileDrawer (components/navigation/), over
│   │                    an AnimatedBackground
│   ├── index.tsx        game hub — session-resume banner + game tiles
│   ├── leaderboard.tsx  fetches GET /leaderboard via the server
│   ├── profile.tsx      display name, session info
│   └── about.tsx        about the arcade
└── saboteur/            the Saboteur game — own Stack, loaded only when entered
    ├── _layout.tsx      Stack with game-specific header styling
    ├── index.tsx        landing: name entry + create room (+optional password)
    ├── join.tsx         join by room code
    ├── lobby.tsx        player list, host controls (kick, start)
    └── game.tsx         the board, hand, overlays — the big screen (~350 lines)
```

The hub/game split is the **template for future games**: each game lives in
its own route group under `app/<game>/` and is only mounted when the player
selects it from the hub. Game-agnostic chrome (navigation, leaderboard,
profile) stays in `(arcade)/`.

### State management

One zustand store (`store/useGameStore.ts`) holds four slices in a flat
object: auth (`token`, `playerId`, `displayName`, `roomCode`), the room
snapshot, the two game-state projections (`publicState`, `privateState`), and
transient UI selection (`selectedCardId`, `rotated`). There is no client-side
game logic in the store — it is a passive mirror of server emissions.
`clearAll()` resets everything on leave/kick/expiry.

Session persistence is AsyncStorage (`lib/storage.ts`): the auth bundle under
`za:auth` plus the last display name under `za:displayName`.
`lib/tokenUtils.ts` decodes the JWT client-side purely to check `exp` —
expired sessions are discarded instead of restored. The **root layout**
rehydrates this bundle into the store before any route renders, so a web
refresh landing directly on `/saboteur/game` reconnects instead of hanging.

### Dialogs (`lib/dialog.ts` + `components/ui/ArcadeDialog.tsx`)

React Native's `Alert.alert` is a **no-op on react-native-web**, so all
confirms and error popups go through `showDialog(title, message?, buttons?)`
— a tiny zustand store rendered by `<ArcadeDialogHost />`, which is mounted
once in the root layout above the navigator. It mirrors the `Alert` button
contract (`default` / `cancel` / `destructive`), supports 1–n buttons, and
tapping the backdrop acts as cancel. Never import `Alert` in app code.

### Networking

Two channels, mirroring the server:

- **REST** (`lib/api.ts`): thin typed `fetch` wrapper over
  create/join/getRoom/kick/leaderboard. Error bodies' `message` fields are
  surfaced as `Error`s for `showDialog` popups. Base URL: `EXPO_PUBLIC_SERVER_URL`
  (`constants/config.ts`, default `http://localhost:3001` — must be the
  machine's LAN IP for on-device testing).
- **Socket.IO** (`hooks/useSocket.ts`): a module-level singleton socket,
  owned by a hook mounted **once in the root layout**. It connects whenever
  the store has a token (websocket transport, 10 reconnection attempts) and
  tears down when the token clears. Handlers just write server emissions into
  the store; on (re)`connect` it emits `request_state` to resync, and on
  `INVALID_TOKEN`, `server_error` (room no longer exists) or `player_kicked`
  it clears storage + store and routes home. Screens send moves via `getSocket()?.emit('place_card', …)` and
  render whatever state arrives — there is no optimistic update; the
  round-trip is fast enough and keeps clients trivially consistent.

### Client-side placement preview (`lib/placement.ts`)

A deliberate, contained duplication of the server's board validator, used
*only* to highlight legal cells when a path card is selected (`validPlacements`
returns the set of legal cells for a card + rotation). The server remains
authoritative — an out-of-sync client just gets `action_rejected`. **If you
change placement rules in `boardValidator.ts`, update `placement.ts` to
match** (the highlight going stale is the failure mode, not cheating).

### Theming

Two palettes defined in `tailwind.config.js` and mirrored as hex constants in
`constants/theme.ts` (style props — navigators, animated styles, text shadows
— can't take Tailwind classNames):

- `arcade.*` — neon red/purple/blue hub chrome on near-black violet. All hub
  and future-game chrome should use these tokens.
- `mine.*` — Saboteur's in-game board palette (gold/stone/tunnel) tinted to
  sit on the arcade background.

`neonText()` / `neonBox()` in `theme.ts` produce the glow effects, and
`OVERLAY_FILL` is the shared full-screen-centered backdrop style — overlays
use it as an explicit style prop because **NativeWind classNames are
unreliable on reanimated `Animated.View`s** (positioning classes can be
silently dropped). `components/ui/` holds the reusable primitives
(`NeonButton`, `GlowPulse`, `ScalePressable`, `GameTile`, `ArcadeDialog`,
`AnimatedBackground`). NativeWind v4 with `darkMode: 'class'` (the app is
always dark; the class strategy avoids NativeWind's media-query crash).
Components are grouped by domain: `board/`, `cards/`, `lobby/`, `overlays/`
(role reveal, gold pick, round end, game over), `navigation/` (hub sidebar,
mobile header/drawer), `ui/`.

---

## Key flows end-to-end

**Create & join.** Landing screen → `POST /rooms/create` → save
`{ token, playerId, roomCode, displayName }` to AsyncStorage + store →
the token's arrival makes `useSocket` connect → socket middleware verifies
JWT → socket joins the room → everyone gets `room_updated` → lobby renders.
Joining is identical via `POST /rooms/join`.

**A turn.** Player taps a hand card (store: `selectedCardId`) → legal cells
highlight via `lib/placement.ts` → tap a cell → `emit('place_card', { cardId,
position, rotated })` → server: auth → engine `placeCard()` → on failure
`action_rejected { reason }` back to that socket only; on success
`game_state` to the room + fresh `private_state` to each player → all
clients re-render.

**Round end.** Engine flips to `round_end` (gold reached / deck+hands empty)
→ if miners won, the gold draft runs via `choose_gold` events until complete
→ server emits `role_reveal` and starts the 12s timer → overlay shows
roles/nuggets → timer fires `advanceRound()` → next round's `game_state`
(or game over: room `finished`, results persisted, `winnerIds` set).

**Reconnect / resume.** App restart (or a web page refresh on any route) →
the root layout loads auth from AsyncStorage (if the JWT isn't expired) →
socket reconnects with the same token → `request_state` pulls the full
current snapshot. If the room is gone server-side, `server_error` clears the
session and routes home. Players are never removed on disconnect, only
marked `isConnected: false`; the game does not pause for absent players —
their turn waits.

---

## Design decisions & rule deviations

These are **intentional** — verified against official sources on 2026-06-11.
Don't "correct" them back toward `zuychin-arcade-spec.md`:

1. **Pass/discard draws a card.** Official rules: every turn ends with a
   draw. Spec §8 said otherwise and was overridden.
2. **Saboteur count is guaranteed** (exactly `ROLE_TABLE[n].saboteurs` per
   round). The official "deal players + 1, set one aside" rule was dropped
   because it can produce rounds with zero saboteurs in 3–4 player games.
3. **Leaderboard goes through the server** (`GET /leaderboard`), not from
   mobile to Supabase directly — keeps Supabase keys off the client entirely.
4. **Revealed goals are open on all four sides** (physical rule lets you
   orient the goal card to fit).
5. **tsup bundles the types package** into the server build instead of plain
   tsc (the types package ships TS source).
6. **`packages/types` requires `"type": "module"`** or tsx loses named
   runtime exports.

Other consciously accepted trade-offs: in-memory rooms (restart = wipe; no
horizontal scaling — fine for a friends-scale deployment), plaintext room
passwords (they gate a lobby, not data), permissive Supabase RLS with the
anon key (server-side only, private deployment), no optimistic UI.

---

## Adding a new game to the arcade

The Saboteur implementation defines the pattern:

1. **Contracts first** — add `packages/types/src/<game>.ts` (+ constants
   file) with the server-private state, the public/private projections, and
   the socket payloads. Export from `index.ts`.
2. **Pure engine** — `apps/server/src/game/<game>/` with an `engine.ts`
   exporting `init…()` and move functions returning `EngineResult`. No IO
   imports. Add a simulation script and run it.
3. **Projections** — a `publicState.ts` deciding field-by-field what is
   broadcast vs per-socket.
4. **Socket handlers** — either generalize `ServerRoom.gameState` into a
   tagged union per game or add a parallel handler module; keep the
   `applyEngineCall` pattern (reject → `action_rejected`, succeed → broadcast
   public + per-socket private).
5. **Mobile route group** — `app/<game>/` with its own `_layout.tsx`,
   landing/lobby/game screens; a `GameTile` on the Arcade tab linking in.
   Use `arcade.*` chrome tokens plus a game-specific palette like `mine.*`.
6. **Reuse** the lobby/room layer as-is — rooms, JWTs, kick, and
   `room_updated` are already game-agnostic.

## Known limitations / future work

- **Deployment is pending** — nothing is on Render/Supabase/EAS yet, and the
  app has not been tested on a physical device.
- Rooms don't survive server restarts; there is no state snapshotting.
- One Socket.IO process only — no Redis adapter, no horizontal scale.
- No rate limiting on REST endpoints or socket events.
- The simulation covers the engine, not the socket layer or UI; there are no
  unit tests or E2E tests.
- `RoomStore.cleanup()` is time-based only; an abandoned in-game room lives
  for 4 idle hours.
