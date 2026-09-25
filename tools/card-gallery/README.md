# Local component gallery

## Expansion component fixtures

Use `?scene=expansion&family=kraken&surface=cards`, choosing `kraken`, `telestrations`, `cartographers` or `dixit`. `surface=rules` opens that game's actual reference sheet. These bounded examples use production components and fonts with synthetic data and local callbacks only. Existing nine-family routes and the screenshot campaign remain separate.

Cards include Kraken navigation and full/compact characters; Cartographers explore, hero, ambush and objectives; selected Dixit artwork with local inspect callbacks; and the Telestrations relay and drawing surfaces. Inspect phone and desktop separately. Use `expansion-ready`, `expansion-fixture-*`, `expansion-actions` and `expansion-rules-closed` markers. Expansion fixtures do not accept page, panel or role parameters. Run their focused check with `node --test --test-isolation=none tools/card-gallery/expansion.test.cjs`.

## Artwork fixtures

The optional `scene=artwork` query selects a separate, bounded visual inspection scene. Existing `?family=...` comparison routes and their 216-image campaign are unchanged. These fixtures use actual production components, fonts and artwork; they do not connect to a room or service. They are additional visual evidence, outside the existing campaign runner.

Use these loopback query strings after exporting the gallery:

- `?family=citadels&scene=artwork&page=1` through `page=2`: four actual role cards per page, all eight roles.
- `?family=libertalia&scene=artwork&page=1` through `page=10`: four actual crew cards per page, all forty ranks.
- `?family=tokyo&scene=artwork&page=1`: all six assigned monster profiles at both production call-site sizes, 45 and 54 px. Pages 2 through 17 show all 64 canonical named powers, four per page in actual `PowerCardCollection` and `PowerCard` components, including local selected/unavailable states. Page 18 shows actual `TokyoArena` with two empty synthetic zones and its integrated arena artwork. The arena is not a game-state fixture or occupant test. Power IDs are `artwork-fixture-tokyo-power-<canonical_id>`; the arena ID is `artwork-fixture-tokyo-arena`.
- `?family=saboteur&scene=artwork&page=1` and `page=2`: four action cards per page covering the six intact/broken tools plus map and rockfall, with the same concealed deck back on both pages.
- `?family=saboteur&scene=artwork&panel=role&role=miner` and `role=saboteur`: actual private-role overlay with synthetic data. Dismissal stays local.
- `?family=bang&scene=artwork&page=1` through `page=10`: four fixtures per page (last page two), first all 22 canonical card names using `BangCardView`, then all 16 character portraits using `BangCharacterArtwork` with canonical summaries. Page 6 contains the final two cards and first two characters.
- `?family=not-alone&scene=artwork&page=1` through `page=9`: four actual `CardChip` components per page (last page three), all 15 Survival then all 20 Hunt definitions. Canonical title, phase and complete summary remain live; synthetic local controls cover enabled/options/unavailable appearance.
- `?family=colt&scene=artwork&page=1` and `page=2`: four then two actual `CharacterChoice` components, all six characters. `page=3` renders the actual `TrainBoard` with three synthetic cars, both levels, marshal and loot. Browse horizontally to see caboose, carriage and locomotive; this is not an authenticated game.
- `?family=coup&scene=artwork`: four `CoupTableArtwork` identities (back, loyalist, reformist, treasury) plus a fifth compact-seat fixture using actual `CharacterCard size="xs"` with mixed hidden and revealed/lost influences.
- `?family=skull&scene=artwork`: four actual numbered `SkullKingCardView` suit faces plus the uniform `SkullKingDeckArtwork`, five fixtures total.

New stable identities are `artwork-fixture-bang-card-<name>`, `artwork-fixture-bang-character-<id>`, `artwork-fixture-<survival|hunt>-<id>`, `artwork-fixture-colt-character-<id>`, `artwork-fixture-colt-train`, `artwork-fixture-coup-<back|loyalist|reformist|treasury|compact-seat>`, `artwork-fixture-skull-suit-<green|purple|yellow|black>` and `artwork-fixture-skull-deck-back`. IDs preserve canonical underscores. Artwork wrappers use constrained inner columns, except Not Alone power cards which retain their production stretching row. Skull King wrappers use the exported text-aware card width. Captions and unlike component types are not card-height equality evidence. No callbacks emit game commands; train browsing and private-role dismissal only update local UI.

Wait for `#artwork-ready`. Every fixture has matching `nativeID` and `testID` of `artwork-fixture-<identity>`, for example `artwork-fixture-crew-21`, `artwork-fixture-assassin`, `artwork-fixture-monster-0`, or `artwork-fixture-repair_lantern`. Monster size wrappers have `testID=artwork-monster-<index>-<45|54>`. The production private-role overlay retains `saboteur-secret-role`; local dismissal exposes `testID=artwork-role-dismissed`. Invalid scene, family, page, panel or role values fail explicitly. Capture mobile and desktop separately, including scroll coverage where required; this is component evidence, not an authenticated route test.

