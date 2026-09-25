# Testing

Run these checks from a clean dependency installation before relying on a
change. Passing source tests, exporting bundles and exercising a browser are
different forms of evidence. None alone proves device or deployment readiness.

## Prerequisites

- Use Node.js **25.6.0**, the verified regression-runner version, and the
  repository-pinned pnpm **9.6.0**.
- The root `engines` range describes runtime/build compatibility. Some client
  CJS tests load TypeScript directly using Node support, so do not assume every
  allowed runtime can run the regression suite unchanged. Other runner versions
  are not verified by this guide.
- Install dependencies with `pnpm install --frozen-lockfile`. Keep the three
  tracked dependency patches under `patches/`; do not replace them with local
  edits inside `node_modules`.
- The commands below use PowerShell and run from the repository root unless
  stated otherwise. No ignored QA notes or temporary helper scripts are needed.

## Regression checks

```powershell
node --version
if ((pnpm --version).Trim() -ne '9.6.0') { throw 'Use pnpm 9.6.0.' }
pnpm typecheck
pnpm --filter @zuychin-arcade/mobile lint
pnpm test:dependencies

$clientTests = @(Get-ChildItem apps/mobile/scripts -Recurse -File -Filter '*.test.cjs' | Sort-Object FullName | Select-Object -ExpandProperty FullName)
node --test --test-concurrency=1 @clientTests

Push-Location apps/server
try {
  $serverTests = @(Get-ChildItem src,scripts -Recurse -File -Filter '*.test.ts' | Sort-Object FullName | Select-Object -ExpandProperty FullName)
  node --import tsx --test --test-concurrency=1 @serverTests
} finally {
  Pop-Location
}
```

Check each command's exit code. Run the suites sequentially to limit memory
pressure and avoid competing local test services. The server tests create
isolated loopback services where needed; a separately running development
server is not required. Do not supply hosted persistence credentials to tests.

The full server sweep includes canonical and protocol regressions that are not
all exposed through individual package aliases. For longer per-game campaigns:

```powershell
pnpm --filter @zuychin-arcade/server simulate:saboteur
pnpm --filter @zuychin-arcade/server smoke:saboteur
```

Replace `saboteur` with `coup`, `king-of-tokyo`, `skull-king`, `citadels`,
`not-alone`, `bang`, `libertalia` or `colt-express`. Simulations exercise the
authoritative engine. Socket smoke scripts use real HTTP and Socket.IO against
isolated local servers. They do not replace human or browser interaction.

The four expansion slugs are `feed-the-kraken`, `telestrations`,
`cartographers-heroes` and `dixit-odyssey`. Each has `test:<game>`,
`simulate:<game>` and `smoke:<game>` aliases. Dixit's simulation alias runs
its engine regression file, including seeded complete matches. The completed
local browser scenarios and their boundaries are recorded below.

Focused client checks, from the repository root:

```powershell
node --test --test-concurrency=1 apps/mobile/scripts/dixit-client.test.cjs apps/mobile/scripts/kraken-client.test.cjs apps/mobile/scripts/telestrations-client.test.cjs apps/mobile/scripts/telestrations-review.test.cjs apps/mobile/scripts/cartographers-client.test.cjs
node --test --test-concurrency=1 apps/mobile/scripts/dixit-artwork.test.cjs apps/mobile/scripts/game-art-assets.test.cjs apps/mobile/scripts/kraken-material.test.cjs apps/mobile/scripts/voyage-map.test.cjs apps/mobile/scripts/font-registration.test.cjs
node --test --test-concurrency=1 apps/mobile/scripts/kraken-character-art.test.cjs apps/mobile/scripts/cartographers-artwork.test.cjs apps/mobile/scripts/game-toolbar.test.cjs apps/mobile/scripts/typecheck-scope.test.cjs
```

The client harnesses exercise real hooks/components with controlled transports.
They prove neither browser paint nor physical touch behaviour. The expansion's
loopback browser runner, `apps/mobile/scripts/four-games-ui-smoke.cjs`, uses an
explicit web export compiled against `https://localhost:3214` and an independently
running local-only API on port 3213. It owns its temporary static server and TLS
proxy. Do not run another proxy on port 3214 at the same time. Its JSON receipts
and screenshots record the exact scope; it is automated UI coverage, not an
independent human playtest.

