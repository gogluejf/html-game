# Song Structure — Universal Format (v3)

One format: **backbone + parts**. The engine grid is an internal compiled
detail only. Authoring happens exclusively through the CLI (`scripts/compose.py`);
the JSON files are compiler input, not authoring surfaces.

```
backbone.json + parts-<slug>.json ──▶ compiler.js ──▶ engine grid ──▶ jukebox
   (architect)         (composer)        (automatic)
```

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

`timeSig` is a string in `"beats/noteValue"` format: `"4/4"`, `"3/4"`, `"6/8"`,
`"7/8"`, `"5/4"`, `"4/7"` — any valid sig. No default assumption; pick what
the music needs.

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
signature.

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
  "form": [
    { "section": "intro",  "bars": 2, "drums": "none"   },
    { "section": "hook",   "bars": 4, "drums": "light"  },
    { "section": "build",  "bars": 4, "drums": "medium" },
    { "section": "peak",   "bars": 4, "drums": "full"   },
    { "section": "tag",    "bars": 2, "drums": "light"  }
  ]
}
```

Rules:
- `section`: any lowercase name. Conventional roles: intro, verse, pre-chorus,
  chorus, hook, build, peak, break, bridge, drop, tag, outro. Repeating a name
  groups those blocks as one compositional unit (same notes, different context).
- **Variations:** to repeat a section with *different* notes, use a suffix:
  `hook`, `hook-b`, `hook-c` or `verse`, `verse-2`. Same name = same content
  reused. Different name = different `--lead` entry.
- `bars`: positive int, **minimum 2** (compiler rejects 1-bar sections).
  Total bars × seconds-per-bar should land in 0:40–3:00 for game music.
- `drums`: a key from the song's `drumKit` (parts file). It selects which drum
  pattern plays during the section — NOT a volume knob.
- `timeSig`: string `"beats/note"`. Any valid sig.

## Parts (`parts-<slug>.json`)

```jsonc
{
  "name": "BIG TOP SHRED",
  "genre": "Speed Metal",
  "vibe": "Blazing speed-metal circus at 190 BPM — galloping E-minor root chug, soaring square-wave lead",
  "createdAt": "2026-10-02T13:04:47",
  "revision": 1,

  // Drum patterns referenced by name from backbone form entries.
  // Always 32-step [{k,s,h}] arrays. Beat notation or named patterns.
  "drumKit": {
    "none":   {},
    "light":  { "snare": "2 4" },
    "medium": { "snare": "2 4", "kick": "1 2 3 4" },
    "full":   { "snare": "2 4 3.5", "kick": "1 2 3 4", "hat": "eighths" }
  },

  // One entry per DISTINCT section name in the backbone.
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
- Sharp spelling only (no flats). Octaves 1–5.
- Bar cell count = `resolveTimeSig(timeSig)` (see table above).

### CLI note notation (how you write bars in `--lead`/`--layer`/`--bass`)
- `|` separates bars. Tokens within a bar land on an eighth-note grid:
  token N → position N × (step_width / 8).
- `_` = rest for one default slot.
- `~` = hold 2 beats (4 slots); `.` = dotted (3 slots).
- `xN` repeats the preceding pattern N times.
- Example for 4/4 (8 eighths/bar): `"E4 _ G4 _ | A4 B4 C5 D5"`
- Example for 4/7 (16 eighths/bar): `"E4 _ G4 _ A4 _ B4 _ | C5 D5 E5 F5 G5 F5 E5 D5"`

### Drum kit notation
- Kick/snare/hat: beat numbers as space-separated string (`"1 2.5 3"`) or
  named pattern (`"quarters"`, `"eighths"`, `"sixteenths"`).
- Beat N → 16th-step N×4. Fractional beats allowed.
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
3. Expand drum kit entries to step-level `{k,s,h}` arrays (always 32 steps).
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
length (< 1 min), energy stays high, tag is abrupt.

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

## Laws of good music (composition craft — non-negotiable)

These are the rules that separate a living song from a dull one. They hold for
any genre, tempo, or time signature. If a draft violates them, it sounds flat —
fix the notes before blaming the structure.

### Law 1 — Bass is the engine, never a root pedal
- A bass line must **move**: walking lines, octave jumps, passing/chromatic
  notes, offbeat hits that interlock with the snare.
- `root _ root3 _` repeated x8 across a section = death. Forbidden.
- The bass defines the groove's *feel* (syncopation, push/pull). When in doubt,
  put a note on an offbeat and hear if the song starts dancing.
- Bass register: stay in octaves 1–3; one deliberate jump per phrase max.

### Law 2 — Drums evolve strictly additively
- Each drum level **adds** an instrument or density; it never removes.
  light ⊂ medium ⊂ heavy ⊂ full. (e.g. light = snare+hat; medium adds kick
  pattern; heavy adds ghost notes / extra kicks; full adds sixteenth hats +
  pre-fill hits.)
- The last beat(s) of a build-type section should **point into** the next
  section: a fill approach, a rising hat, or a kick run landing on the downbeat.
- Section-to-section drum changes must be audible as a step up, not a shuffle.

### Law 3 — Lead hangs on the bass
- Melody anchors to bass note changes: call-and-response between bass and lead.
  When the bass jumps, the lead answers (a third/fifth above, or echoes the
  direction).
- Floating melodies with no relationship to the bass read as decoration, not
  construction. Check every bar: does the lead's strong beats sit over the
  bass's strong beats?

### Law 4 — Every 4 bars must add something (and within sections: every bar moves)
- Layer, register, rhythmic density, harmony, or key area — at least one
  dimension escalates per 4-bar block. Static repeats are forbidden.
- **Within a section, no two consecutive bars may be identical.** Even in a
  steady groove, each bar varies: the bass changes its passing note, the lead
  answers differently, a pad chord shifts, or a drum ghost appears. A section
  where bar 2 = bar 1 is a loop, not a progression.
- Repeats use `-b`/`-c` suffixes with real variation (new ending, added layer,
  higher top note), never identical content.

**Per-bar progression test (the composer's core habit):** when writing a
multi-bar section, number the bars and for each bar after the first, state in
one word what changed (`bar2: +layer`, `bar3: bass walks up`, `bar4: pad to V`).
If you can't name the change, the bar is a copy — rewrite it. This is what
separates "a riff that repeats" from "a song that progresses".

### Law 5 — One rhythmic template per song
- The first section defines the note/rest cell pattern (the song's voice).
  Later sections reuse that template; intensity comes from drums + register +
  pad motion — NEVER from packing more notes.
- Driving 16th-note runs in the peak break the song's voice and read as "too much".

### Law 6 — Peak = hook shape, higher, sparser
- The peak wears the hook's melodic shape one octave up (or on its top half).
  It does not become a different rhythmic animal. Sparsity = power.

### Law 7 — Tag = arrival, never preview
- Stepwise descent from near the peak's top note toward the tonic, in the
  song's own rhythmic template. Must NOT quote the hook's opening figure.
- End on a sustained tonic (held root + rests) with drums dropped one level,
  so the loop restart feels like lift-off.

### Law 8 — Chords drive the arc
- Pad progression moves away from tonic in builds (ii, V, borrowed chords)
  and resolves home at peak/tag. Static one-chord pads kill forward motion.

### Law 9 — Intensity ladder: quantified escalation every X bars

This is the master rule that makes a song feel like it's climbing instead of
looping. Define an **intensity score** per bar from 5 measurable dimensions,
each scored 0–3:

| Dimension | 0 (low) | 1 | 2 | 3 (high) |
|---|---|---|---|---|
| **Note count** (lead+layer notes/bar) | ≤ 4 | 5–8 | 9–12 | > 12 |
| **Rhythmic rate** (fastest active subdivision) | quarters | eighths | mixed 8th/16th | sixteenths |
| **Register** (lead top note this bar) | oct 4 low half | oct 4 high half | oct 5 low half | oct 5 high half |
| **Drum density** (hits/bar across kit) | ≤ 6 | 7–12 | 13–20 | > 20 |
| **Layers** (simultaneous voices: bass/lead/pad/layer/drums) | 2–3 | 4 | 5 | 5 + crash/open-hat events |

**The rule:** for songs that build (most game music), the bar-by-bar intensity
score must be **non-decreasing through the main body**, and must **increase by
≥ 1 point every 2 bars** on average. A section where the score stays flat for
4+ bars is a stall — fix it before moving on.

**How to raise the score (pick ONE dimension per step, not all at once):**
- +note count: subdivide one quarter into two eighths in the lead
- +rhythmic rate: switch the last 2 beats of the bar to sixteenth bursts
- +register: raise the top note by a step or jump to the upper octave
- +drum density: add ghost notes, offbeat kicks, or open hats (new drum level)
- +layers: bring in the layer voice / pad chord change / crash

**The peak exception (Law 6 still applies):** at the peak the score may DROP on
note count (sparsity = power) while STAYING MAXIMAL on drum density + register.
A peak that is dense AND sparse at once doesn't exist — choose: full drums +
simple high melody.

**Worked example (8-bar build, target +1/2 bars):**
```
bar 1: notes=4  rate=q    reg=o4L drums=6  layers=3  → score 2
bar 2: notes=6  rate=8th  reg=o4L drums=8  layers=3  → score 4   (+2: notes+rate)
bar 3: notes=6  rate=8th  reg=o4H drums=10 layers=4  → score 6   (+2: reg+drums)
bar 4: notes=8  rate=mix  reg=o4H drums=12 layers=4  → score 8   (+2)
bar 5: notes=10 rate=mix  reg=o5L drums=14 layers=5  → score 10  (+2)
bar 6: notes=10 rate=16th reg=o5L drums=16 layers=5  → score 12  (+2)
bar 7: notes=12 rate=16th reg=o5H drums=18 layers=5  → score 14  (+2)
bar 8: notes=12 rate=16th reg=o5H drums=24 layers=5  → score 16  (+2: drums)
PEAK:  notes=6  rate=8th  reg=o5H drums=32 layers=5  → drum max, melody releases
```

**Composer habit:** after writing each section, tally the score per bar in one
line (like above). If any run of 4 bars shows no increase, identify which
dimension to raise and rewrite those bars. This replaces guesswork with arithmetic.

### Anti-dull checklist (run before declaring done)
- [ ] **Intensity ladder (Law 9): score per bar tallied; +1 point every 2 bars on average through the body?**
- [ ] Bass has ≥ 4 distinct pitch events per 4 bars?
- [ ] Each drum level audibly adds something vs the previous?
- [ ] Lead's strong beats align with bass's strong beats?
- [ ] **No two consecutive bars in any section are identical** (per-bar progression test)?
- [ ] No two consecutive 4-bar blocks share all dimensions (notes+rhythm+density)?
- [ ] Peak uses the hook's shape, not new material?
- [ ] Tag descends to tonic without quoting the hook?

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
- Bass lives in octaves 1–3. One octave jump per phrase max.
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
bursts. Do this across a build section: bar 1 sparse, bar 2 denser, bar 3
densest. At the peak, RELEASE back to sparsity (Law 6) — the contrast is what
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
For any repeated section (`hook-b`, `verse-2`...), the variation must change
at least TWO of: (a) ending resolution, (b) added layer, (c) top note raised,
(d) rhythmic density of the last bar. One change = subtle; zero = copy (forbidden by Law 4).

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
