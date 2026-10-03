# Song Structure — Format Spec

One format: **backbone + parts**. The engine grid is an internal compiled
detail only. Authoring happens exclusively through the CLI (`scripts/compose.py`);
the JSON files are compiler input, not authoring surfaces.

```
backbone.json + parts-<slug>.json ──▶ compiler.js ──▶ engine grid ──▶ jukebox
   (architect)         (composer)        (automatic)
```

The unit vocabulary is defined in [song-anatomy.md](song-anatomy.md):
**step → beat → bar → part → song.** A *bar* (= measure) is the counting unit;
a *part* is a named zone with a job (hook / build / peak / outro).

## Time signature

`timeSig` is a string in `"beats/noteValue"` format: `"4/4"`, `"3/4"`, `"6/8"`,
`"7/8"`, `"5/4"`, `"4/7"` — any valid sig. No default assumption; pick what the
music needs.

The engine resolves this to steps-per-bar at 16th-note resolution:

| timeSig | steps/bar | eighths/bar (CLI notation) |
|---|---|---|
| 4/4 | 16 | 8 |
| 3/4 | 12 | 6 |
| 6/8 | 24 | 12 |
| 7/8 | 28 | 14 |
| 4/7 | 32 | 16 |
| 5/4 | 20 | 10 |

**Bar width = beats × (4 / denom)** for denom ∈ {2,4,8,16}; anything else
falls back to 4 steps/beat.

### Drum kits vs time signature

Drum kit patterns are always **32-step grids** (engine constant). Beat
notation (`"2 4"`) maps beat N → step N×4, which aligns with the actual bar
only when the bar is exactly 32 steps wide (4/4, 4/7, 8/8, …). For other
signatures, fractional/explicit beat values still work but may not land on
your musical beats — verify with `show-parts`. Named patterns
(`quarters`/`eighths`/`sixteenths`) tile the full 32-step grid regardless of
signature. **Beats are 1-indexed:** use an explicit `0` for the downbeat (step 0).

## File layout

```
.squid-os/music-composer/<game>/
  backbones/<slug>.json     ← structure (architect owns)
  parts-<slug>.json         ← notes (composer owns)
```

Playlist order = each song's `createdAt` (managed by the CLI).

## Backbone (`backbones/<slug>.json`)

```jsonc
{
  "name": "BIG TOP SHRED",
  "bpm": 190,
  "timeSig": "4/4",
  "parts": [
    { "part": "intro",  "measures": 2, "drum": "none"   },
    { "part": "hook",   "measures": 4, "drum": "light"  },
    { "part": "build",  "measures": 4, "drum": "medium" },
    { "part": "peak",   "measures": 4, "drum": "full"   },
    { "part": "tag",    "measures": 2, "drum": "light"  }
  ]
}
```

Rules:
- `part`: any lowercase name. Conventional roles: intro, verse, pre-chorus,
  chorus, hook, build, peak, break, bridge, drop, tag, outro. Repeating a name
  groups those blocks as one compositional unit (same notes, different context).
- **Variations:** to repeat a part with *different* notes, use a suffix:
  `hook`, `hook-b`, `hook-c` or `verse`, `verse-2`. Same name = same content
  reused. Different name = different `--lead` entry.
- `measures`: positive int, **minimum 2** (compiler rejects 1-bar parts).
  Total bars × seconds-per-bar should land in 0:40–3:00 for game music.
- `drum`: a key from the song's `drumKit` (parts file). It selects which drum
  pattern plays during the part — NOT a volume knob.
- `timeSig`: string `"beats/note"`. Any valid sig.

## Parts (`parts-<slug>.json`)

