# Sprite Editor — Server + Split Refactor

## Context

The current editor is a 2,744-line single HTML file (`editor-template.html`) with all JS/CSS inlined. It's generated per-project by `render_editor.py` which injects a manifest JSON. This is fragile, hard to maintain, and couples the editor to a render step.

We already have:
- Per-sheet JSONs split under `.squid-os/sprite-sheets/<PROJECT>/<label>/*.json`
- A proven `server.sh` pattern (petal-panic) for non-blocking local HTTP
- Both skills define `<sheets-root>` and `<assets-dir>` as standard variables

This plan refactors the editor into a **served multi-file app** that loads sheet JSONs at runtime via HTTP. No more render step. No more single giant HTML.

---

## Goal

Replace the render-and-open workflow with:

```
server.sh go → http://localhost:PORT/editor.html?project=petal-panic
```

Both abyss-qwen and petal-panic load instantly by changing the query param. No re-render, no template injection, no `render_editor.py`.

---

## Target Structure

```
.squid-os/sprite-editor/
├── server.sh              # start/stop/status/go (same pattern as petal-panic/server.sh)
├── index.html             # shell: canvas, panels, toolbar markup (~100 lines)
├── css/
│   └── editor.css         # all styling extracted from template
├── js/
│   ├── main.js            # boot, state management, routing (?project=)
│   ├── loader.js          # fetch /sprite-sheets/<project>/<label>/*.json, build entity tree
│   ├── viewport.js        # zoom, pan, canvas rendering, coordinate transforms
│   ├── spriteView.js      # frame display, animation playback, timing
│   ├── cropOverlay.js     # bbox drawing/editing on canvas
│   ├── entityNav.js       # sidebar: label groups, entity rows, anim/frame tree
│   ├── timeline.js        # frame scrubber, play/pause, FPS controls
│   ├── inspector.js       # right panel: properties, offset, scale, collision, melee
│   ├── tools.js           # tool selection logic (select, collision, melee, scale, pivot)
│   └── save.js            # draft (localStorage) + canonical save (POST to server)
└── README.md              # usage notes
```

Each JS file: ~100–300 lines, single responsibility, ES module (`import`/`export`).

---

## Sub-tasks

### Task 1: Server

**What:** Create `.squid-os/sprite-editor/server.sh` — same pattern as `petal-panic/server.sh`.

