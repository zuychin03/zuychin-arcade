# BANG! card-family miniatures

Historical image-generation and asset-validation record, 22/09/2026. Status statements below describe that preparation step, not the current delivery checklist. Production components define current integration; see [the design guide](../../../DESIGN.md) and [testing limits](../../TESTING.md).

Built-in imagegen preparation for the approved tactile redesign, 22/09/2026. Seven presentation families reuse original art across the 22 printed card identities. Names, suits, ranks, effects, selected action and legality remain live content, not art-derived rules.

## Shared exact prompt

Use case: stylized-concept
Asset type: one original square reusable card-art vignette for a mobile-first Western tabletop game.
Style/medium: photographed hand-crafted miniature props, tactile worn timber, aged brass, thick paper and weathered leather. Tangible dimensional objects with contact shadows and modest imperfections; not flat vector art, a screen or a full card.
Composition/framing: one clear compact prop arrangement on a low dark wooden plinth, elevated three-quarter view, all props and base comfortably within square frame. Strong readable silhouette at 140 pixels.
Lighting/palette: dark brown #120A08 background, warm brass #F6C453 lantern light, sand #E8C99B highlights and a restrained dark red #FF5D55 accent. Warm readable shadows without neon or excessive bloom.
Constraints: original props only, no commercial game art, recognisable real person, publisher character, human face, cultural caricature, lettering, numbers, logos, watermark, printed card border, suit, rank, exact game values or UI. Artwork is a reusable presentation family; it must not claim to depict every exact card identity. No blood or graphic violence.

## Exact subject prompts

### attack

Primary request: a small weathered wooden target board with several non-graphic impact dents, beside two plain brass duel counters and a folded red cloth. One strong target silhouette; no people, firearm or cultural group.

### response

Primary request: an old dark leather cowboy hat resting beside a small wooden board with a harmless missed impact mark off to one side. Clear intact hat silhouette, warm rim light, no person, projectile or injury.

### recovery

Primary request: a simple frontier ceramic mug with a brass handle, a small folded cloth and an empty rustic resting-place stool. Quiet welcoming saloon still life, no bottle labels, medicine symbols, numeric values or people.

### supply

Primary request: two stacked weathered wooden supply crates beside a closed leather transport trunk, with one blank sealed paper envelope on top. Clear transport-and-supplies silhouette, no writing, currency or visible card face.

### interference

Primary request: a single crafted dark leather glove posed lifting one thick blank-backed red card from a short closed stack on a wooden plinth. No visible person or anatomy beyond the glove, no card face or lettering. Readable diagonal pick-up gesture as a frozen miniature prop.

### equipment

Primary request: a shallow worn-timber equipment tray holding a small barrel, a simple brass spyglass and a coiled rope. Neutral frontier supplies with clear large shapes, not a diagram or exact inventory. No labels, guns, dynamite, card symbols or numeric values.

### weapon

Primary request: a closed empty weathered leather holster with decorative aged-brass buckle and a small machined metal component beside it on timber. Evokes frontier weapon equipment without showing a specific firearm model. No bullets, people, lettering or model numbers.

## Recorded outputs

Each original is 1254×1254 and copied unchanged into this directory as `bang-card-{family}.png`. Root inspected every original and optimised 320×320 WebP. The seven WebPs total 130,540 bytes, below the 224 KiB collection budget; each is below 48 KiB. Full source/output hashes and encoding metadata are in each `apps/mobile/assets/game-art/bang-card-{family}-manifest.json`. Fourteen shared asset tests, scoped lint and all seven deterministic checks pass. Primary props remain visible; some secondary lanterns or timber supports touch/cross the scene edge, and the interference still life includes a small decorative compass. No printed card rules or identity are baked into the images. BANG!'s UI has not yet been integrated or accepted.

| Family | Original generated filename |
| --- | --- |
| attack | `exec-e5eb61ca-bd2e-4f98-846a-87a41c815bac.png` |
| response | `exec-00218ca4-ac0b-48ca-aba6-79fa318d63b2.png` |
| recovery | `exec-66b1b011-71a8-4181-ac1f-95d7e390092a.png` |
| supply | `exec-f840eb70-b963-4976-9013-0e729353b307.png` |
| interference | `exec-e82c0f15-5894-4859-a627-e5747f932f64.png` |
| equipment | `exec-c7353f5c-d6cf-476a-8ecd-d11560f91707.png` |
| weapon | `exec-a6d7c7b0-67ed-4bb8-adbf-8bdccd81c101.png` |
