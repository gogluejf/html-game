# Craft Instructions (v2)

These replace the old "Laws of good music". A law is something an auditor
checks after the fact; an instruction is something the composer follows
**while writing**. Every instruction below is also mechanically enforced by
`compose.py audit` — if the CLI can't verify it, it isn't an instruction,
it's a wish.

The source material: our own failure post-mortems (sparse GOLDEN SCARAB,
transposed-everything sections, lopsided kick patterns) + the standard
constrained-composition framework (scale lock, grid lock, layer-by-function,
drunkard's walk, repetition-with-variation).

---

## M1 — Scale lock (no random pitches)

Every song declares its scale in the parts file (`"scale": "E-phrygian"`).
Allowed scales: `major`, `minor`, `phrygian`, `dorian`, `pentatonic-minor`,
`pentatonic-major`, each with a root letter (`E-minor`, `C-major`, …).

- **Lead and layer notes must be in-scale.** Off-scale = FAIL, with the
  offending bar printed.
- **Two chromatic exceptions are legal** (the seasoning, not the meal):
  - the *lowered 7th* (D natural in E-minor → Dorian/mixolydian color)
  - the *raised leading tone* (D# in E-minor → pull into E)
- Bass and pads must be in-scale with zero exceptions.

Why: ~95% of our 61 songs already live inside one minor scale with exactly
this seasoning. This just makes explicit what was working and blocks the
day I reach for a note because it "fits the vibe".

## M2 — Density floor (no ghost melodies)

Per bar, count filled lead cells / total cells:

| Voice | Floor | Escape hatch |
|---|---|---|
| lead | ≥ 50% | section name suffixed `-sparse` (breaks, tags, cries) |
| bass | ≥ 40% | same |
| layer | n/a (optional voice) | — |

Below floor = FAIL with the exact bar. `parts` prints the fill ratio per bar
at write time so sparsity is visible immediately, not after a browser test.

Why: a 3-note-per-bar "melody" at 180 BPM is silence with ambition. The old
tracks that sound good fill 50–100% of every cell.

## M3 — Progression (every part gets new melodic material)

- **New-pitch rule:** each body section (hook/build/peak/…) must contain at
  least **3 pitch classes its predecessor doesn't have**. Octave shifts don't
  count — compare pitch classes only.
- **No-clone rule:** no two body sections may share > 70% of their pitch-class
  multiset (octave-folded). Hook and peak may *rhyme* (same ending figure,
  same rhythm shape) but the bodies must differ.
- **AABA within a section:** a 4-bar section should state a phrase in bars
  1–2, answer/vary in bar 3, and **return bar 1's rhythm with a changed
  ending** in bar 4. Repetition creates legitimacy; identical endings create
  boredom.

Why: this is exactly today's bug — peak was hook transposed up a step per
bar. Legally valid under the old Law 4 (which only checked *within* a
section), musically dead.

## M4 — Ceiling climb (register arc)

Top-note trajectory across the song must satisfy:

```
intro ≤ hook < build ≤ peak        (strictly rising through the body)
tag: descends stepwise to tonic     (and states peak's top note once = farewell)
```

- `audit` prints the per-section top-note table.
- peak_top ≤ hook_top = FAIL.
- The peak's top note appearing *casually early* steals the ceiling: if a
  section before the peak reaches the peak's top note, WARN (glimpses are
  allowed in build only, max one bar).

Why: if everything already hit A5 in the hook, the peak has nowhere to go.

## M5 — Drunkard's walk (lead line motion)

Melodies move by small steps, not teleports. For consecutive *active* notes
in a lead line (ignore rests):

- **≥ 70%** of intervals must be a 2nd or 3rd (step or small skip) in the
  scale, or a repeated note.
- **≤ 30%** may be leaps (4th+). A leap must satisfy ONE of:
  - it goes **up** and lands in a register the section hasn't reached yet
    (leaps are how sections climb), or
  - it's the **first note of a new section** (entry leap), or
  - it's the **final descent** in a tag/break (resolution leap down).
- Random upward-and-downward leaping with no destination = FAIL
  ("lead line has N unanchored leaps").

Why: this is the pasted doc's "secret sauce" and it's correct. Human melody
is local motion with purposeful escapes. My first GOLDEN SCARAB draft had
wide phrygian jumps everywhere with no landing — it sounded like a pinball,
not a riff.

## B1 — Bass is the engine (per-section identity)

- Bass must change its **root at least once per 2 bars** (a pedal longer
  than 2 bars = FAIL, except tagged `-pedal` sections).
- Bass outline per section must differ from the previous section's outline
  (same M3 no-clone rule, applied to bass roots).
- Register: octaves 1–3. One octave jump per phrase max.
- The bass root on beat 1 of each bar should match the pad chord's root
  (or its 5th) — if it doesn't for a whole bar, WARN ("bass/chord clash").

Why: root pedals are the #1 dullness generator, and bass that ignores the
pad chords sounds like two songs fighting.

## H1 — Harmony drives the arc (pads)

- Pad progression must **move away from tonic in builds** (ii, bIII, IV, V —
  anything but the i chord) and **resolve home at peak/tag**.
- At least one chord change per 2 bars in any section longer than 2 bars.
- Static one-chord pads across a 4+ bar section = FAIL.

Why: if the harmony doesn't travel, the melody's climbing feels arbitrary.

## D1 — Backbeat is sacred (snare)

In every non-silent drum kit: **snare hits exactly beats 2 and 4**, plus
optional ghosts (extra snare hits are allowed only on offbeats 2.5/3.5 and
never replace the main backbeat). Missing or moved backbeat = FAIL.

## D2 — Kick from a closed vocabulary (no freestyle beat lists)

Kick patterns must be built from named blocks, not freehand beat math:

| Block | Definition | Use |
|---|---|---|
| `kick_quarters` | beats 1 2 3 4 | boss fight, synthwave four-on-floor |
| `kick_eighths` | every 8th note | speed metal body (double-time feel) |
| `kick_blast` | every 16th note | peak/rage ONLY |
| `kick_push` | 1 2.5 3 3.75 | punk offbeat push |
| `fill_up` | 3.25 3.5 3.75 | last bar of a build, points into next section |

A level's kick = one block (optionally + `fill_up` in the final bar of a
build-type section). Freehand beat lists are rejected unless they exactly
match one of these expansions.

