---
name: sprite-gen
description: Generates high-quality animated sprite sheets (enemies, bosses, power-ups, player ships, backgrounds) by interacting with ChatGPT image generation via browser-use. Handles prompt construction, reliable text input, send, wait-for-generation, download, and quality verification. Maintains a single ChatGPT conversation for style consistency across all sprites in a project.
allowed-tools: bash read_file write_file edit_file inspect_media open
---

## Overview
Interacts with ChatGPT's image generation to produce pixel-art sprite sheets for games. Constructs structured prompts specifying grid layout (rows x columns = entities x animation frames), style constraints, and per-entity descriptions. Uses browser-use to navigate to an existing or new ChatGPT conversation, reliably injects the prompt (bypassing flaky type_text via JS contenteditable manipulation), sends it, polls for generation completion, downloads the resulting image via CDP fetch with auth cookies, and verifies quality via screenshot inspection. Keeps all sprites in one conversation so style stays consistent. Supports enemies, bosses, power-ups, player ships, and backgrounds.

## Variables
- `<skill-folder>` — directory containing this SKILL.md
- `<working-dir>` — the REPO ROOT (e.g. `~/src/html-game`). NOT the game subfolder. All paths in state are relative to this.
- `<assets-dir>` — where generated sprite sheets are saved: `<working-dir>/<PROJECT>/assets/` (one folder per project/game, e.g. `panic-petal/assets/`). Persisted in the state file as `assets_dir`.
- `<chat-url>` — the ChatGPT conversation URL to use for style consistency (created on first run, reused thereafter)

## Instructions
## Workflow

**PRIMARY METHOD:** Use the deterministic CLI script for all GPT interactions:
```bash
python3 <skill-folder>/scripts/sprite_gen.py <subcommand> [args]
```
Subcommands: `send`, `wait`, `download`, `screenshot`, `state`. This handles the flaky input box, polling, and auth-cookie downloads deterministically. Only fall back to manual browser-harness heredocs if the script fails.

Requires: `pip install websocket-client` (one-time setup).

### 1. Setup & Session Management

- Use @skill:browser-use to control Chrome. Run its bootstrap first.
- **Check login:** Navigate to `https://chatgpt.com/`. If redirected to `/auth/login_with`, the user is NOT logged in. Tell them to log in via the visible Chrome window, then wait and re-check. Do NOT proceed until logged in.
- **Session reuse for style consistency:** All sprites for one project MUST be generated in the SAME ChatGPT conversation. On first run, start a new chat (click "New chat"). Save the resulting URL (`https://chatgpt.com/c/<uuid>`) as `<chat-url>`. On subsequent runs, navigate directly to `<chat-url>` so GPT sees prior sprites and matches their style.
- **Model selection:** Click the model dropdown in the composer (the button showing current mode like "Instant"). Select the highest-quality model available (e.g. "GPT-5.6 Sol"). This gives better image quality than Instant mode.

### 2. Prompt Construction

