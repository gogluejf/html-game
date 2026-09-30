# Sprite Editor — Save-to-Disk (Tuning Data)

## Context

The editor currently saves all gameplay metadata (collision, hitboxes, markers, offset, scale, timing) to localStorage only. We need a canonical save path that writes this data into the per-sheet JSON files, with a draft/sync model that gives clear feedback on what's saved vs what's dirty.

---

## Data Model

### What goes into the sheet JSON (per entity/anim)

Merged directly into the existing entity object:

```json
{
  "name": "scarlet_vale",
  "anim": "run",
  "speed": 8,
  "playback": "loop",
  "collision": { "x": 10, "y": 5, "w": 240, "h": 300 },
  "pivot": { "x": 120, "y": 150 },
  "markers": [],
  "frames": [
    {
      "file": "scarlet_vale_run_f1.png",
      "row": 0, "col": 0,
      "bbox": [29, 9, 236, 313],
      "offset": { "x": 0, "y": 0 },
      "scale": { "sx": 1, "sy": 1 },
      "boxes": [],
      "durUnits": 1
    }
  ]
}
```

- `speed`, `playback`, `collision`, `pivot`, `markers` → anim-level fields on the entity
- `offset`, `scale`, `boxes`, `durUnits` → frame-level fields, merged into existing `frames[]` objects

### What stays in localStorage (editor config / transient)

| Field | Why |
|---|---|
| `view.show` (toggles) | UI preference |
| `view.isPlaying` | Global play state |
| `view.bgColor` | Canvas bg color |
| `view.filmOpen` | Filmstrip open/closed |
| `active` | Last selected entity |
| `frameIdx` | Navigation position |
| `playing` (per-anim) | Transient playback state |
| `checksums` | Map of entity key → hash (for sync tracking) |

---

## Draft / Sync Model

### Three states per anim

| State | Meaning | Sidebar indicator |
|---|---|---|
| **Clean** | localStorage matches JSON (checksums match) | nothing |
| **Dirty** | User edited, localStorage diverged from JSON | ● dot next to anim name |
| **Stale** | JSON changed on disk since load (checksum mismatch) | ⚠ icon (only visible when trying to save) |

### Checksum

- **Scope:** per-entity (the specific object matching `name` + `anim`)
- **Method:** canonical JSON serialization (sorted keys, no whitespace) → SHA-256 → first 16 hex chars
- **Stored in:** localStorage under `checksums[entityKey]` where `entityKey = "${name}_${anim}"`
- **Compared at:** explicit Save time (fetch fresh JSON, extract entity, compute checksum, compare)

Why per-entity: if someone modifies entity 2 on disk, saving entity 1 should NOT trigger a warning.

### Flow

| Action | Behavior |
|---|---|
| **Load editor** | Fetch sheet JSONs → for each entity with tuning data, compute checksum → store in localStorage → state = clean |
| **User edits** | Auto-save game data to localStorage (draft) → mark anim **dirty** → show ● in sidebar |
| **Switch anims** | No popup. Draft is already safe in localStorage. Just switch. |
| **Ctrl+S / Save button** | 1. Fetch current sheet JSON from server<br>2. Extract the entity object<br>3. Compute its checksum<br>4. Compare to stored checksum<br>5a. Match → write tuning data to JSON via PUT → update checksum → mark clean<br>5b. Mismatch → `confirmDialog("Sprite was modified outside editor. Overwrite?", doSave)` |
| **Save succeeds** | Update checksum in localStorage → remove ● dot |
| **Save fails (network/file error)** | Show error via `confirmDialog`. Data stays in localStorage (not lost). |
| **Reset (existing button)** | Re-read entity from JSON → overwrite localStorage for that anim → recompute checksum → mark clean |

### Save button location

Next to undo/redo buttons in the toolbar. Same "state management" cluster. The existing ✓ save-indicator becomes the actual Save button (or sits right next to it).

### Sidebar dirty indicator

Small ● dot (orange or cyan) rendered next to the anim name in the sidebar row. Appears when dirty, disappears when clean. Purely visual — clicking it does nothing (you just navigate to that anim and hit Save).

---

## Server Endpoint

Upgrade from plain `python3 -m http.server` to a small Python handler that also accepts writes:

```
PUT /sprite-sheets/<project>/<label>/<sheet>.json
Body: full updated JSON (the editor sends the complete file with the one entity modified)
Response: 200 on success, 409 if file was modified since the checksum we sent (optional server-side check)
```

Actually simpler: **no server-side checksum validation.** The client does the checksum comparison (it already has the fresh fetch). The server just writes the file atomically:

```python
# Atomic write pattern:
# 1. Write to <file>.tmp
# 2. os.replace(<file>.tmp, <file>)  # atomic on POSIX
```

The server script becomes `server.py` (replaces the `python3 -m http.server` call in `server.sh`). Still lightweight — ~50 lines of Python using `http.server` with a custom handler that adds PUT support.

---

## CLI: `record_tuning.py`

Location: `.squid-os/skills/sprite-crop/scripts/record_tuning.py`

