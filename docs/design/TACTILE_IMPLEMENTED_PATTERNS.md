# Tactile interface patterns

This guide describes the implemented Expo/React Native components, not a separate HTML design system. [DESIGN.md](../../DESIGN.md) sets the visual direction; [the testing guide](../TESTING.md) separates source, rendered, full-game and native verification.

Follow the [game theme contract](GAME_THEME_CONTRACT.md) when implementing a new
game. `constants/typography.ts` owns same-role font weights; per-game colour and
mechanics do not justify a second room-form, button or navigation type system.

## Visual authority

- [theme.ts](../../apps/mobile/constants/theme.ts) owns the Arcade and game palettes. Preserve each game's identity, including purple Not Alone and spectral-white Skull King. NativeWind configuration mirrors the relevant tokens.
- Outfit is the display and body family; Space Mono is for room codes, scores and short data labels. Rules remain live text, not part of a bitmap.
- Original miniature illustrations introduce games and decorate recognised card categories. Stateful paths, dice, cards, counters, ownership and legal targets remain code-native.
- Production artwork and manifests live in `apps/mobile/assets/game-art`. Original masters and exact generation prompts live in `docs/design/game-art`. The manifests retain source/output hashes and encoding settings.
- The locked controller identity is documented in [ARCADE_BRAND.md](ARCADE_BRAND.md).

Material lighting is local to playing pieces: restrained thickness, directional highlights, contact shadows and recessed board slots. It does not require a WebGL scene or continuous decorative motion.

Kraken character portraits use one original 2:3 composition per character. The
rulebook shows the complete set; gameplay renders only the local private
character or a character already present in the public projection. Decorative
test identifiers and accessibility labels must not disclose concealed identities.

Cartographers has a distinct landscape illustration for each drawing card, plus
one illustration per scoring category. Its terrain symbols, selectable map cells,
placement shapes and objective examples remain live graphics below the artwork.
The art is thematic, not a source of legal placement or scoring information.

## Consistent painted cards

Compare the visible card face, not merely its outer wrapper. Consistency applies within the same family and role, not between a die, path tile, crew card and power card.

### Measured collections

[CardGrid](../../apps/mobile/components/ui/CardGrid.tsx) calculates tracks from available width, gap, minimum/maximum card width and text scale. Track width does not depend on item count, so the last item does not expand just because its row is incomplete.

[useMeasuredLayoutWidth](../../apps/mobile/hooks/useMeasuredLayoutWidth.ts) reads precise web layout width rather than relying only on rounded React Native Web layout events. Native and server-rendered paths retain event measurements. Keep fractional widths through track calculation to avoid accidental desktop wrapping.

Rows stretch their children, but every wrapper between the row and painted surface must preserve that stretch. [CardSurface](../../apps/mobile/components/ui/CardSurface.tsx) provides opt-in `fill` for this purpose. A tall outer wrapper with an unstretched face is still an unequal-card defect.

[LibertaliaLootCollection](../../apps/mobile/components/libertalia/Loot.tsx) is an example: current, voyage and collected loot share the same collection. Compact and full variants have distinct width bounds, preserve token order, and combine native/measured scale once. Full cards retain complete help text; compact cards retain their accessible effect description.

Same-row peers share face height. Separate wrapped rows may have different intrinsic heights. Never impose a fixed height or remove rules solely to make a geometry assertion pass.

### Caption-bearing rails

[useIntrinsicCardHeight](../../apps/mobile/hooks/useIntrinsicCardHeight.ts) supports comparable faces with captions outside the card. It measures natural face content and tracks the current layout/member epoch, discarding stale measurements after membership or layout changes.

Keep owner names and programme captions outside the measured face. Otherwise a longer player name changes the card's apparent size. Skull King, Not Alone and Colt use this pattern where appropriate.

### Enlarged text

[useMeasuredTextScale](../../apps/mobile/hooks/useMeasuredTextScale.ts) measures an existing live text element on web and combines its ratio with native font scale. It does not introduce a hidden measurement label or alter the text itself.

