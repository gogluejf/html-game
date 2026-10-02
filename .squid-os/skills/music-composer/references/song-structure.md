# Song Structure — Universal Format (v3)

One format, one pipeline. Every song is **backbone + parts**; the engine grid
is an internal compiled detail only.

```
backbone.json + parts-<slug>.json ──▶ compiler.js ──▶ engine grid ──▶ jukebox
   (architect)         (composer)        (automatic)
```

No legacy path. No rendered HTML. One code path in the jukebox.

## Music hierarchy

| Unit | Size | In our format |
|---|---|---|
| beat | the pulse | notes hang off beats with durations |
| bar | N beats (from timeSig) | `bars` counts, chord spans |
| phrase | one melodic idea, 1–4 bars | a part's content per section |
| section | named role: hook/build/peak/bridge/tag… | one entry in `form` |
| song | ordered sections | the whole backbone |

Nothing caps section count or length. A 3-section 12-bar banger and a
12-section 60-bar epic are equally legal. Unlimited named drum patterns per song.

## Time signature

`timeSig` is a string in `"beats/noteValue"` format: `"4/4"`, `"3/4"`, `"6/8"`, `"7/8"`.

The engine resolves this to steps-per-bar at 16th-note resolution:
- `4/4` → 16 steps/bar (default)
- `3/4` → 12 steps/bar
- `6/8` → 24 steps/bar (grouped as 2×3)
- `7/8` → 28 steps/bar

Bar arrays in parts must match the resolved step count. The compiler handles
the math; the composer writes one bar array per bar regardless of sig.

## File layout

```
.squid-os/music-composer/<game>/
  backbones/<slug>.json     ← structure (architect owns)
  parts-<slug>.json         ← notes (composer owns)
```

Playlist order = each song's `createdAt` (in the parts file).

## Backbone (`backbones/<slug>.json`)

```jsonc
{
  "name": "BIG TOP SHRED",
  "bpm": 190,
  "timeSig": "4/4",
  "form": [
    { "section": "intro",  "bars": 2, "drums": "none"   },
    { "section": "hook",   "bars": 4, "drums": "light"  },
    { "section": "build",  "bars": 4, "drums": "medium" },
    { "section": "peak",   "bars": 4, "drums": "full"   },
    { "section": "bridge", "bars": 2, "drums": "medium" },
    { "section": "tag",    "bars": 2, "drums": "light"  }
  ]
}
```

Rules:
- `section`: any lowercase name. Conventional roles: intro, verse, pre-chorus,
  chorus, hook, build, peak, break, bridge, drop, tag, outro. Repeating a name
  groups those blocks as one compositional unit (same notes, different context).
- **Variations:** to repeat a section with *different* notes, use a suffix:
  `hook`, `hook-b`, `hook-c` or `verse`, `verse-2`. The `-b`/`-c`/`-2` naming
  is convention, not enforced — the compiler treats every name as unique.
  Same name = same content reused. Different name = different `--lead` entry.
- `bars`: positive int. Total bars × seconds-per-bar should land in 0:40–3:00
  for game music (softer target, not a hard limit).
- `drums`: a key from the song's `drumKit` (parts file). It selects which drum
  pattern plays during the section — NOT a volume knob.
- `timeSig`: string `"beats/note"`. Default `"4/4"`. Must be valid.

## Parts (`parts-<slug>.json`)

