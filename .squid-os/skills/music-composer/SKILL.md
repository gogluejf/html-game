---
name: music-composer
description: Composes procedural chiptune/synth music for games using a backbone-first workflow. The architect designs song structure (sections, intensity arc, time signature) and the composer writes notes into that structure. A compiler produces the engine grid; the jukebox server plays everything.
version: 3.0.0
allowed-tools: bash read_file write_file edit_file open
---

## Overview

Turns a musical brief into playable songs via a **two-role pipeline**:

```
ARCHITECT → backbone.json (structure: sections, bars, drums, timeSig)
COMPOSER  → parts-<slug>.json (notes: lead, bass, pad, layer, drumKit)
COMPILER  → engine grid (internal, automatic)
JUKEBOX   → plays it (server-based, one code path)
```

No legacy format. No rendered HTML. No fixed phrase count. Structure is as
free as the music demands: 3-section banger or 12-section epic, any time
signature, unlimited drum patterns.

## Variables

- `<skill-folder>` — directory containing this SKILL.md
- `<working-dir>` — active project root
- `<songs-dir>` — `<working-dir>/.squid-os/music-composer/<GAME>/`
- `<server>` — `<skill-folder>/server/` (jukebox web app)

## Workflow

### 1. Interview for the brief

Ask only what's needed; infer the rest. Minimum:
- **Game name**
- **How many tracks** + purpose (normal play, boss, menu, etc.)
- **Vibe/style per track** (genre, mood, energy)
- **Tempo feel** — you pick concrete BPM
- Any must-haves (key, hook, specific reference)

One-liner brief? Infer sensible defaults. Don't over-ask.

### 2. Architect: design the backbone

For each song, create `backbones/<slug>.json`:

```jsonc
{
  "name": "SONG NAME",
  "bpm": 140,
  "timeSig": "4/4",          // "3/4", "6/8", "7/8" — any valid sig
  "form": [
    { "section": "intro",  "bars": 4, "drums": "none"   },
    { "section": "hook",   "bars": 8, "drums": "light"  },
    { "section": "build",  "bars": 8, "drums": "medium" },
    { "section": "peak",   "bars": 8, "drums": "full"   },
    { "section": "bridge", "bars": 4, "drums": "medium" },
    { "section": "tag",    "bars": 4, "drums": "light"  }
  ]
}
```

**The architect decides:**
- Section names and order. **Names are free-form** — pick real musical terms
  that fit the genre/vibe. The same song structure might be called:
  - Pop/rock: `intro`, `verse`, `pre-chorus`, `chorus`, `bridge`, `outro`
  - EDM: `intro`, `build`, `drop`, `break`, `drop-b`, `outro`
  - Jazz/funk: `head-in`, `groove`, `solo`, `head-out`
  - Metal/boss: `intro`, `verse`, `chorus`, `phase2`, `rage`, `tag`
  - Ambient: `drift`, `swell`, `fade`
  - Variations: suffix `-b`, `-c`, `-2` (e.g. `chorus`, `chorus-b`)
  
  There is no fixed enum. Adapt the vocabulary to the style. The name is just
  a key to look up notes in parts. Pick names that make the structure readable
  at a glance for someone who knows that genre.
