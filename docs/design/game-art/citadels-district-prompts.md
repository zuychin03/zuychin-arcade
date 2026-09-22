# Citadels district-category miniatures

Historical image-generation and asset-validation record, 22/09/2026. Status statements below describe that preparation step, not the current delivery checklist. Production components define current integration; see [the design guide](../../../DESIGN.md) and [testing limits](../../TESTING.md).

Built-in imagegen preparation for the approved tactile redesign, 22/09/2026. These five illustrations identify printed district categories, not individual named buildings or their powers. Exact names, printed costs, effective action costs and full effects remain live app content.

## Shared exact prompt

Use case: stylized-concept
Asset type: one original square district-category illustration for a mobile-first tabletop city-building game, not a complete card or interface.
Style/medium: premium photographed hand-painted architectural miniature on a small tangible stone plinth. Carved masonry, ceramic roofs, aged brass details, tiny warm window lights and subtle imperfections. Physical depth and soft contact shadows, not flat vector art or plastic game graphics.
Scene/backdrop: simple midnight-blue #090D1A tabletop and seamless dark background, with faint stone texture only. A single compact building group. No distant city, skyline or extra buildings at the frame edge.
Composition/framing: elevated three-quarter product view, large clear architectural silhouette, complete tallest roof and stone base comfortably within the square frame. Readable at a small card-art size, with restrained fine detail.
Lighting/palette: royal-blue #7395FF night light and warm gold #F4C04E windows against midnight stone. Category-specific accent supplied below. Readable shadows, no excessive bloom or neon.
Constraints: original architecture, no commercial game art, recognisable real landmark, printed text, numbers, letters, labels, logos, watermark, border, card layout or UI. No people. Do not include coins, cost symbols or a fixed number of district slots. All identity and rules text is supplied separately as live content.

Each call appends exactly one subject request below to the shared prompt.

## Noble

Primary request: a small refined palace and enclosed courtyard on a stone plinth. Warm cream stone, restrained gold roof finials, royal-blue ceramic roof and illuminated tall windows. A broad central hall and two low wings make a readable elegant silhouette, without copying a real palace.

## Religious

Primary request: a small stone sanctuary with one bell tower and a modest arched entrance on a stone plinth. Pale masonry, deep-blue ceramic roof and warm golden windows. Distinctive peaceful architectural silhouette, no religious lettering or identifiable real monument.

## Trade

Primary request: a compact miniature market courtyard with two emerald-green fabric stall canopies and a small harbour warehouse. Wooden crates are secondary small props. Warm stone, weathered timber and golden window light, with a bold emerald accent. Keep it one coherent district miniature on a stone plinth.

## Military

Primary request: a compact fortified stone gateway with one strong watchtower and a short crenellated wall on a stone plinth. Crimson ceramic roofs and a small plain red pennant, dark iron gate and warm watch windows. Solid broad silhouette, no weapons, battle or real-world military insignia.

## Unique

Primary request: an unusual scholarly city complex with a small violet-roofed observatory, a brass armillary instrument and an arched library wing on a stone plinth. Original gently fantastical architecture, elegant and tangible. Violet and gold details distinguish this category, with no floating runes, words or symbols claiming a specific game power.

## Output provenance

All five built-in outputs are saved here as `citadels-district-{color}.png`, each 1254×1254. All originals and optimised outputs were personally inspected. The palace, sanctuary, market, gate and observatory silhouettes remain distinct at card-art size; full roofs, towers and bases remain within the frame.

The width-only pipeline creates 320×320 WebPs without cropping or padding:

| Printed category | Output bytes |
| --- | ---: |
| noble | 19,292 |
| religious | 19,500 |
| trade | 21,916 |
| military | 16,440 |
| unique | 22,386 |
| Total | 99,534 |

Each `citadels-district-{color}-manifest.json` records source/output hashes, full-composition transform and Sharp 0.35.4, libvips 8.18.6 and WebP 1.6.0 encoding at quality 82, effort 5, picture preset. Deterministic regeneration and twelve asset tests pass. These category images are prepared, not yet mounted or visually accepted in Citadels. They do not change Haunted Quarter, School of Magic or any other rule exception.
