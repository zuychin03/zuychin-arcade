# Libertalia phase-stage artwork

Historical image-generation and asset-validation record, 22/09/2026. Status statements below describe that preparation step, not the current delivery checklist. Production components define current integration; see [the design guide](../../../DESIGN.md) and [testing limits](../../TESTING.md).

Prepared 22/09/2026 for the bounded four-stage set. These images represent printed ability timing, not individual crew portraits. All ranks, names, phase badges and rules remain live text. UI integration was pending at that preparation step.

Generation uses the built-in image tool, one call per asset with the shared prompt followed by its exact subject prompt.

## Shared exact prompt

Use case: stylized-concept

Asset type: one original square phase-stage art vignette for a mobile-first sky-pirate tabletop game.

Style/medium: premium photographed handcrafted miniature diorama, tangible carved timber, painted stone, worn sailcloth and aged brass, soft physical contact shadows and restrained imperfections. A compact scene, not flat vector art, a UI or a full card.

Composition/framing: centred miniature stage on a low dark navy base, three-quarter tabletop view, complete main silhouette inside a generous square margin, legible at 120 pixels. No human figures or character portraits.

Lighting/palette: dark navy #080C1C backdrop, sky-cyan #6DE1FF and muted violet #B18CFF details, warm gold #F5C85B accents. Adventurous airborne-fleet identity rather than a horror ocean scene. Time-of-day lighting follows the specific subject, without excessive bloom.

Constraints: entirely original scene, no commercial game artwork, readable words, letters, numbers, logos, watermark, card border, ranks, scores or game-effect symbols. It represents ability timing only, not any named crew member or unique power.

## Exact subject prompts

### daytime

Primary request: a miniature floating island arrival dock in bright soft daylight, one small elegant sky-sailing boat approaching a simple wooden gangway, pale cloud tufts beneath the island, sky-blue sail and restrained violet pennant. Clearly daytime arrival, complete boat and island visible.

### dusk

Primary request: a small floating-island loot quay at dusk, wooden pier and closed dark-wood crates, a small plain chest and coiled rope, warm lantern with a quiet amber pool of light, violet twilight sky. Clearly an evening port stage, no coins or exact loot counts as gameplay information.

### night

Primary request: a miniature airborne ship lookout deck during a quiet deep-blue night, a brass telescope on a simple stand beside a gently lit lantern, mast section and dark-violet furled sail, sparse tiny stars in the distant backdrop. Clearly night watch, complete central instruments and deck base visible.

### anchor

Primary request: a small brass anchor beside an open blank cream-paper ledger on a navy timber mooring platform, plain tied storage pouch and coiled rope, calm pale-cyan ambient light. A quiet end-of-voyage accounting and mooring still life. Ledger has absolutely no handwriting, marks, ruled numbers or text; anchor and book are fully visible.

## Saved outputs and inspection

All four source PNGs are 1254×1254. Repository source copies are saved here as `libertalia-phase-{phase}.png`. Optimised assets and independent manifests are in `../../../apps/mobile/assets/game-art/`. The original and 320×320 WebP for every phase were visually inspected. Subjects remain readable at reduced size; the ledger is blank. Decorative compass-shaped ornaments carry no gameplay meaning. The night mast and anchor platform extend to the frame, while their primary instruments, anchor and ledger remain visible.

| Phase | Built-in original filename | WebP bytes |
| --- | --- | ---: |
| daytime | `exec-f359b3e6-2bab-4438-9d47-2018b103695e.png` | 20,692 |
| dusk | `exec-4db62610-7439-4a44-9473-5f2dfa3746c4.png` | 21,272 |
| night | `exec-4a27822e-a8ee-4473-9fde-e78116e692fd.png` | 18,462 |
| anchor | `exec-53f99a94-6337-4f5a-9e0a-b6c32b11b7fa.png` | 19,932 |

The collection totals 80,358 bytes, below its 160 KiB collection budget and 48 KiB per-image cap. Optimisation uses width-only resizing, quality82, effort5 and picture preset with Sharp0.35.4, vips8.18.6 and WebP1.6.0. No cropping or padding is applied. Four deterministic regeneration checks and sixteen shared asset tests pass. No Libertalia UI or rendered lifecycle evidence is implied.

### Content hashes

| Phase | Source SHA256 | WebP SHA256 |
| --- | --- | --- |
| daytime | `ba3cdb01ecdba1fd5cdf4d02e4e42526515e55e3575a64d5f97c5753bf10f0c6` | `ac50dbfe8591851da280ef08f2d790e3be60b425cdc6b103435df60e70f2f815` |
| dusk | `ab303c8b7709e7fd733553dab7fc68df47ff4fd3efc8d57fe2b3f45ece8e44d9` | `1d8354eb29693e9c34d41688f13260d66f8c37f715c7e2b75d161b3c8b33ba94` |
| night | `a132a7d15867db82cbcf9239d8b0f5ca26ab18bff779b0756ed280fc40fa0c94` | `f876064597e29c12670594f641b9b217224bf0af79533839305633aaf389d631` |
| anchor | `c20553d3b6771775af0ded5bb22f0ae7f5f26078a9462dd1e0b49a0038113755` | `04458ad130df28853a18547ae65cd5619af14d9eff62b4781f65dbff7f022328` |
