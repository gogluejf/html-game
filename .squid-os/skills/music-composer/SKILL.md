---
name: music-composer
description: Composes procedural chiptune/synth music for games using a backbone-first workflow. The architect designs song structure (parts, intensity arc, time signature) and the composer writes notes into that structure. A compiler produces the engine grid; the jukebox server plays everything.
version: 3.1.0
allowed-tools: bash read_file write_file edit_file open
---

## Overview

Turns a musical brief into playable songs via a **two-role pipeline**:

```
ARCHITECT → backbone.json (structure: parts, bars, drums, timeSig)
COMPOSER  → parts-<slug>.json (notes: lead, bass, pad, layer, drumKit)
COMPILER  → engine grid (internal, automatic)
JUKEBOX   → plays it (server-based, one code path)
```

No legacy format. No rendered HTML. No fixed bar count. Structure is as
free as the music demands: 3-part banger or 12-part epic, any time
signature, unlimited drum patterns.

**The CLI (`scripts/compose.py`) is the only way to create or modify files.**
Never hand-write or hand-edit `backbones/*.json` / `parts-*.json` — every
musical decision goes through `arch` / `parts` arguments. The JSON files are
compiler output artifacts, not authoring surfaces.

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

Design the structure in your head first (part names, bar counts, drum
levels, time sig), then create it with ONE `arch` call:

```bash
python3 <skill-folder>/scripts/compose.py arch --game GAME \
  --name "SONG NAME" --bpm 140 --time-sig "4/4" \
  --part intro,4,none \
  --part hook,8,light \
  --part build,8,medium \
  --part peak,8,full \
  --part tag,4,light
```

`--part name,measures,drum` is repeatable; order = song order. Drum values are
keys you will define later in the parts' `drumKit`. (The flag is `--part`.)

**The architect decides:**
- Part names and order. **Names are free-form** — real musical terms that
  fit the genre/vibe (pop: `verse`/`chorus`; EDM: `build`/`drop`; jazz:
  `head-in`/`solo`/`head-out`; boss: `phase1`/`rage`). No fixed enum.
- How many bars per part (**minimum 2** — the compiler rejects 1-bar
  parts).
- Drum pattern assignment per part.
- Time signature — any valid `"beats/note"` string: `4/4`, `3/4`, `6/8`,
  `7/8`, `5/4`, `4/7`… no default assumption; pick what the music needs.
- Overall duration (target 0:40–3:00 for game music; verify with
  `show-arch`, which prints total bars + estimated duration).
- **Repeats vs variations:** same name = same notes replayed (e.g. two `hook`
  entries with different drums). Suffix `-b`, `-c`, `-2` = different notes.

**Genre-aware structure patterns** (guidelines, not rules):

| Genre | Typical arc | Notes |
|---|---|---|
| Speed metal | intro→hook→build→peak→bridge→tag | Short parts (2–4 bars), fast escalation, double-time feel |
| Synthwave | intro→verse→chorus→verse→chorus→outro | Longer parts (4–8 bars), steady pulse, sidechain pump |
| Punk | hook→hook→build→peak→tag | Minimal intro, immediate energy, short total length |
| Jazz/funk | head→solo A→solo B→head-out | Rubbery timing, sparse drums, comping pads |
| Boss fight | phase1→phase2→phase3→rage | Intensity never drops, each phase adds layers |
| Menu/ambient | loop A→loop B→loop A | Seamless, no strong start/end, gentle dynamics |
| Circus/carnival | call→response→build→climax→tag | Playful, dynamic contrasts, unexpected key shifts |

The architect is FREE to deviate. These are starting points, not cages.

**Sanity-check the skeleton:** each part should have a clear job and the drums
should get busier as the song builds. A backbone where two adjacent parts share
the same drum level AND the same bar count is a red flag — the song will stall
there. Full craft details are in [craft-instructions.md](references/craft-instructions.md).

After creating, check the result:

```bash
python3 <skill-folder>/scripts/compose.py show-arch --game GAME --name "SONG NAME"
```

It prints the part map, total bars, estimated duration, and the distinct
part names you'll fill in parts.

### 3. Composer: write the parts

Fill notes with ONE `parts` call (or several — `parts` merges; see step 5):

```bash
python3 <skill-folder>/scripts/compose.py parts --game GAME \
  --name "SONG NAME" --genre "Acid Jazz" \
  --vibe "one-line description of the sound" \
  --lead intro="E4 _ G4 _ | A4 _ G4 E4" \
  --lead hook="C5 D5 E5 F5 | G5 F5 E5 D5" \
  --layer peak="B4 A4 G4 A4 | B4 A4 G4 A4" \
  --bass intro="E2 _ E3 _ | E2 _ E3 _" \
  --bass hook="A2 _ A3 _ | G2 _ G3 _" \
  --pad hook="Em x4 C x2" \
  --drum none='{}' \
  --drum light='snare:"2 4" hat:eighths' \
  --drum medium='snare:"2 4" kick:"1 3" hat:eighths' \
  --drum full='snare:"2 4 3.5" kick:"1 2.5 3" hat:sixteenths' \
  --voice bassType=sawtooth --voice bassCut=900 --voice bassDur=0.14 \
  --voice padType=sawtooth --voice padCut=1400 --voice padDur=0.4 \
  --voice leadType=square --voice leadCut=3800 --voice leadDur=0.16 --voice vib=14 \
  --voice layerType=triangle --voice layerCut=3000 --voice layerDur=0.18 \
  --voice kickTop=150 --voice kickBot=42
```

