---
name: music-composer
description: Composes procedural chiptune/synth music for games by interviewing the user for vibe/style, generating a JSON composition file using a fixed phrase-bank song structure, and producing a standalone jukebox player HTML that plays all songs from that file.
version: 2.0.0
allowed-tools: bash read_file write_file edit_file open
---

## Overview
Turns a musical brief (vibe, style, tempo, mood) into a data-driven composition and a playable jukebox. Uses a deterministic song structure: each track has phrase banks for lead/pads, a steady bass groove, per-phrase drum levels (none/light/medium/full), and voice timbre params. A Python CLI validates the composition and emits a self-contained player HTML whose P key cycles through every song.

**v2 — Dream Construction:** tracks may now carry up to 8 phrases with micro-variations and a resolving tag (`0, 0b, 1, 1b, 2, 3, 4, 5`). Requires an explicit `drumLevels` table; `leadLayers` use the new flat per-phrase form. Classic 4-phrase tracks (`phraseLens [2,2,1,1]`) remain fully supported. See references/song-structure.md "Dream Construction".

## Variables
- `<skill-folder>` — directory containing this SKILL.md (holds scripts/, assets/engine.js, references/)
- `<working-dir>` — active working directory and project root for the current session
- `<songs-dir>` — one dir per game holding ONE JSON file per song: `<working-dir>/.squid-os/music-composer/<GAME>/` (e.g. `petal-panic/ratchet-rumbelow.json`). Created/updated by the composer script.
- `<player-out>` — where the standalone player HTML is written: `<working-dir>/.squid-os/music-composer/<GAME>.jukebox.html` (the HTML is the rendered viewer of all songs in the dir)

**Playlist order lives in each song's `createdAt`.** Songs load sorted by `createdAt` ascending. New songs get `now()` (microsecond precision) so they sort to the bottom; `edit` refuses to overwrite `createdAt`, so a revision bump can never reorder a song. To move a song, edit its `createdAt` to an earlier/later timestamp. Filenames are slugs of the name (`ratchet-rumbelow.json`); the pretty name stays inside as `"name"`.

## Instructions

**Workflow** — turn a musical brief into a validated composition + playable jukebox. Two deterministic scripts do the heavy lifting; you provide the creative content (the actual notes).

```bash
# Compose: builds or REPLACES the whole songs dir from a tracks JSON (full overwrite)
python3 <skill-folder>/scripts/compose.py compose --game <GAME> --tracks '<TRACKS_JSON>'
# Validate only (no write) — accepts a single song file OR an array file
python3 <skill-folder>/scripts/compose.py validate --file <song.json-or-array.json>
# Emit the standalone player HTML (reads every song in <songs-dir>)
python3 <skill-folder>/scripts/compose.py player --game <GAME> --out <player-out>

# Manage an existing playlist incrementally (one file per song, validated):
python3 <skill-folder>/scripts/compose.py list   --game <GAME>                 # show tracks + index/bpm/vibe (sorted by createdAt)
python3 <skill-folder>/scripts/compose.py add    --game <GAME> --track '<JSON_OBJECT_OR_ARRAY|@file|->'   # writes new file(s), appends at bottom
python3 <skill-folder>/scripts/compose.py remove --game <GAME> --name "<NAME>" [--index N]   # deletes the file(s); both repeatable
python3 <skill-folder>/scripts/compose.py set-vibe --game <GAME> --name "<NAME>" --vibe "<short phrase>"   # repeatable; one --vibe per selector
```

### 1. Interview for the brief

Ask only what's needed to write good music; infer the rest. Minimum to know:
- **Game name** (for the songs dir + output path).
- **How many tracks** and what each is for (e.g. normal play, escalation, boss).
- **Vibe/style per track** (e.g. '80s punk', E-minor metal, synthwave horror, acid jazz).
- **Tempo feel** (fast/medium/slow) — you pick concrete BPM.
- Any must-haves (a hook, a specific key, an emotional arc).