```jsonc
{
  "name": "BIG TOP SHRED",
  "genre": "Speed Metal",
  "vibe": "Blazing speed-metal circus at 190 BPM — galloping E-minor root chug, soaring square-wave lead",
  "createdAt": "2026-10-02T13:04:47",
  "revision": 1,

  // Drum patterns referenced by name from backbone form entries.
  // Beat positions within a bar. Named patterns: "quarters", "eighths", "sixteenths".
  "drumKit": {
    "none":   {},
    "light":  { "snare": "2 4" },
    "medium": { "snare": "2 4", "kick": "1 2 3 4" },
    "full":   { "snare": "2 4 3.5", "kick": "1 2 3 4", "hat": "eighths" }
  },

  // One entry per DISTINCT section name in the backbone.
  // Each value = array of bars; each bar = array of 16 cells (note name or null).
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
  "_bass_single": true,               // true = use first section's bass for all

  // Pads: step-offset → chord notes, per section
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
- Sharp spelling only (no flats).
- Bar width = 16 cells for 4/4 (one bar of 16th notes). For other time sigs,
  bar width changes accordingly (see Time signature above).
- A section with `bars: N` gets N bar arrays in its lead/bass/layer entries.

### Drum kit notation
- Kick/snare: beat numbers as space-separated string (`"1 2.5 3"`) or named
  pattern (`"quarters"`, `"eighths"`, `"sixteenths"`).
- Hat: same notation.
- Empty object `{}` = silence.
- Unlimited named patterns per song.

### Pad chords
- Step offset keys (`"0"`, `"8"`, `"16"`, etc.) relative to section start.
- Value = array of note names (chord voicing).
- Compiler maps to simultaneous oscillators.

## Compiler contract

`compiler.js` (browser) and `universal.py` (CLI reference) do the same thing:

1. Read backbone `form` → determine section order, bar counts, drum assignments.
2. Read parts → look up notes per section name.
3. Expand drum kit entries to step-level `{k,s,h}` arrays.
4. Produce engine grid: `leads[]`, `bass`, `pads[]`, `leadLayers[]`, `drums[]`,
   `drumLevels[]`, `phraseLens[]`.
5. Jukebox plays the grid. Done.

The compiler is the ONLY reader of universal files. There is no other playback path.

## Structural guidelines (architect's craft)

These are **craft guidelines**, not validation rules. The architect uses them
to design compelling structures based on genre and vibe:

### Intensity arc
- Most songs build: quiet → loud → release. But boss fights stay loud.
  Ambient loops stay flat. Circus music swings wildly.
- The drum assignment per section IS the intensity curve. Design it deliberately.
- Tag/outro should be quieter than peak (resolution feel), unless the genre
  calls for a hard stop.

### Section naming
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

**Metal / Speed metal:** Short sections (2–4 bars), fast escalation, hook is
immediate, peak adds double-time drums + higher register, bridge drops to half
time or clean tone, tag resolves on tonic.

**Synthwave / Retro:** Steady 4/4 pulse, sidechain-style pad pumping, verse→
chorus contrast via layer addition rather than tempo change, longer sections
(4–8 bars), smooth transitions.

**Punk / Hardcore:** Minimal intro (0–2 bars), immediate hook, short total
length (<1 min), energy stays high, tag is abrupt.

**Jazz / Funk / Soul:** Rubbery timing (use 6/8 or swing feel), sparse drums
(comping, not driving), solo sections get more bars, head-in/head-out form.

**Boss / Fight:** Phases instead of verses. Each phase adds a layer or raises
BPM feel. Never drops below phase-1 intensity. Rage section = everything maxed.

**Circus / Carnival:** Playful contrasts, unexpected key shifts, call-and-
response, dynamic swings (sudden quiet → sudden loud), tag is a big finish.

**Ambient / Loop:** No strong start or end. Two or three gentle variations that
crossfade. Dynamics stay narrow. Seamless loop point is critical.

### Melodic craft (composer's domain, but architect sets the stage)
- Hook should be singable/memorable: 4–8 notes, rhythmic identity.
- Build sections raise tension: ascending lines, increasing rhythm density,
  harmonic movement away from tonic.
- Peak releases tension: highest register, fullest drums, simplest melody
  (sparsity = power).
- Bridge descends toward tonic, ends on sustained root. Never quotes the hook.
- Tag resolves home: brief, final, lands on tonic.

## Workflow

1. **Architect** designs the backbone: sections, bars, drums, timeSig.
   Iterates until the arc feels right. (No notes yet.)
2. **Composer** fills parts: lead, bass, pad, layer, drumKit, voices.
   Writes into the frozen structure.
3. **Jukebox** compiles and plays. If melody fights the arc → fix notes.
   If structure is wrong → fix backbone. Separate concerns.

Both roles can be the same AI session. The separation is conceptual:
decide structure first, then fill it. Don't write notes before the skeleton
exists.
