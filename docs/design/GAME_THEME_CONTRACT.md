# Game theme contract

Every game belongs to the same Arcade application. A game's palette, illustrations
and mechanics can differ. Equivalent controls, typography roles, room flows and
accessibility behaviour must not differ accidentally. This contract applies to
new games and changes to existing games, alongside [DESIGN.md](../../DESIGN.md)
and the [implemented component guide](TACTILE_IMPLEMENTED_PATTERNS.md).

## Authoritative sources

- `apps/mobile/constants/theme.ts`: shared and per-game colour values.
- `apps/mobile/constants/typography.ts`: the installed font face for each role.
- Existing shared components: behaviour, sizing and interaction defaults.
- Game contracts and public/private projections: state, legal actions and secrets.
- `apps/mobile/assets/game-art/*-manifest.json`: generated-asset identity,
  proportions, hashes and encoding budgets.

Do not copy a screen and then invent a second set of common UI defaults. Extend
the existing shared component where the behaviour is genuinely shared. A new
game-specific component is appropriate for an actual board, hand, decision or
rules diagram, not a differently styled room form.

## Typography roles

Import `TYPOGRAPHY`; use its installed face rather than combining an arbitrary
`fontWeight` with a regular font. That combination can synthesise bold on web
and select a different face on native. All role fonts are registered in the
root layout, including the semibold face used by existing compact game pieces.
The startup/font-failure screen may use the system fallback so recovery does
not depend on the resource that failed.

| Role | Font face | Shared size and use |
| --- | --- | --- |
| `display` | Outfit 800 | Game identity and outcome. Size responds to the surface; entrance titles use 24/28/36 px. |
| `navigation` | Outfit 800 | 18 px in every game Stack header. Weight `normal` avoids adding synthetic weight to the already-bold face. |
| `heading` | Outfit 700 | 16/24 px for setup sections. Rulebook/gameplay headings may use a larger size with the same face. |
| `control` | Outfit 700 | 16/22 px, no tracking, for primary, secondary and choice-button labels. |
| `body` | Outfit 400 | 16/24 px for prose, instructions, inputs, validation and recovery. |
| `label` | Outfit 700 | 12/18 px, tracking 1, for short form labels, not paragraphs or rules. |
| `data` | Space Mono 700 | Room codes, scores and compact numeric data. Size follows the data surface. |

`RoomCodeDisplay` keeps its existing responsive Outfit 800 display code and
tracking as an explicit exception; changing that face would change its verified
room-code width. The join field and ordinary data retain Space Mono.

Weight conveys a role, not which game was implemented most recently. Keep
descriptions regular, headings bold and data distinct. Do not make a whole
paragraph bold to make a page appear more substantial. Compact card metadata
can retain its established size when tested with enlarged text; it is not the
default for new prose. Never clamp required rules or shrink text to force equal
card heights.

## Colour and identity

Define a coherent palette with `bg`, `surface`, `panel`, `border`, readable
`text`/`muted`, and primary/secondary accents. Existing named tokens such as
`gold` may be mapped to the shared components' `accent` slot at the route boundary.
Do not duplicate the palette in a component. Distinct game palettes are
intentional, not inconsistencies: preserve purple Not Alone, spectral-white
Skull King and Kraken's deep-sea blue. Telestrations uses warm paper, raspberry
and ochre, including its entrance artwork.

Normal body, muted, placeholder and button text must reach 4.5:1 contrast against
the actual surface beneath it; large display text needs at least 3:1. A colour
that works on the game background may fail on a raised panel or the dark hub.
Check each painted pair rather than inheriting an ancestor's text colour.

Light games explicitly provide `onAccent` and `controlSurface` to shared solid,
outline and recovery controls. The hub can use a separate `catalogueAccent` for
contrast on the Arcade shell. Error text needs a theme-appropriate danger token.
Do not reuse a pale dark-theme error colour on white paper.

Colours with gameplay meaning are independent of decorative themes. Keep
Kraken course colours, Telestrations player ink, card suits, terrain and faction
identities stable. Pair state colours with labels or symbols. Never change a
player's stored drawing to match a new theme.

## Shared surface ownership