`apps/mobile/scripts/dixit-ui-smoke.cjs` uses the same API and exclusive TLS
proxy ports. It plays a three-seat match through visible controls, validates
scores independently and observes authorised projections without injecting
game commands. Run these browser scripts one at a time against the explicit
export path. The full-game runner and the manual tester must not compete for
the same proxy.

`apps/mobile/scripts/kraken-ui-smoke.cjs <export-path> --run` also requires
exclusive ownership of that proxy. It creates five isolated seats through the
UI, plays a natural voyage, then rematches and tests a departure. It checks
private-state boundaries, winner eligibility, reloads, ship visibility and
navigation-card geometry. Randomly unencountered phases are listed separately
in the report; a successful run does not imply every character or map event
appeared. Omitting `--run` prevents accidental execution.

The optional `supabase.sql` results function now accepts the additions' maximum
seat counts. Reviewing that SQL file or testing a mocked result writer does not
prove a hosted migration. Apply it separately only when authorised.

Coup's simulation command runs both Base (2–6 players) and Reformation +
Inquisitor (2–10). Its socket suite covers complete games and rematches for
both variants, plus revision fencing and owner-only examination decisions.
`src/routes/coup-creation.test.ts` verifies creation defaults, version validation,
room capacity and configuration retained for joins/recovery.

## Export checks

