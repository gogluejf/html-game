# Petal Panic — Checkpoints and Transition Screens

**A checkpoint marks an area boundary, not a mid-area save location.** Reaching
an exit clears the area and establishes the next area's starting point.

## 1. Where flags appear

- Area 1 has no entry checkpoint drawn.
- Areas 2, 3, and 4 have an entry checkpoint at their start.
- Each ordinary area has an exit checkpoint.
- The area-4 exit is a boss checkpoint; the next, separate boss zone starts beside
  a boss checkpoint too.
- Vertical-area entry and exit flags sit on supporting platforms, at the bottom
  and top respectively. In screen coordinates (y=0 is top), the entry flag has
  the **larger** y value (bottom of the climb) and the exit flag has the
  **smaller** y value (top of the climb). The exit flag's platform is a one-way
  surface near the top of the zone's bounds.

An entry flag is already the starting checkpoint, not another exit trigger.
Arriving beside it must not immediately clear the newly entered area.

## 2. Clearing an ordinary area

1. Reach and activate the exit flag.
2. The flag flashes or receives a comparable celebratory effect.
3. A rewarding banner appears: for example, **1-1 CLEAR**.
4. Fade out the current area.
5. Show the next area's entry screen.
6. Fade into the new zone at its starting point.

There is no scrolling past the exit into the next zone. A horizontal area begins
with its entry behind/near the hero, not at the opposite end of the previous map.
After a vertical ascent, the next horizontal area is simply a new horizontal
world; there is no journey back down the previous shaft.

Effects should make completion feel rewarding. Exact timing and effect composition
are tunable. Music and sound are deferred, not prerequisites for this flow.

## 3. One shared area-entry screen

The same full-screen presentation is used for:

- Starting the first area of a new game.
- Advancing to another area or level.
- Restarting an area after an ordinary death.
- Restarting the current level's area 1 after Continue.
- Entering/restarting the boss zone, identified as that level's boss area.

It displays three pieces of information:

1. Level name.
2. Area identifier.
3. Number of lives remaining.

**No score appears here.** This replaces the earlier idea of a separate death
score screen. A life-count decrease can be emphasized within this same screen;
there is no need for another screen type. Timing and whether the screen is
skippable are design-plan concerns, not rules of this document.

## 4. Ordinary death

After the death presentation and a short delay, fade to black. Consume one life
exactly once. If lives remain, show the shared entry screen with the new count,
then restart the entire current area.

Examples:

- Death in 1-1: restart 1-1, no starting checkpoint flag drawn.
- Death in 1-3: restart 1-3 beside its entry flag.
- Death near the top of a vertical area: restart at the bottom platform.
- Death in the boss zone: restart beside the boss checkpoint, before the approach.

Everything in the area's starting arrangement returns. Camera progress is reset.
The previous attempt's kills and destroyed objects do not leave the next attempt
partly cleared. Persistent reward accounting remains separate.

## 5. Game Over is not ordinary death

At zero lives, show the **existing Game Over screen** instead of the area-entry
screen. Keep its score/stat display, opaque dark background, Continue count,
and Continue / Quit navigation.

Continue starts area 1 of the current level with restored starting lives.
It does not resume beside the flag of the area where the player lost their last
life. See [game rules](game-rules.md) and [lifecycle](lifecycle.md).
