# Zuychin Arcade

Private online multiplayer board-game hub for friends. The local arcade includes
**Saboteur, Coup, King of Tokyo, Skull King, Citadels, Not Alone, BANG!,
Libertalia: Winds of Galecrest, and Colt Express**, plus local expansion
implementations of **Feed the Kraken, Telestrations, Cartographers Heroes and
Dixit Odyssey**. All four additions have completed local full-game browser checks.
No accounts or sign-up are
required: players join a room with a room code and display name.

The commercial-game implementations are private engineering prototypes. Public
hosting or distribution requires written digital implementation rights from the
respective rights holders.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a detailed tour of the codebase,
the game engine, the socket protocol, and how to add a new game to the hub.

## Four-game expansion

These local additions retain the existing room-code workflow and require no
new environment variables or dependencies. Full-game browser checks cover
creation, lobby, gameplay, results, recovery and rematch, separately from
engine and socket tests. See [testing evidence and limits](docs/TESTING.md#evidence-and-release-limits)
for the exact scenarios; these checks do not establish device or production readiness.

| Game | Players | Implemented rules baseline and room options |
| --- | --- | --- |
| Feed the Kraken | 5–11 | Base game with all 21 characters; quick voyage, or long voyage for 7–11 players |
| Telestrations | 4–12 | Dedicated 12-player edition; three rounds, friendly/competitive/no scoring, either passing direction, original prompt offers or a shared category |
| Cartographers Heroes | 1–100 | Standalone Heroes, maps C/D, all 19 drawing cards and 16 scoring objectives, four seasons and solo scoring |
| Dixit Odyssey | 3–12 | 2024 base rules, two voting dials, three-player double submissions, 30-point ending and an original 84-image deck |

The complete Dixit deck uses 84 distinct original illustrations, not the
publisher's artwork, with uniformly sized 512×768 card faces. Telestrations
uses original prompts from a shuffled pool, exhausted before reuse, and human
scoring decisions. There is no automatic semantic grading or imported prompt deck.

Explicit leave and expired reconnect grace forfeit a seat. Kraken forfeits do
not trigger a feeding victory. Telestrations cancels the unfinished round,
retains settled scores and restarts it with at least four remaining players.
Dixit cancels the unfinished round and continues with at least three.
Cartographers retains submitted map changes, reroutes unfinished ambush work,
and excludes forfeited seats from further scoring and victory. Each game
explains its departure policy in its own reference.

Kraken uses clockwise character-response priority and private responses from
every aboard player during rituals. The latter prevents phase transitions from
revealing whether a hidden role can act. Navigation cards share their illustrated
faces with the ship's reference; actual routes and effects remain live game state.
The voyage chart uses named destinations, numbered waypoints and a vessel token,
with zoom and a Find ship control for small screens.

The existing distribution-rights, HTTPS hosting and native signing/device
acceptance requirements still apply.

## Stack

| Piece    | Tech                                                          |
| -------- | ------------------------------------------------------------- |
| Monorepo | pnpm workspaces + Turborepo                                    |
| Mobile   | Expo SDK 56 (React Native 0.85), expo-router, NativeWind v4, Reanimated 4, zustand |
| Server   | Fastify 5 + Socket.IO 4, in-memory rooms, JWT auth             |
| Database | Supabase (PostgreSQL) - game results + leaderboard only, optional |
| Shared   | `@zuychin-arcade/types` - TypeScript contracts and game constants |

## Repository layout

```
zuychin-arcade/
├── packages/
│   └── types/            shared types + game constants (ships TS source, no build)
├── apps/
│   ├── server/           Fastify REST + Socket.IO server, authoritative game engine
│   │   ├── src/
│   │   │   ├── index.ts              entry point - Fastify + Socket.IO bootstrap
│   │   │   ├── routes/room.ts        REST endpoints (rooms, leave, leaderboard, health)
│   │   │   ├── socket/handlers.ts    socket auth middleware + per-game dispatch
│   │   │   ├── store/RoomStore.ts    in-memory room registry
│   │   │   ├── game/<game>/          per game: authoritative engine, projection, socket handlers
│   │   │   ├── lib/                  Supabase client + result persistence
│   │   │   └── utils/                JWT signing, room-code generator
│   │   └── scripts/<game>/           simulations and standalone socket smoke runners
│   └── mobile/           Expo app (web browser, Expo Go, or sideloaded APK)
│       ├── app/                      expo-router routes: arcade hub + per-game route groups
│       ├── components/               per-game pieces + shared UI, lobby and navigation
│       ├── store/useGameStore.ts     single zustand store (auth + room + game state)
│       ├── hooks/useSocket.ts        Socket.IO connection lifecycle
│       └── lib/                      REST client, dialogs, placement preview, storage
├── supabase.sql          schema + leaderboard view + RLS policies
├── turbo.json            task pipeline (build / dev / lint / typecheck)
└── tsconfig.base.json    shared strict TS config
```

## Prerequisites

- Node.js matching the root `engines` field: 20.19.4+, 22.13+, 24.3+ or 25+ in the declared major ranges (server build targets `node20`)
- Use **Node.js 25.6.0** for the verified regression-test workflow. The broader runtime/build range does not mean every allowed version runs the tests unchanged; see [Testing](docs/TESTING.md).
- pnpm 9 (`corepack enable` is the easiest way - the repo pins `pnpm@9.6.0`)
- A browser is enough to play (web is the easiest test surface - open multiple
  tabs for multiplayer). For phones: the **Expo Go** app, on the **same LAN**
  as your machine

## Run locally

```bash
pnpm install --frozen-lockfile
```

**1. Server** (terminal 1)

```bash
cp apps/server/.env.example apps/server/.env   # set JWT_SECRET; leave Supabase values empty for local-only use
pnpm --filter @zuychin-arcade/server dev       # loads apps/server/.env - http://localhost:3001
```

Without `SUPABASE_URL`/`SUPABASE_SECRET_KEY` the server runs fine; game results
are not persisted and `GET /leaderboard` returns a readable unavailable response
(HTTP 503, `RANKINGS_DISABLED`), distinct from a working leaderboard
with no results or a temporary query failure. The rankings page states that
rankings are currently disabled by the administrator. Players can still create rooms
and play; connecting storage does not restore results from earlier games.

The server otherwise fails closed unless both a 32-byte `JWT_SECRET` and an
origin allowlist are configured. `ARCADE_INSECURE_LOCAL_DEV=true` is an explicit
local-only shortcut: it uses a known JWT secret, accepts only loopback browser
origins, and forces the server to bind to `127.0.0.1`. It therefore cannot be
used for phone or LAN testing.

**2. Client** (terminal 2)

```bash
cp apps/mobile/.env.example apps/mobile/.env
# Set EXPO_PUBLIC_SERVER_URL=http://localhost:3001 for browser-only development.
cd apps/mobile && npx expo start               # Metro on http://localhost:8081
```

- **Web (easiest):** open http://localhost:8081 in a browser - three tabs make
  a playable 3-player game for games supporting that count. The client requires
  `EXPO_PUBLIC_SERVER_URL`; there is no implicit localhost fallback.
- **Phone (Expo Go):** scan the QR, and set the server URL first:

```bash
# EXPO_PUBLIC_SERVER_URL=http://<your-machine-LAN-IP>:3001  (NOT localhost -
# the phone must be able to reach your machine over the network)
```

Native Expo clients normally send no browser `Origin`. If Expo web is opened
through a LAN address, add that exact origin (including its port) to
`ARCADE_ALLOWED_ORIGINS`.

### Environment variables

| Variable | App | Required | Purpose |
| --- | --- | --- | --- |
| `PORT` | server | no (default 3001) | HTTP + WebSocket port |
| `JWT_SECRET` | server | **yes by default** | at least 32 bytes; signs HS256 room-session JWTs |
| `ARCADE_ALLOWED_ORIGINS` | server | **yes by default** | exact comma-separated web origins permitted to call REST and Socket.IO |
| `ARCADE_INSECURE_LOCAL_DEV` | server | no | explicit loopback-only fallback for local browser development |
| `ARCADE_TRUST_PROXY_CIDRS` | server | no | comma-separated verified proxy IPs or CIDRs used for forwarded client identity; defaults to no trust. Hostnames, aliases and `/0` ranges are rejected |
| `SUPABASE_URL` | server | no | results persistence; skipped when unset |
| `SUPABASE_SECRET_KEY` | server | no | backend-only results persistence; skipped when unset |
| `EXPO_PUBLIC_SERVER_URL` | mobile | yes | base URL for REST + Socket.IO |

## Common commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | all `dev` tasks via turbo (server watch + expo start) |
| `pnpm build` | all builds (server bundles to `apps/server/dist/` via tsup) |
| `pnpm typecheck` | `tsc --noEmit` in every workspace |
| `pnpm test:dependencies` | security-update compatibility checks for Metro assets, URL decoding, Xcode IDs and compiler binaries |
| `pnpm --filter @zuychin-arcade/server dev` | server only, watch mode |
| `pnpm --filter @zuychin-arcade/server simulate:saboteur` | Saboteur engine simulation test (see below) |
| `pnpm --filter @zuychin-arcade/server simulate:coup` | Base Coup (1,250 games, 2–6 players) and Reformation (270 games, 2–10 players) |
| `pnpm --filter @zuychin-arcade/server simulate:<game>` | Engine simulation for any implemented game slug |
| `pnpm --filter @zuychin-arcade/server smoke:<game>` | Real HTTP + Socket.IO integration suite where provided |
| `pnpm --filter @zuychin-arcade/server build && pnpm --filter @zuychin-arcade/server start` | production build + run |
| `cd apps/mobile && npx expo start` | Metro dev server / Expo Go |
| `pnpm --filter @zuychin-arcade/mobile export:web` | clean web export with input and generated API-origin checks |
| `pnpm --filter @zuychin-arcade/mobile export:native` | clean Android and iOS bundle checks, not signed builds or device tests |

## Testing & verification

Engine simulations and socket checks are exposed as
`simulate:<game>` / `smoke:<game>`. Most simulation scripts live under
`apps/server/scripts/<game>/`; the four expansion socket suites and Dixit
simulation coverage use their Node test files under `apps/server/src/game/<game>/`.
Server regression suites use Node's built-in test runner under
`apps/server/src/` and `apps/server/scripts/`; client component and tooling regressions are
`apps/mobile/scripts/*.test.cjs`. Reproducible commands, browser isolation and
the limits of these checks are in [docs/TESTING.md](docs/TESTING.md).

Node.js 25.6.0 is the verified regression runner. Some client tests load
TypeScript directly through Node, so the package's broader runtime/build
range is not a test-runner compatibility claim. The security overrides in `package.json`
retain the current Expo stack. Two narrow patches preserve Metro's image-file
loading and query-string's decoder import after their dependency updates;
the existing Expo file-map patch preserves OneDrive compatibility. Run
`pnpm test:dependencies` after reinstalling or changing these overrides, then
verify server tests and web/native exports. Keep all three patch files tracked.

**Engine simulation** - pure game logic, no server needed:

```bash
pnpm --filter @zuychin-arcade/server simulate:saboteur
```

This runs deterministic three-round games at every count from 3 to 10,
departure scenarios and focused rule regressions. It checks card and nugget
conservation, role counts, legal turns, private drafting and connectivity. Run it
after **any** change to `apps/server/src/game/saboteur/` or to the constants
in `packages/types`.

**Socket smoke test**: isolated HTTP + Socket.IO servers on ephemeral ports:

```bash
pnpm --filter @zuychin-arcade/server smoke:saboteur
```

It covers complete games and rematches at 3–10 players, creation and lobby
controls, revisions, privacy, reconnect and forfeits. It refuses configured
hosted persistence and needs no separately running server. Run it after
changes to the socket handlers, auth or room store.

**Coup** has parallel scripts: `simulate:coup` (pure engine - drives the
challenge/block phase machine with seeded legal inputs for Base 2–6 and Reformation 2–10 players,
asserting coin/card conservation, monotonic influence loss, no deadlocks, and a
single winner) and `smoke:coup` (isolated HTTP/socket regression suite covering
full games, rematches, lobby authority, challenge, exchange and examination privacy,
reconnect and forfeits). Run both after any change under
`apps/server/src/game/coup/` or the Coup socket handlers.

For the mobile app, use the `export:web` and `export:native` package scripts
with the intended HTTPS `EXPO_PUBLIC_SERVER_URL`. They clear Metro's cache
and check the generated output for the configured API origin. A successful
export proves bundling, not signed builds, physical-device behaviour or a
working production backend.

### Installable web app (PWA)

The web export includes a manifest, the approved controller/Z launcher icons,
an offline recovery page and a versioned service worker. Serve the complete
export at the root of an HTTPS origin. The standard `export:web` command builds
the worker after Expo finishes; a raw `expo export` needs the additional
`node scripts/build-pwa.cjs <export-directory>` step from `apps/mobile`.

Players can use **Install Arcade** at the bottom of the library sidebar when their browser supports
an install prompt, or follow **Add Arcade to your device** for browser-menu
instructions. On phones, open the navigation menu to find these controls.
The install control is hidden in standalone mode and after a recognised install.
Browsers with native install prompts show it only when installation is offered.
Browsers without installation detection may not recognise an existing home-screen
shortcut until it has been opened on the same browser storage profile.
iPhone and iPad users can use Share, Add to Home Screen. Native
iOS and Android builds remain available from the same codebase.

This is an online-first PWA, not an offline multiplayer mode. Only public
build assets and the connection-recovery page are cached. Room responses,
credentials, private hands and API traffic are never stored by the service
worker. Artwork is cached on demand, not downloaded in full at installation.
An update waits for explicit approval from the library and safe responses
from every open Arcade tab. Finish or leave rooms and return to the library
in all tabs before updating. An active match is never automatically reloaded.

Hosting must serve `/service-worker.js` as JavaScript with revalidation
(`Cache-Control: no-cache`), not rewrite it to the app HTML. Also revalidate
HTML and `/manifest.webmanifest`; fingerprinted assets may use long-lived
immutable caching. Keep the export's `/offline.html` and `/icons/` files intact.
Test installation and background/reconnect behaviour on real target devices
before release. Browser automation and platform exports do not prove those
device behaviours.

## Deployment (not yet done)

**Server - Render**
1. Push the repo to GitHub, create a Web Service on render.com
2. Build: `corepack enable && pnpm install && pnpm --filter @zuychin-arcade/server build`
3. Start: `node apps/server/dist/index.js`
4. Env vars: `JWT_SECRET`, `ARCADE_ALLOWED_ORIGINS`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.
   Set `ARCADE_TRUST_PROXY_CIDRS` only after verifying the actual proxy addresses
   and that those proxies overwrite forwarded headers. Leave it unset otherwise.
   Do not guess provider CIDRs or use a universal range. Legacy
   `ARCADE_TRUST_PROXY_HOPS` now fails startup and must be removed or migrated;
   a hop count cannot establish a trusted proxy's identity.
5. Run exactly one always-on server replica. Active rooms are currently process-local,
   so a sleeping, restarting or horizontally scaled service will lose or split games.

**Database - Supabase**
1. Create a free project, run `supabase.sql` in the SQL editor
2. Create a backend secret key and set it as `SUPABASE_SECRET_KEY` in Render.
   Never put this key in an `EXPO_PUBLIC_*` variable or client bundle.
3. If the project previously used the anonymous result policies, also run
   `supabase/migrations/20260907_harden_results_access.sql` before redeploying.
4. Existing projects must also apply `supabase/migrations/20260920_atomic_game_results.sql`
   before deploying the server. New projects receive this function from `supabase.sql`.
   Result saves use one atomic RPC and retry with the same result ID, preventing
   partial or duplicate scores after a lost response. Retries are bounded; a long
   outage or process shutdown can still lose an unsaved result.
5. Run `supabase/verify_results_security.sql`; public-role table privileges must be
   false, only `service_role` may execute the result RPC, and no anonymous result
   policy should remain. `supabase/verify_atomic_results.sql` checks retry behaviour
   with synthetic rows inside a rolled-back transaction. These scripts must be
   run against the intended database before release; local mocks do not verify it.

**Native preview builds (EAS)**

Local JavaScript/Hermes exports are not signed applications. Before requesting
a cloud build, link the intended Expo project and configure the real HTTPS
`EXPO_PUBLIC_SERVER_URL` in its `preview` EAS environment. Account linking,
cloud uploads and signing are separate from the local verification commands.
The EAS pre-install hook rejects a missing, non-HTTPS or malformed API origin
before installing dependencies. Configure the `production` environment separately
before a production build.

After authorising a preview build:

```bash
cd apps/mobile
npx eas-cli build --platform android --profile preview
```

Use `--platform ios` for an iOS preview after configuring signing. Install and
test the resulting application on the target devices before a production build.

This checkout is not configured for EAS Update: it has no `expo-updates`
dependency, update URL, runtime version or build channels. `eas update` is not
an Expo Go sharing shortcut. Enabling remote updates requires the separate
[EAS Update setup](https://docs.expo.dev/eas-update/getting-started/) and an
explicitly authorised publish operation. No store submission or remote update
is performed by the local export checks.

## Gotchas

- **`packages/types` must keep `"type": "module"`** - it ships raw TS source
  (`main` points at `src/index.ts`); without that field, tsx loses named
  runtime exports (`ROLE_TABLE`, `BOARD`, …) and the server crashes at import.
- The server build uses **tsup with `noExternal: ['@zuychin-arcade/types']`**
  to bundle the TS-source types package into `dist/` - plain `tsc` would not
  compile a dependency's sources. Keep this if you add more TS-source packages.
- Rooms live **in memory only**. A server restart drops every active game;
  clients get `Room or player no longer exists` and fall back to the home
  screen. Idle rooms are garbage-collected after 4 hours.
- JWTs expire after **24h** and are scoped to one room. The mobile app stores
  them in device-only SecureStore on iOS/Android and tab-scoped sessionStorage
  on web. Expired sessions are discarded on resume; display-name preferences
  use AsyncStorage separately.
- **`Alert.alert` is a no-op on react-native-web** - buttons silently do
  nothing in the browser. Use `showDialog()` from `apps/mobile/lib/dialog.ts`
  for every confirm/error popup.
- **NativeWind `className` is unreliable on reanimated `Animated.View`s** -
  positioning classes can be silently dropped. Full-screen overlays use the
  explicit `OVERLAY_FILL` style from `apps/mobile/constants/theme.ts`.
- Several digital rule adaptations are **deliberate** -
  do not "fix" them back. See the notes below and
  [ARCHITECTURE.md → Design decisions](./ARCHITECTURE.md#design-decisions--rule-deviations).

## Custom game artwork

The original nine games include 252 individual illustrations in addition to the original
shared scenes and category artwork. Named cards and characters, uniform hidden
card backs, faction seals and board scenery use original generated artwork.
Rules, costs, ranks, paths and interaction states remain live interface elements.
Card faces combine directional bevels and game-specific neon accents without
requiring a 3D rendering engine. King of Tokyo, Skull King, Citadels, Not Alone,
BANG!, Libertalia and Colt Express use full-width, uncropped illustrations
inside a single card surface, with separate live headers and rules. Comparable
cards retain consistent row heights as text grows.

The four additions use their own original cover scenes and game-specific assets:

- Feed the Kraken: 21 individual character portraits in the reference and
  authorised private/revealed character views, plus three reusable course scenes.
- Cartographers Heroes: 19 individual drawing-card illustrations and four
  shared scoring-category scenes. Placement shapes and scoring diagrams remain
  live graphics, not claims about the geometry shown in the illustrations.
- Dixit Odyssey: 84 distinct playable dream illustrations.
- Telestrations: original entrance artwork and player-created drawings, with
  a clear drawing surface instead of decorative images inside the sketchbook.

Runtime WebP images are stored in `apps/mobile/assets/game-art`; source PNGs,
prompts and the identity catalogue are in `docs/design/game-art`. The encoding
pipeline records content hashes, preserves the full composition and enforces
per-image and per-family byte budgets. Internal generation receipts stay local.
The [four-game artwork inventory](docs/design/game-art/FOUR_GAMES_ARTWORK.md)
links each new source, runtime asset and exact generation prompt.

## Game rules notes

Each game's **How to play** opens an illustrated guide built around its own
mechanics, followed by the detailed rules. Examples cover connected tunnels,
dice, trick hierarchy, secret drafting, pursuit, shooting distance, ranked crew
and shared programming. Coup reuses its character reference with the selected
version's cards, actions and blocks before players enter a room.

Coup room creation offers **Base Coup (2–6 players)** and **Reformation +
Inquisitor (2–10 players)**. Base remains the default. The selected version is
fixed for the room, shown to joining players, and retained for rematches.
Reformation includes allegiances, conversion, a Treasury Reserve and the
Inquisitor in place of the Ambassador. It still has one individual winner.
See the [publisher overview](https://indieboardsandcards.com/our-games/coup-reformation/)
and [printed expansion rules](https://www.spelhuis.be/Files/7/112000/112353/Attachments/Product/aD1jf4U81u46a97ia1719S97Nm9925v8.pdf).

Coup's digital decision windows last 30 seconds. Expiry selects Reformist during
allegiance setup, shows the examined player's first hidden influence, or returns
an inspected card without replacement. Other timed defaults retain the original
exchange hand, prove a valid claim or concede, and reveal the first hidden card
when influence must be lost. Explicit leave or expired reconnect grace instead
forfeits immediately. Base Coup's existing rules and departure policy are unchanged.

Saboteur follows the [AMIGO 2025 base rules, version 4.0](https://blog.amigo-spiele.de/content/ap/rule/04900-GB-AmigoRule.pdf),
with the digital adaptations below. [Testing and release limits](docs/TESTING.md#evidence-and-release-limits)
distinguish engineering checks from publisher fidelity and distribution rights.

- Each round shuffles the official `ROLE_TABLE` pool of players + 1 cards,
  deals one role per player, and sets one aside unseen. Only a zero-saboteur
  deal is repeated, preserving variable role counts while ensuring every
  digital round has opposition.
- The current gold picker sees the available values privately. Other players
  see only the number of cards remaining. Personal totals stay private until
  game over. Both miner drafts and Saboteur rewards consume the finite gold deck.
- Every turn (including a pass/discard) ends by drawing a card, per the
  official rules. This supersedes an earlier "no draw on pass" implementation note.
- The playable board is deliberately capped at 5 by 9 cells for mobile
  observability. Revealed goals retain their printed paths, including the
  two mirrored stone corners, rather than becoming four-way junctions.
- A round ends for the saboteurs when the deck is empty and every hand is
  empty.
- The server keeps hands and Map peeks private to their owner. Roles also
  stay private during active rounds, then are revealed at round end.
- Explicit leave or expired reconnect grace immediately forfeits the seat:
  no further turns, deals, rewards or victory eligibility. Fewer than three
  active players ends the match without a winner or competitive result.
- Commands require the current revision. Rematches continue the room's
  revision sequence; the client adopts public and private snapshots together.

Skull King's disclosed `classic-core-3-8-v2` digital mode supports 3–8 players
without Graybeard, advanced cards or pirate powers. Explicit leave or expired
reconnect grace forfeits immediately. Legal automatic play completes only the
current round, then the seat leaves the rotation. Historical scores remain,
but the forfeited seat earns no further points and cannot win. Fewer than three
eligible captains ends immediately without a winner or scoring the unfinished
round. These departure rules are digital adaptations, not printed game rules.

Citadels' `revised-2016-custom-4-7-digital-v2` mode supports 4–7 players.
Explicit leave or expired reconnect grace forfeits immediately. Legal automatic
play finishes only the current round, then removes the seat before the next
character draft. Its unbuilt cards return to the deck bottom; its city remains
visible as inactive history, not a legal target. The crown passes clockwise to
an eligible builder. Fewer than four eligible builders ends immediately without
a winner, final scoring or a competitive result. These are digital departure
rules; temporary disconnections remain recoverable within the grace period.

Not Alone immediately makes a departed seat ineligible. A forfeited Hunted
finishes only the current round through legal automatic play, then leaves the
active rotation. The original rescue and assimilation targets remain unchanged.
The Creature's departure awards the remaining Hunted the game; every Hunted
departing awards the eligible Creature the game. If everyone departs, there is
no winner. These are digital departure rules, not printed-game procedures.

Libertalia's `winds-of-galecrest-calm-v3.0` mode supports 2–6 players and
calm-side loot. The full prepared voyage loot, ships and scores are public;
hands and graveyards remain private. Its disclosed digital rules include:

- Wind Nymph clashes use the owners present at night's start. Each conflicting
  owner discards their own copy when resolving it, preserving their other
  night-ability ordering.
- An empty hand skips only impossible island selection, not ship abilities or
  scoring. This is a fulfil-as-possible interpretation, not a published FAQ ruling.
- Freed Prisoner resolves after ordinary night abilities. A Witch copy already
  committed for that timing survives removal of its original source, an explicit
  implementation interpretation.
- Leaving or expired reconnect grace forfeits immediately. A seat leaves at once
  during selection; after reveal, legal automatic choices finish only that day.
  Prepared loot and player-count mode stay fixed until the next voyage. Archived
  seats cannot earn later scores or win. One eligible survivor wins by forfeit;
  none ends without a winner. Completed results do not change on departure.

Run `test:libertalia:engine`, `simulate:libertalia`, `test:libertalia` and
`smoke:libertalia` in the server package after relevant changes. Scripted engine
and protocol campaigns do not replace an independently chosen full game or
browser/device interaction. See [Testing](docs/TESTING.md) for reproducible checks
and remaining release limits.

Colt Express's `base-2016-digital-v2` mode supports 2–6 players and five rounds.
Three to six players choose unique characters before the train is placed and
hands are dealt. Concurrent claims use the first accepted choice; a rejected
claim refreshes the available characters. Two players instead choose paired
two-bandit teams, secret starting formations and a reserve card each round.
The optional three-player team mode, Expert mode and expansions are excluded.

Leaving or expired reconnect grace forfeits immediately. Only already-programmed
actions finish automatically; no new cards are programmed for that seat, and
its bandits retire before the next round. Forfeits during setup retire at once.
The initial train, round-card band and team mode stay fixed. A sole eligible
survivor wins by forfeit; no survivors means no winner or competitive result.
These departure rules are digital adaptations. Completed results stay unchanged.

Hands, reserves, face-down programs and owned purse values remain private.
Commands require the current revision, rematches continue its sequence, and
the client restores matching public/private snapshots before enabling controls.
Use `simulate:colt-express` and `smoke:colt-express` in the server package;
the [all-file regression command](docs/TESTING.md#regression-checks) also runs Colt's
canonical and protocol tests.
