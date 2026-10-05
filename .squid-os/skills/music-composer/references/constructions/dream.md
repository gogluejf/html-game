# Construction: DREAM

The classic 7-part loop construction as actually built by the good old songs
(PHARAOH'S WRATH, CELTIC PIRATES REMIX, etc.). Paired sections: each pair
states a melody, the second varies only the ending. Each PAIR introduces new
melodic material. Density escalates with drum level.

## Skeleton

```
part      bars  drum  role
─────────────────────────────────────────────────────────────
riff       2    0     Melody A — statement. Defines A's cell template.
riff-b     2    0     A repeated, vary ONLY last 4-8 steps
run        2    1     Melody B — NEW material. May be denser than riff
                   (e.g. riff = sparse stabs, run = full 16-note line)
run-b      2    1     B repeated, vary ONLY last 4-8 steps
peak       2    2     Melody C — NEW climax figure (arpeggio/peak shape),
                   NOT a transpose of riff. Layer optional here.
climax     2    3     Fullest melody + layer. Song's highest note. New or
                   returned material at max density/register.
tag        2    2     Stepwise descent to tonic, ends in rests. Drums drop
                   one level so the loop-back feels like a landing.
```

Drum ladder: `[0, 0, 1, 1, 2, 3, 2]`

## Rules

1. **Pairs vary only the ending.** riff-b vs riff, run-b vs run: first N-8
   steps byte-identical, last 4-8 steps change (new ending note, passing tone,
   different landing). This is the A-A' form — familiarity with a twist.
2. **Each pair brings new melodic material.** run must differ from riff by ≥3
   pitch classes; peak must differ from both. No pair may be a pure
   transposition of an earlier pair. (Octave shifts of the SAME contour count
   as transposition — new pitches or new contour required.)
3. **Template is per-pair, not per-song.** Each melody defines its own
   note/rest cell pattern. Density generally escalates with drum level
   (sparse stabs at lvl0 → full runs at lvl2-3).
4. **Climax owns the ceiling.** Highest note of the song appears in climax
   (a one-bar glimpse in peak is allowed, nowhere else). Layer joins at
   climax (optionally peak).
5. **Tag = arrival, never preview.** Stepwise descent from near the top down
   to tonic. Must NOT quote the riff's opening figure. Final bar: sustained
   root or silence over home-chord pad. Drums dropped one level (3→2).
6. **Bass:** steady groove or walking roots; pedal at climax is fine for
   punk/metal. Octaves 1-3. A proven punk trope: hits on the ODD eighths
   (steps 0,2,4,6 = "1 & 3" of each beat) so the bass locks with the kick's
   downbeats and leaves room for the snare.
7. **Pads carry the chord arc** — move away from tonic through run/peak,
   resolve home at tag.

### Melody craft (learned the hard way)

8. **Walking beats sparse.** Dense stepwise lines that climb (full scale
   walks, arpeggios that breathe with placed rests) hit MUCH harder than a
   few isolated notes in empty space. A 3-note-per-bar "melody" at 180 BPM
   is silence with ambition. Leaps only on purpose: to enter a part, to
   climb registers, or to resolve at the end. ≥70% of intervals should be
   2nds/3rds (see M5 drunkard's walk).
9. **Phrases need room to develop.** 4-bar sections let a melody state →
    answer → vary → return-with-new-ending (AABA within the part). 2-bar
    parts force stabs; if the brief says "long melody", use 4-bar pairs.
10. **Drums build by ADDITION, one thing per level.** Proven ladder:
    level 0 = silence (melody+bass only) → level 1 = SNARE BACKBEAT ONLY
    (beats 1+3) → level 2 = +kick (syncopated off-beats) + hats →
    level 3 = full kit (sixteenth hats, syncopated kick wall). Never stack
    everything at once; the listener should hear each layer arrive.
11. **Drum level changes mark TRANSITIONS, not bars.** The ladder itself
    (each new layer arriving) is the transition signal.
12. **Extensions continue the arc, never loop.** When duplicating a pair
    for length, the second half must bring NEW material: continue the climb
    one register higher, new contour, changed rhythm cells, or moved
    harmony — ideally two of those. Verbatim repetition of an 8-bar stretch
    = boredom.

## Voice guidance

- Energetic genres: square lead @3800-4200 cutoff, decay 0.10-0.16, vib 14-20
- Bass: sawtooth @700-1000, decay 0.10-0.14
- Pads: sawtooth @900-2200 (warmer = jazz/fusion, brighter = punk), decay 0.3-0.5
- Layer (peak/climax): sawtooth @2600, decay 0.14-0.2

## arch command

```bash
python3 compose.py arch --game GAME --name "SONG NAME" --bpm N --time-sig "4/4" \
  --part riff,2,none \
  --part riff-b,2,none \
  --part run,2,light \
  --part run-b,2,light \
  --part peak,2,medium \
  --part climax,2,full \
  --part tag,2,medium
```

Drum kit names must be defined in the parts' `drumKit`. Proven ladder (see
rule 11 — each level adds exactly one thing):

```
none    = silence (melody + bass only)
light   = snare backbeat ONLY: snare:"1 3"
medium  = +kick syncopated + hats: kick:"0 2.5 3.5" snare:"1 3" hat:eighths
full    = full kit: kick:"0 1 1.5 2.5 3 3.5" snare:"1 3" hat:sixteenths
```

(Old songs sometimes used sparser kits — e.g. PHARAOH'S WRATH light = snare
only. Match the genre: punk wants kick early, jazz/fusion can wait.)

## Variants

- **fast:** raise BPM 10-20%, keep 2-bar parts
- **slow:** double to 4-bar parts, lower BPM 10-15%
- **long-melody:** 4-bar pairs throughout (rule 10) — the melody gets real
  phrases; the go-to shape for "epic / rich / melodic" briefs
- **long:** duplicate a pair (e.g. run x4 bars) for ~0:40+ songs
- **two-melody emphasis:** make riff and run a true call-and-answer pair
  (A descends / B ascends, different chord beds under each) — the pairing
  structure already supports this; no separate construction needed

## Examples in library

- PHARAOH'S WRATH (E-harmonic-minor, 180 BPM, punk metal — the reference)
- CELTIC PIRATES REMIX (140 BPM, storm-tossed pirate action)
- GHOST SHIP REQUIEM (A-minor, 150 BPM, celtic punk)
- LONG SKY (D-minor, 176 BPM, speed punk — the long-melody variant: 4-bar
  walking phrases, add-by-one drum ladder)
