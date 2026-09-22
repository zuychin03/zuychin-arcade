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

Local verification on 23/09/2026 completed the web export and both Android/iOS
Hermes exports with their configured API-origin guards. No signing, upload or
device test was performed by those export checks.

## Browser and visual checks

Use the [card gallery guide](../tools/card-gallery/README.md) for isolated
production-component sizing scenes. Gallery evidence does not replace actual
game-route, privacy, focus, command or full-match checks.

Browser runners live under `apps/mobile/scripts/`; game-specific fixture
servers live under `apps/server/scripts/`. Read the chosen runner's explicit
environment guards and scenario contract before starting it. There is no
single flag set that safely launches every campaign.

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

## Evidence and release limits

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
