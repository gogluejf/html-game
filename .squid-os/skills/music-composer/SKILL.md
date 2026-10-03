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

Pick a **construction** first — these are proven part-arc templates with
drum ladders and variation rules (see `references/constructions/`):

- **DREAM** (`dream.md`) — the classic 8-part loop: paired sections
  (`riff → riff-b → run → run-b → peak → drop → climax → tag`), each pair
  brings new melodic material, b-phrases vary only the ending, sparse drop
  before the climax, drum ladder `[0,0,1,1,2,3,3,2]`. Call-and-answer
  two-melody songs use the same skeleton (make riff/run a true A/B pair).

Each file has the exact `arch` command, the per-part rules, voice guidance,
and variants. When the user's brief implies a known shape (boss loop,
call-and-answer punk, etc.), use the matching construction verbatim. Free-form
`--part` design is still allowed for songs that genuinely need a non-standard
shape — but default to a construction; freestyle is where lazy drafts come from.

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

Fill notes with ONE `parts` call (or several — `parts` merges; see step 5).
Compose original material. There is deliberately NO worked note example in
this skill: past concrete melodies get copied verbatim into every new song
and the library turns into one riff in different keys. Write pitches that
serve THIS brief — a different key center, a different rhythmic identity,
a different register arc than the songs already in the game. Before writing,
check what keys/keys-shapes existing songs use (`list --game GAME`) and
steer away from them.

**Drums — compose them, don't template them.** This is where tracks live or die.
A good drum pattern has *rhythm*: grouped hits, placed ghosts, a syncopated or
driving kick, and breathing room. A flat wall of even hits sounds like a
metronome. Study what great tracks actually did:

- **Punk/arcade:** kick+snare lock driving the beat (kick on 1+3 or every beat
  at peak, snare backbeat 2+4), hats keeping time underneath — eighths for a
  steady pulse, or grouped sixteenths with gaps for drive. Never a silent,
  unbroken sixteenth wall at full volume; that masks the backbeat.
- **Breakbeat/electro:** syncopated kick that moves bar to bar, ghost snares
  and double-hits, hats in rhythmic groups (threes, gaps) — see Sawdust Breaks.
- **Folk/reel/jig:** sparse kick on the beat, light hat figure, let the lead
  carry — see Pirate Ship Reel.

Pick the pattern that serves the genre and the moment. Levels should generally
build in energy as the song climbs, but a deliberate drop-out after a loud part
is a valid choice too — use judgment. For energetic genres use the punchy
sawtooth/square voices above; muffled triangle/sine defaults sound dull.

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

**Write a melody and bass that serve the song.** These are goals, not laws —
`audit` only *warns* on them now, so use your ear:

- **Rhythm is half the identity.** Mix held notes (`~`), dotted (`.`), quick
  pairs, and placed rests. Even eighths all the way sounds robotic. Dense,
  moving lines (like Pirate Ship Reel's 16-note jig bars) usually hit harder
  than sparse ones for energetic genres.
- **Build an arc.** Start lower/tighter, end higher/bigger; the peak is
  usually the song's highest moment, and the tag walks home to the tonic.
- **Walk with purpose.** Melodies mostly move by steps; leap on purpose (to
  climb registers, enter a part, or resolve at the end).
- **Bass should have a job.** It can pedal hard on the root when that's the
  groove (very punk), or walk with the harmony — either is fine. Keep it in a
  low register where it has weight.

Run `audit` before declaring done — but treat its output as things to *consider*,
not commands. Only off-scale notes and structural errors are hard FAILs now.

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
  it only hard-FAILs on real bugs (missing/stale parts, undefined drum refs,
  off-scale notes, kick-wall noise floor). Everything musical (progression,
  ceiling, bass motion, drum patterns) is a WARN to consider with your ear, not
  a command. Fix FAILs; judge WARNs.
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

# Craft audit of one song: hard-FAILs only on real bugs (structure, off-scale,
# kick-wall). Musical/taste checks are WARNs to consider. Exit 1 on FAIL.
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
- [constructions/dream.md](references/constructions/dream.md) — DREAM construction: the classic 8-part loop (riff/riff-b/run/run-b/peak/drop/climax/tag), paired variation, sparse drop, drum ladder
- [craft-instructions.md](references/craft-instructions.md) — musical goals and the scale/voice vocabulary. Most of it is now advisory (audit only WARNs); read it for guidance, not as a rulebook to obey.
- [song-anatomy.md](references/song-anatomy.md) — the unit ladder (song/part/measure/beat/step), worked example, who-decides-what contract
- [song-structure.md](references/song-structure.md) — file format spec + chiptune voice recipes only. (Its "Laws of good music" part is unused; the active rules are in craft-instructions.md.)
- [behavior-spec.md](references/behavior-spec.md) — jukebox transport/UI behavior
