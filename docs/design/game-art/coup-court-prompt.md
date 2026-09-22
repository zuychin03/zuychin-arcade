# Coup court concept

Historical image-generation and asset-validation record, 22/09/2026. Status statements below describe that preparation step, not the current delivery checklist. Production components define current integration; see [the design guide](../../../DESIGN.md) and [testing limits](../../TESTING.md).

Built-in imagegen, 22/09/2026 (Australia/Sydney). Original illustration prepared for the tactile redesign. Saved as `coup-court-concept.png`, 1536×1024, 2,560,498 bytes, SHA-256 `e1fd8bbd590e9827943aac171c9c1b90b763a768d38ae80fa8b56c659173bab5`. The source was inspected: full cards, mask and coins are visible with a secondary court setting and no rasterised copy. It is not yet integrated or visually accepted in the application.

Width-only production WebPs are prepared: 640×427 cover and 1280×853 hero, together 223,344 bytes. Exact output hashes and encoding are recorded in `apps/mobile/assets/game-art/coup-manifest.json`. Asset regression and deterministic regeneration checks pass.

## Exact generation prompt

Use case: stylized-concept

Asset type: original game-library cover and entrance illustration for a phone-first multiplayer bluffing card game app, also shown on desktop.

Primary request: a tactile miniature clandestine royal court about hidden influence and bluffing. Two face-down thick wine-coloured playing cards with simple embossed geometric backs lie slightly overlapping on a small dark stone tabletop. A sculpted half-mask with restrained brass detail leans next to a few small stacks of worn brass coins. Behind this foreground is one compact miniature throne and a partial arc of court architecture, suggesting concealed power rather than a vast palace. This is a handcrafted diorama photographed in a studio, with convincing three-dimensional material depth, not a flat vector scene.

Composition/framing: horizontal landscape 3:2, elevated three-quarter view. A single cohesive still-life, complete with comfortable margins on every edge. Cards, mask and coins are large enough to remain distinct at 300 px wide. Throne is secondary but legible. No text area needs to be reserved: interface copy is outside the image. Restrained negative space around the entire miniature, no cropped objects and no sprawling landscape.

Lighting/materials: directional warm light reveals thick ivory card edges, embossed wine card stock, imperfect carved stone, soft wine velvet and brushed aged brass; natural contact shadows. Deep wine #140A12 background with crimson #EF5775 accents, antique gold #F4C04E and restrained deep purple #B365FF in the fabric. Rich local colour and subtle roughness, dark but readable, not neon outlines or plastic gloss.

Constraints: wholly original artwork, no commercial card portraits or box art, no named characters, no lettering, numbers, symbols that imply actual card roles or live game state, logos, UI, frames or watermarks. No literal character faces on the cards. Decorative atmosphere only; never a rules diagram. Avoid excessive flourishes, floating objects, heavy fog or bright bloom.
