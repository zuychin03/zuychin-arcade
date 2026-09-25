# Four-game artwork coverage

These assets extend the original thirteen-game interface. Illustrations were generated with the built-in imagegen tool, not copied from publisher cards. Source illustrations and exact prompts are retained here; the mobile application consumes only optimised WebP derivatives. Original artwork does not establish permission to distribute the named games.

## Coverage

- Feed the Kraken: one distinct portrait for each of its 21 characters, used in the rulebook and authorised private/revealed views. The three course illustrations remain intentionally reusable.
- Cartographers Heroes: 19 distinct drawing-card scenes and four shared objective-category scenes. Objective illustrations represent their category, not individual scoring patterns. Live diagrams remain the scoring reference.
- Dixit Odyssey: the existing 84 distinct dream-card illustrations are unchanged.
- Telestrations: the hub and entrance use a [warm-paper edit](telestrations-sketchbooks-warm.png) of the preserved original cover, with raspberry and ochre accents. The [exact built-in edit prompt](telestrations-sketchbooks-warm-prompt.md) records its provenance. The playable drawings are created by players, so the drawing surface contains no generated decoration.

## Encoding and integration

The shared `apps/mobile/scripts/generate-game-art.cjs` registry defines exact dimensions, encoding quality and byte budgets. It preserves the full composition without cropping, padding or upscaling. Per-image manifests beside the WebP files record source/output SHA-256 hashes, dimensions, encoder versions and budgets.

Kraken portraits are 480 × 720 with a 70 KiB per-image ceiling. Cartographers scenes are 640 × 427 with a 90 KiB ceiling. Art remains decorative and non-interactive; names, rules, diagrams and legal actions remain live interface elements. Failed images retain a bounded footprint and readable live content. CardSurface and CardGrid preserve tactile frames and matching same-row face heights without clipping enlarged rules text.

Cartographers artwork uses a centred 3:2 frame capped at 480 logical pixels wide, keeping its height at or below 320 pixels even when a current card spans a tablet panel. Kraken's private portrait uses an 80 × 120 frame with wrapping live copy; unopened private information does not mount the portrait.

## Kraken character set

| Identity | Source | Runtime | Exact prompt |
| --- | --- | --- | --- |
| kleptomaniac | [PNG](kraken-character-kleptomaniac.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-kleptomaniac.webp) | [Prompt](kraken-character-kleptomaniac-prompt.md) |
| troublemaker | [PNG](kraken-character-troublemaker.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-troublemaker.webp) | [Prompt](kraken-character-troublemaker-prompt.md) |
| gunsmith | [PNG](kraken-character-gunsmith.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-gunsmith.webp) | [Prompt](kraken-character-gunsmith-prompt.md) |
| peacemaker | [PNG](kraken-character-peacemaker.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-peacemaker.webp) | [Prompt](kraken-character-peacemaker-prompt.md) |
| gunslinger | [PNG](kraken-character-gunslinger.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-gunslinger.webp) | [Prompt](kraken-character-gunslinger-prompt.md) |
| minstrel | [PNG](kraken-character-minstrel.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-minstrel.webp) | [Prompt](kraken-character-minstrel-prompt.md) |
| boatswain | [PNG](kraken-character-boatswain.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-boatswain.webp) | [Prompt](kraken-character-boatswain-prompt.md) |
| herbalist | [PNG](kraken-character-herbalist.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-herbalist.webp) | [Prompt](kraken-character-herbalist-prompt.md) |
| lookout | [PNG](kraken-character-lookout.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-lookout.webp) | [Prompt](kraken-character-lookout-prompt.md) |
| master strategist | [PNG](kraken-character-master_strategist.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-master_strategist.webp) | [Prompt](kraken-character-master_strategist-prompt.md) |
| smuggler | [PNG](kraken-character-smuggler.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-smuggler.webp) | [Prompt](kraken-character-smuggler-prompt.md) |
| agitator | [PNG](kraken-character-agitator.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-agitator.webp) | [Prompt](kraken-character-agitator-prompt.md) |
| adviser | [PNG](kraken-character-adviser.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-adviser.webp) | [Prompt](kraken-character-adviser-prompt.md) |
| chief cook | [PNG](kraken-character-chief_cook.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-chief_cook.webp) | [Prompt](kraken-character-chief_cook-prompt.md) |
| rabble rouser | [PNG](kraken-character-rabble_rouser.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-rabble_rouser.webp) | [Prompt](kraken-character-rabble_rouser-prompt.md) |
| archivist | [PNG](kraken-character-archivist.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-archivist.webp) | [Prompt](kraken-character-archivist-prompt.md) |
| mentor | [PNG](kraken-character-mentor.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-mentor.webp) | [Prompt](kraken-character-mentor-prompt.md) |
| spiritualist | [PNG](kraken-character-spiritualist.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-spiritualist.webp) | [Prompt](kraken-character-spiritualist-prompt.md) |
| debt collector | [PNG](kraken-character-debt_collector.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-debt_collector.webp) | [Prompt](kraken-character-debt_collector-prompt.md) |
| negotiator | [PNG](kraken-character-negotiator.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-negotiator.webp) | [Prompt](kraken-character-negotiator-prompt.md) |
| instigator | [PNG](kraken-character-instigator.png) | [WebP](../../../apps/mobile/assets/game-art/kraken-character-instigator.webp) | [Prompt](kraken-character-instigator-prompt.md) |

