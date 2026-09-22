# Skull King special-card miniatures

Historical image-generation and asset-validation record, 22/09/2026. Status statements below describe that preparation step, not the current delivery checklist. Production components define current integration; see [the design guide](../../../DESIGN.md) and [testing limits](../../TESTING.md).

Built-in imagegen preparation for the approved tactile redesign, 22/09/2026. These five decorative card illustrations preserve the spectral-white identity. Exact names, rules, Tigress mode and legal actions remain live app content. No numbered-card raster set is required.

## Shared exact prompt

Use case: stylized-concept
Asset type: one original square special-card illustration for a mobile-first tabletop game app, not a complete card or UI.
Style/medium: premium photographed hand-painted tabletop miniature, tangible ivory, aged brass, dark carved timber and fabric where appropriate. Quietly imperfect craftsmanship, crisp readable silhouette, restrained physical depth and soft contact shadows.
Scene/backdrop: a simple charcoal-navy #080B12 tabletop and seamless dark background, faint surface texture only. One compact central object or tightly composed prop group. No horizon, distant scenery or busy background.
Composition/framing: close three-quarter product view, the entire subject comfortably inside the square frame with clear breathing space. Large readable shapes for an approximately 100-pixel card art field.
Lighting/palette: spectral-white #F7FAFF moonlight, pale cyan #A9D8FF rim light and restrained aged-gold #F4C04E detail. Navy shadows. Not turquoise, neon or excessive bloom.
Constraints: original design, no commercial game art, recognisable franchise character, printed words, numbers, letters, logo, watermark, border, card layout or UI. No graphic violence. No symbols suggesting a universal rank or additional rules. All rules and card names are supplied separately as live interface text.

Each call appends exactly one of the subject requests below to the shared prompt.

## Pirate

Primary request: a weathered dark captain's tricorn hat resting on a small carved ivory-and-timber stand, with one short antique cutlass leaning beside it. The hat and broad metal blade form one bold compact silhouette. No human figure, face or skull emblem.

## Tigress

Primary request: an original dual-aspect captain's artefact, a pale carved feline-profile medallion in a small brass mount with a short folded coral sash and a coiled escape rope beside it. Suggest a resourceful seafaring captain through materials, not a literal tiger or a two-panel diagram. No human figure and no text.

## Skull King

Primary request: an ivory carved skull artefact wearing a small aged-brass crown, resting on a low dark timber base. Majestic and slightly weathered, not frightening or gruesome. The complete crown, skull and base are visible. No crossed weapons.

## Mermaid

Primary request: a small original pearlescent mermaid statuette with a graceful curved tail on a carved wave base. A simplified, modestly clothed sculptural sea figure, not a realistic person. Ivory and pale cyan surfaces with a small aged-brass detail. Keep the full tail and wave base visible.

## Escape

Primary request: a small hand-carved ivory-and-timber lifeboat with a loosely coiled rope and one short wooden oar, arranged as one compact tabletop piece. Calm and purposeful, with no passengers. The complete boat, oar and rope are visible.

## Output provenance

All five built-in outputs are saved in this directory as `skull-special-{kind}.png`, each 1254×1254. All original and optimised outputs were personally inspected. The full objects and bases remain in frame, with consistent navy, ivory and brass materials. The Tigress image is a feline medallion, not a character portrait or a representation of its selected mode.

The established width-only pipeline creates the following 320×320 WebPs without cropping or padding:

| Kind | Output bytes |
| --- | ---: |
| pirate | 15,034 |
| tigress | 16,950 |
| skull_king | 16,376 |
| mermaid | 13,296 |
| escape | 13,408 |
| Total | 75,064 |

Each `skull-special-{kind}-manifest.json` records source/output hashes, full-composition transform and Sharp 0.35.4, libvips 8.18.6 and WebP 1.6.0 encoding at quality 82, effort 5, picture preset. Deterministic regeneration matches. Assets are prepared, not yet mounted or visually accepted in Skull King.
