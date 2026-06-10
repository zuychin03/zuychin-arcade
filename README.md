# zuychin-arcade ⛏️

Private online multiplayer board game hub for friends. First game: **Saboteur**
(3–10 players, hidden roles). No sign-up — room code + display name only.

## Stack

| Piece    | Tech                                                        |
| -------- | ----------------------------------------------------------- |
| Monorepo | pnpm workspaces + turbo                                      |
| Mobile   | Expo SDK 56 (React Native), expo-router, NativeWind, zustand |
| Server   | Fastify + Socket.IO, in-memory rooms, JWT auth               |
| Database | Supabase (PostgreSQL) — game results + leaderboard only      |

```
packages/types     shared TypeScript types + verified Saboteur constants
apps/server        REST + Socket.IO server, authoritative game engine
apps/mobile        Expo app (Expo Go / local APK, no app store)
```

## Run locally

```bash
pnpm install

# 1. server
cp apps/server/.env.example apps/server/.env   # set JWT_SECRET (supabase optional)
pnpm --filter @zuychin-arcade/server dev       # http://localhost:3001

# 2. mobile — set your machine's LAN IP so phones can reach the server
cp apps/mobile/.env.example apps/mobile/.env   # EXPO_PUBLIC_SERVER_URL=http://192.168.x.x:3001
cd apps/mobile && npx expo start               # scan QR with Expo Go
```

### Engine simulation test

Plays 240 full games (all player counts) with random legal moves and asserts
rules invariants:

```bash
pnpm --filter @zuychin-arcade/server simulate
```

## Deployment (all free tier)

**Server — Render**
1. Push the repo to GitHub, create a Web Service on render.com
2. Build: `corepack enable && pnpm install && pnpm --filter @zuychin-arcade/server build`
3. Start: `node apps/server/dist/index.js`
4. Env vars: `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`
5. Free tier sleeps after 15 min — first request takes ~30s, or ping it with UptimeRobot

**Database — Supabase**
1. Create a free project, run `supabase.sql` in the SQL editor
2. Copy URL + anon key into Render env vars

**Mobile — Expo Go (no store)**
```bash
cd apps/mobile
npx eas update --channel preview --message "latest"   # share exp.host link
eas build --platform android --profile preview        # or a sideloadable APK
```

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
