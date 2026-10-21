# Petal Panic — Level Architecture Revision: Zones as Pure Data

**Status:** proposed (brainstorm, 2026-10-20; rooms revision, 2026-10-20)
**Trigger:** vertical areas had no visible floor, no entry flag in view, and the
hero spawned off-screen. Root cause was NOT missing geometry — it was
orientation-specific special cases scattered across camera, spawn, death, and
floor code. Horizontal "just worked" because its world fits one screen; every
vertical behavior needed a hand-written `if (orientation === 'vertical')`
branch, and those branches drifted out of sync with each other.

## Core model: zone vs room

A **zone** is gameplay identity. A **room** is physical space.

- **Zone** = what the player experiences as "a place": where the hero spawns,
  how they enter (entryFlag), how they leave (exitFlag or a trigger), and the
  rules that apply (`ratchet`, `lethalBottom`). Orientation is a property of
  the zone's rooms + flags, never a branch in the engine.
- **Room** = a box with content: `{ id, x, y, w, h, platforms }`. Camera
  clamps/follow operate on the ACTIVE room. The composer fills a specific
  room. New level shapes (diagonal climbs, tall horizontal rooms, pit-heavy
  corridors) are new *configs*, not new *code*.

```js
zone = {
  kind: 'area' | 'boss',
  orientation: 'horizontal' | 'vertical' | 'boss', // data, never branched on
  activeRoom: 'hall',        // which room the hero is currently in
  spawn:   { x, y },         // hero start (feet position), inside first room
  entryFlag: { x, y },       // pure visual start marker (or null for area 1)
  exitFlag:  { x, y },       // trigger at far end / top (null for boss)
  ratchet: false,            // camera never follows back down (climbs)
  lethalBottom: false,       // falling below the floor kills (pits/climbs)
  rooms: [
    { id: 'main', x, y, w, h, platforms: [...] },
  ],
}
```

- Horizontal area = 1 room (the whole zone). Zero behavior change.
- Vertical climb = 1 room (tall box). Same.
- Boss zone = 2 rooms: `hall` (the run) + `arena` (the fight). Crossing the
  checkpoint trigger switches `activeRoom` to `arena`; nothing is redrawn —
  the arena already exists with its own platforms. Death-restart switches
  back to `hall`. This kills the "redraw over the run" hack entirely.

## Goal

A zone is **data, not a code path**. Orientation becomes a property of the
zone's rooms + flags, not a branch in the engine.

Horizontal = wide room, both flags on the floor line, no ratchet.
Vertical = tall room, entry bottom / exit top, ratchet + lethal bottom on.
Diagonal (future) = tall+wide room, exit top-right, ratchet on. **Same code.**

## What already matches the goal

- Camera (`core/camera.js`) is already "clamp to room box + follow hero."
  The orientation branches only add: fixed-x for narrow boxes (falls out of
  clamp math when `w === VIEW_W`) and the ratchet (becomes a flag).
- Flags/spawn are already plain `{x, y}` descriptors built by `level.js`.
- Macro composer already composes along an axis; it just hardcodes which axis
  instead of reading it from the room.

## What changes (delete > add)

### 1. One ground rule, no per-orientation constants
Today: `ZONE_GROUND_Y` (horizontal), `VERTICAL_GROUND_Y` (vertical), plus
`bounds.y + bounds.h` legacy anchors.
Target: **floor top = `room.y + room.h - FLOOR_H`** for every room.
The climb height is the space above the floor; the slab body sits inside the
world so a ground band renders at the bottom edge — identical mechanic to
horizontal. Delete `VERTICAL_GROUND_Y`; keep `ZONE_GROUND_Y` as the same
formula applied to horizontal rooms.

### 2. Camera: kill the orientation branches
- Clamp-to-box + follow-hero stays (already generic); it operates on the
  active room's box.
- Ratchet becomes `zone.ratchet` data; `camera.update` reads the flag.
- Entry snap (both axes, set high-water mark) applies to ALL zones — it's just
  "start where the hero is," which horizontal needs too once rooms get taller
  than one screen.
- No-horizontal-scroll / no-vertical-scroll fall out of the clamp math
  automatically when a dimension equals the viewport size. No special case.
- Room switch (boss): `enterBossRoom()` sets `zone.activeRoom = 'arena'`,
  snaps camera to the arena box, removes the flag. Camera code itself is
  unchanged — it just reads whichever room is active.

