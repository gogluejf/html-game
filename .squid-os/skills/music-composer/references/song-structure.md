# Song Structure (music-composer)

The composition is a JSON array of **track** objects. The engine (`assets/engine.js`)
resolves note names to Hz and plays them. This is the exact format the in-game
`MusicSequencer` uses, so generated music sounds identical in the player and in-game.

## Note names

Notes are written as `letter+octave` (e.g. `"A4"`, `"C5"`, `"E1"`), optionally with an
accidental for sharps/flats: `"C#4"`, `"Db4"`, `"G#2"`. A rest is `null`.
The engine's `_NOTE` table covers C1..B5 including all black keys:

```
C1 32.70  D1 36.71  E1 41.20  F1 43.65  G1 49.00  A1 55.00  B1 61.74
C2 65.41  D2 73.42  E2 82.41  F2 87.31  G2 98.00  A2 110.00 B2 123.47
C3 130.81 D3 146.83 E3 164.81 F3 174.61 G3 196.00 A3 220.00 B3 246.94
C4 261.63 D4 293.66 E4 329.63 F4 349.23 G4 392.00 A4 440.00 B4 493.88
C5 523.25 D5 587.33 E5 659.25 F5 698.46 G5 783.99 A5 880.00 B5 987.77
```

Never use raw Hz or bare identifiers — every cell must be a name string or null.

Accidentals use **sharp spelling only** (`C#n`, `D#n`, `F#n`, `G#n`, `A#n` —
each = one semitone above the preceding natural, computed as
`natural * 2^(1/12)`). Flat spellings (`Db`, `Eb`, ...) are accepted by the
engine as aliases of their sharp equivalents but should NOT be written in new
compositions — keep the vocabulary to a single format. There is no `E#`/`B#`
— those keys don't exist.

## Track object

```jsonc
{
  "name": "SYNTHWAVE",
  "bpm": 118,
  "steps": 32,                 // fixed; one phrase = 32 sixteenth-notes (2 bars)
  "drums": [ set0, set1, set2, set3 ],   // indexed by phrase: none/light/medium/full
  "bass":  [ ...32... ],        // steady groove, note names or null
  "leads": [ phrase0, phrase1, phrase2, phrase3 ],  // melody phrase bank
  "pads":  [ padPhrase0, padPhrase1, padPhrase2, padPhrase3 ], // chord phrase bank
  "phraseLens": [2,2,1,1],      // bars each phrase plays before advancing
  "leadLayers": [null, null, layerBankA, layerBankB], // optional extra line on phrases 2,3
  // voice params:
  "bassType":"sawtooth","bassCut":800,"bassDur":0.22,
  "padType":"sawtooth","padCut":2200,"padDur":0.5,
  "leadType":"square","leadCut":3400,"leadDur":0.22,"vib":6,
  "layerType":"triangle","layerCut":3000,"layerDur":0.22,
  "kickTop":120,"kickBot":40
}
```

### Phrase arrays
- `leads[i]`, `pads[i]`, `bass`: exactly **32** entries.
- `pads[i]` is an object mapping step-index -> chord (array of note names), e.g.
  `{"0":["A2","C4","E4"],"8":["F2","A3","C4"]}`. Only listed steps sound; others rest.

### Drums
`drums` is an array of **4** sets (one per phrase level). Each set is 32 objects
`{"k":bool,"s":bool,"h":bool}` (kick/snare/hat). Stack instruments by level:
- index 0 (none): all false
- index 1 (light): snare backbeat only
- index 2 (medium): + kick
- index 3 (full): + busy 16th hats and ghost notes

### phraseLens
Bars each phrase plays before moving to the next. `[2,2,1,1]` means:
phrase0 x2 blocks, phrase1 x2, phrase2 x1, phrase3 x1, then repeat. Drum level
follows the current phrase (0->none, 1->light, 2->medium, 3->full).

### drumLevels (v2, optional — required for >4 phrases)
Explicit per-phrase drum intensity table: one value `0..3` per phrase
(0=none, 1=light, 2=medium, 3=full). Classic 4-phrase tracks may omit it
(level = phrase index). Dream-construction tracks (8 phrases) MUST provide it,
e.g. `[0,0,1,1,2,3,3,2]` — the tag phrase (7) drops back to medium so the loop
into phrase 0 feels like a resolution, not a restart.