## Cartographers drawing and objective sets

| Identity | Source | Runtime | Exact prompt |
| --- | --- | --- | --- |
| lagoon | [PNG](cartographers-lagoon.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-lagoon.webp) | [Prompt](cartographers-lagoon-prompt.md) |
| pasture | [PNG](cartographers-pasture.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-pasture.webp) | [Prompt](cartographers-pasture-prompt.md) |
| settlement | [PNG](cartographers-settlement.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-settlement.webp) | [Prompt](cartographers-settlement-prompt.md) |
| timber grove | [PNG](cartographers-timber_grove.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-timber_grove.webp) | [Prompt](cartographers-timber_grove-prompt.md) |
| hillside terrace | [PNG](cartographers-hillside_terrace.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-hillside_terrace.webp) | [Prompt](cartographers-hillside_terrace-prompt.md) |
| frontier dwelling | [PNG](cartographers-frontier_dwelling.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-frontier_dwelling.webp) | [Prompt](cartographers-frontier_dwelling-prompt.md) |
| wildwood garden | [PNG](cartographers-wildwood_garden.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-wildwood_garden.webp) | [Prompt](cartographers-wildwood_garden-prompt.md) |
| woodland crossroads | [PNG](cartographers-woodland_crossroads.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-woodland_crossroads.webp) | [Prompt](cartographers-woodland_crossroads-prompt.md) |
| coastal encampment | [PNG](cartographers-coastal_encampment.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-coastal_encampment.webp) | [Prompt](cartographers-coastal_encampment-prompt.md) |
| mangrove swamp | [PNG](cartographers-mangrove_swamp.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-mangrove_swamp.webp) | [Prompt](cartographers-mangrove_swamp-prompt.md) |
| kethras gates | [PNG](cartographers-kethras_gates.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-kethras_gates.webp) | [Prompt](cartographers-kethras_gates-prompt.md) |
| dobrik | [PNG](cartographers-dobrik.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-dobrik.webp) | [Prompt](cartographers-dobrik-prompt.md) |
| wren | [PNG](cartographers-wren.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-wren.webp) | [Prompt](cartographers-wren-prompt.md) |
| freyla | [PNG](cartographers-freyla.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-freyla.webp) | [Prompt](cartographers-freyla-prompt.md) |
| dal | [PNG](cartographers-dal.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-dal.webp) | [Prompt](cartographers-dal-prompt.md) |
| dragon | [PNG](cartographers-dragon.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-dragon.webp) | [Prompt](cartographers-dragon-prompt.md) |
| zombie | [PNG](cartographers-zombie.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-zombie.webp) | [Prompt](cartographers-zombie-prompt.md) |
| troll | [PNG](cartographers-troll.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-troll.webp) | [Prompt](cartographers-troll-prompt.md) |
| gorgon | [PNG](cartographers-gorgon.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-gorgon.webp) | [Prompt](cartographers-gorgon-prompt.md) |
| objective-forest | [PNG](cartographers-objective-forest.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-objective-forest.webp) | [Prompt](cartographers-objective-forest-prompt.md) |
| objective-village | [PNG](cartographers-objective-village.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-objective-village.webp) | [Prompt](cartographers-objective-village-prompt.md) |
| objective-farm-water | [PNG](cartographers-objective-farm-water.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-objective-farm-water.webp) | [Prompt](cartographers-objective-farm-water-prompt.md) |
| objective-general | [PNG](cartographers-objective-general.png) | [WebP](../../../apps/mobile/assets/game-art/cartographers-objective-general.webp) | [Prompt](cartographers-objective-general-prompt.md) |
