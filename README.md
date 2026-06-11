# zuychin-arcade ⛏️

Private online multiplayer board-game hub for friends. First game: **Saboteur**
(3–10 players, hidden roles, 3 rounds). No accounts or sign-up — players join a
room with a room code and a display name only.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a detailed tour of the codebase,
the game engine, the socket protocol, and how to add a new game to the hub.

## Stack

| Piece    | Tech                                                          |
| -------- | ------------------------------------------------------------- |
| Monorepo | pnpm workspaces + Turborepo                                    |
| Mobile   | Expo SDK 56 (React Native 0.85), expo-router, NativeWind v4, Reanimated 4, zustand |
| Server   | Fastify 5 + Socket.IO 4, in-memory rooms, JWT auth             |
| Database | Supabase (PostgreSQL) — game results + leaderboard only, optional |
| Shared   | `@zuychin-arcade/types` — TypeScript contracts + verified Saboteur constants |

## Repository layout

```
zuychin-arcade/
├── packages/
│   └── types/            shared types + game constants (ships TS source, no build)
├── apps/
│   ├── server/           Fastify REST + Socket.IO server, authoritative game engine
│   │   ├── src/
│   │   │   ├── index.ts              entry point — Fastify + Socket.IO bootstrap
│   │   │   ├── routes/room.ts        REST endpoints (create/join/kick/leaderboard)
│   │   │   ├── socket/               socket auth middleware + in-game event handlers
│   │   │   ├── store/RoomStore.ts    in-memory room registry
│   │   │   ├── game/saboteur/        pure game engine (no IO)
│   │   │   ├── lib/                  Supabase client + result persistence
│   │   │   └── utils/                JWT signing, room-code generator
│   │   └── scripts/simulate.ts       engine smoke test (240 random games)
│   └── mobile/           Expo app (Expo Go / sideloaded APK, no app store)
│       ├── app/                      expo-router routes: (tabs) hub + saboteur/ game
│       ├── components/               board, cards, lobby, overlays, ui primitives
│       ├── store/useGameStore.ts     single zustand store (auth + room + game state)
│       ├── hooks/useSocket.ts        Socket.IO connection lifecycle
│       └── lib/                      REST client, placement preview, AsyncStorage
├── supabase.sql          schema + leaderboard view + RLS policies
├── turbo.json            task pipeline (build / dev / lint / typecheck)
└── tsconfig.base.json    shared strict TS config
```

## Prerequisites

- Node.js 20+ (server build targets `node20`)
- pnpm 9 (`corepack enable` is the easiest way — the repo pins `pnpm@9.6.0`)
- For mobile: the **Expo Go** app on your phone, on the **same LAN** as your machine

## Run locally

```bash
pnpm install
```

**1. Server** (terminal 1)

```bash
cp apps/server/.env.example apps/server/.env   # set JWT_SECRET; Supabase vars optional
pnpm --filter @zuychin-arcade/server dev       # tsx watch — http://localhost:3001
```

Without `SUPABASE_URL`/`SUPABASE_ANON_KEY` the server runs fine; game results
are simply not persisted and `GET /leaderboard` returns `[]`.

**2. Mobile** (terminal 2)

```bash
cp apps/mobile/.env.example apps/mobile/.env
# EXPO_PUBLIC_SERVER_URL=http://<your-machine-LAN-IP>:3001  (NOT localhost —
# the phone must be able to reach your machine over the network)
cd apps/mobile && npx expo start               # scan the QR with Expo Go
```

### Environment variables

| Variable | App | Required | Purpose |
| --- | --- | --- | --- |
| `PORT` | server | no (default 3001) | HTTP + WebSocket port |
| `JWT_SECRET` | server | **yes in prod** | signs room-session JWTs; insecure dev fallback otherwise |
| `SUPABASE_URL` | server | no | results persistence; skipped when unset |
| `SUPABASE_ANON_KEY` | server | no | results persistence; skipped when unset |
| `EXPO_PUBLIC_SERVER_URL` | mobile | yes | base URL for REST + Socket.IO |

