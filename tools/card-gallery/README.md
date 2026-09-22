# Local component gallery

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
