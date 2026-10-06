# Macro Editor — Architecture Plan Status

_Last updated: 2026-10-06 (from session `2026-10-02_04-09-27-macro`, refreshed against current code)._

Legend: ✅ done · ⬜ not done

## §3 Data Model

🟢 **Done**
- ✅ Macro JSON files in `macros/levels/<id>.json`
- ✅ Filename matches macro ID
- ✅ JSON is the only source of truth
- ✅ Game loads macros from disk
- ✅ Formal JSON Schema: `macros/macro.schema.json`
- ✅ Validation when game loads
- ✅ Validation when editor loads
- ✅ Validation before editor Save
- ✅ Validation again at server PUT
- ✅ Node tests validate all canonical macros
- ✅ Blocks use `{ x, y, width, height }`
- ✅ Platforms use `{ x, y, width }`

⬜ **Not done**
- ⬜ Validate procedurally generated macros—generator not built yet

---

## §4 Unit Coordinate System

🟢 **Done**
- ✅ Grid cells are `72×48px`
- ✅ Game and editor share constants
- ✅ Horizontal area: 56 units long
- ✅ Horizontal play height: 10 units
- ✅ Vertical area: 56 units high × 13 units wide
- ✅ Boss approach: 22 units
- ✅ Entry/exit inset: 2 units
- ✅ No duplicated editor geometry constants

---

## §5 Blocks

🟢 **Done**
- ✅ Positive whole-number width
- ✅ Positive whole-number height
- ✅ No arbitrary 1–3 limit
- ✅ Width constrained by remaining area space
- ✅ Horizontal blocks cannot enter entry/exit clearance
- ✅ Vertical blocks cannot cross column 13
- ✅ Two-unit horizontal top clearance
- ✅ Maximum horizontal surface is row 8
- ✅ Touching/stacked blocks allowed
- ✅ Floating blocks require at least 2 empty rows
- ✅ Overlapping block rectangles rejected
- ✅ Existing contiguous equal-height blocks merged
- ✅ Visual block placement/resizing tools

---

## §6 Platforms

🟢 **Done**
- ✅ Positive whole-number width
- ✅ No arbitrary width-3 limit
- ✅ Width constrained by remaining area space
- ✅ Horizontal platforms cannot enter entry/exit clearance
- ✅ Vertical platforms cannot cross column 13
- ✅ Cannot be placed at row 0
- ✅ Require at least 1 empty row underneath
- ✅ Preserve horizontal top clearance
- ✅ Same-row overlapping platforms rejected
- ✅ Existing contiguous same-row platforms merged
- ✅ Visual platform placement/resizing tools

---

## §7 Mixed Structures

🟢 **Done**
- ✅ Block/platform overlap and burial validation
- ✅ Shared clearance validation
- ✅ Wide structures supported
- ✅ Existing macros pass validation
- ✅ Editor hover feedback for invalid mixed structures

---

## §8 Slots

🟢 **Done**
- ✅ Enemy, barrel, and power-up slot types
- ✅ Slots render as colored dots
- ✅ Duplicate slot positions rejected
- ✅ Wide-block slot collision uses full block width
- ✅ Enemy/barrel slots cannot exist inside blocks
- ✅ Existing migrated slots fixed
- ✅ Place slot tool
- ✅ Cycle slot type tool
- ✅ Live support-surface validation UX

---

## §9 Horizontal and Vertical Modes

🟢 **Done**
- ✅ Both orientations render
- ✅ Vertical width fixed from 22 to 13 units
- ✅ Vertical macro data migrated
- ✅ Horizontal top clearance enforced
- ✅ Orientation-specific entry/exit clearance
- ✅ Vertical reachability accounts for wide platforms

---

## §10–§11 Editor App and Visual Design

🟢 **Done**
- ✅ Editor lives in `petal-panic/macro-editor/`
- ✅ Sprite Editor layout/style reused
- ✅ Local server on port 8767
- ✅ Grid, axes, labels, zone box, and clearance bands
- ✅ Wide blocks/platforms render correctly
- ✅ Block labels show `Bwidth×height`

