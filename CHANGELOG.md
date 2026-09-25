# Changelog

## Unreleased

### Games

- Added local implementations of Feed the Kraken, Telestrations (12-player
  edition), Cartographers Heroes and Dixit Odyssey (2024 base), with completed
  local full-game browser checks. This is not a deployment-readiness claim.
- Added title-specific creation options, private decision windows, forfeit
  recovery, rulebooks and original cover artwork for the four additions.
- Completed the 84-image original Dixit deck with consistent full-composition
  card faces and mobile asset budgets.
- Added illustrated Kraken course cards and a visual navigation reference.
  Ritual responses no longer reveal an absent hidden role through phase changes;
  Look-Out shows the inspected top card even while holding a navigation hand.
  Navigator forfeiture consistently settles the committed pair.
- Fixed Chief Cook and Drunk effects appointing a tongueless Kraken captain
  when the current captain is the only eligible survivor.
- Replaced raw Kraken chart coordinates with readable waypoints and named
  destinations; the current position now displays a vessel token.
- Registered the semibold Outfit face used by Cartographers and added a
  suite-wide font-registration regression.
- Shuffled Telestrations' original prompt pool per game, exhausting it before
  reuse instead of repeating the same menus in every new room.

- Added selectable Coup Reformation + Inquisitor rooms for 2–10 players,
  including allegiance setup, conversion, Treasury embezzlement and private
  examination. Base Coup remains the default 2–6-player version.
- Expanded Saboteur and Coup with King of Tokyo, Skull King, Citadels, Not Alone,
  BANG!, Libertalia: Winds of Galecrest and Colt Express, including room setup,
  authoritative engines, private state, gameplay and results.

### Interface

- Reworked cards across King of Tokyo, Skull King, Citadels, Not Alone, BANG!,
  Libertalia and Colt Express to use one physical frame and full-width artwork.
  Removed nested illustration panels while preserving live rules, hidden-card
  boundaries, accessible actions and consistent same-row card heights.
- Added 21 original Kraken character portraits and 23 Cartographers illustrations
  covering every drawing card and the four scoring categories. Preserved live
  rules, placement diagrams, private-character boundaries and uncropped artwork.
- Let Telestrations and Cartographers game-header controls wrap below enlarged
  titles, retaining readable words and full-size rules/leave buttons.
- Moved PWA installation and update controls to the bottom of the desktop
  sidebar and mobile navigation drawer, keeping the game library unobstructed.
- Hide installation controls in standalone mode and after a recognised install,
  including returning visits and other tabs. Native browser install offers
  restore the option after an uninstall.
- Restored the complete controller/Z favicon and versioned its exported URL
  so browser tabs refresh the corrected artwork.
- Added an online-first installable PWA with controller/Z home-screen icons,
  browser installation guidance, offline recovery and room-safe update controls.
- Added 252 custom illustrations across all nine games, including individual
  characters, named cards, card backs, faction seals and board scenery.
- Refined card faces with directional bevels, recessed artwork and neon edges;
  kept readable rules and interactive state separate from the illustrations.
- Stacked smaller ARCADE beneath ZUYCHIN beside the controller logo, centred
  the full header lockup and left-aligned sidebar branding.
- Corrected Citadels role heights, count-dependent hand widths, enlarged-text
  rulebook headers, Colt Express roof alignment and wrapped character-choice faces.
- Added illustrated, mechanics-specific teaching sections to all nine rulebooks,
  with Coup's character reference reused before play and expandable detailed
  chapters for the other games.
- Centred the mobile header branding between balanced side controls.
- Replaced internal privacy-page instructions with player-facing data and
  contact information. Rankings now show a public administrator-disabled notice
  without exposing internal setup details.
- Replaced the camera-derived Arcade identity with the Zuychin controller mark
  and generated navigation, launcher and favicon assets.
- Added game-specific artwork and tactile cards, tiles, tokens and boards across
  the nine-game arcade, with responsive phone and desktop layouts.
- Made comparable card faces share row heights and measured column widths while
  retaining full rules, compact pieces and scrollable hand rails.
- Improved enlarged-text layouts, keyboard focus, private-choice presentation,
  result rosters and shared navigation.

### Reliability and verification

- Passed all 1,573 client regressions, mobile/gallery TypeScript and scoped lint
  for the seven-game card revision on 25/09/2026. A fresh component-gallery web
  export passed 40 rendered phone/desktop cases, including 200% CSS text.
  This is not a new full-game campaign or physical-device acceptance.
- Excluded generated web/native exports from mobile typechecking, preventing
  retained minified bundles from exhausting the typecheck heap.
- Added focused engine, socket and client regressions for the four additions,
  including rematch revision fencing and restored private drawings.
- Passed all 1,553 mobile and 917 server regressions, final web/Android/iOS
  bundle exports and the server production build on 24/09/2026. Full-game browser evidence
  includes all four additions, with limits documented separately.
- Extended the optional results setup SQL with per-game limits for 11-, 12-
  and 100-seat games. This repository change does not apply hosted SQL.

- Hardened authoritative command revisions, private projections, reconnect and
  departure handling while preserving the disclosed digital game adaptations.
- Added component sizing, game-route and canonical fixture checks, with separate
  rendered-web evidence and preserved failure records.
- Added a public testing guide and database-free local setup defaults.
- Completed local web and Android/iOS Hermes bundle checks with configured
  API-origin validation on 23/09/2026.

### Release boundaries

- Local checks do not establish signed-build, physical-device, hosted-persistence
  or production-deployment acceptance. Exporting bundles is not a device test.
- Active rooms remain process-local. Public hosting and distribution remain
  subject to the applicable rights-holder permissions.

See [Testing](docs/TESTING.md) for reproducible commands and evidence limits,
and [game rules notes](README.md#game-rules-notes) for public adaptations.