### leadLayers (optional)
**v2 flat form (preferred):** one 32-step phrase (or `null`) per phrase index —
length must equal the number of phrases. Put layers on the climax/tag phrases:
`[null,null,null,null,layerA,layerB,layerC,layerD]`.

**Legacy nested form (still accepted):** `[bank0,bank1,bank2,bank3]` indexed by
drum level, each bank = N phrases (or null). The engine normalizes it by taking
each non-null bank's first phrase.

## Dream Construction (v2)

The classic 4-phrase cycle (`0,0,1,1,2,3` via `phraseLens [2,2,1,1]`) has two
weaknesses: repeated phrases sound redundant, and the fast 2→3 climax fires and
loops back too quickly. The **dream construction** fixes both with 8 phrases:

```
phrase:   0    0b   1    1b   2     3     4      5
role:     hook hook build build peak  peak  bridge tag->home
lens:     1    1    1    1    1     1     1      1      (phraseLens [1,1,1,1,1,1,1,1])
drums:    0    0    1    1    2     3     3      2      (drumLevels)
```

Rules:
- **b-phrases (0b, 1b)** = the SAME melody as their base with a *tiny* variation
  in the last 4–8 steps (a passing note, an ending that lands differently).
  Kills A-A redundancy without breaking familiarity (classic A-A' form).
- **Phrases 2 & 3** = the peak, now given room to breathe (two full blocks at
  full/medium drums instead of a quick 2→3 flash).
- **Phrase 4** = extra climax/hype phrase at full drums — the joyful top.
- **Phrase 5 (tag)** = bridge resolving HOME: melodically points back to the
  hook, drums drop to medium (level 2) so the loop into phrase 0 lands softly.
- Bass stays steady across all 8; pads carry the chord progression; leadLayers
  (flat form) typically join on phrases 4–5.

Example skeleton (E minor):
```jsonc
{
  "name": "DREAM", "bpm": 140, "steps": 32,
  "drums": [setNone, setLight, setMedium, setFull],   // still 4 sets
  "drumLevels": [0,0,1,1,2,3,3,2],
  "phraseLens": [1,1,1,1,1,1,1,1],
  "leads": [hook, hookVar, build, buildVar, peak, peak2, hype, tag],
  "pads":  [pad0, pad0b, pad1, pad1b, pad2, pad3, pad4, pad5],
  "leadLayers": [null,null,null,null,layerA,layerB,layerC,layerD]
}
```

## Progression guidance
Write distinct phrases with a real arc (hook -> build -> climax -> drop). Vary range
and rhythm between phrases; keep the bass steady. Avoid one repeated 2-bar loop.

### Universal composition rules (any style, tempo, or genre)

These hold for chiptune punk, waltzes, acid jazz, marches — anything:

1. **One rhythmic template per song.** Phrase 0 defines the note/rest cell pattern
   (e.g. `X X X .  X X . .`). Every other phrase reuses that template. Intensity
   comes from drums + register + pad motion — NEVER from packing more notes.
   Driving 16th/8th-note runs in the peak break the song's voice and read as "too much".
2. **Peak/hype = same cells, higher register, sparser if anything.** The peak wears
   the hook's shape one octave up; it does not become a different rhythmic animal.
3. **Bridge/tag = arrival, never preview.** A descent from near the peak's top note,
   stepwise toward the tonic, in the song's own template. It must NOT quote the
   hook's opening figure (that makes the loop feel like a duplicate). End on a
   sustained tonic (held root + mostly rests, 8+ steps) over a home-chord pad with
   drums dropped one level (e.g. 3→2) so the hook's restart feels like a lift-off.
   Handoff: the phrase before the bridge should end pointing INTO the bridge's first note.
4. **b-phrases vary ONLY the last 4–8 steps**, and the variation is derived from the
   phrase's own earlier cells (echo a cell, arpeggiate the held ending) — not invented
   from nowhere. First 24 steps stay byte-identical. If more differs, it's a new phrase.