**Details:**
- Serves the repo root (`~/src/html-game`) so both the editor static files AND the project assets AND the sheet JSONs are reachable.
- Default port: `8766` (avoid clash with petal-panic's 8765).
- PIDFILE: `/tmp/sprite-editor-server.pid`
- LOGFILE: `/tmp/sprite-editor-server.log`
- Commands: `start [port]`, `stop`, `status`, `go [port]`
- The server just needs to serve static files — `python3 -m http.server` is sufficient for now.
- Later (when we add save): swap to a small Python HTTP handler that also accepts `PUT /sprite-sheets/...` for JSON writes.

**Paths served:**
| URL | Maps to |
|---|---|
| `/sprite-editor/` | `.squid-os/sprite-editor/` (the app) |
| `/sprite-sheets/<project>/<label>/<sheet>.json` | `.squid-os/sprite-sheets/...` (sheet data) |
| `/petal-panic/assets/...` | `petal-panic/assets/...` (cropped frames) |
| `/abyss-qwen/assets/...` | `abyss-qwen/assets/...` |

**Validation:** `./server.sh go` → curl the editor index.html → 200 OK.

---

### Task 2: Extract & Split the Template

**What:** Decompose `editor-template.html` (2,744 lines) into the target structure above.

**Approach (agent-dispatched):**
1. **CSS extraction** → `css/editor.css` (all `<style>` content)
2. **HTML shell** → `index.html` (markup only, `<link>` to CSS, `<script type="module" src="js/main.js">`)
3. **JS split** by responsibility:
   - Read the full template JS
   - Identify natural boundaries (state, rendering, tools, panels, playback, loading)
   - Extract each into its own module with explicit imports/exports
   - `main.js` orchestrates: reads `?project=` param, calls `loader.js`, wires up viewport + nav + inspector

**Rules:**
- No behavior changes — pure structural refactor.
- All existing features preserved (tools, playback, collision box, melee box, scale, pivot, offset).
- ES modules only. No globals. No IIFE wrappers.
- Each file must pass `node --check`.
- The app must work identically when opened via the server.

**Agent technique:** Dispatch inline agents for mechanical extraction (CSS pull, individual JS module splits). Orchestrator handles architecture decisions and integration verification.

---

### Task 3: Runtime Loading (replace manifest injection)

**What:** Replace the baked-in `/*__MANIFEST__*/` with runtime `fetch()`.

**`loader.js` responsibilities:**
1. Read `?project=<name>` from URL params.
2. `GET /sprite-sheets/<project>/` → enumerate label subfolders (or use a directory listing endpoint).
3. For each label folder, `GET` all `*.json` files.
4. Parse each sheet JSON, extract `entities[]`, `file`, `size`, `rows`, `cols`, `cell`, `crop`.
5. Build the entity tree grouped by label (same structure the current MANIFEST provides).
6. Resolve cross-sheet entities (same `name` + `anim` across multiple sheets in same label → merge frames).
7. Expose: `loadProject(projectName) → { labels: [{ name, entities: [...] }] }`

**Image paths:** Sheet JSONs store `file` relative to repo root (e.g. `petal-panic/assets/heroes/scarlet_vale_sheet.png`). Cropped frames are in `crop.frames_dir` + frame filename. The server serves these directly — no path rewriting needed.

**Validation:** Open `http://localhost:8766/sprite-editor/index.html?project=petal-panic` → sidebar populates with all entities from all labels. Same for `?project=abyss-qwen`.

---

### Task 4: Skill Refactor (remove render step)

**What:** Update both skills to reference the new served editor instead of generating HTML.

**sprite-crop skill changes:**
- Remove §6 "Sprite editor (on demand)" or replace with: "Open the editor via `server.sh go` and navigate to `?project=<name>`."
- Remove `render_editor.py` from scripts (or mark deprecated).
- Remove `editor-template.html` from templates (or archive).
- Update instructions: after a crop pass, tell user to open `http://localhost:8766/sprite-editor/?project=<name>` to verify.

**sprite-gen skill changes:**
- If it references the editor anywhere, update to the new URL pattern.
- The `state` subcommand stays unchanged (still writes per-sheet JSONs).

**Standard variable alignment:**
Both skills already define:
- `<sheets-root>` = `<working-dir>/.squid-os/sprite-sheets/`
- `<assets-dir>` = project asset folder from meta

The editor uses the same paths. No new variables needed — the server just serves the repo root and the editor constructs URLs from the same path conventions.

---

### Task 5: Cleanup

**What:** Remove dead artifacts.

- Delete `.squid-os/sprite-gen/editor-petal-panic.html` (generated output)
- Delete `.squid-os/sprite-gen/editor-abyss-qwen.html` (generated output)
- Delete `skills/sprite-crop/scripts/render_editor.py` (replaced by server)
- Delete `skills/sprite-crop/templates/editor-template.html` (replaced by split files)
- Update `skills/sprite-crop/SKILL.md` resources section
- Archive old plan: `.squid-os/plans/sprite-editor.md` → mark as superseded by this plan

---

## Execution Order

```
Task 1 (server)  →  Task 2 (split)  →  Task 3 (runtime loading)  →  Task 4 (skill refactor)  →  Task 5 (cleanup)
```

Tasks 1 and 2 can be partially parallel (server doesn't depend on split being done; split doesn't need server running until validation).

---

## Agent Technique

Following the orchestration pattern from the JS refactor session:

1. **Orchestrator (me)** handles:
   - Architecture decisions (file boundaries, module interfaces)
   - Integration points (what imports what)
   - Verification (open in browser, test features)
   - Skill updates

2. **Inline agents** handle:
   - Mechanical CSS extraction
   - Individual JS module splits (given clear boundaries + import list)
   - Import path fixes after moves
   - Server script creation (copy pattern from petal-panic)

3. **Rules for agents:**
   - Read this plan for context
   - Do NOT change behavior — pure structural refactor
   - Run `node --check` on every JS file
   - Report: files created, lines per file, any issues

---

## Validation Checklist

After all tasks complete:

- [ ] `./server.sh go` starts cleanly, prints URL
- [ ] `http://localhost:8766/sprite-editor/?project=petal-panic` loads, sidebar shows all entities
- [ ] `http://localhost:8766/sprite-editor/?project=abyss-qwen` loads, sidebar shows all entities
- [ ] Select an entity → canvas shows frames at 2× with axes
- [ ] Playback works (space, arrows, FPS +/-)
- [ ] Collision box tool: drag, resize, shift+corner ratio
- [ ] Melee box tool: per-frame, enable/disable
- [ ] Scale tool: sx/sy independent
- [ ] Pivot tool: click places marker
- [ ] Offset: Shift+arrows ±1, Ctrl+arrows ±10
- [ ] State preserved when switching entities
- [ ] No console errors
- [ ] `render_editor.py` deleted, skills updated
- [ ] Old generated HTML files deleted

---

## Out of Scope (this plan)

- Save-to-disk (POST endpoint, write-back to JSON) — next plan
- Gameplay metadata editing (hitboxes, markers, radius) — next plan
- JSON Schema validation — next plan
- Game debug menu integration — later
- Multi-user / concurrent editing — N/A
