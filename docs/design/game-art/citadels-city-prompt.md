# Citadels city miniature

Historical image-generation and asset-validation record, 22/09/2026. Status statements below describe that preparation step, not the current delivery checklist. Production components define current integration; see [the design guide](../../../DESIGN.md) and [testing limits](../../TESTING.md).

Built-in imagegen preparation for the approved tactile redesign, 22/09/2026. Decorative atmosphere, not a rendered player city or a fixed-slot board. Preserve royal-blue and gold identity. UI integration remains after the active game gates.

## Exact generation prompt

Use case: stylized-concept
Asset type: original horizontal 3:2 entrance and library illustration for a mobile-first city-building board-game app.
Primary request: a premium handmade miniature royal city built from tangible stone district tiles on a dark midnight-blue tabletop. A strong central castle silhouette is surrounded by a few distinct palace, sanctuary, market and fortified-gate buildings. Include a small plain brass crown, a few blank gold pieces and a short sealed role-card stack in the foreground.
Style/medium: photographed hand-painted architectural miniatures, tactile carved stone, ceramic roofs, aged brass, thick paper and warm tiny window lights. Subtle imperfect craftsmanship, real physical depth and soft contact shadows, not flat vector art, neon gradients or a UI mock-up.
Composition/framing: slightly elevated three-quarter camera, a compact city model with the tallest tower and full stone base comfortably within the frame. Clear large shapes at phone size. Foreground props remain secondary and comfortably in frame. No distant cityscape or empty text block.
Lighting/mood: royal blue #7395FF night light on midnight stone #090D1A, warm gold #F4C04E windows and metal, restrained emerald and crimson roof accents. Readable shadows, no excessive bloom.
Constraints: original architecture and props, no publisher artwork, recognisable copyrighted landmarks, printed district names, role portraits, numbers, card values, lettering, logos, UI or watermark. Do not arrange a fixed seven-slot board or imply an actual completed city. All game state, costs, rules and labels are supplied separately as live app content.

## Output provenance

The original 1536×1024 PNG is `citadels-city-concept.png`, 2,607,616 bytes, SHA-256 `1a1bdb1ce8e6f578d6c5a546a9e5e2c5a4658e597523fd6a4fe3477045b455cd`. The original and optimised cover were personally inspected: the complete miniature and its main foreground props remain within the frame.

The established width-only pipeline preserves the composition without cropping or padding. `citadels-cover.webp` is 640×427, 59,182 bytes; `citadels-hero.webp` is 1280×853, 172,996 bytes. Combined loading budget: 232,178 bytes. The separate `citadels-manifest.json` records output hashes and Sharp 0.35.4, libvips 8.18.6 and WebP 1.6.0 encoding at quality 82, effort 5, picture preset. Deterministic regeneration matches. These are prepared assets, not integrated UI or rendered Citadels acceptance.
