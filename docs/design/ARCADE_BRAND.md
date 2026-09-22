# Zuychin Arcade controller identity

The user selected the controller concept on 22/09/2026 (Australia/Sydney).

The angular Z remains the family signature. Controller grips and controls identify Arcade; the existing readable ZUYCHIN / ARCADE text remains beside the symbol in navigation. Wordmarks are not squeezed into launcher icons or favicons.

## Source and outputs

- Approved concept: `logo-concepts/01-z-controller.png`, generated with the built-in imagegen tool. Exact prompts are in `logo-concepts/prompts.json`.
- Production vector master: `apps/mobile/assets/zuychin-controller.svg` (repository-relative).
- Generated derivatives: navigation SVG constants, compatibility SVG, app icon, Android adaptive foreground/monochrome and PNG/SVG favicons.
- App configuration uses the generated `favicon.png` for web.
- Palette: Arcade pink `#FF2E88` on `#0B0716`; navigation callers may theme the symbol.

The production master is a clean code-native vector reconstruction of the approved concept, not the large concept presentation bitmap. Backgrounds, raster sizes and padding are generated from that one source. Previous camera assets and unselected concept images are local-only archives, not required build inputs. The prompt record describes the original camera reference at generation time, not the current controller icon at the same historical path.

## Regeneration

From `apps/mobile`, run `node scripts/generate-brand.cjs --sharp-module "<path to an existing Sharp module>"`. Add `--check` to compare every generated output without writing. This does not install dependencies; normal builds consume the checked-in derivatives.

The current outputs were generated with Sharp 0.35.4. Android artwork is constrained to the central safe circle and includes no baked-in launcher mask. The opaque 1024 px app icon and transparent adaptive variants are separately validated.

## Validation boundary

- Asset/component regressions cover the vector-derived identity and navigation integration.
- The controller identity is included in the checked web export and reviewed shared navigation layouts. Regeneration checks, lint and typechecking are separate from rendered verification.
- Physical launcher/device appearance remains unverified. Asset rendering and local bundles are not native acceptance; see [the testing guide](../TESTING.md).

Small favicons use only the two outer Z strokes from the same master, with a tighter crop. The full controller remains unchanged in navigation and app/adaptive icons. The independent review found it legible at 30 and 44 px; the original full-controller favicon was too dense at 16 px.