If the user gives a one-line brief ('make music for abyss-qwen, dark synthwave'), infer sensible defaults: 3-4 tracks, distinct styles, matching BPMs. Do not over-ask.

### 2. Write the tracks (the creative part)

Author a JSON array of track objects using the **song structure** (see references/song-structure.md). Key rules:
- Each track carries a short **`vibe`** field — a 10–25 word human phrase describing the intended feel/style (e.g. `"gritty carnival punk, fast and aggressive, sawtooth drive with busy hats"`). Display-only; shown dimmed under the title in the playlist. Always include it when authoring new tracks.
- Notes are **names** (`"A4"`, `"C5"`) or `null` for a rest — never raw Hz. The engine resolves names via its `\_NOTE` table (C1..B5).
- Every phrase array is **exactly 32 steps** (one 2-bar block of 16th notes).
- Each track has a **bank of lead phrases** and a matching bank of **pad phrases**; `phraseLens` (in bars, e.g. `[2,2,1,1]`) controls how long each phrase plays before advancing.
- **Drums** = an array of 4 sets (index = intensity level): `[none, light, medium, full]`. Each set is 32 entries of `{k,s,h}` booleans. Stack instruments per level: light=snare, medium=+kick, full=+busy hats/ghosts.
- **drumLevels** (v2) — optional per-phrase table mapping each phrase to a drum set index (0-3). REQUIRED when a track has more than 4 phrases; otherwise level = phrase index.
- Optional **leadLayers** (v2 flat form) — one 32-step phrase or null per phrase index; extra harmony/counter line on the phrases you choose (typically climax/tag). Legacy nested `[null,null,bankA,bankB]` form still validates and plays.
- Voice params per track: `bassType/bassCut/bassDur`, `padType/padCut/padDur`, `leadType/leadCut/leadDur/vib`, `layerType/layerCut/layerDur`, `kickTop/kickBot`.
- Make melodies **progressive**: distinct phrases with a real arc (hook -> build -> climax -> drop), not one repeated loop.
- **Universal rules (any style):** one rhythmic template per song (phrase 0 defines it; intensity comes from drums/register/pads, never note density); peak = same cells higher & sparser; bridge = descent to a sustained tonic that never quotes the hook's opening figure; b-phrases vary only the last 4–8 steps. See references/song-structure.md "Universal composition rules".
- **Dream construction (v2, preferred for new tracks):** 8 phrases `0, 0b, 1, 1b, 2, 3, 4, 5` with `phraseLens [1,1,1,1,1,1,1,1]` and `drumLevels [0,0,1,1,2,3,3,2]`. b-phrases repeat their base melody with a tiny variation in the last 4–8 steps; phrase 4 extends the peak; phrase 5 is a tag that resolves home so the loop feels like a landing. Full rules in references/song-structure.md.

Compose 32-step phrases by hand to fit the style. Keep the bass steady; let lead + pads carry the progression.

### 3. Compose, validate, and emit the player

1. Run `compose.py compose --game <GAME> --tracks '<TRACKS_JSON>'`. It validates (array lengths, finite notes, drum-set shape) and writes one file per song into `<songs-dir>`. If validation fails, fix the tracks JSON and re-run — do not hand-edit the song files.
2. Run `compose.py player --game <GAME> --out <player-out>`. It inlines the engine from `<skill-folder>/assets/engine.js` plus the composition into a single self-contained `jukebox.html`.
3. Open it: `open <player-out>`. The **P** key cycles through every track; **M** mutes. Confirm each song plays and loops without cutting off.

### 4. Manage an existing playlist (add / remove / list)

