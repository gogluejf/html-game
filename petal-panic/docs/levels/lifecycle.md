# Petal Panic — Game and Area Lifecycle

**Starting a game, continuing, entering an area, and starting a life are different
operations.** They may lead to the same entry screen, but reset different things.

## 1. Game start — from zero

Starting a genuinely new game establishes:

- The selected hero: Scarlet or Balthazar.
- Global starting lives and continues.
- Fresh game progress and reward accounting.
- A new set of random generation choices for the game's areas.
- Entry into the first level's area 1.

The generation choices belong to this entire game. Returning from death or
using Continue must never invoke a fresh-game reset.

## 2. Area start — first arrival

First arrival establishes the area's terrain arrangement and population using
its level configuration and this game's generation choices.

- Choose the applicable macro sequence and its variations.
- Resolve enemy, barrel, and powerup placements within the budgets.
- Establish entry/exit flags and camera boundaries.
- Preserve that exact arrangement for later attempts.
- Show the area-entry screen, then begin play at the area's start.

It is not important whether future areas are prepared early or on first arrival.
The visible contract is that each area's choices are fixed for the game.

## 3. Life start — an attempt in the current area

A life start creates a fresh playable attempt from the preserved arrangement.
On death with lives remaining:

1. Finish the death presentation and consume one life exactly once.
2. Fade to black after a short delay.
3. Show the area-entry screen with the updated life count.
4. Restore the entire area and its starting camera position.
5. Place the hero at its entry and resume play.

All enemies, barrels, and powerups return to their original positions and initial
state. Destroyed objects and defeated enemies are restored. Transient attacks,
projectiles, and effects from the failed attempt must not leak into the new one.
The boss zone likewise restarts from its checkpoint, with the encounter reset.

This is **replaying the same arrangement**, not rolling a new one. Restoring the
world does not settle score, coin, or inventory persistence; those design-plan
policies are listed in [game rules](game-rules.md).

## 4. Game continue

At Game Over, choosing Continue:

1. Requires a remaining continue and consumes exactly one.
2. Restores the global starting life count.
3. Returns to area 1 of the current level.
4. Shows the entry screen and starts a fresh attempt there.

All previously generated areas retain their original arrangements. Example:
continuing after defeat in 2-3 returns to 2-1; reaching 2-3 again reveals the
same terrain, enemies, barrels, and powerups as before.

Continue is not a new game and does not return to Level 1 unless Level 1 was
already the current level.

## 5. Normal advancement

Clearing an area advances to the next zone without consuming a life or continue.
The next area receives its own entry screen and fresh playable contents.
Defeating a boss runs the reward screen before the next level's area 1.

**Game end:** after the final level's boss and its reward screen, show a minimal
end-of-game screen — a congratulations presentation with the final score. It has
**no menu**: a single instruction line plus the regular navigation bar; confirm
and back both return home. This is a placeholder: the full ending (story scenes,
credits) belongs to the future story epic. The last boss must not attempt to
advance into a nonexistent next level.

## 6. Lifetime of randomness

- New game: new arrangements may be chosen.
- Ordinary death: same current area arrangement.
- Continue: same arrangements across the whole game.
- Quit and start from scratch: the old game is over; new choices are allowed.

“Regenerate” means rebuilding the same world after failure, not rerolling it.
Saving/resuming a game across application sessions is outside the current scope.