QA-only, no production route, room, authentication or authoritative game state. Imports actual production card components, artwork, canonical definitions and fonts. BANG, Libertalia, Tokyo, Coup and Colt use exported production collections with their production sizing props. Other families use a labelled neutral comparison rail; this is not proof of their inline game-route parent layouts. Route evidence is supplied separately by targeted fixture runs. Native font scaling, physical input and device distribution remain separate gates.

This reusable tool lives in `tools/card-gallery`. It is not a workspace package and uses the existing monorepo dependencies. On a clean clone, first complete the repository's normal root dependency installation (`pnpm install --frozen-lockfile`); do not install dependencies separately here or add this directory to the workspace.

From the repository root, the focused checks are:

```powershell
node --test --test-isolation=none apps/mobile/scripts/card-gallery-ui.test.cjs tools/card-gallery/static-server.test.cjs
node apps/mobile/node_modules/typescript/bin/tsc -p tools/card-gallery/tsconfig.json --noEmit
Push-Location tools/card-gallery
node ../../node_modules/eslint/bin/eslint.js .
Pop-Location
```

After source freeze and explicit export approval, run from the repository root:

```powershell
$env:EXPO_OFFLINE = '1'
$env:CI = '1'
node apps/mobile/scripts/card-gallery-ui.cjs --freeze
Push-Location tools/card-gallery
node ../../node_modules/expo/bin/cli export --platform web --output-dir dist --max-workers 1
Pop-Location
```

After that export, the dedicated static server command from the repository root is:

```powershell
node tools/card-gallery/static-server.cjs
```

It binds only `127.0.0.1:8083` and serves only this gallery's `dist` directory. No host, port or target override is accepted. Stop that owned foreground process with Ctrl+C, or retain its process handle if the coordinator starts it hidden in the background. Do not stop unrelated Node processes. The server prints its role, PID and exact root once ready; it has no HTTP shutdown endpoint.

Do not publish this export. Serve it only on the dedicated loopback port; never replace the production export. Generated `dist/`, `.expo/` and `frozen-source*.json` files are local-only. Preserve previous manifests, exports and receipts before preparing another run. The runner requires a fresh output directory, exact gallery bundle SHA and source manifest created before export. Its maximum is 216 application images across three named batches, plus two calibration controls for the complete campaign. Complete row captures replace individual card captures when possible. The four profiles are 320 touch CSS200, 375 touch CSS200, 1280 fine normal and 1280 fine CSS200. The three representatives per family include short/long material, selected and disabled states, and a real back where supported. These are not an exhaustive card or rules inventory.

Each batch also checks 414 touch and 768 fine at normal/CSS200 using DOM measurements only. These checks are not screenshot evidence. Tokyo dice are separately measured and captured within the same hard ceiling, not compared with power-card dimensions. Heights compare peers within a row or rail; separate wrapped rows may retain different intrinsic heights. Widths compare same-role faces across rows. Skull King and Not Alone use the production intrinsic-height hook with deliberately different QA caption lengths.

Run `apps/mobile/scripts/card-gallery-ui.cjs` with `CARD_GALLERY_UI_RUN=true`, `CARD_GALLERY_UI_EXCLUSIVE_WINDOW=granted`, `CARD_GALLERY_BATCH=first|second|third`, `CARD_GALLERY_URL` (default `http://127.0.0.1:8083`), absolute `CARD_GALLERY_OUTPUT`, absolute `CARD_GALLERY_STATIC_ROOT`, absolute `CARD_GALLERY_SOURCE_MANIFEST`, and `CARD_GALLERY_SHA256`. The second and third batches also require absolute `CARD_GALLERY_CALIBRATION_RECEIPT` pointing to the passed first-batch `receipt.json` with matching source/export identity. `BROWSER_PATH` is optional. An existing output directory or source manifest is never overwritten by the setup command.

Use `tools/card-gallery/dist` for the static root and `tools/card-gallery/frozen-source.json` for the manifest, resolving both to absolute paths. Choose a fresh output directory under `.tmp-qa-evidence/`; hash the exact entry JavaScript referenced by the new export's `index.html` for `CARD_GALLERY_SHA256`. Run the three explicit batches sequentially, each in a separate process, and stop on any failure. Old `.tmp-qa-tools/card-gallery` files and historical receipts are not inputs to a new run from this promoted tool.

Source, all export files, served HTML, entry JavaScript, loaded assets and real font files are fenced. Receipts are atomic and redacted. A failure closes both contexts/browser and preserves its partial evidence. No POST, room or Socket.IO request is authorised. Component callback tests use actual local pointer input and assert exact one-call versus disabled zero-call behaviour; they do not claim authoritative gameplay transitions.