## Common commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | all `dev` tasks via turbo (server watch + expo start) |
| `pnpm build` | all builds (server bundles to `apps/server/dist/` via tsup) |
| `pnpm typecheck` | `tsc --noEmit` in every workspace |
| `pnpm --filter @zuychin-arcade/server dev` | server only, watch mode |
| `pnpm --filter @zuychin-arcade/server simulate` | engine simulation test (see below) |
| `pnpm --filter @zuychin-arcade/server build && pnpm --filter @zuychin-arcade/server start` | production build + run |
| `cd apps/mobile && npx expo start` | Metro dev server / Expo Go |
| `cd apps/mobile && npx expo export --platform android` | bundle health check (catches Metro/import errors without a device) |

## Testing & verification

There is no unit-test framework; the engine is verified by **simulation**:

```bash
pnpm --filter @zuychin-arcade/server simulate
```

This plays 240 full 3-round games (30 per player count, 3–10 players) with
random legal moves and asserts rules invariants (deck composition, role
counts, turn legality, gold distribution totals, board connectivity). Run it
after **any** change to `apps/server/src/game/saboteur/` or to the constants
in `packages/types`.

For the mobile app, `npx expo export --platform android` is the cheapest
"does it still bundle" check before testing on a device.

## Deployment (all free tier — not yet done)

**Server — Render**
1. Push the repo to GitHub, create a Web Service on render.com
2. Build: `corepack enable && pnpm install && pnpm --filter @zuychin-arcade/server build`
3. Start: `node apps/server/dist/index.js`
4. Env vars: `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`
5. Free tier sleeps after 15 min — first request takes ~30s, or ping it with UptimeRobot

**Database — Supabase**
1. Create a free project, run `supabase.sql` in the SQL editor
2. Copy URL + anon key into Render env vars

**Mobile — Expo (no store)**
```bash
cd apps/mobile
npx eas update --channel preview --message "latest"   # share exp.host link
eas build --platform android --profile preview        # or a sideloadable APK
```

## Gotchas

- **`packages/types` must keep `"type": "module"`** — it ships raw TS source
  (`main` points at `src/index.ts`); without that field, tsx loses named
  runtime exports (`ROLE_TABLE`, `BOARD`, …) and the server crashes at import.
- The server build uses **tsup with `noExternal: ['@zuychin-arcade/types']`**
  to bundle the TS-source types package into `dist/` — plain `tsc` would not
  compile a dependency's sources. Keep this if you add more TS-source packages.
- Rooms live **in memory only**. A server restart drops every active game;
  clients get `Room or player no longer exists` and fall back to the home
  screen. Idle rooms are garbage-collected after 4 hours.
- JWTs expire after **24h** and are scoped to one room. The mobile app stores
  them in AsyncStorage and discards expired ones on resume.
- Several rules deviations from `zuychin-arcade-spec.md` are **deliberate** —
  do not "fix" them back. See the notes below and
  [ARCHITECTURE.md → Design decisions](./ARCHITECTURE.md#design-decisions--rule-deviations).

## Game rules notes

Saboteur constants in `packages/types/src/saboteur-constants.ts` were verified
against ultraboardgames.com, Wikipedia, Board Game Arena, and zatu.com
(2026-06-11). Implementation details worth knowing:

- Role cards dealt = players + 1, one set aside unseen — so a round can have
  one fewer saboteur than the table value (including zero in 3–4 player games;
  in that case nobody scores when the gold isn't reached).
- Every turn (including a pass/discard) ends by drawing a card, per the
  official rules — the spec's §8 "no draw on pass" note was overridden by the
  authoritative sources it cites.
- Revealed goal cards are modelled as connecting on all four sides (the
  physical rule lets you orient them to fit the tunnel).
- A round ends for the saboteurs when the deck is empty and every hand is
  empty.
- The server is fully authoritative: hands, roles, and map peeks are only ever
  sent to the owning player via per-socket `private_state` events.
