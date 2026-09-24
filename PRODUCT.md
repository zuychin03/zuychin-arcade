# Zuychin Arcade

<!-- impeccable:product-schema 1 -->

## Platform

web

The shared Expo/React Native application also targets iOS and Android. Web is the primary access channel, with most usage expected on mobile devices. Design phone-first, especially mobile web; desktop is the secondary expansion. Web evidence does not establish native acceptance.

## Product purpose

Multiplayer board and card games, from creating or joining a room through the lobby, gameplay, results and reconnect recovery. The thirteen-game suite includes Saboteur, Coup, King of Tokyo, Skull King, Citadels, Not Alone, BANG!, Libertalia, Colt Express, Feed the Kraken, Telestrations, Cartographers Heroes and Dixit Odyssey. The four latest additions have completed local full-game browser checks; device and deployment acceptance remain separate.

## Users and operating context

Players share room codes and play together, primarily on phones, with desktop support. The design must support choosing a game, reading its essential rules, joining a table and understanding legal actions and public state on small screens. No audience demographics or commercial claims are established.

## Capabilities and constraints

- Preserve authoritative game rules, server actions, session recovery and public/private information boundaries.
- Preserve the capped 5×9 Saboteur board and title-specific digital rule adaptations documented in README.md.
- Treat every game's entrance, lobby, gameplay and results as one experience.
- Keep room sessions and result persistence independent of decorative presentation changes.

## Brand commitments

The angular Z controller logo is Arcade's locked identity. The experience is graphical and tactile, with restrained three-dimensional treatment of cards, boards and illustrations. Text remains essential for rules and action clarity. Preserve established game identities, including purple Not Alone and spectral-white Skull King.

## Evidence on hand

Implementation and regression tests live under `apps/mobile`, `apps/server` and `packages/types`. Reusable design patterns and generated-art provenance live under `docs/design`. See [the testing guide](docs/TESTING.md) for reproducible checks and release limits. Runtime evidence is separate from source checks; local checks do not establish deployment readiness.

## Product principles

- Make game state and available actions easier to understand through graphics.
- Use material depth without hiding rules, controls or player information.
- Keep mobile observation and touch interaction practical.
- Verify complete journeys, not gameplay screenshots alone.