**Drum levels must be strictly additive** (each level adds an instrument or
density, never removes): light = snare + hats; medium adds the kick pattern;
full/heavy add ghost notes, offbeat kicks, and sixteenth hats. Muffled
triangle/sine defaults make everything sound dull — use the punchy sawtooth/
square voices above for any energetic genre.

**Genre drum grammar — map the genre to its actual vocabulary, don't improvise.**
Pasting one genre's beat onto another is how "punk" ends up sounding like disco:

| Genre | Kick | Snare | Hats |
|---|---|---|---|
| Punk/hardcore | driving 1+3, offbeat push (2.5, 3.75) at peak | backbeat 2+4, ghosts at peak | eighths → sixteenths at peak |
| Speed metal | double-time 8th-note kick | backbeat + fills | constant sixteenths |
| Synthwave | four-on-floor (this is where it belongs) | rim/ghost on 2+4 | eighths, open on offbeats |
| Acid jazz/funk | syncopated, sparse | rim clicks, comping | soft eighths |
| Boss fight | relentless quarters + accents | heavy backbeat, layered ghosts | dense, always moving |

**Note notation** (for `--lead`, `--layer`, `--bass`):
- `|` separates bars. Within a bar, tokens are placed on an eighth-note grid
  by default (token N lands at position N×(step_width/8)).
- `_` = rest for one default slot.
- `~` suffix = hold 2 beats; `.` suffix = dotted (1.5×).
- Note names: sharps only (`C#5`, `F#4`), octaves 1–6.
- `xN` repeat shorthand is supported: a group of tokens followed by `xN` is
  repeated N times (e.g. `C4 D4 x4`). Prefer writing bars out and varying them
  — verbatim repetition is what makes songs boring — but use `xN` when you
  genuinely want an exact groove to repeat; it parses cleanly.
- Bar width is derived from the backbone's `timeSig` automatically — you
  always write **bars**, never raw cells. For 4/4 that's 8 eighths/bar; for
  4/7 it's 16 eighths/bar; for 6/8 it's 12 eighths/bar.

**Drum kit notation** (for `--drum name='...'`):
- `inst:"beat beat ..."` — beat numbers within the current bar, space-separated.
  **Beats are 1-indexed:** beat 1 = first beat of the bar. To hit the DOWNBEAT
  (the very first instant, step 0), use an explicit `0`. Example:
  `kick:"0 1 2.5 3"` puts kicks on the downbeat + beats 1, 2.5, 3.
  Fractional beats allowed (`3.5`). D4 requires a kick at step 0 in any kit
  that has kicks — so always include `0` for the downbeat.
- Named patterns: `quarters`, `eighths`, `sixteenths` (repeat across the
  32-step grid).
- `{}` = silence.
- Unlimited named patterns per song; the backbone references them by name.

