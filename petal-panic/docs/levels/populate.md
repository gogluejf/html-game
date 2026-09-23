# Petal Panic — Area Population

**Terrain patterns provide meaningful places; budgets decide how many things
occupy them.** Enemies, barrels, and powerups are not scattered independently at
arbitrary intervals. Each uses macro-specific placement opportunities and chances.

## 1. Budgets and placement chances

Level configuration describes the available enemy roster, boss, powerup mix,
and population quantities. Area progression determines how those resources are
distributed across areas 1 through 4.

Two ideas must stay distinct:

- **Quantity budget:** how many items or enemies belong in the generated area.
- **Placement/type chance:** which valid slots or types are selected to satisfy it.

For a fixed budget, independent coin flips must not accidentally produce an
empty or overcrowded area. Use valid opportunities to satisfy the intended
quantity; if the chosen terrain cannot support it, revise the composition rather
than pile items into invalid positions.

**Design-plan decision:** exact totals per level versus per area, and the
allocation between areas. The matrix must make that scope explicit so a
level-wide quantity is not mistakenly repeated in every area.

## 2. Powerups

Powerups should feel fair and rewarding, not overwhelmingly generous.

The configuration matrix needs to express:

- Total number intended to appear.
- Eligible powerup types and their selection percentages/weights.
- Any guaranteed quantities or limits by type.
- Suitable macro positions and the chance of selecting them.
- Progression restrictions and hero-specific eligibility where relevant.

The precise matrix values and guarantee/weight interpretation are tuning work.
They must eventually resolve to one clear budget rather than conflicting totals.

A powerup can reward reaching an elevated or less convenient position, but it
must remain reachable by the selected hero. Its placement must make sense in
the terrain pattern, not merely occupy empty coordinates.

## 3. Barrels

Barrels form a second layer over terrain macros. Their randomness is patterned,
not chaotic: a platform, step, or open pocket can be a likely barrel position.

Three arrangement scales:

- **Single:** isolated barrels as the common simple placement.
- **Medium structure:** approximately 4–9 barrels in an organized arrangement.
- **Super structure:** a much larger set piece with many barrels.

Examples include barrel pyramids and walls. Large structures should be occasional
highlights, with stronger opportunities especially in areas 3 and 4, not constant
clutter. Exact frequency and counts remain tuning values.

Explosive barrels can occupy strategic positions within these structures so a
well-placed attack causes a satisfying chain reaction. Normal, coin, and explosive
barrels should form a deliberate arrangement rather than an arbitrary mix.

This document does **not** redesign barrel health, damage, blast radius, or
explosion propagation. Patterns take existing chain-damage behavior into account.
They must not assume an explosion can reach beyond its actual gameplay area.

## 4. Enemies

Each level declares its enemy types, boss, and intended enemy quantities. Macros
provide suitable positions, with selection chances dependent on pattern type.

An enemy placement should respect:

- Its movement and required supporting surface or air space.
- Available space for its attacks and for the hero to react.
- The route through the pattern.
- The area's place in the difficulty progression.

Enemy balance and smarter placement will evolve later. Keep rosters, quantities,
and placement preferences adjustable without rewriting the terrain grammar.
Do not force the same enemy mix into every macro simply to reach a total.

## 5. Combined population

Resolve placements together so one layer does not invalidate another:

- A barrel structure must not bury a powerup or entry flag.
- Required landing surfaces must remain usable.
- An enemy must not begin trapped inside solid terrain or barrel geometry.
- Entry/exit spaces must remain readable and accessible.
- Population must not make an otherwise reachable macro impossible.

All population choices are fixed for the game. After losing a life, enemies,
barrels, and powerups return in the same arrangement. Whether collecting them
again increases persistent rewards is a separate [game-rule decision](game-rules.md).
