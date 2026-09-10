# Song Structure (music-composer)

The composition is a JSON array of **track** objects. The engine (`assets/engine.js`)
resolves note names to Hz and plays them. This is the exact format the in-game
`MusicSequencer` uses, so generated music sounds identical in the player and in-game.

## Note names

Notes are written as `letter+octave` (e.g. `"A4"`, `"C5"`, `"E1"`). A rest is `null`.
The engine's `_NOTE` table covers C1..B5:

```
C1 32.70  D1 36.71  E1 41.20  F1 43.65  G1 49.00  A1 55.00  B1 61.74
C2 65.41  D2 73.42  E2 82.41  F2 87.31  G2 98.00  A2 110.00 B2 123.47
C3 130.81 D3 146.83 E3 164.81 F3 174.61 G3 196.00 A3 220.00 B3 246.94
C4 261.63 D4 293.66 E4 329.63 F4 349.23 G4 392.00 A4 440.00 B4 493.88
C5 523.25 D5 587.33 E5 659.25 F5 698.46 G5 783.99 A5 880.00 B5 987.77
```

Never use raw Hz or bare identifiers — every cell must be a name string or null.

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

### leadLayers (optional)
`[null, null, bankA, bankB]` where bankA/bankB are 4x32 note-name banks. The layer
plays on phrase 2 (bankA) and phrase 3 (bankB), adding harmony/counter-melody at the climax.

## Progression guidance
Write distinct phrases with a real arc (hook -> build -> climax -> drop). Vary range
and rhythm between phrases; keep the bass steady. Avoid one repeated 2-bar loop.
