# Not Alone place miniatures

Historical image-generation and asset-validation record, 22/09/2026. Status statements below describe that preparation step, not the current delivery checklist. Production components define current integration; see [the design guide](../../../DESIGN.md) and [testing limits](../../TESTING.md).

Built-in imagegen assets for the approved tactile redesign, 22/09/2026. Images represent printed Place identity only. They do not reveal a secret destination, imply adjacency or replace live powers and state.

## Shared exact prompt

Use case: stylized-concept
Asset type: one original square place-card illustration for a mobile-first tabletop survival game.
Style/medium: premium photographed hand-painted alien terrain miniature on a low irregular dark stone base, tactile resin and weathered miniature materials, convincing physical depth, soft contact shadows and modest surface imperfections.
Composition/framing: one compact isolated diorama, elevated three-quarter view, whole base and all primary objects inside the square with a quiet margin. Strong readable silhouette at 160 pixels. The scene is an art field only, not a complete card or UI.
Lighting/palette: dark purple #0D0818 studio background, violet #B57BFF environmental light with small restrained subject-specific accents. Purple dominates rather than green. Readable material shadows, no excessive bloom or neon.
Constraints: original terrain and props, no commercial artwork or recognisable franchise designs; no people, lettering, numbers, logos, watermark, printed card border, rank, rules, UI, selection cue, route lines or implied place adjacency. Do not draw a complete geographic map.

## Exact subject prompts

### lair

Primary request: a mysterious creature lair formed by a single broad jagged cave mouth in violet-black rock, with a few rose-purple crystal shards and faint scratches at its entrance. No shelter building or technology; the opening is the unmistakable focal point.

### jungle

Primary request: a dense compact grove of tall alien broad-leaf plants, violet-purple foliage with subtle magenta veins, curling roots and a small dark clearing. Distinct canopy silhouette, no cave, waterway or machinery.

### river

Primary request: one luminous ribbon of flowing pale violet water crossing a dark stone miniature base, smooth banks and one curving alien fern. The water channel, not a bridge, is the clear focal point. Tiny restrained amber mineral flecks.

### beach

Primary request: a small crescent of dusky lavender sand meeting calm dark-purple water, with a single original compact brass rescue beacon on a low tripod at the high shore. Warm amber glass, weathered metal, no flashing state indicator or beam showing a game event.

### rover

Primary request: a complete small functional alien expedition rover, a sturdy original four-wheeled exploration vehicle with weathered ceramic-metal body and turquoise glass, parked on violet stony terrain. Fully intact, recognisably wheeled, no wreckage, spaceship or people.

### swamp

Primary request: a compact murky purple wetland pool with a few twisted low roots, bronze-brown reeds and unusual rounded fungi. Waterlogged low silhouette rather than a tall jungle canopy. Tangible glossy resin water, no route markings.

### shelter

Primary request: a small intact human-built expedition shelter, a closed angular habitat pod with a visible reinforced doorway, a dim restrained mint interior window and an awning, on purple rock. Clearly protective engineered housing, not a cave or derelict wreck. No people or writing.

### wreck

Primary request: broken fragments of an original exploration spacecraft hull, a torn engine ring and buckled wing section partly embedded in purple rocks, with restrained cool-blue glass. Clearly damaged spaceship debris, no functioning wheeled vehicle or occupied shelter. No fire or violence.

### source

Primary request: a small clear pearlescent spring bubbling from a bowl-shaped violet mineral formation, thin pale aqua water cascading into a contained pool, a few luminous crystal nodules. Calm restorative atmosphere, no technology, wide river or swamp.

### artefact

Primary request: a mysterious original sculptural alien artefact, two offset carved ivory-metal arcs hovering close around one violet crystalline core on a low stone pedestal. Subtle physical support integrated into the sculpture, elegant and tangible, no runes, readable symbols, numerical values or magical UI.

## Recorded outputs

Each original is 1254×1254 and copied unchanged into this directory as `not-alone-place-{name}.png`. Original generation and optimised 320×320 outputs were personally inspected. The ten WebPs total 194,216 bytes, below the 320 KiB collection budget; every image stays below 48 KiB. Full source/output hashes, sizes and deterministic width-only encoding are recorded in each `apps/mobile/assets/game-art/not-alone-place-{name}-manifest.json`. All thirteen shared asset tests and all ten deterministic regeneration checks pass. These assets are prepared only; Not Alone's UI and rendered acceptance are still outstanding.

| Place | Original generated filename |
| --- | --- |
| lair | `exec-1f059a29-3a57-4f54-8bde-435825a7cc48.png` |
| jungle | `exec-c7f1e9e5-cdcb-4255-af72-cbd36c4879e6.png` |
| river | `exec-3279bee5-1abf-432a-943b-b9efcdb1f553.png` |
| beach | `exec-44d1352d-30ac-49b2-aacd-4e010f8086e1.png` |
| rover | `exec-aa86662d-d4da-44c2-be93-740cdc835bbb.png` |
| swamp | `exec-991cf05f-6ac7-4752-9e0d-6bb106d9f9fd.png` |
| shelter | `exec-43567f41-2b7d-48da-93d7-3896c1e32ee6.png` |
| wreck | `exec-e1f80320-255a-4262-9f93-a88c9d80d7fc.png` |
| source | `exec-47c15d14-4293-47e7-8f6a-8c3859537915.png` |
| artefact | `exec-86824b86-9e30-4a70-89da-ed071fe219ca.png` |
