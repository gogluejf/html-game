# Powerups

Pickup items that grant the hero a temporary or permanent benefit.

## What they are

Floating objects in the world with a gentle bob animation. The hero collects
them by touching them. Each type has a distinct icon and color.

## Types

- **Weapon Powerup** — upgrades the hero's default weapon (faster fire rate,
  bigger bullets, multi-shot). Stacks up to a max level.
- **Special Drop** — fills an empty special slot with a random special weapon
  (see `special-weapons.md`). If both slots are full, no drop spawns.
- **Heal** — restores a chunk of HP. Only spawns when the hero is below max.

## Behavior

- Float in place with a slow vertical bob. Do not fall, do not roll.
- Collected on contact with the hero. Play a pickup sound + flash.
- Have a lifetime: fade out after ~10s if not collected.
- Do not block movement. No damage. Enemies ignore them.

## Spawning

- Dropped by enemies on death (weighted random table).
- Placed at specific level spots (designer-chosen, e.g. end of a corridor).
- Never spawned by attacks or explosions.
