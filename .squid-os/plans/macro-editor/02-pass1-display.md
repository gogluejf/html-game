# Macro Editor — Pass 1: Display + Draft/Save

## Goal

Open the editor → see all macros in the left menu (grouped by difficulty) → click one → canvas shows a basic render (blocks/platforms as surfaces, dots for placements). Plus working **draft-on-change + Save** using the exact sprite-editor model. No placing/editing tools yet.

Same CSS + same layout as the cleaned sprite editor. Copy, don't abstract (2 tools only).

---

## Setup (copy from sprite editor)

Source: `.squid-os/skills/sprite-crop/scripts/server/`

Target: `petal-panic/macro-editor/`

| Copy | Notes |
|---|---|
| `css/editor.css` | verbatim, zero changes at first |
| `js/dialog.js`, `js/toast.js` | neutral helpers, reuse as-is |
| `js/state.js` | draft/dirty-state store — adapt keys to macro |
| `js/viewport.js` | zoom/pan math, reuse |
| `js/save.js` | draft (localStorage) + canonical save — adapt to macro JSON |
| `server.sh`, `server.py` | new port **8767**, serve repo root |

Do NOT copy: filmstrip, playback, timing, markers, meleeBoxes, rigidbody, pointer (sprite-specific).

---

## The macro-specific files

1. **`loader.js`** — import constants from game (`UNIT_PX_X/Y`, `PLATFORM_DRAW_H` from `js/world/macros.js`), fetch `macros/levels/*.json`. Reuse the game's `macroLoader.js` approach.
2. **`sidebar.js`** — list macros grouped by difficulty (1/2/3), "New" button on top (no-op for now), click = select, **yellow dirty dot** next to name (exact sprite-editor behavior).
3. **`draw.js`** — canvas render of selected macro: blocks + platforms as filled surfaces, placements as colored dots (powerup=blue, enemy=red, barrel=orange), grid lines every 72×48.
4. **`main.js`** — boot: load constants + macros → build sidebar → wire click→draw → wire draft/save.

---

## Data source (single source of truth)

- Constants: import from `js/world/macros.js`
- Macros: read `macros/levels/*.json` — the SAME files the game loads

---

## Draft + Save (exactly like sprite editor)

- **Draft:** any change auto-writes to localStorage (per-macro key).
- **Dirty dot:** yellow ● in sidebar when localStorage draft ≠ canonical JSON. NO separate dirty flag — compare data, exactly like sprite editor.
- **Save:** writes the current draft to `macros/levels/<id>.json` via server PUT (atomic). Clears the dot.
- **Test/Dump button (the cheat):** a toolbar button that mutates the loaded macro state to force a change — e.g. add a block at x=0,y=0 (or toggle one). This triggers the draft path so we can exercise draft→dirty-dot→save without real editing tools yet.

Flow to verify: load macro (clean) → hit Test button (adds block) → dot appears (dirty) → Save → JSON on disk updated → dot clears → reload → block persists.

---

## Game fix: ground = exactly 1 unit (from tuning)

Current (WRONG): `ZONE_GROUND_Y = 500`, `ZONE_FLOOR_H = 40`, `UNIT_PX_Y = 48`. Floor is 40px ≠ 1 unit, and 500 isn't a clean unit multiple.

Fix:
- Make the floor surface sit at a clean unit boundary and the floor slab be **exactly 1 unit (48px)** tall.
- Source both from tuning/consts, grouped under a level-geometry block (stage/group = 0 = ground).
- E.g. `GROUND_UNITS = 10` → `ZONE_GROUND_Y = GROUND_UNITS * UNIT_PX_Y` (= 480), `ZONE_FLOOR_H = UNIT_PX_Y` (= 48).
- Verify nothing depends on the literal 500/40 (grep + run test suite). Hero spawn, entry/exit flags, and vertical-zone anchoring must still land correctly after the shift.

This makes the macro editor's row 0 == the real game floor, so editor grid and game agree at the ground line.

---

## Done when (Pass 1 — ✅ COMPLETE)

- [x] `server.sh go` (port 8767) opens clean
- [x] Left menu shows all 15 macros under difficulty 1/2/3
- [x] Click a macro → canvas draws its blocks/platforms + placement dots
- [x] Grid aligned to 72×48, zoom/pan works (wheel zoom about cursor, drag pan, FIT)
- [x] Test/Dump button adds a block → yellow dirty dot appears
- [x] Save writes JSON to disk → dot clears → reload persists the block
- [ ] Ground normalized to 1 unit from tuning; game tests still pass  ← DEFERRED (separate task)
- [x] No console errors

Verified end-to-end via headless Chromium: boot loads 15 macros, draft→dirty-dot→save pipeline persists to `macros/levels/*.json`, render shows centered grid + blocks + platforms + colored slot dots.

### Note on ground normalization
Deferred out of Pass 1 (it ripples into hero spawn / flags / vertical-zone math and needs the full test suite). Tracked as a follow-up before Pass 2 editing tools land, so the editor's row 0 == the real game floor.

## Explicitly NOT in Pass 1

❌ placing/editing/deleting tools · ❌ Generate · ❌ Test-mode play (hero) · ❌ validation UX · ❌ delete/create macro files