Use these for incremental edits instead of re-running `compose` (which replaces the whole list):
- **`list --game <GAME>`** — print all tracks with their 0-based indices (use the index for precise `remove`).
- **`add --game <GAME> --track '<src>'`** — append one track (JSON object) or several (array). `<src>` may be inline JSON, `@file`, or `-` for stdin. Validates each track first and rejects duplicate names. New songs get a fresh `createdAt` so they sort to the bottom of the playlist.
- **`remove --game <GAME> --name "<NAME>" [--index N]`** — delete by name and/or index (both repeatable); removes the song file(s). Errors if nothing matches. No renumbering needed — order is carried by each surviving song's `createdAt`.
- **`set-vibe --game <GAME> --name "<NAME>" --vibe "<phrase>"`** — set the short `vibe` description on track(s). Repeatable; each `--name`/`--index` pairs with the next `--vibe` in order. The vibe is a 10–25 word human phrase describing the intended feel/style; it's display-only metadata (shown dimmed under the title in the playlist) and does not affect playback or validation.

After any `add`/`remove`/`set-vibe`, re-run `player` to refresh the jukebox HTML. Prefer these over hand-editing the song files.

### 5. Iterate

If a track sounds wrong, edit its phrases in the tracks JSON and re-run compose + player. Common fixes:
- 'cuts off after a few notes' -> a phrase slot holds a non-note token (e.g. a bare function name); ensure every cell is a note name or null.
- 'too repetitive' -> add more distinct lead phrases / change phraseLens.
- 'drums feel flat' -> make each drum level add a clearly different instrument.

## Rules
- Notes are always names (`A4`, `C5`) or null — never raw Hz, never bare function identifiers (that bug crashes the scheduler: 'not a finite floating-point value').
- Every phrase/lead/pad/drum array is exactly 32 steps; validate before writing.
- Tracks with more than 4 phrases MUST include `drumLevels` (one value 0-3 per phrase).
- `phraseLens` entries are positive integers; its length must equal the number of phrases.
- Song files are generated by compose.py only — never hand-edit them. Use `add`/`remove` for incremental playlist edits.
- **Order is `createdAt`.** Never overwrite a song's `createdAt` via `edit` (the CLI refuses). To reorder, edit that one file's `createdAt` to an earlier/later timestamp; to append, use `add`.
- Keep the engine in assets/engine.js as the single source of truth; the player inlines it so output is self-contained and matches in-game playback.
- Melodies must progress (distinct phrases + arc), not loop one static 2-bar pattern.
- One songs dir per game; do not overwrite another game's composition.
- Always test the emitted jukebox.html in a browser (P to cycle) before declaring done.

## Output Format
```
Composed music for <GAME>:

- Songs dir:  <songs-dir>  (one JSON per song)
- Player:     <player-out>  (open it, press P to cycle tracks)

Tracks:
1. <NAME> — <style/vibe>, <bpm> BPM, <n> phrases
2. ...

Validation: PASS (all phrases 32 steps, notes finite, drum sets well-formed)
Tested in browser: yes/no
```

## Examples
**Input:** 'make music for abyss-qwen, dark synthwave horror + a boss track'

**Output:**
1. Interview confirms: 2 tracks (synthwave normal-play ~118 BPM, doom/boss ~75 BPM).
2. Author tracks JSON with note-name phrase banks, phraseLens [2,2,1,1], 4-level drums.
3. `compose.py compose --game abyss-qwen --tracks '<json>'` -> writes one file per song into .squid-os/music-composer/abyss-qwen/ (validation PASS).
4. `compose.py player --game abyss-qwen --out .squid-os/music-composer/abyss-qwen.jukebox.html`.
5. Open jukebox.html; P cycles both songs. Report summary.

## Resources

### Scripts
- [compose.py](scripts/compose.py) — Executable script (one file per song; order via createdAt)
- [split_songs.py](scripts/split_songs.py) — One-time migration: split a legacy `<GAME>.json` into one file per song, rewriting `createdAt` to preserve playlist order
- [compact_songs.py](scripts/compact_songs.py) — Cosmetic compactor: inlines leaf note/drum arrays (bass/leads/pads/drums) onto single lines; run after compose/add/edit, idempotent

### References
- [song-structure.md](references/song-structure.md) — Additional documentation
- [behavior-spec.md](references/behavior-spec.md) — Jukebox player transport/UI expected-behavior spec (modes, buttons, list, timeline, keys, logging)

### Assets
- [engine.js](assets/engine.js) — Template or resource file