Set `EXPO_PUBLIC_SERVER_URL` to the intended HTTPS API origin before exporting.
It is public client configuration, never a backend credential. See the
[README setup](../README.md#run-locally) and [environment table](../README.md#environment-variables).

```powershell
pnpm --filter @zuychin-arcade/mobile export:web
pnpm --filter @zuychin-arcade/mobile export:native
```

Both scripts clear Metro's cache and validate the configured API origin in the
generated output. The native script exports Android and iOS JavaScript/Hermes
bundles, including on Windows. It does not compile an APK/IPA, invoke Xcode,
sign an application or install it on a device. Hermes validation checks the
binary signature and URL bytes, not a parsed string-table boundary.

These commands describe repeatable checks, not a claim that a particular
checkout has passed them. Record the revision, environment and actual outcome
of each run. An HTTPS URL embedded in a bundle does not prove that the backend
is reachable or correctly deployed.

Local verification on 23/09/2026 completed web and Android/iOS Hermes exports
for the Coup expansion and illustrated rulebooks, with API-origin guards using
local HTTPS QA configuration. The final public-notice wording was subsequently
re-exported and browser-checked on web; native exports predate that copy-only
adjustment. No signing, upload or device test was performed by those checks.

## Browser and visual checks

Use the [card gallery guide](../tools/card-gallery/README.md) for isolated
production-component sizing scenes. Gallery evidence does not replace actual
game-route, privacy, focus, command or full-match checks.

Browser runners live under `apps/mobile/scripts/`; game-specific fixture
servers live under `apps/server/scripts/`. Read the chosen runner's explicit
environment guards and scenario contract before starting it. There is no
single flag set that safely launches every campaign.

`apps/mobile/scripts/coup-reformation-ui-smoke.cjs` exercises either Coup version
through real browser controls. Set `COUP_UI_VARIANT` to `base` or `reformation`,
`COUP_EVIDENCE_DIR` to a fresh local directory, `COUP_UI_EXCLUSIVE_WINDOW=granted`,
`COUP_EXPECTED_SHA256` to the freshly exported JavaScript bundle's SHA-256, and
`QA_BROWSER_CERT_SPKI` to the pin printed by `local-qa-proxy.cjs`. Its defaults use
the loopback web preview on 8081 and persistence-disabled API on 3213, with the
client API proxied through local HTTPS 3214. It does not start those services.
It covers a natural four-seat match, version selection, lobby, new private
decisions, examination reload, rematch and normal leave, not every possible deal.

`apps/mobile/scripts/rulebooks-ui-smoke.cjs` uses the same evidence-directory,
exclusive-window, bundle-hash and certificate-pin guards. It opens all nine
rulebooks from their entrances at phone, narrow-phone 200% CSS text, desktop,
desktop 200% CSS text and short-landscape sizes. It captures the authored
examples, expands detailed chapters, checks their web accessibility state,
and verifies keyboard dismissal and focus return. It also checks the privacy
contact and the public `RANKINGS_DISABLED` notice against a database-free
local server. Expected HTTP 503 diagnostics are recorded separately; unrelated
browser errors remain failures. Review the saved images, not just the receipt.
Set `RULEBOOKS_SYSTEM_PAGES_ONLY=true` for a focused privacy/rankings check.

- Use loopback-only local services with persistence disabled. Fixture servers
  require their explicit opt-in flags as well as local-development guards.
  Never point a fixture or destructive cleanup runner at a hosted room.
- Use one browser-owning run at a time, separate authenticated contexts for
  players, and bounded command, image and time budgets. A browser is a separate
  dependency; `puppeteer-core` does not install one.
- Keep the product source and exported bundle fixed throughout a run. Verify
  source hashes and served/disk bundle hashes before and after capture.
- Review the saved images as well as assertions. Check full card faces, rules,
  actions, scroll endpoints and result controls at the declared viewport and
  text scale. Distinguish off-screen scroll content from genuine clipping.
- CSS 200% text and emulated touch are web checks, not native text scaling or
  physical-device evidence. Measured DOM geometry does not prove every glyph
  or control was visibly framed in a screenshot.
- Preserve failed attempts and raw diagnostics. Do not turn a fixture checkpoint
  into a claim of a naturally completed match, or a forfeit into natural scoring.
- Finish with normal UI leave and cleared authentication where required, release
  any runner-owned socket seats, close contexts and the owned browser, and
  verify final source/bundle hashes. Fallback cleanup is not a normal-exit pass.

Temporary evidence, browser profiles and local TLS material are not publication
inputs. Do not commit session tokens, backend secrets or unredacted private
runtime data. A new checkout should generate its own evidence.

## Progressive web app checks

Run the production web export before testing service-worker behaviour. Verify
the generated manifest, icon dimensions, viewport metadata and service-worker
asset allowlist. The worker is generated by the normal `export:web` script.

```powershell
node --test apps/mobile/scripts/pwa-worker.test.cjs apps/mobile/scripts/pwa-client.test.cjs apps/mobile/scripts/brand-assets.test.cjs
$env:PWA_QA_OUTPUT = '.tmp-qa-evidence/pwa-browser-fresh-run'
node apps/mobile/scripts/pwa-ui-smoke.cjs apps/mobile/dist
```

Use a fresh evidence directory for each run. Set `QA_BROWSER_PATH` if Chrome
is installed somewhere other than the runner's Windows default. The browser
runner serves the explicit export on a temporary loopback origin. Its busy-tab
scenario is a labelled route fixture, not a completed multiplayer match. Install
offer and completion events are fixtures, not actual operating-system installs.

Check installation help, keyboard access and update controls at the bottom of
the library sidebar and mobile navigation drawer, including 200% text. Confirm
that the closed drawer and gameplay display no installation controls. Check
standalone mode, returning installed visits, cross-tab installation events,
failed prompts, blocked storage and fresh install offers after uninstall.
Update controls must remain available when the install button is hidden.

With separate browser tabs, verify that an active room, reconnecting session,
unrestored session or unresponsive client blocks an update. Confirm that
approval expires, changed client membership cancels activation, and only
approved idle tabs reload.

Verify that offline navigation shows the recovery page, retry restores online
navigation, and caches contain only allowlisted public assets. API responses,
room state and credentials must never enter the service-worker cache.

Record browser, exported bundle and worker versions with the evidence.
Browser emulation does not prove installation or standalone behaviour on
physical iOS or Android devices.

## Evidence and release limits

- The seven-game card revision on 25/09/2026 passed all 1,573 client tests,
  mobile/gallery TypeScript, scoped ESLint and six gallery-server safety tests.
  A fresh component-gallery web export passed 40 browser cases: seven game
  families plus Citadels roles, Not Alone powers and Colt characters at 375 px
  normal text, 320 px with 200% CSS text, and 1280 px with both text sizes.
  All 132 illustration fields retained square, full-width geometry; images
  and fonts loaded without browser runtime errors. Normal-text family cases
  also checked glyph containment, painted same-row dimensions, 48 px controls
  and 28 local selection actions. Screenshots received independent visual review.
  These are production components with synthetic data, not complete matches.
- A separate local development-app preview showed the revised cards in actual
  King of Tokyo, Skull King, Citadels, Not Alone and BANG! matches. Libertalia
  reached its lobby and Colt Express its entrance before testing was stopped.
  This was an initial-game visual review, not a completed lifecycle campaign.
  Existing SVG accessibility-prop and pointer-events deprecation warnings were
  observed in development. No new physical iOS/Android or production deployment
  acceptance is implied by this revision's component export and browser checks.
- The 24/09/2026 artwork and follow-up fixes passed all 1,565 client tests
  across 106 files, mobile/server TypeScript and scoped lint. All 44 new images
  have verified source/output hashes, dimensions and byte budgets. The Kraken
  captain-eligibility fix passed 35 engine tests, 13 HTTP/socket tests and the
  previously failing natural-action reproduction. An earlier socket timeout
  passed its isolated and full-suite reruns; its cause was not established.
- The follow-up web export includes all 64 routes, with server-URL validation
  and PWA generation passing. Native exports were not repeated for this
  artwork and layout follow-up; the earlier native receipts below describe
  their own baseline, not these changes.
- Its browser checks covered all 44 new image identities in the real rulebooks
  at 320, 375 and 1280 px, plus 200% CSS text at 320 and 1280 px. Painted
  same-row card faces had zero measured width/height spread. Deliberately
  failed images retained complete live copy and stable artwork/card dimensions.
  The failure fixture bypassed the service worker to establish actual request
  failure rather than a successful cached response.
- A fresh three-route create/lobby/gameplay/leave check verified Kraken private
  portrait visibility and single-copy ability text, both corrected enlarged-text
  headers, reachable 48 px actions and Telestrations keyboard drawing. All ten
  seats returned to the hub on exit. This follow-up covers initial decisions,
  not additional complete browser matches. Physical device testing remains open.
- The final complete server sweep on 24/09/2026 passed all 917 tests across
  34 files, with no failures, skips or cancellations. This includes the existing
  games and four additions, complete HTTP/socket matches, rematches, privacy,
  room lifecycle and security fixtures. Shared-types and server TypeScript
  passed. Test-owned local services used no hosted persistence credentials.
- The expansion's shared regression pass on 24/09/2026 passed 88 server
  security/lifecycle/results checks, 114 mobile session/socket/room-code checks
  and 13 catalogue checks. Two old nine-game test fixtures were updated to
  assert the exact thirteen-game routes, metrics and assets. Server/mobile
  TypeScript and scoped lint also passed.
- The final complete mobile script sweep passed all 1,553 tests across 102
  files, with no failures or skips, including the readable voyage-chart checks.
  Eight stale Colt train/GameCover fixture
  imports were reproduced and repaired before that successful rerun. Raw failed
  and successful logs are retained locally.
- The expanded Android and iOS Hermes exports succeeded with 483 and 479
  assets respectively; both embedded API URLs passed the export validator.
  These used a local QA endpoint and include the final prompt-shuffle wording
  and readable voyage-chart changes. They are bundle-compatibility evidence,
  not signed builds or device tests.
- The final server production build and all ten dependency-compatibility checks
  passed. Scoped lint was clean across all 86 changed or new mobile source
  files. Sandbox child-process restrictions initially prevented some runners
  from starting; the permitted reruns executed the checks normally.
- The Telestrations shuffled-prompt follow-up passed 40 engine tests, nine
  socket tests and server TypeScript. It covers seeded reproducibility,
  exhaustion before reuse, partial-round refills, cancelled offers and
  projection privacy. Earlier browser evidence predates this server-only
  prompt-order change.
- A manual Cartographers Map C solo game completed all four seasons with
  independently chosen placements, 16/15/28/41 seasonal points and 100 total.
  The displayed 80-point solo adjustment correctly produced 20, Master
  Mapsmith. Creation, lobby, Summer reload, results/map inspection, rematch
  reset and normal leave passed at phone/desktop sizes. This run did not cover
  multiplayer, Map D or 200% text. An earlier detached-browser attempt remains
  an interrupted attempt of unknown cause, not a completed game or a confirmed
  product defect.
- Kraken's final compiled-web run completed two natural voyages through 493 accepted
  visible-control actions: five isolated seats, then four after an explicit
  rematch departure. All nine expected phases appeared, including rituals and
  telescope inspection. Reload, privacy, faction winner eligibility, 48 px
  targets, card-row geometry and ship visibility passed, with 39 captures and
  no browser errors, blocked requests or rejected actions. Character powers
  were passed in this run; live telescope coverage is not live Look-Out
  character activation. The latter remains covered by engine/client tests.
  The final chart uses readable waypoints, named destinations and a vessel
  token; rendered zoom and Find ship checks passed at 320/375/1280 px.
- The final Telestrations browser rerun completed the three-round category
  fixture, then a separate offered-prompt smoke checked 12 distinct private
  offers, visible selection/submission, authorised handoff, reload and normal
  exits. The offered-prompt smoke is not an additional full game. All four
  entrances/references passed five-width capture checks, including the revised
  prompt-pool wording. Eleven PWA browser checks then passed on the same export,
  including its versioned favicon, installation guidance, update gates and
  offline recovery. Installation events and busy tabs remain labelled fixtures.
- After the final chart change, web, Android and iOS exports were repeated.
  Eleven PWA browser checks passed again on web bundle SHA-256
  `94296f7086235438c2ed7160c3312365b6d30c5cca5f01c18eaef0cfe1ce768e`,
  worker `2714a402d44ae032537b7aef`. The corrected favicon loaded with its
  content-versioned URL. The final Kraken run used this same frozen export.
- The four-game work on 24/09/2026 passed 115 focused client/artwork/material
  regressions, including all 84 Dixit identities and font registration across
  the app. The integrated engine/socket sweep passed 189 tests before the
  subsequent Kraken privacy follow-up; do not treat that earlier count as
  validation of later engine changes.
- The Telestrations compiled-web run completed three rounds at four seats:
  60 submissions, 36 handoffs, 48 page reveals and 12 scored books. It checked
  exact saved drawing recovery, an independently expected shared score,
  rematch and an undersized forfeit ending. The same run captured all four
  entrances/rulebooks at five widths. These are automated browser fixtures,
  not independent manual play or native acceptance.
- A separate Dixit compiled-web run completed a three-seat match through seven
  rounds to 30 points, checking mixed/all/none correct-vote outcomes against an
  independent scoring calculation, dual votes, two decoys, reloads, rematch and
  an undersized ending. The post-fix Kraken engine/socket suite passed all 46
  tests, including complete seeded voyages and five HTTP/socket matches.
- Chrome decoded the exported controller favicon at 16, 32 and 48 px. Its
  complete silhouette is preserved; the fine central Z loses detail at 16 px.
  Exported routes use a content-versioned favicon URL to avoid the old icon.
- The 24/09/2026 sidebar/favicon follow-up passed 57 focused regressions,
  mobile TypeScript, scoped lint, a production web export and 11 headless
  Chrome checks at phone/desktop widths, including 200% text. The export was
  isolated from unfinished game work. Install events and busy tabs are test
  fixtures; physical-device installation remains unverified.
- The 23/09/2026 artwork/PWA pass completed 534 focused regression tests,
  seven PWA client tests, icon validation, TypeScript and scoped lint checks.
  Web, Android and iOS JavaScript exports succeeded. These are not signed builds.
- Follow-up filesystem checks on 24/09/2026 passed 21 PWA worker/build tests and
  23 gallery/server tests. Directory scanning handles incomplete OneDrive
  enumeration metadata without weakening symlink or scan-boundary checks.
- Eight PWA browser checks passed, covering installation guidance, icon loading,
  enlarged-text layout, public-cache boundaries, a busy-tab update veto,
  explicitly approved idle updates, offline recovery and online retry. The
  busy-tab scenario uses a route fixture, not an active multiplayer match.
- The same web build passed create/join, lobby, gameplay entry and normal leave
  for all nine games, with 24 clean exits and 54 screenshots. This is an
  initial-route smoke test, not nine completed matches or exhaustive rules proof.
- Final component checks passed 72 representative card cases and 16 Citadels
  role comparisons across phone/desktop sizes and enlarged text. Earlier
  identity and rulebook/navigation checks passed 108 and 48 cases respectively.
  These counts describe their fixtures, not all possible gameplay layouts.
- Shared rulebook and Coup reference headings were checked at 320 px with
  200% CSS text after correcting word splitting and close-button spacing.
- Local engine, protocol, component and rendered-web checks cover their declared
  scenarios only. A successful fixture is not an exhaustive rules audit or a
  complete multiplayer lifecycle.
- Physical iOS/Android, VoiceOver/TalkBack, native large text, background/resume,
  hardware/gesture Back and broader cross-browser behaviour require separate
  validation. Signed builds and store distribution are separate gates.
- Hosted Supabase policies, atomic result persistence and the intended production
  network require verification against that environment. Local mocks and
  persistence-disabled runs do not prove hosted behaviour.
- Active rooms are process-local. Restart recovery and horizontal scaling are
  unsupported; deployment requires one always-on replica. Result retries are
  bounded and there is no durable outbox.
- The implementations retain the disclosed [digital adaptations](../README.md#game-rules-notes).
  Engineering acceptance does not establish publisher fidelity, licensing or
  distribution rights. Public hosting or distribution requires the applicable
  written rights-holder permissions.