- How many bars per section
- Drum pattern assignment per section (keys from the parts' `drumKit`)
- Time signature (default 4/4; use 3/4 for waltzes, 6/8 for ballads, etc.)
- Overall duration (target 0:40–3:00 for game music)
- **Repeats vs variations:** same name = same notes replayed (e.g. two `hook`
  entries with different drums). Suffix `-b`, `-c`, `-2` = different notes
  (e.g. `hook` then `hook-b` for a varied second pass).

**Genre-aware structure patterns** (guidelines, not rules):

| Genre | Typical arc | Notes |
|---|---|---|
| Speed metal | intro→hook→build→peak→bridge→tag | Short sections (2–4 bars), fast escalation, double-time feel |
| Synthwave | intro→verse→chorus→verse→chorus→outro | Longer sections (4–8 bars), steady pulse, sidechain pump |
| Punk | hook→hook→build→peak→tag | Minimal intro, immediate energy, short total length |
| Jazz/funk | head→solo A→solo B→head-out | Rubbery timing, sparse drums, comping pads |
| Boss fight | phase1→phase2→phase3→rage | Intensity never drops, each phase adds layers |
| Menu/ambient | loop A→loop B→loop A | Seamless, no strong start/end, gentle dynamics |
| Circus/carnival | call→response→build→climax→tag | Playful, dynamic contrasts, unexpected key shifts |

The architect is FREE to deviate. These are starting points, not cages.

### 3. Composer: write the parts

For each song, create `parts-<slug>.json`:

```jsonc
{
  "name": "SONG NAME",           // must match backbone
  "genre": "Speed Metal",
  "vibe": "Blazing speed-metal circus at 190 BPM — galloping E-minor chug",
  "createdAt": "2026-10-02T13:04:47",
  "revision": 1,

  "drumKit": {
    "none":   {},
    "light":  { "snare": "2 4" },
    "medium": { "snare": "2 4", "kick": "1 2 3 4" },
    "full":   { "snare": "2 4 3.5", "kick": "1 2 3 4", "hat": "eighths" }
  },

  "lead": {
    "intro":  [[null,null,"E4",null,...], [...]],   // bars of 16 cells
    "hook":   [[...], [...]],
    "peak":   [[...], [...]]
  },
  "layer": {
    "peak":   [[...], [...]]                        // optional counter-melody
  },
  "bass": {
    "intro":  [[...], [...]]
  },
  "_bass_single": true,                              // same bass for all sections
  "pad": {
    "hook":   { "0": ["C3","E4","G4"], "16": ["C3","E4","G4"] }
  },
  "voices": {
    "bassType": "triangle", "bassCut": 400, "bassDur": 0.3,
    "padType": "sine", "padCut": 1800, "padDur": 0.9,
    "leadType": "square", "leadCut": 2600, "leadDur": 0.25, "vib": 4,
    "layerType": "triangle", "layerCut": 3000, "layerDur": 0.22,
    "kickTop": 110, "kickBot": 45
  }
}
```

**The composer decides:**
- Actual note content (melodies, bass lines, chord voicings)
- Which sections get layers (typically peak/climax only)
- Whether bass is shared (`_bass_single: true`) or per-section
- Pad chord placement (step offsets within each section)
- Voice timbres (waveform type, filter cutoff, duration, vibrato)
- Drum kit patterns (kick/snare/hat positions per named level)

**Note format:** arrays of bars, each bar = 16 cells (16th notes). Cell = note
name string (`"A4"`, `"C#5"`) or `null` for rest. Pads use step-offset keys
(`"0"`, `"8"`, `"16"`) mapping to chord note arrays.

### 4. Test in jukebox

```bash
bash <skill-folder>/server/server.sh go
# Opens: http://localhost:<port>/.squid-os/skills/music-composer/server/jukebox.html?game=<GAME>
```

All songs compile automatically at load. No render step. No HTML generation.

### 5. Iterate / Overwrite

**`parts` is modular.** Pass only what you want to change. Existing sections,
drums, voices, pads are preserved. Revision bumps automatically.

```bash
# Fix just the hook-b melody (everything else stays):
python3 compose.py parts --game petal-panic \
  --name "BIG TOP FURY" \
  --lead hook-b="NEW MELODY | HERE | NOW | YES"

# Add a layer to peak (wasn't there before):
python3 compose.py parts --game petal-panic \
  --name "BIG TOP FURY" \
  --layer peak="B4 A4 G4 A4 | B4 A4 G4 A4"

# Change one drum pattern:
python3 compose.py parts --game petal-panic \
  --name "BIG TOP FURY" \
  --drum blast='kick:sixteenths snare:"2 4" hat:sixteenths'

# Update structure (full rewrite — arch has no merge):
python3 compose.py arch --game petal-panic \
  --name "BIG TOP FURY" --bpm 170 --time-sig "4/4" \
  --section phase1,4,medium \
  --section phase2,6,full \
  --section rage,8,blast
```

**`arch` is a full rewrite** (no merge). If you change the backbone, you may
need to re-pass parts for any new/renamed sections.

- Re-open jukebox. Changes are live (no cache).

## Rules

- One format: backbone + parts. No legacy grids. No dual paths.
- `timeSig` in the backbone is respected by the engine (beats per bar × resolution).
- Section names in `form` must have matching entries in parts (lead at minimum).
- `drums` values in form must be keys in the parts' `drumKit`.
- Every bar array is exactly 16 cells (one bar of 16th notes).
- `createdAt` sets playlist order; never overwrite it on edits.
- Test in browser before declaring done.

## Output Format

```
Composed music for <GAME>:

Songs dir: <songs-dir>
Jukebox:   http://localhost:<port>/...?game=<GAME>

Tracks:
1. <NAME> — <genre>, <bpm> BPM, <timeSig>, <n> sections, ~<duration>
2. ...

Tested in browser: yes/no
```

## Resources

### CLI (`scripts/compose.py`)

```bash
# Create backbone (architect)
python3 compose.py arch --game GAME --name NAME --bpm N --time-sig "4/4" \
  --section name,bars,drum [repeatable]

# Show backbone structure (what sections to fill in parts)
python3 compose.py show-arch --game GAME --name NAME

# Create parts (composer) — overwrites if same --name
python3 compose.py parts --game GAME --name NAME --genre G --vibe V \
  --lead section="notes | notes | ..." [repeatable] \
  --layer section="notes | ..." [repeatable] \
  --bass "E2 E3 x16" [--bass-single] \
  --pad section="Em x4 C x2" [repeatable] \
  --drum name='snare:"2 4" kick:"1 2 3 4" hat:eighths' [repeatable] \
  --voice key=value [repeatable]

# Show parts summary (what's in each section, drum patterns, voices)
python3 compose.py show-parts --game GAME --name NAME

# Validate all songs in a game
python3 compose.py validate --game GAME

# List songs
python3 compose.py list --game GAME

# Remove a song
python3 compose.py remove --game GAME --name NAME

# Set vibe
python3 compose.py set-vibe --game GAME --name NAME --vibe "..."
```

**Overwrite:** re-run `arch` or `parts` with same `--name`. File is replaced.

### Server
- [server.sh](server/server.sh) — start/stop/status/go the jukebox HTTP server
- [server.py](server/server.py) — static file server with no-cache headers
- [compiler.js](server/js/compiler.js) — backbone+parts → engine grid (browser-side)

### References
- [song-structure.md](references/song-structure.md) — format spec + structural guidelines
- [behavior-spec.md](references/behavior-spec.md) — jukebox transport/UI behavior
