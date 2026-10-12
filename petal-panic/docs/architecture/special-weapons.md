# Petal Panic — Special Weapons

Conceptual reference for how special weapons work. No code — behavior only.
Implementation lives in the hero weapon system and the powerup drop logic.

## Core idea

A **special is a weapon, not a resource.** There is no count, no pool, no
ammo meter for specials. You either hold a special in a slot or you don't.

The hero always has their **default weapon** (regular ammo). It is built-in,
never collected, never lost, and cannot be rotated away from — it is the
fallback the rotation always returns to.

## The two heroes share one special pool

Balthazar and Scarlet can pick up the **same** specials. The drop table is
random between:

- **Bomb** — arcing projectile, explodes on fuse or impact, area damage.
- **Petal Saw** — fast straight projectile, short range, single-target.

There are no hero-exclusive specials anymore.

## Slots

The hero carries **two special slots** plus the implicit default weapon:

```
[ default ammo ]  [ slot 1 ]  [ slot 2 ]
                    bomb        (empty)
```

- Slot 1 and slot 2 each hold at most one special.
- One of the three options is always **selected** (the active weapon).
- Default ammo is selected by default and is never stored in a slot.

## Rotation

The player rotates through: **default → slot 1 → slot 2 → default …**

- Rotation is only meaningful for slots that actually contain a special.
  An empty slot is skipped.
- You can only fire a special if it is currently selected.
- Selecting an empty slot falls through to the next occupied option.

## Picking up a special

When the hero touches a special powerup:

1. **Always auto-selects the newly grabbed weapon.** This is unconditional —
   even if it lands in a slot that was already selected.
2. Placement rules, checked in order:
   - **Slot 1 empty** → place there.
   - **Slot 1 full, slot 2 empty** → place in slot 2.
   - **Both full** → replace the **currently selected** slot… with one
     exception:
   - **Both full AND default ammo is selected** → replace **slot 1**.
     (You can't "replace the default" — it isn't a slot.)

### Same-special pickup

If you already carry the same special you just picked up, it is **replaced**
by the new copy — position follows the placement rules above, and the new
copy becomes selected. No stacking, no counts.

## Losing a special

The hero loses the **currently selected** special when they take a hit that
costs damage (energy drain). Hits absorbed by i-frames or self-protection do
not cost a special.

After losing:

- If the lost special was in **slot 2** and **slot 1 is empty**, the weapon
  in slot 2 **moves into slot 1**. We never leave a layout of "nothing in 1,
  something in 2" — it is confusing and useless.
- Selection falls back sensibly: if the selected slot just emptied, select
  whatever remains (slot 1 after the move above, otherwise default ammo).

## What dies with this design

Everything that treated specials or ammo as quantities:

- Ammo collection / ammo powerups — gone. Ammo is initial state only.
- Special-ammo counters (`+50 Special` style drops) — gone.
- Any UI, stat, or death-check logic keyed on ammo quantity — removed.
- Hero-specific special restrictions — gone; both heroes share the pool.