**Pads** (for `--pad part="..."`): chord names with `xN` holds, placed at
bar starts within the part (`"Em x4 C x2"` = Em for 4 bars, then C for 2).
(Here `xN` means "hold this chord for N bars" — that's harmony sustain, not
melodic repetition, so it's fine.)

**The composer decides:**
- Actual note content (melodies, bass lines, chord voicings)
- Which parts get layers (typically peak/climax only)
- Whether bass is shared (`--bass-single` with a single `--bass` pattern) or
  per-part (`--bass part="..."`). **Default to per-part**: a shared
  bass is a root pedal waiting to happen. Per-part specs also clear the
  stale `_bass_single` flag automatically.
- Pad chord placement
- Voice timbres (waveform type, filter cutoff, duration, vibrato)
- Drum kit patterns (kick/snare/hat positions per named level)

**Voice timbres — use the chiptune presets, not generic values.** The "Nintendo
vibe" comes from voice params, not notes: short decay (0.14–0.22), high cutoffs
(lead 3400+), square/sawtooth melody. Copy the genre preset from
[song-structure.md](references/song-structure.md) "Chiptune / 8-bit / synthwave
voice recipes" — do NOT improvise soft triangle/sine defaults for energetic
genres. Triangle is reserved for pads in jazz/ambient only.

**Write a melody that moves and builds.** This is what makes a track good —
aim for all of these in every song:

- **Every bar is different from the one before.** No bar copied verbatim from
  an earlier bar. If you want a groove to repeat, change at least one thing
  (the ending note, a passing tone, or the top note) so it feels like progress,
  not a loop.
- **Build momentum across the song.** Start lower and tighter; end higher and
  bigger. The peak part should reach the highest notes of the whole song — if
  the hook already hit the top, the peak has nowhere to go.
- **Vary the rhythm.** Mix short staccato notes with some held notes and a
  couple of fast runs. Don't play even eighths the entire way — rhythm variety
  is half the identity of a chiptune melody.
- **Walk, don't teleport.** Melodies mostly move by small steps (2nds/3rds);
  use a leap on purpose (to climb into a new register, to enter a new part, or
  to resolve down at the end), not randomly.
- **Land the ending.** The tag descends stepwise back to the tonic and states
  the peak's top note once as a farewell.

These are goals, not rigid rules — `audit` checks the mechanical ones
(progression, ceiling, bass motion, drums) so you can focus on making it sound
good. Run `audit` before declaring done.

Check the result:

```bash
python3 <skill-folder>/scripts/compose.py show-parts --game GAME --name "SONG NAME"
```

### 4. Test in jukebox

```bash
bash <skill-folder>/server/server.sh go
# Opens: http://localhost:<port>/.squid-os/skills/music-composer/server/jukebox.html?game=<GAME>
```

All songs compile automatically at load. No render step. No HTML generation.

### 5. Iterate / Overwrite

**`parts` is modular.** Pass only what you want to change. Existing parts,
drums, voices, pads are preserved. Revision bumps automatically. **But merges
leave stale data**: if the backbone's part set changed (rename/remove), old
part entries survive in parts. `audit` flags them — delete or repurpose.

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
```

**`arch` is a full rewrite** (no merge). If you change the backbone, re-pass
parts for any new/renamed parts.

- Re-open jukebox. Changes are live (no cache).

## Rules

- One format: backbone + parts. No legacy grids. No dual paths.
- All file creation/modification goes through the CLI. Never edit JSON by hand.
- Part names in the backbone must have matching entries in parts (lead at minimum).
- `drum` values in the backbone must be keys in the parts' `drumKit`.
- Parts need ≥ 2 bars.
- `createdAt` sets playlist order; the CLI manages it — don't touch it.
- Validate before declaring done: `compose.py validate --game GAME`.
- **Audit before declaring done: `compose.py audit --game GAME --name NAME`** —
  it mechanically checks progression, register arc, bass motion, and drums.
  Fix every FAIL; WARNs are judgment calls.
- Test in browser before declaring done.

## Output Format

```
Composed music for <GAME>:

Songs dir: <songs-dir>
Jukebox:   http://localhost:<port>/...?game=<GAME>

Tracks:
1. <NAME> — <genre>, <bpm> BPM, <timeSig>, <n> parts, ~<duration>
2. ...

Tested in browser: yes/no
```

## Resources

### CLI (`scripts/compose.py`)

```bash
# Create backbone (architect) — full rewrite, no merge
python3 compose.py arch --game GAME --name NAME --bpm N --time-sig "SIG" \
  --part name,measures,drum [repeatable]

# Show backbone structure (part map, duration, distinct parts)
python3 compose.py show-arch --game GAME --name NAME

# Create/update parts (composer) — merges; only passed fields change
python3 compose.py parts --game GAME --name NAME --genre G --vibe V \
  --lead part="notes | notes | ..." [repeatable] \
  --layer part="notes | ..." [repeatable] \
  --bass part="notes | ..." [repeatable] [--bass-single] \
  --pad part="Chord xN Chord xN" [repeatable] \
  --drum name='snare:"2 4" kick:"0 1 2.5 3" hat:eighths' [repeatable] \
  --voice key=value [repeatable]

# Craft-instruction audit of one song: consistency vs backbone, M1 (scale),
# M3 (progression), M4 (ceiling), B1 (bass moves), D1-D5 (drums). Exit 1 on FAIL.
python3 compose.py audit --game GAME --name NAME

# Show parts summary (parts, drum patterns, voices)
python3 compose.py show-parts --game GAME --name NAME

# Validate all songs in a game
python3 compose.py validate --game GAME

# List songs
python3 compose.py list --game GAME

# Remove a song (backbone + parts)
python3 compose.py remove --game GAME --name NAME

# Set vibe
python3 compose.py set-vibe --game GAME --name NAME --vibe "..."
```

### Server
- [server.sh](server/server.sh) — start/stop/status/go the jukebox HTTP server
- [server.py](server/server.py) — static file server with no-cache headers
- [compiler.js](server/js/compiler.js) — backbone+parts → engine grid (browser-side)

### References
- [craft-instructions.md](references/craft-instructions.md) — **the active rulebook** (M/B/H/D instructions, all mechanically enforced by `audit`). Follow this.
- [song-anatomy.md](references/song-anatomy.md) — the unit ladder (song/part/measure/beat/step), worked example, who-decides-what contract
- [song-structure.md](references/song-structure.md) — file format spec + chiptune voice recipes only. (Its "Laws of good music" part is unused; the active rules are in craft-instructions.md.)
- [behavior-spec.md](references/behavior-spec.md) — jukebox transport/UI behavior