### 3. Death: one rule, camera-relative (already implemented)
Kill = **hero's top edge drops below the bottom pixel of the camera**
(`camera.y + camera.h`), orientation-agnostic — no floor reference at all.

- The floor saves the hero whenever it is on-screen; the rule only fires when
  the hero exits the view. In horizontal zones the floor is always visible, so
  it never triggers there in practice — but the code path is identical.
- The ratchet is what makes falling lethal in climbs: the camera won't follow
  back down, so a fall eventually pushes the hero out of the bottom → dead.
- **Floor holes work later with zero extra code:** fall through a gap, drop
  out of camera-bottom, die. No new branch.
- Becomes `isLethalFall(h, zone)` gated by `zone.lethalBottom`; same die()
  pipeline. (The predicate itself is already camera-relative in `death.js`.)

### 4. Spawn/flags: read zone data
`entryPosition()` stops branching on orientation — it returns `zone.spawn` /
`zone.entryFlag`. `level.js` keeps computing those values (it owns the
layout math), but consumers treat them as opaque data.

### 5. Composer: data-driven axis, per room
`composeArea(rng, room, stage, budget)` receives the target ROOM (box + flags)
instead of an `orientation` string + separate width/height budgets. Stacking
axis, reach checks, and entry/exit clearance read from the room box + flags.
This is the only piece with genuinely different logic (stack X vs stack Y) —
it stays logic, but becomes config-driven so a diagonal room is a new box, not
a new branch. Boss zones compose hall and arena independently (different
layouts allowed in the same zone).

### 6. Boss zone: two rooms, no redraw
Today `enterBossRoom()` re-draws a fixed-width battle room OVER the run.
Target: the boss zone is built with two rooms up front — `hall` (22-col
approach) and `arena` (fixed fight width). The flow machine (`bossFlow.js`)
keeps LOCKED→INTRO→BAR_FILL→BOSS_ENTER→COMBAT, but its geometry reads the
arena room: camera freeze = arena box, hero placement = arena entry, boss
slide-in origin = arena right edge. Death restart = `activeRoom` back to
`hall`, flag restored, hero at `zone.spawn`.

## Explicitly OUT of scope

- Diagonal levels (the refactor must make them *possible*, not ship them).
- Changing macro vocabulary or difficulty curves.
- Boss flow machine logic (LOCKED→…→COMBAT stays as-is; only its geometry
  source changes from hardcoded values to the arena room).

## Acceptance criteria

1. Zero `orientation === 'vertical'` branches in `camera.js`, `death.js`,
   `build.js`, `zoneLifecycle.js` (grep-verifiable).
2. A fake "tall horizontal" zone (h > VIEW_H, no ratchet) scrolls vertically
   both ways with the existing camera code — no new branches.
3. Vertical area opens with: visible ground band, entry flag on the floor,
   hero standing on the floor, first platform within jump reach (screenshot).
4. All existing level/world/camera/death tests pass unchanged in meaning
   (anchors updated to the shared formula).
5. `VERTICAL_GROUND_Y` deleted; one floor formula in `level.js`.
6. Boss zone has two rooms; `enterBossRoom()` switches `activeRoom` without
   redrawing geometry; a platform placed in the arena room does not appear in
   the hall.

## Migration order (small PRs, each green)

1. **Zone struct + rooms + floor formula** — `level.js` emits zones with
   `rooms[]` (single room for areas; hall+arena for boss), `spawn/entryFlag/
   exitFlag/ratchet/lethalBottom/activeRoom`; single floor formula; update
   tests.
2. **Camera** — ratchet flag + universal entry snap; read active room box;
   delete orientation branches; camera tests.
3. **Death + spawn** — `isLethalFall` + `entryPosition` read zone data.
4. **Composer** — take a room instead of orientation string; keep output
   identical for existing horizontal/vertical zones (determinism test).
5. **Boss rooms** — build hall+arena at zone creation; `enterBossRoom()`
   switches `activeRoom` + snaps camera/hero; delete the redraw-over-run
   path; boss flow geometry reads the arena room.

## Open questions

- Should `ratchet`/`lethalBottom` live on the zone or on a per-level
  "ruleset" object (so a whole level can share rules)? Leaning: zone, since
  structure.md already scopes these rules per area type.
- Backward-scroll in horizontal areas is still an open design decision
  (structure.md §3); this refactor doesn't force it either way.
- Room naming: `hall`/`arena` for boss, `main` for ordinary areas — confirm
  before PR 1.
