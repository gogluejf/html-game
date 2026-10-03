# Song Anatomy — The Unit Ladder

The entire system in one picture. No jargon, no legacy terms.

## The 4 units (small → big)

```
STEP      16th-note tick. The engine's atom. You never write these directly.
BEAT      The tap. "1 2 3 4". A quarter note in 4/4.
MEASURE   A box of beats (= "bar", same thing). The counting unit.
PART      A named zone with a job: hook / build / peak / outro.
SONG      All parts in order.
```

**One line to remember:** song = parts, part = measures, measure = beats, beat = steps.

## Visual

```
🎵 SONG: PETAL PANIC V2  (208 BPM · 4/4 · A major · ~16s)
│
├─ PART: hook  (drum: light)
│   measure 1:  A4 . E5 D5          bass: A2 E3 D3 A3
│   measure 2:  C#5 B4 A4           bass: C3 A3 E3 G3
│   measure 3:  F#4 A4 B4           bass: A2 E3 F3 G3
│   measure 4:  C#5 (pickup)        bass: C3 A3 B3 C4 ← climbs!
│
├─ PART: build (drum: medium)
│   measure 5:  D5 E5 F#5           bass: D2 A2 F#2 D3
│   measure 6:  G#5 F#5 E5          bass: A2 F#2 D3 C#3
│   measure 7:  A5 G#5 F#5  ← top-note glimpse!
│   measure 8:  E5 D5 C#5 ↓        bass: A2 F#2 D3 E3
│
├─ PART: peak  (drum: full)
│   measure 9:  A5 E5   ← owns the top note, sparse = power
│   measure 10: D5 C#5
│   measure 11: A4 E5 D5
│   measure 12: C#5 A4
│
└─ PART: outro (drum: light)
    measure 13: G#4 F#4  ↓
    measure 14: E4       ← lands on tonic. Song over.
```

## Counts for this song

| Unit | Total |
|---|---|
| parts | 4 (hook, build, peak, outro) |
| measures | 14 (4+4+4+2) |
| beats | 56 (14 × 4) |
| steps (16ths) | 224 (56 × 4) |

## How to read any measure

A 4/4 measure has **8 eighth-note slots** (the writing grid):

```
slot:  1   2   3   4   5   6   7   8
       ───────────────────────────────
       A4  _   E5  D5  _   _   _   _
       beat1     beat2     beat3     beat4
```

`_` = rest. Sparse notes = punk energy.

## Time signature = whatever the architect wants

Any `beats/note` string. The whole pipeline adapts:

| Sig | Beats/mes | Steps/mes | Feel |
|---|---|---|---|
| 4/4 | 4 | 16 | normal |
| 3/4 | 3 | 12 | waltz |
| 6/8 | 6 | 24 | compound |
| 7/8 | 7 | 28 | odd lurch |
| 5/4 | 5 | 20 | prog |

Duration formula (works for any sig):
```
seconds = measures × beats_per_measure × (60 / bpm)
```

## The 3 anti-boring rules (audit enforces these)

1. **No measure repeats its neighbor** — consecutive identical, period-2 cells,
   and echo repeats (measure N+2 = N) are all FAILs. Lead AND bass.
2. **Bass moves** — ≥ 4 distinct pitches per 4-measure part. Root pedal = FAIL.
3. **Peak = hook shape, higher + sparser** — peak top note must reach or exceed
   the build's glimpse. Not new material.

## Who decides what (the contract)

| Role | Decides | Never decides |
|---|---|---|
| **Architect** (backbone) | parts, measure counts, bpm, timeSig, which drum track per part | notes, melodies |
| **Composer** (parts file) | notes per measure per part, drum track contents, voices | structure, part order |
| **Engine** (sequencer) | plays measures in order, nothing else | music, opinions |

## Drum tracks (unlimited, architect-assigned)

Each part gets ONE named drum track from the parts file's `drumKit`.
No levels, no ladder — the architect freely assigns any track to any part.

A drum track = full kit at any density:
```
--drum full='kick:"1 2.5 3 3.75" snare:"2 4 3.5" hat:sixteenths'
```

Instruments: `kick`, `snare`, `hat`, `openHat`, `crash`.
Positions: beat numbers (`"1 2.5 3"`) or named patterns (`quarters`, `eighths`, `sixteenths`).

## Part naming convention

| Name | Job | Typical length |
|---|---|---|
| hook / chorus | the catchy theme | 4 measures |
| verse | story/tension | 4–8 measures |
| build | climb toward peak | 4 measures |
| peak / drop | biggest moment | 4 measures |
| bridge | contrast, reset | 2–4 measures |
| outro / tag | land home | 2 measures |

Same name repeated in the backbone = same notes replayed.
Want different notes? New name: `hook-b`, `verse-2`.

## Vocabulary

The only unit words in the system: **step, beat, bar (= measure), part, song.**
There is no "phrase" or "section." A melodic idea spanning 2–4 bars is a
*writing choice*, not a tracked unit — audit checks bars directly.