```jsonc
{
  "name": "BIG TOP SHRED",
  "genre": "Speed Metal",
  "vibe": "Blazing speed-metal circus at 190 BPM — galloping E-minor root chug, soaring square-wave lead",
  "scale": "E-phrygian",
  "createdAt": "2026-10-02T13:04:47",
  "revision": 1,

  // Drum patterns referenced by name from backbone part entries.
  // Always 32-step [{k,s,h}] arrays. Beat notation or named patterns.
  "drumKit": {
    "none":   {},
    "light":  { "snare": "2 4" },
    "medium": { "snare": "2 4", "kick": "0 1 2 3" },
    "full":   { "snare": "2 4 3.5", "kick": "0 1 2 3", "hat": "eighths" }
  },

  // One entry per DISTINCT part name in the backbone.
  // Each value = array of bars; each bar = array of cells (note name or null).
  // Bar cell count = resolveTimeSig(timeSig) — see table above.
  "lead": {
    "intro": [[null,null,"E4",null,...], [...]],
    "hook":  [[...], [...], [...], [...]],
    "peak":  [[...], [...]]
  },
  "layer": {                          // optional counter-line
    "peak":  [[...], [...]]
  },
  "bass": {
    "intro": [[...], [...]]
  },
  "_bass_single": true,               // true = use first part's bass for all

  // Pads: step-offset → chord notes, per part
  "pad": {
    "hook": { "0": ["C3","E4","G4"], "16": ["C3","E4","G4"] }
  },

  // Voice timbres
  "voices": {
    "bassType": "triangle", "bassCut": 400, "bassDur": 0.3,
    "padType": "sine", "padCut": 1800, "padDur": 0.9,
    "leadType": "square", "leadCut": 2600, "leadDur": 0.25, "vib": 4,
    "layerType": "triangle", "layerCut": 3000, "layerDur": 0.22,
    "kickTop": 110, "kickBot": 45
  }
}
```

### Note format
- Cells are note names (`"A4"`, `"C#5"`) or `null` for rest.
- Sharp spelling only (no flats). Octaves 1–5.
- Bar cell count = `resolveTimeSig(timeSig)` (see table above).

### CLI note notation (how you write bars in `--lead`/`--layer`/`--bass`)
- `|` separates bars. Tokens within a bar land on an eighth-note grid:
  token N → position N × (step_width / 8).
- `_` = rest for one default slot.
- `~` = hold 2 beats (4 slots); `.` = dotted (3 slots).
- **No `xN` repeat shorthand.** Write every bar explicitly and vary them —
  repetition is how songs get boring.
- Example for 4/4 (8 eighths/bar): `"E4 _ G4 _ | A4 B4 C5 D5"`
- Example for 4/7 (16 eighths/bar): `"E4 _ G4 _ A4 _ B4 _ | C5 D5 E5 F5 G5 F5 E5 D5"`

### Drum kit notation
- Kick/snare/hat: beat numbers as space-separated string (`"0 1 2.5 3"`) or
  named pattern (`"quarters"`, `"eighths"`, `"sixteenths"`).
- Beats are 1-indexed; use `0` for the downbeat (step 0). Fractional beats allowed.
- Empty object `{}` = silence.
- Unlimited named patterns per song.

### Pad chords
- Step offset keys (`"0"`, `"8"`, `"16"`, etc.) relative to part start.
- Value = array of note names (chord voicing).
- Compiler maps to simultaneous oscillators.

## Compiler contract

`compiler.js` (browser) and `compose.py` (CLI reference) do the same thing:

1. Read backbone `parts` → determine part order, bar counts, drum assignments.
2. Read parts → look up notes per part name.
3. Expand drum kit entries to step-level `{k,s,h}` arrays (always 32 steps).
4. Produce engine grid: `leads[]`, `bass`, `pads[]`, `leadLayers[]`, `drums[]`,
   `drumLevels[]`.
5. Jukebox plays the grid. Done.

The compiler is the ONLY reader of universal files. There is no other playback path.

## Structural guidelines (architect's craft)

These are **craft guidelines**, not validation rules. The architect uses them
to design compelling structures based on genre and vibe:

### Intensity arc
- Most songs build: quiet → loud → release. But boss fights stay loud.
  Ambient loops stay flat. Circus music swings wildly.
