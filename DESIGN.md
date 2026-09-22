# Zuychin Arcade design system

This records the implemented tactile direction of the Expo/React Native application. [Reusable patterns](docs/design/TACTILE_IMPLEMENTED_PATTERNS.md) describe the shared components, and [the testing guide](docs/TESTING.md) documents verification and release limits.

## Direction and page families

Genre: playful, material-rich tabletop worlds. Phone screens are the primary composition, with mobile web the main delivery channel. Desktop expands this experience instead of setting its proportions, and remains an explicit target for every game and complete lifecycle. The library is an illustrated catalogue; game entrances pair a meaningful scene with clear create/join controls. Gameplay is a readable tabletop with code-native stateful pieces, not a marketing page.

- Library: image-led choices with title, player count and a concise game hook. One, two or three measured columns. Keep session recovery ahead of the library.
- Entrance: scene and room form side by side on wide screens, stacked on phones and with enlarged text. Rules remain a separate, accessible action.
- Lobby: player roster, host controls and readiness before decorative imagery.
- Gameplay: board, hand and state hierarchy determined by each game's actual actions. Preserve exact IDs, hit areas and hidden-information boundaries.
- Results and recovery: outcome and next action first, with decorations subordinate to the result.

The existing navigation shell and route ownership remain. No new global footer or marketing sections are required.

## Colour and typography

`apps/mobile/constants/theme.ts` remains authoritative for cross-platform colour tokens. The Arcade dark-violet shell supports the existing per-game palettes. Use accents to identify games and action states, not as constant neon borders or text glows. Preserve purple Not Alone and spectral-white Skull King.

Use the installed Outfit family for display and readable body copy. Reserve Space Mono for codes, scores and short data labels. Headings are upright; rules and descriptions must not become tiny tracked uppercase text.

React Native style values and the existing NativeWind configuration remain the implementation authority. Do not introduce a parallel CSS-only OKLCH theme or replace working native typography for a web-only skill recipe.

## Materials and imagery

- Original generated miniature scenes introduce games in the library and entrance. Keep prompt/source/hash provenance with optimised assets.
- Actual paths, cards, dice, counters and selectable targets stay code-native and reflect current state.
- Cards use bounded edge thickness, contact shadows and directional highlights. Board slots read as recessed spaces.
- Decoration is noninteractive and excluded from the accessibility tree. Essential text remains live text.
- Preserve full scene composition where practical. Provide a bounded image footprint and a useful fallback on load failure.
- No new WebGL dependency, constant floating decoration or generic glow replacing material depth.

## Layout and interaction

Use a four-point spacing rhythm for new layouts, comfortable 16 px body copy, at least 44 px primary touch targets and no clipping at 200% text enlargement on phones as well as desktops. Avoid large empty illustration panels or decorative heroes that make core actions unnecessarily distant. Preserve usable short/landscape viewports, safe-area handling and keyboard access. Existing compact game controls may retain justified dimensions where the full-game audit establishes their usability.

Controls need visible keyboard focus, pressed feedback, disabled/loading behaviour and recoverable error states where applicable. Do not hide content behind delayed entrance animations. Preserve form focus order, double-submit prevention and leave/recovery semantics.

Motion explains a state change or direct interaction. Reduced motion removes spatial travel and repeating effects. Visible state must never depend on an animation finishing.

## Verification contract

For a changed surface, check the fresh served bundle at relevant widths from 320, 375, 414, 768 and 1280 px, plus a short landscape viewport. Include touch-sized controls, keyboard operation, image loading, 200% text at phone and desktop widths, and reduced motion. Review actual screenshots as well as measured geometry, correct material defects, then confirm. Keep source, isolated render, full browser journey and physical-device evidence distinct.

Compare painted card faces, not just their outer wrappers. Widths remain consistent within a family regardless of card count; same-row peers or comparison rails share face heights while separate wrapped rows may grow with their content. Never hide rules to satisfy a sizing assertion. Do not claim a universal design pass when native checks or individual game surfaces remain unverified.