Build a structured prompt with these sections (adapt to user's request):

```
Generate a sprite sheet of [N] [entity type] sprites for [game description], continuing the exact same [style] as the [prior sheets] above.

LAYOUT: [R] rows x [C] columns on a solid pure black background. Each row is one unique [entity]; the [C] columns are its [C] animation frames shown left-to-right. All cells exactly the same size ([CELL]x[CELL] px), evenly spaced, no text, no labels, no borders between cells. Image [W] wide x [H] tall.

STYLE: [detailed style description - see Style Template below].

ROWS (top to bottom), [C] distinct loopable frames each:
1. [ENTITY NAME] - [description]. Frames: [frame 1 desc] -> [frame 2] -> [frame 3] -> [frame 4].
2. ...
...

Frames within each row must be clearly distinct but smoothly sequential (loopable). Keep it clean and croppable.
```

**Key prompt rules:**
- ALWAYS specify exact pixel dimensions for the full image AND per-cell size.
- ALWAYS say "solid pure black background" — makes cropping trivial (threshold on black).
- ALWAYS say "no text, no labels, no borders".
- ALWAYS describe each frame distinctly (e.g. "wings up -> mid -> down -> mid") so GPT doesn't make identical frames.
- For the FIRST sprite in a session, include a full style description. For subsequent ones, say "continuing the exact same style as the [prior] sheets above" — this keeps consistency.
- Cell size guidelines: enemies/power-ups/player = 256x256px per cell; bosses = 512x512px per cell (bigger detail); backgrounds = single image (no grid).

### 3. Reliable Text Input (CRITICAL)

ChatGPT's contenteditable input is FLAKY with browser-harness. Use this proven sequence:

1. **Click into the input area** to focus it:
   ```python
   click_at_xy(640, 970)  # center-bottom of page where composer lives
   time.sleep(1)
   ```

2. **Send via CLI** (preferred):
   ```bash
   python3 <skill-folder>/scripts/sprite_gen.py send --prompt "<PROMPT>" --chat-url "<CHAT_URL>"
   ```
   Or manually (fallback): click input at (640,970), `type_text(prompt)`, verify, click send at (868,964).

3. **Verify** the text landed:
   ```python
   val = js("""(() => { const el=document.querySelector('[contenteditable="true"],textarea'); return el?(el.innerText||el.value||'').slice(0,80):'EMPTY'; })()""")
   ```
   If empty, retry: click again + type_text again. If still empty after 2 tries, use the JS fallback:
   ```python
   js(f"""(() => {{ const el=document.querySelector('[contenteditable="true"],textarea'); if(!el)return 'NO'; el.focus(); el.innerHTML=''; const p=document.createElement('p'); p.textContent={json.dumps(prompt)}; el.appendChild(p); el.dispatchEvent(new Event('input',{{bubbles:true}})); return 'SET'; }})()""")
   ```

4. **Send** by clicking the blue send button (aria-label "Send prompt", located at approximately x=868, y=964):
   ```python
   click_at_xy(868, 964)
   time.sleep(3)
   ```
   Verify it sent: check that the input is now empty OR a new user message bubble appeared. If not sent, try `press_key("Enter")` while focused.

### 4. Wait for Generation

**Preferred (CLI):**
```bash
python3 <skill-folder>/scripts/sprite_gen.py wait --timeout 120 --expected-srcs <N>
```

Manual fallback — poll every 5 seconds, up to 2 minutes max:
```python
for i in range(24):
    time.sleep(5)
    info = js("""(() => {
      const imgs=[...document.querySelectorAll('img')].filter(i=>{const r=i.getBoundingClientRect();return r.width>80&&r.height>80;});
      const srcs=new Set(imgs.map(i=>i.src));
      const generating=!!document.querySelector('[data-testid*="generating"], .stop-button, button[aria-label*="Stop"]');
      return JSON.stringify({count:imgs.length, uniqueSrcs:srcs.size, generating});
    })()""")
    d = json.loads(info)
    print(f"poll {i+1}: {info}")
    if not d["generating"] and d["uniqueSrcs"] >= expected_unique_count:
        break
```
Track `expected_unique_count` — increment by 1 for each new image generated in the session.

### 5. Download

**Preferred (CLI):**
```bash
python3 <skill-folder>/scripts/sprite_gen.py download --output <assets-dir>/<filename>.png
```

Manual fallback — get the newest image's src URL and download via CDP fetch:
```python
import base64, json as J
# Get all large image srcs
srcs = js("""(() => { const imgs=[...document.querySelectorAll('img')].filter(i=>{const r=i.getBoundingClientRect();return r.width>80&&r.height>80;}); return JSON.stringify([...new Set(imgs.map(i=>i.src))]); })()""")
data = J.loads(srcs)
newest_src = data[-1]  # most recently added
# Fetch with page context (cookies included)
b64 = js(f"""(async () => {{ try {{ const r = await fetch({J.dumps(newest_src)}, {{credentials:'include'}}); const b = await r.blob(); return await new Promise(res=>{{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(b);}}); }} catch(e){{ return 'ERR:'+e.message; }} }})()""")
if b64 and b64.startswith('data:'):
    raw = b64.split(',',1)[1]
    open('<assets-dir>/<filename>.png','wb').write(base64.b64decode(raw))
    print("SAVED <filename>.png")
```
Verify with PIL: `from PIL import Image; im=Image.open(path); print(im.size)`

### 6. Quality Verification (on the downloaded asset)

Use @tool:inspect_media on the **downloaded PNG file itself** (never a screenshot) with a query covering exactly what will be stored in state:

```text
Query: "Count the rows and columns of sprites in this sheet. Are the frames within each row visually distinct from each other? Does the style match [style_name]? Any text, labels, borders, or artifacts?"
```

Checklist:
- Correct number of rows/columns (matches what was requested)
- Frames are DISTINCT (not all identical)
- Style matches prior sheets / `<style_name>`
- No text/borders/artifacts
- Shapes match the request (e.g. sausage shape, tied knots, etc.)

If quality is poor, tell the user what's wrong and offer to regenerate with a refined prompt (stay in the same conversation). Only record the sheet in state after it passes.

### 7. Record in State

**First time for a project — initialize:**
```bash
python3 <skill-folder>/scripts/sprite_gen.py state \
  --state <working-dir>/.squid-os/sprite-gen/state-<PROJECT>.json \
  --init --chat-url "<URL>" --style-name "<style>" --assets-dir "<PROJECT>/assets"
```

**After each verified generation (or pre-existing sheet) — add entry:**
```bash
python3 <skill-folder>/scripts/sprite_gen.py state \
  --state <working-dir>/.squid-os/sprite-gen/state-<PROJECT>.json \
  --add-sheet name=<label> file=<relative/path.png> size="<W>x<H>" rows=<R> cols=<C> cell=<CELL> \
  description="<what it is visually>" \
  entities='[{"row":1,"name":"entity_name","anim":"frame cycle description"},...]' \
  --prompt-file /tmp/<label>_prompt.txt
```

The CLI enforces the schema. `entities` MUST be a JSON array where every object has `row` (int), `name` (string), `anim` (string). For single-image sheets (logo, cover, background): `rows=1 cols=1 cell=<width>`.

**NEVER hand-edit the state JSON.** All writes go through this CLI.

### 8. Open for User Review

Use @tool:open on the saved PNG so the user can see it full-size.

### 9. Project State File

Maintain a JSON state file at `<working-dir>/.squid-os/sprite-gen/state-<PROJECT>.json` where `<PROJECT>` is the **game/project name** derived from the user's conversation context (e.g. "galaga", "tetris", "space-invaders"). NOT the folder name — ask or infer from what the user is building. A single code repo can contain multiple games, each with its own state file.

On first run for a new project, determine the name from the user's request (e.g. "make sprites for my galaga game" → `state-galaga.json`). If ambiguous, ask once.

**Schema — pure visual asset data only (enforced by CLI):**

```json
{
  "chat_url": "https://chatgpt.com/c/<uuid>",
  "style_name": "hand-painted circus parchment",
  "palette": ["crimson", "gold", "cream", "black"],
  "assets_dir": "panic-petal/assets",
  "sheets": {
    "<entity_name>": {
      "file": "panic-petal/assets/scarlet_vale_sheet.png",
      "size": "1619x971",
      "rows": 3,
      "cols": 5,
      "cell": 324,
      "description": "Scarlet Vale heroine animations on tan parchment",
      "entities": [
        {"row": 1, "name": "scarlet_vale", "anim": "run cycle: stride->contact->push->stride->contact"},
        {"row": 2, "name": "scarlet_vale", "anim": "jump: takeoff->rise->apex->fall->land"},
        {"row": 3, "name": "scarlet_vale", "anim": "attack: windup->swing->extend->impact->recover"}
      ],
      "original_prompt": "exact prompt sent to GPT or reverse-engineered",
      "crop": {
        "bg_color": [203, 170, 122],
        "bg_tol": 40,
        "row_y": [[0, 325], [326, 649], [650, 971]],
        "col_x": [[162, 489, 811, 1133, 1457], [162, 489, 811, 1133, 1457], [162, 489, 811, 1133, 1457]],
        "frame_size": "324x324",
        "frames_dir": "panic-petal/assets/heroes"
      }
    }
  },
  "updated": "2026-09-10T03:48:11"
}
```

Field meanings:
- `chat_url` — the ChatGPT conversation to resume (null if sheets were pre-existing)
- `style_name` — human-readable style anchor for prompts
- `palette` — dominant color names
- `assets_dir` — project asset folder relative to `<working-dir>`
- `file` — sheet path relative to `<working-dir>`
- `size` — actual image dimensions `WxH`
- `rows` — number of entity rows (one per row)
- `cols` — animation frames per row (left→right)
- `cell` — px per cell; frame N of row R crops at `(N*cell, R*cell)` with size `cell x cell`
- `description` — one-liner of what the sheet is visually
- `entities[]` — per row: `row` (int), `name` (string, entity key), `anim` (frame cycle description)
- `original_prompt` — exact prompt as sent to GPT, or reverse-engineered from image inspection
- `crop` — written by `crop_sprites.py record-crop`, NOT hand-edited

**Frame naming convention:** `<entity>_<action>_f<N>.png` (e.g. `scarlet_vale_run_f1.png`). For single-action entities (abyss style): `<entity>_f<N>.png`. Frames go FLAT in `assets/<label>/` — no per-entity subfolders.

## Rules
- **Same conversation always:** Never start a new chat mid-project. Style consistency depends on GPT seeing prior sprites in context.
- **Verify before sending:** Always confirm the prompt text is actually in the input box before clicking send. Check with JS innerText read.
- **Verify after download:** Always @tool:inspect_media the downloaded PNG file itself (not a screenshot) before recording it in state. If quality is bad, regenerate in the same chat.
- **State is pure art data:** The state file tracks ONLY generated visual assets (file, size, rows, cols, cell, description, entities, original_prompt). NEVER store game design values (points, wave, hp, weight, effect, score) — those belong in game code.
- **Black background mandatory:** Every sprite sheet prompt MUST specify "solid pure black background" for easy cropping.
- **Distinct frames mandatory:** Every prompt MUST explicitly describe each animation frame differently. If GPT returns identical frames, regenerate with stronger frame differentiation language.
- **No hardcoded credentials:** Read CDP websocket URL from `~/.config/squid-os/browser-use.json` at runtime.
- **Poll patiently:** Image generation takes 30-90s. Poll every 5s, max 24 iterations (2 min). Don't give up early.
- **Download via page fetch:** Always use in-page `fetch()` with `credentials:'include'` to download images — direct curl won't have auth cookies.
- **Save to assets dir:** All generated sheets go to `<assets-dir>` = `<working-dir>/<PROJECT>/assets/` (create it if missing, persist as `assets_dir` in state). Descriptive names: `enemies_sheet.png`, `bosses_sheet.png`, `powerups_sheet.png`, `player_sheet.png`, `background.png`. Cropped frames are saved by the sprite-crop skill under `<assets-dir>/<label>/`.
- **Open for user:** After saving, always `open` the file so the user can see it full-size immediately.
- **Style template for first prompt:** When starting a fresh project (no prior sprites), include this style block: "crisp 16-bit neo-arcade pixel art, [theme] neon colors ([list colors]) glowing against dark abyss-black. Sharp hard edges, NO anti-aliasing, NO gradients, flat shading with one highlight + one shadow step, high contrast, symmetrical, front-facing, no perspective. Consistent style across every sprite. Glowing accent cores/eyes. 1px dark rim outline."
- **Subsequent prompts:** Say "continuing the exact same [style] as the [prior entity] sheets above" — do NOT repeat the full style description. This keeps GPT anchored to the established look.

## Output Format
```
## Sprite Generation Report

- **Chat URL:** [conversation URL used]
- **Model:** [model selected, e.g. GPT-5.6 Sol]
- **Entity:** [enemies / bosses / power-ups / player / background]
- **Layout:** [R] rows x [C] cols, [CELL]px cells
- **Frames per entity:** [C] distinct animation frames
- **Quality check:** [PASS/FAIL - brief note on what was verified]
- **File saved:** `<assets-dir>/<filename>.png` ([W]x[H]) — e.g. `galaga/assets/enemies_sheet.png`
- **Status:** [DONE / NEEDS REGENERATION - reason]
```

## Examples
**Example 1: Generate enemy sprites (first in session)**

User: "Make me 4 aquatic enemies for my galaga game, pixel art style, neon colors on black"

Skill actions:
1. Bootstrap browser-use, verify ChatGPT login
2. Start new chat, select GPT-5.6 Sol
3. Construct prompt: 4 rows x 4 cols, 256px cells, 1024x1024, full style description, per-row entity descriptions with distinct frames
4. Click input (640,970), type_text, verify, click send (868,964)
5. Poll ~45s until generation done
6. @tool:inspect_media on the downloaded PNG: confirm 4x4 grid, distinct frames, correct entities
7. Download via CLI -> `assets/<project>/enemies_sheet.png` (1024x1024)
8. Open file for user

**Example 2: Generate boss sprites (same session, style consistency)**

User: "Now make 3 bosses, same style, bigger"

Skill actions:
1. Navigate to SAME chat URL (from step 2 above)
2. Prompt says "continuing the exact same style as the enemy sheet above", 3 rows x 4 cols, 512px cells, 2048x1536
3. Same input/send/wait/download flow
4. Save to `assets/<project>/bosses_sheet.png`

**Example 3: Regenerate poor quality result**

User: "The power-ups look wrong, they should be sausage shaped with tied knots"

Skill actions:
1. Stay in SAME chat
2. New prompt emphasizing the shape: "BUBBLY SAUSAGE/POPPER shapes with TIED KNOTS on each end, NOT ornate badges"
3. Stronger frame differentiation: "frame 1 = fully inflated fat, frame 3 = most squished thin/wide"
4. Send, wait, verify, download (overwrites previous)

## Resources

### Scripts
- [sprite_gen.py](scripts/sprite_gen.py) — Deterministic CLI: send/wait/download/screenshot/state management via CDP.

### References
- [prompt-templates.md](references/prompt-templates.md) — Additional documentation