- The drum assignment per part IS the intensity curve. Design it deliberately.
- Tag/outro should be quieter than peak (resolution feel), unless the genre
  calls for a hard stop.

### Part naming
- Use names that communicate function: `intro`, `verse`, `chorus`, `hook`,
  `build`, `peak`, `break`, `bridge`, `drop`, `tag`, `outro`.
- For non-standard forms, invent clear names: `call`, `response`, `phase2`,
  `rage`, `seamless-loop-a`.
- Repeating a name means "same musical material, different context" (e.g. two
  `chorus` entries with different drums).

### Duration targets (game music)
- Menu/ambient: 0:30–1:00 (loops)
- Normal play: 0:40–1:30
- Boss fight: 1:00–2:00
- Epic/cutscene: 2:00–3:00+
- These are soft targets. A 35-second punk track is fine.

### Genre-specific patterns (starting points, not rules)

**Metal / Speed metal:** Short parts (2–4 bars), fast escalation, hook is
immediate, peak adds double-time drums + higher register, bridge drops to half
time or clean tone, tag resolves on tonic.

**Synthwave / Retro:** Steady 4/4 pulse, sidechain-style pad pumping, verse→
chorus contrast via layer addition rather than tempo change, longer parts
(4–8 bars), smooth transitions.

**Punk / Hardcore:** Minimal intro (0–2 bars), immediate hook, short total
length (< 1 min), energy stays high, tag is abrupt.

**Jazz / Funk / Soul:** Rubbery timing (use 6/8 or swing feel), sparse drums
(comping, not driving), solo parts get more bars, head-in/head-out form.

**Boss / Fight:** Phases instead of verses. Each phase adds a layer or raises
BPM feel. Never drops below phase-1 intensity. Rage part = everything maxed.

**Circus / Carnival:** Playful contrasts, unexpected key shifts, call-and-
response, dynamic swings (sudden quiet → sudden loud), tag is a big finish.

**Ambient / Loop:** No strong start or end. Two or three gentle variations that
crossfade. Dynamics stay narrow. Seamless loop point is critical.

### Melodic craft (composer's domain, but architect sets the stage)
- Hook should be singable/memorable: 4–8 notes, rhythmic identity.
- Build parts raise tension: ascending lines, increasing rhythm density,
  harmonic movement away from tonic.
- Peak releases tension: highest register, fullest drums, simplest melody
  (sparsity = power).
- Bridge descends toward tonic, ends on sustained root. Never quotes the hook.
- Tag resolves home: brief, final, lands on tonic.

## Craft rules

All composition rules live in [craft-instructions.md](craft-instructions.md)
(the M/B/H/D instructions, mechanically enforced by `audit`). This file does
not restate them. Before declaring done, run `compose.py audit`.

## Chiptune / 8-bit / synthwave voice recipes (the "Nintendo vibe")

The chiptune punch is NOT in the notes — it's in the voice params. These are
the settings that make the engine sound like an 8-bit console instead of a
soft synth pad. Use them as starting points per genre; tweak ±20% max.

### The three pillars of chiptune punch
1. **Short decay, fast attack** — `dur` values 0.14–0.22. Long notes (0.5+)
   turn everything into mush. Notes must *stop* so the next one can hit.
2. **High filter cutoffs** — lead 3400–4200 Hz, bass 900–1100 Hz. Low cutoffs
   (400–800) are for ambient/dark moods only.
3. **Harsh waveforms on melody, clean on bass** — square or sawtooth lead,
   sawtooth bass. Triangle/sine = soft, use only for pads or jazz.

### Voice presets (copy these into `--voice` args)

**Chiptune action (NES/SMS feel — the default game-music sound):**
```
bassType=sawtooth  bassCut=1000  bassDur=0.16
padType=sawtooth   padCut=1600   padDur=0.45
leadType=square    leadCut=4000  leadDur=0.18  vib=10
layerType=triangle layerCut=3200 layerDur=0.18
kickTop=150        kickBot=46
```