Why: `kick:"1 2.5 3 4.5"` looked like a driving pattern and expanded to a
lopsided 3+2+3 waltz. The vocabulary removes the ability to freestyle badly.

## D3 — Additive ladder, verified by diff

Drum levels must be strict supersets: `full ⊇ medium ⊇ light`. `audit`
prints the literal diff between consecutive levels; a level that removes or
moves an existing hit = FAIL. Each step up must add one of: a new instrument,
a denser subdivision, or ghost/fill events.

## D4 — Noise floor + accent rules

- Max **24 kick hits per bar** (32/32 wall = FAIL "noise floor").
- If a level has kicks, **step 0 (downbeat) must be a kick** — the beat needs
  a home.
- **Snare attack zone:** no kick on steps 8–9 or 24–25 (the 16th right before
  and on the snare's main hits) so the backbeat cuts through.

## D5 — Fills point forward

The last bar of any build-type section ends with either `fill_up` (kick run
into the downbeat) or hats stepping up a subdivision (eighths→sixteenths).
A build that ends flat = WARN ("no transition into next section").

---

## Genre quick-reference (starting points, not cages)

| Genre | Scale | Kick block | Hats | Lead register |
|---|---|---|---|---|
| Speed metal | minor/phrygian | eighths → blast at peak | 16ths constant | o4 → o5 at peak |
| Punk/hardcore | minor | quarters + push | 8ths → 16ths | o4, rhythmic stabs |
| Synthwave | major/minor | four-on-floor | 8ths, open offbeat | o4–o5, smooth lines |
| Boss fight | minor/phrygian | quarters (+ghost 2.5 at rage) | dense, always moving | o4 → o5, phase layers |
| Menu/ambient | pentatonic | sparse or none | soft 8ths | o3–o4, slow walk |

## Voice presets (unchanged — these work)

See song-structure.md "Chiptune voice recipes". Punch lives in the params
(short decay 0.14–0.22, high cutoffs, harsh waves on melody), not the notes.
