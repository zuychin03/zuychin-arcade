# Zuychin Arcade design system

This records the implemented tactile direction of the Expo/React Native application. [Reusable patterns](docs/design/TACTILE_IMPLEMENTED_PATTERNS.md) describe the shared components, and [the testing guide](docs/TESTING.md) documents verification and release limits.

The [game theme contract](docs/design/GAME_THEME_CONTRACT.md) is the implementation
rule for all existing and future games. It defines shared typography roles,
palette contrast, card framing, rulebook ownership and acceptance checks.

## Direction and page families

Genre: playful, material-rich tabletop worlds. Phone screens are the primary composition, with mobile web the main delivery channel. Desktop expands this experience instead of setting its proportions, and remains an explicit target for every game and complete lifecycle. The library is an illustrated catalogue; game entrances pair a meaningful scene with clear create/join controls. Gameplay is a readable tabletop with code-native stateful pieces, not a marketing page.

- Library: image-led choices with title, player count and a concise game hook. One, two or three measured columns. Keep session recovery ahead of the library.
- Entrance: scene and room form side by side on wide screens, stacked on phones and with enlarged text. Rules remain a separate, accessible action.
- Lobby: player roster, host controls and readiness before decorative imagery.
- Gameplay: board, hand and state hierarchy determined by each game's actual actions. Preserve exact IDs, hit areas and hidden-information boundaries.
- Results and recovery: outcome and next action first, with decorations subordinate to the result.

The existing navigation shell and route ownership remain. No new global footer or marketing sections are required.

## Colour and typography

`apps/mobile/constants/theme.ts` remains authoritative for cross-platform colour tokens. The Arcade dark-violet shell supports the existing per-game palettes. Cards have luminous, per-game edge accents and full-width illustrations inside one physical frame, with stronger lighting for selection. Keep rules text free of glows and preserve purple Not Alone and spectral-white Skull King.

Telestrations uses warm paper, dark raspberry and ochre, including its sketchbook artwork. Its buttons opt into light-theme foreground and surface tokens; its catalogue accent remains readable against the dark Arcade shell. Feed the Kraken retains deep-sea blue. Navigation course colours and the drawing-ink palette carry game meaning and do not change with decorative themes.

Use the installed Outfit family through `constants/typography.ts`: 800 for display
and navigation, 700 for headings and controls, and 400 for body copy. Reserve
Space Mono for codes, scores and short data labels. Headings are upright; rules
and descriptions must not become tiny tracked uppercase text. Apply explicit
font faces consistently rather than relying on platform-default bolding.

React Native style values and the existing NativeWind configuration remain the implementation authority. Do not introduce a parallel CSS-only OKLCH theme or replace working native typography for a web-only skill recipe.

## Materials and imagery

- Original generated miniature scenes introduce games in the library and entrance. Keep prompt/source/hash provenance with optimised assets.
- Actual paths, cards, dice, counters and selectable targets stay code-native and reflect current state.
- Cards use bounded edge thickness, contact shadows, bevels and directional highlights. A single outer face clips the illustration to the card's corners; do not add a smaller rounded artwork frame inside it. Board slots read as recessed spaces.
- Decoration is noninteractive and excluded from the accessibility tree. Essential text remains live text.
- Preserve full scene composition where practical. Provide a bounded image footprint and a useful fallback on load failure.
- No new WebGL dependency, constant floating decoration or generic glow replacing material depth.

## Layout and interaction

Use a four-point spacing rhythm for new layouts, comfortable 16 px body copy, at least 44 px primary touch targets and no clipping at 200% text enlargement on phones as well as desktops. Avoid large empty illustration panels or decorative heroes that make core actions unnecessarily distant. Preserve usable short/landscape viewports, safe-area handling and keyboard access. Existing compact game controls may retain justified dimensions where the full-game audit establishes their usability.

Controls need visible keyboard focus, pressed feedback, disabled/loading behaviour and recoverable error states where applicable. Do not hide content behind delayed entrance animations. Preserve form focus order, double-submit prevention and leave/recovery semantics.

Motion explains a state change or direct interaction. Reduced motion removes spatial travel and repeating effects. Visible state must never depend on an animation finishing.

## Installed web app utilities

Installation and update controls sit at the bottom of the library sidebar or, on phones, inside the navigation drawer. Use the existing Arcade palette and at least 48 px control heights. Browser-specific installation help appears inline and scrolls with navigation when space is limited. Keep these utilities out of the main content and gameplay; an update must not interrupt a room or another active Arcade tab. The service-worker controller remains mounted independently of sidebar visibility.

Hide installation controls for recognised installations, without hiding available updates. On browsers with native install prompts, wait for the browser's offer; a fresh offer can clear a remembered installation after uninstall. Other browsers retain manual guidance when no installed signal is available.

The offline recovery page states that multiplayer needs a network connection and provides a retry action. It may explain that the app checks the previous seat after reconnecting, but must not promise that the seat or room remains available.

## Verification contract

For a changed surface, check the fresh served bundle at relevant widths from 320, 375, 414, 768 and 1280 px, plus a short landscape viewport. Include touch-sized controls, keyboard operation, image loading, 200% text at phone and desktop widths, and reduced motion. Review actual screenshots as well as measured geometry, correct material defects, then confirm. Keep source, isolated render, full browser journey and physical-device evidence distinct.

Compare painted card faces, not just their outer wrappers. Widths remain consistent within a family regardless of card count; same-row peers or comparison rails share face heights while separate wrapped rows may grow with their content. Never hide rules to satisfy a sizing assertion. Do not claim a universal design pass when native checks or individual game surfaces remain unverified.