**Synthwave drive (retro-80s, four-on-floor):**
```
bassType=sawtooth  bassCut=800   bassDur=0.22
padType=sawtooth   padCut=2200   padDur=0.5
leadType=square    leadCut=3400  leadDur=0.22  vib=6
layerType=triangle layerCut=3000 layerDur=0.22
kickTop=120        kickBot=40
```

**Speed metal / hardcore:**
```
bassType=sawtooth  bassCut=950   bassDur=0.17
padType=sawtooth   padCut=1500   padDur=0.4
leadType=sawtooth  leadCut=3600  leadDur=0.2   vib=14
layerType=sawtooth layerCut=2800 layerDur=0.2
kickTop=130        kickBot=42
```

**Acid jazz / nu-jazz (the ONLY soft preset):**
```
bassType=triangle  bassCut=700   bassDur=0.24
padType=triangle   padCut=2600   padDur=0.7
leadType=triangle  leadCut=3800  leadDur=0.3   vib=10
layerType=triangle layerCut=3400 layerDur=0.3
kickTop=110        kickBot=44
```

### Register rules (8-bit authenticity)
- Lead lives in octaves 4–5 (C4–B5). Never below C4, never above B5 (engine limit).
- Bass lives in octaves 1–3. One octave jump per part max.
- Pads sit between: octaves 2–4, 2–3 note voicings (root+third+fifth), not full chords.
- Octave doubling (lead + same note an octave up in layer) is THE power move at peaks.

## Pressurized melodic variation (how to write progressions that kick)

A progression feels pressurized when the listener is always slightly behind the
music. Build it with these moves, in priority order:

### 1. Sequence-up (the workhorse)
Take a 2-bar motif and repeat it a step (or third) higher each time. Each
repeat keeps the rhythm identical but climbs — tension accumulates without new
material. Classic form: `motif @ E → motif @ F# → motif @ G# → BREAK`.
This is what makes builds feel inevitable.

### 2. Answer-and-climb
Bar A states a question (ends on a rising offbeat note). Bar B answers with a
similar shape but lands HIGHER and resolves. Every exchange raises the floor.
The bass mirrors the answer an octave down so the climb is felt in the chest.

### 3. Rhythmic compression
Same notes, tighter spacing over time: quarters → eighth pairs → sixteenth
bursts. Do this across a build part: bar 1 sparse, bar 2 denser, bar 3
densest. At the peak, RELEASE back to sparsity (M4) — the contrast is what
makes the peak hit.

### 4. Call-response with the drums
Lead plays a figure, rests while drums fill the gap, lead returns one step
higher. The drum fills (ghost notes, crash approaches) become part of the
melody's conversation. Never let lead and drums both "talk" at full volume
simultaneously — alternate emphasis per half-bar.

### 5. The top-note rule
Track your highest note across the song. It should appear: once in the build
(a glimpse), constantly in the peak (ownership), and then vanish until the tag
(one final statement before the descent). If the top note appears early and
casually, the peak has no ceiling left to reach.

### Variation pressure test
For any repeated part (`hook-b`, `verse-2`...), the variation must change
at least TWO of: (a) ending resolution, (b) added layer, (c) top note raised,
(d) rhythmic density of the last bar. One change = subtle; zero = copy
(forbidden by M3).

## Workflow

1. **Architect** designs the backbone: parts, bars, drums, timeSig.
   Iterates until the arc feels right. (No notes yet.)
2. **Composer** fills parts: lead, bass, pad, layer, drumKit, voices.
   Writes into the frozen structure.
3. **Jukebox** compiles and plays. If melody fights the arc → fix notes.
   If structure is wrong → fix backbone. Separate concerns.

Both roles can be the same AI session. The separation is conceptual:
decide structure first, then fill it. Don't write notes before the skeleton
exists.