| Surface | Required pattern | Permitted game variation |
| --- | --- | --- |
| Hub | `GameTile` and `GameCover` | Original scene, title, hook, player count, contrast-safe accent |
| Entrance | `RemainingLanding`, illustrated presentation | Scene, truthful tagline, setup choices and labels |
| Join | `RemainingJoin` | Palette, title and mark; same validation, room-code behaviour and controls |
| Lobby | `RemainingLobby` and `RoomCodeDisplay` | Game-specific setup/readiness details; same roster, host and connection hierarchy |
| Navigation | `TYPOGRAPHY.navigation` and existing back controls | Title and palette; preserve route and leave semantics |
| Rules modal | `RulesReferenceSheet` interaction and header pattern | Mechanics-specific diagrams, real public card references and detailed chapters |
| Card face | One `CardSurface` with frameless `CardIllustration` | Source ratio, family width, live metadata, legal selection state |
| Recovery | `GameRecovery` | Message and palette, including light-theme control colours |
| Results | Outcome, eligibility and next action before optional inspection | Scoring details, board/log inspection and authorised rematch |

Coup's persistent in-game reference sidebar is intentional. Keep its selected
version and real character/action references while its modal variant follows
the shared dismissal, focus and header conventions. Shared rulebook chrome
does not mean shared generic content: tunnels, bluffing, dice, tricks, drafting,
pursuit, range, ranked crew, programming, navigation, drawing relays, map
placement and clue voting need their own visual explanations.

## Artwork and card geometry

Art belongs on the physical card face, not inside a second miniature card.
`CardSurface` owns corner clipping, edge depth and selection lighting.
`CardIllustration` owns the decorative image's source ratio and fallback only.
It must not add padding, rounding, borders, shadows or a narrower maximum width.
Put spacing around live text; bound the entire card when needed on desktop.

Use square fields for square sources, 2:3 for Kraken portraits and Dixit,
and the source landscape ratio for navigation and Cartographers. Preserve full
composition unless a deliberate crop is documented and visually reviewed.
Compact public markers, dice, paths and paired repair tools are different
piece types, not full-card sizing exceptions.

`CardGrid` owns track width independently of item count. Preserve `fill` through
every wrapper so the painted faces, not just their containers, share same-row
heights. Caption-bearing rails use `useIntrinsicCardHeight` so player names do
not change card geometry. Separate wrapped rows may grow naturally. Do not
stretch the last card, hide rules, or impose a fixed height on mixed copy.

Generate original raster art when it adds theme or recognition. Do not bake
essential names, rules, costs, status or legal-action information into the image.
Use the existing generation pipeline, retain the master and exact prompt, and
verify runtime hashes, byte budgets and failure fallback. Player drawings and
code-native board geometry must not be replaced by decorative bitmaps.

## Layout, states and access

Phone-first means readable at 320 px, not desktop layouts scaled down. Desktop
still receives an intentional composition. Use available container width and
`useMeasuredTextScale` where column count depends on text; native `fontScale`
alone does not detect browser text enlargement. Space related elements on a
four-point rhythm, with more separation between sections than within a group.

Use at least 48 px for ordinary buttons and room inputs, with the existing
minimum 44 px touch-target contract for compact primary interactions. Keep
visible focus, pressed/selected/disabled/busy states and accessible names.
Do not add a second interactive layer over an illustration. Decorative layers
are noninteractive and excluded from accessibility traversal.

Allow long labels and 200% text to wrap or stack. Essential content must remain
reachable with short landscape heights and the software keyboard. A deliberate
horizontal board/hand scroller is valid; accidental document overflow is not.
Reduced motion removes spatial travel without delaying or hiding state.

Preserve empty, loading, disconnected, failed-image and recoverable-error states.
UI consistency must not weaken duplicate-submit guards, revision checks,
session ownership, forfeit policies or hidden-information boundaries.

## Acceptance for every new game

1. Map its palette and typography roles to these shared components before
   implementing the route. Record only genuine exceptions here or in its guide.
2. Exercise entrance, setup options, join, lobby, gameplay, rules, results,
   leave and recovery. Include at least one long-content/empty/error case.
3. Run mobile TypeScript, changed-file lint and relevant client/component tests.
   Extend typography, navigation, contrast, artwork and card-geometry regressions
   when adding a family. A source scan alone is not visual acceptance.
4. Inspect the fresh rendered bundle at 320/375 px and 1280 px; include 200%
   phone/desktop text, 414/768 px measurements and short landscape. Check loaded
   fonts, painted text contrast, actual card faces, corners and image fallback.
5. Verify keyboard/focus, touch-sized controls, reduced motion and actual actions.
   Keep synthetic component fixtures separate from real room/lifecycle evidence.
6. Record what was checked and remaining gaps in [TESTING.md](../TESTING.md).
   Web screenshots and exports do not establish native iOS/Android, screen-reader,
   cross-browser, signing or deployment acceptance.

Relevant regressions include `game-navigation-titles.test.cjs`,
`game-theme-contrast.test.cjs`, `game-library-design.test.cjs`, the shared journey
and rules-reference suites, and each game's material/artwork tests. These are
living guards, not proof that a new game is correct merely because it compiles.
