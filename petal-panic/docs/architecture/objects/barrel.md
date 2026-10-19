# Barrels

Destructible solids that block movement and explode or burst when destroyed.

## What they are

A barrel is a solid object in the world. It blocks the hero and enemies (occupies
the SOLID layer). It has HP — attacks chip it down. When HP hits zero it's gone.

## Types

- **Wood Barrel** — breaks into wood chips. No damage, no coins. Pure obstacle.
- **Explosive Barrel** — explodes on death. Area damage to everything nearby
  (enemies AND the hero). Knockback pushes victims away from the blast center.
- **Coin Barrel** — bursts into coins on death. No damage. Reward for destroying it.

## Behavior

- Blocks movement until destroyed.
- Takes damage from melee swings, projectiles, bombs, explosions.
- A bomb destroys any barrel in one hit regardless of HP.
- On death: plays its effect (explosion / coin burst / particles), then removes itself.
- Cannot be picked up, moved, or interacted with otherwise.

## Spawning

Barrels are placed by level design (see `levels/populate.md`). They form structures:
single barrels, small groups, pyramids, walls. Placement is patterned, not random.
