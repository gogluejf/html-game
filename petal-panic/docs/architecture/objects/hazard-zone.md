# Hazard Zone

A persistent damaging area that lives in the world for a duration.

## What it is

A rectangular (or circular) zone placed at a point in the world. Anything that
enters the zone takes ticking damage while inside. The zone has a visual —
particles, a sprite, or a glowing outline — so the player can read where the
danger is.

## Types

- **Fire Area** — horizontal ground strip (Molotov pattern). Orange/red fire
  particles. Fixed height.
- **Spike** — static hazard with a warning phase (blinking), then an active
  phase (damage). Yellow/white visual.
- **Dust Zone** — rectangular toxic cloud. Configurable width AND height.
  Continuous dust puffs fill the box. Green/yellow hazard palette.

## Behavior

- Static once placed. Does not move, does not follow anyone.
- Ticks damage at a fixed rate while a target is inside. A target can be hit
  multiple times over the zone's life.
- Has a duration: after N seconds the zone dissipates and is removed.
- Team-routed: only hurts the configured team (ally / foe / neutral).
- No knockback, no hitstun (unless explicitly added per-type). Pure contact DoT.
- Does not block movement. You can walk through it.

## Visual

The zone owns its own rendering:
- Fire: particle overlay + faint ground glow.
- Spike: blinking warning rect → solid active rect.
- Dust: continuous puff spawns across the full w×h box.

In debug/theater mode a colored rectangle outlines the exact damage AABB.

## Spawning

Created by attacks (Molotov throws fire, stomp creates spikes, enemy ability
spawns dust). Not placed by level design. Not dropped as a pickup.

## Relationship to attacks

An attack primitive (fireArea, spike, dustZone) CONFIGURES a HazardZone:
position, size, duration, tick rate, damage, team, visual style. The HazardZone
object then lives independently in the world — the attack handle can complete
while the zone keeps ticking until its own duration expires.