Allow enlarged text to reduce columns, move metadata beneath a heading or increase intrinsic height. Do not shrink enlarged text, clip a long title or substitute an ellipsis for required rules. Preserve separate dimensions for intentionally different pieces, including Saboteur's capped 5×9 board and its hand cards.

## Shared surface and artwork components

### CardSurface

The surface accepts optional width/height, `fill`, radius, face/edge/highlight colours, depth, selected and disabled states. Depth defaults to 3 and is bounded to 0–4. Its offset underlay does not change the parent's nominal hit target.

The caller owns interaction, semantics and legal-action state. Decorative edges and highlights do not intercept input or appear as separate accessibility elements. Use lower depth inside narrow board gutters.

### CardIllustration

[CardIllustration](../../apps/mobile/components/ui/CardIllustration.tsx) prints decorative artwork across the card face without its own border, rounding, shadow or width cap. The illustrated card families use it inside a single outer `CardSurface`. Keep padding on live header and rules sections, not around the illustration. Compact public markers and paired Saboteur tools are distinct layouts, not inset versions of a full card.

Match the field to the source proportions: square for most original-game illustrations, 2:3 for Kraken portraits and Dixit images, and landscape for navigation and Cartographers. Bound the whole card when a standalone desktop face needs a maximum width. Do not squeeze a square portrait into a landscape well or frame a miniature image inside another card. The source-specific failure fallback preserves the same footprint. Live ranks, costs, names, rules and action state remain readable when artwork fails.

### GameCover and GameTile

[GameCover](../../apps/mobile/components/ui/GameCover.tsx) reserves a bounded aspect-ratio footprint and explicitly sizes its contained image. It retains full composition, handles source-specific loading failures and accepts a fallback. Do not assume every caller supplies one.

[GameTile](../../apps/mobile/components/ui/GameTile.tsx) owns the live title, player count, description and navigation action. Artwork is decorative; the accessible label comes from live content. Measured library columns and short-landscape composition keep identity and navigation usable without requiring the full illustration to dominate the viewport.

Preserve visible focus, pressed and disabled feedback. Do not add a second interactive layer over the tile artwork.

### Entrances and lobbies

[RemainingLanding](../../apps/mobile/components/remaining/RemainingLanding.tsx) provides the illustrated entrance variant. Introduction and form sit beside each other only when content width and text scale permit; otherwise they stack. Short viewports bound the decorative artwork independently of the form.

Preserve labelled inputs, validation focus, busy/repeat-submit guards, optional-password guidance and actual create/join behaviour. Lobbies prioritise roster, host controls and readiness over artwork. A static screen is not a substitute for testing these behaviours.

## Motion and accessibility

[ScalePressable](../../apps/mobile/components/ui/ScalePressable.tsx) supplies pressed feedback and semantic selected/busy/expanded/disabled state. [useReducedMotionPreference](../../apps/mobile/hooks/useReducedMotionPreference.ts) observes the motion preference; spatial press or selection travel is removed when reduced motion is requested.

[GlowPulse](../../apps/mobile/components/ui/GlowPulse.tsx) becomes steady under reduced motion and cancels its animation when appropriate. Global web CSS also bounds transitions and exposes visible keyboard focus. Essential state never waits for an animation to finish.

Decoration stays out of accessibility traversal. Full effect text, legal-action labels, ownership and concealed/public state must remain correct when images fail, motion is disabled or text grows. Browser-emulated touch and CSS enlargement do not establish VoiceOver, TalkBack or OS text-scaling acceptance.

## Verification when changing a pattern

1. Test the actual shared component and its real collection, including empty, one-item, mixed-length, selected and disabled cases.
2. Measure painted width/height, row packing and glyph containment at normal/enlarged phone and desktop widths.
3. Inspect the screenshots. A passing overflow assertion does not establish readability or good composition.
4. Confirm affected inline game-route parents and real actions separately from the isolated [component gallery](../../tools/card-gallery/README.md).
5. Preserve exact IDs, hit targets, authoritative revisions, private projections, recovery and full-lifecycle evidence.

Do not infer whole-game correctness from an isolated gallery, or native/distribution readiness from a local web render or successful bundle.