---

## §12 Macro Navigation

🟢 **Done**
- ✅ Sidebar grouped by difficulty
- ✅ Select/open macro
- ✅ Restore last-opened macro
- ✅ Switch macros without losing drafts
- ✅ Per-macro draft persists automatically

⬜ **Not done**
- ⬜ Create New Macro
- ⬜ Delete Macro
- ⬜ Search/filter

---

## §13 Editing Tools

🟢 **Done**
- ✅ Select tool
- ✅ Block placement
- ✅ Block resize
- ✅ Platform placement
- ✅ Platform resize
- ✅ Slot placement/type cycling

⬜ **Not done**
- ⬜ Generate tool

---

## §14 Validation UX

🟢 **Done**
- ✅ Shared runtime validation rules
- ✅ Formal schema validation
- ✅ Invalid saves blocked
- ✅ Valid translucent hover preview
- ✅ Invalid red-X preview
- ✅ Explain rejection reasons in editor
- ✅ Clicking invalid placement does nothing
- ✅ Resize/cycle skips illegal dimensions

---

## §15 Zoom and Navigation

🟢 **Done**
- ✅ Wheel zoom around cursor
- ✅ Drag pan
- ✅ Grid remains aligned
- ✅ Fit-to-view
- ✅ Origin axes
- ✅ Horizontal and vertical framing

---

## §16 Draft and Canonical Save

🟢 **Done**
- ✅ Changes auto-save to localStorage
- ✅ Separate draft for each macro
- ✅ Yellow dirty dot
- ✅ Save writes canonical JSON
- ✅ Discard reloads canonical JSON
- ✅ Switching macros preserves drafts
- ✅ No switch confirmation needed
- ✅ External disk-change warning
- ✅ Old incompatible drafts invalidated
- ✅ Schema validation before Save
- ✅ Server validates again before writing
- ✅ Atomic server writes

---

## §17–§20 Procedural Generator

⬜ **Not done**
- ⬜ Generate action
- ⬜ Dimensions controls
- ⬜ Block/platform/slot density
- ⬜ Verticality
- ⬜ Difficulty
- ⬜ Style presets
- ⬜ Seed control
- ⬜ Deterministic generation
- ⬜ Generated-result validation
- ⬜ Generated content becomes normal editable data

---

## §21–§24 Test Mode

⬜ **Not done**
- ⬜ Manual hero test
- ⬜ Real physics inside editor
- ⬜ Lock editing during test
- ⬜ Return to same draft after test
- ⬜ Collision/debug overlays
- ⬜ Automatic ghost runner
- ⬜ Traversal graph
- ⬜ Failure/unreachable reporting

---

## §25–§26 Composer and Clearance

🟢 **Done**
- ✅ Macro geometry remains separate from population budgets
- ✅ Level composer chooses and orders macros
- ✅ Composer populates candidate slots
- ✅ Shared entry/exit clearance constants
- ✅ Editor displays area clearance bands
- ✅ Horizontal object width respects final remaining level space

⬜ **Not done**
- ⬜ Optional neighboring-macro preview

---

## §27 Local Server

🟢 **Done**
- ✅ Serve editor and game modules
- ✅ Load macro JSON
- ✅ Save macro JSON
- ✅ Atomic writes
- ✅ Schema validation on PUT
- ✅ Safe filename/path handling
- ✅ Cache disabled

⬜ **Not done**
- ⬜ Create macro endpoint
- ⬜ Delete macro endpoint

---

# Next Pass

✅ **Pass 2 — Editing Tools** (done)

1. ✅ Select and erase
2. ✅ Place/resize blocks
3. ✅ Place/resize platforms
4. ✅ Place/cycle slots
5. ✅ Live valid/invalid preview
6. ✅ Validation messages