Purpose: agent can read/write tuning data without the UI. Same data model as the editor save.

```bash
# Read tuning for one anim
python3 record_tuning.py read \
  --sheet .squid-os/sprite-sheets/petal-panic/heroes/scarlet_vale_sheet.json \
  --name scarlet_vale --anim run

# Write tuning for one anim (full replace of tuning fields)
python3 record_tuning.py write \
  --sheet .squid-os/sprite-sheets/petal-panic/heroes/scarlet_vale_sheet.json \
  --name scarlet_vale --anim run \
  --data '{"speed":8,"playback":"loop","collision":{"x":10,"y":5,"w":240,"h":300},"pivot":{"x":120,"y":150},"markers":[],"frames":[{"offset":{"x":0,"y":0},"scale":{"sx":1,"sy":1},"boxes":[],"durUnits":1},...]}'

# List all anims in a sheet that have tuning data
python3 record_tuning.py list --sheet <path>

# Remove tuning data from an anim (reset to no-tuning state)
python3 record_tuning.py clear \
  --sheet <path> --name scarlet_vale --anim run
```

Rules:
- Writes are atomic (tmp + rename)
- Validates against `sheet-schema.json` after write
- Never touches other entities in the same file
- `--data` is a JSON string with the tuning fields (speed, playback, collision, pivot, markers, frames[].offset/scale/boxes/durUnits)
- On write: merges tuning INTO the existing entity object (doesn't replace the whole entity — preserves `file`, `row`, `col`, `bbox` from crop data)

---

## Editor JS Changes

### `save.js` — major rewrite

Current: dumps everything to localStorage.
New: splits into **game data** (savable to JSON) and **config** (localStorage only).

```js
// New exports:
export function collectGameData(entityName, animName) → object  // just the tuning fields
export function applyGameData(entityName, animName, data)       // merge into app.S
export function computeEntityChecksum(entityObj) → string       // canonical JSON → SHA-256 → 16 hex
export function getSyncState(entityKey) → 'clean' | 'dirty'     // compare checksums
export function setDirty(entityKey, isDirty)                    // update sidebar dot
export async function saveToDisk()                              // the Ctrl+S handler
export function saveConfig()                                     // localStorage-only (view, active, etc.)
export function loadConfig()                                     // restore view prefs
```

### `sidebar.js` — dirty dot

In `buildSidebar()` and `selectEntity()`, render a `<span class="dirty-dot">●</span>` next to the anim name when `getSyncState(key) === 'dirty'`. Update on save/load.

### `main.js` — wire Save

- Ctrl+S → `saveToDisk()`
- Save button click → `saveToDisk()`
- On boot: after loading manifest, compute checksums for all entities that have tuning data

### `loader.js` — minor addition

When building the entity tree, also extract any existing tuning fields from the JSON (speed, collision, pivot, markers, frame offset/scale/boxes/durUnits) so they're available immediately on load (before any localStorage override).

---

## Schema Update

Add to `sheet-schema.json` entity properties (all optional):

```json
"speed": { "type": "integer", "minimum": 1, "maximum": 60 },
"playback": { "type": "string", "enum": ["loop", "once"] },
"collision": { "type": "object", "properties": { "x":{"type":"number"}, "y":{"type":"number"}, "w":{"type":"number"}, "h":{"type":"number"} } },
"pivot": { "type": "object", "properties": { "x":{"type":"number"}, "y":{"type":"number"} } },
"markers": { "type": "array" }
```

Frame properties additions (all optional):

```json
"offset": { "type": "object", "properties": { "x":{"type":"number"}, "y":{"type":"number"} } },
"scale": { "type": "object", "properties": { "sx":{"type":"number"}, "sy":{"type":"number"} } },
"boxes": { "type": "array" },
"durUnits": { "type": "integer", "minimum": 1 }
```

---

## Skill Cleanup (do alongside)

- Delete `skills/sprite-crop/scripts/render_editor.py`
- Delete `skills/sprite-crop/templates/editor-template.html`
- Delete `skills/sprite-crop/templates/` folder (if empty)
- Update `SKILL.md` §6: replace "render_editor.py" instructions with "open via `server.sh go` → `http://localhost:8766/.squid-os/skills/sprite-crop/scripts/server/index.html?project=<name>`"
- Add `record_tuning.py` to SKILL.md resources section

---

## Execution Order

1. **`server.py`** — add PUT endpoint (atomic write), keep GET/static serving
2. **`record_tuning.py`** — CLI (read/write/list/clear)
3. **Schema update** — add tuning fields
4. **Editor JS** — save.js rewrite, sidebar dirty dot, main.js wiring, loader.js tuning extraction
5. **Skill cleanup** — delete dead files, update SKILL.md
6. **Test** — edit in browser → save → verify JSON on disk → reload → data persists

---

## Out of Scope

- Save All (later)
- Server-side checksum validation (client does it)
- Multi-user conflict resolution
- Undo across save boundaries
- Migration of existing localStorage data to JSON (user said fuck that)
