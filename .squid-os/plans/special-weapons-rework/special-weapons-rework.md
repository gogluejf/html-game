# Special Weapons Rework — Plan

**Date:** 2026-10-13
**Mechanic doc (source of truth):** `petal-panic/docs/architecture/special-weapons.md`
**Status:** ready to execute

## Context

Specials stop being resources (counters/pools) and become **weapons held in two
slots**. Both heroes share the same special pool (bomb / petal saw, random drop).
Ammo is no longer collected or counted — it is the built-in default weapon only.

Full behavior spec lives in the mechanic doc above. This plan is the execution
order for the code + doc changes.

## Tasks

### Task 1 — Slot model on hero
Replace `ammo` / `specialAmmo` wallet counters with a slot model:
- `specialSlots: [null|'bomb'|'saw', null|'bomb'|'saw']`
- `selectedWeapon: 'default' | 0 | 1` (slot index)
- Pickup placement rules per mechanic doc (slot1 → slot2 → replace selected;
  both full + default selected → replace slot 1; always auto-select grabbed)
- Same-special pickup replaces existing copy (no stacking)

### Task 2 — Rotation input
- Cycle default → slot 1 → slot 2 → default; skip empty slots
- Firing a special requires it to be selected
- Update input mapping / controls screen text if needed

### Task 3 — Powerup drops
- Remove `ammo` and `special` (ammo-counter) powerup types + their defs
- Special drop = random bomb or saw, identical for Balthazar and Scarlet
- Update drop tables / level population where specials are placed
- Remove hero-specific special gating if any remains

### Task 4 — Special loss on damaging hit
- Hook into central `damage()` path: when a hit costs damage on the hero
  (returns > 0), clear the currently selected special slot
- i-frame / connect-protected hits (dealt == 0) do NOT cost a special
- Enforce invariant: never leave slot1 empty + slot2 filled → move slot2
  weapon into slot1; selection falls back to what remains (else default)

### Task 5 — Dead code sweep
- `hero.ammo` / `hero.specialAmmo` wallet fields + legacy getters/setters
- Ammo UI (HUD counts), death checks keyed on ammo quantity
- Any test asserting ammo counters
- Grep targets: `ammo`, `specialAmmo`, `POWERUP_TYPES` ammo/special entries

### Task 6 — Doc sync
Update stale ammo references so docs match reality
(`docs/design.md` is a frozen v1 snapshot — deliberately NOT touched):
- `docs/engine/base/powerup.yaml` — drop ammo/special defs, note shared special pool
- `docs/engine/base/hero.yaml` — remove ammo/specialAmmo fields, add slot model
- `docs/architecture/hero-mechanics.md` — rewrite Ammo section → point at
  `special-weapons.md`
- `docs/levels/game-rules.md` — persistence line (remove ammo)

## Acceptance

- No `ammo` counter exists anywhere in js/ (grep clean except comments explaining history)
- Picking up a special auto-selects it; rotation skips empty slots
- Taking a damaging hit drops the selected special; slot invariant holds
- Both heroes can hold both specials
- All tests green; docs contain no stale ammo mechanics
