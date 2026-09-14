# Petal Panic — Music Mood Guide

## The Game's Sound

Petal Panic is a run-and-gun. Think Konami and Capcom at their peak — Gradius, Contra,
Mega Man X, Strider, Ninja Gaiden. That relentless, adrenaline-soaked arcade energy where
the music makes your fingers move faster.

The sound is pure 8-bit chiptune: square-wave leads that cut through everything, punchy
basslines, drums that hit like a fist. But the engine isn't just rhythm — it's *melody*.
Every track needs a hook you can hum for the rest of the day. A phrase that sticks in
your skull after one playthrough and won't leave. Punk, Metal, Acid Jazz energy: fast, raw, unpolished,
aggressive. No filler, no breathing room. Every note earns its place.

And it has to *feel* something. Not just "fast background noise" — real emotion. The
joy of a power-up rush. The dread before a boss appears. The absurd triumph of marching
into a dictator's parade. Memorable moments: the one bar that makes you stop and go
"yeah, *that's* the game." Music you'll still be whistling a week later.

But Petal Panic has a soul: a loving circus turned nightmare by a stupid villain. So the
arcade DNA gets filtered through calliope organs, music boxes, waltz ghosts, and detuning.
Whimsical horror. Nostalgic warmth curdling into something wrong.

---

## Splash Screen

**Petal Panic Title**

A grand circus fanfare. You hear the big top opening, the crowd cheering, the calliope
blaring its most triumphant melody. Then — a note goes slightly wrong. A tritone creeps
in. The tempo feels like it's slipping. The cheer becomes an uneasy hum. Something is
wrong with the circus. Ends on an unresolved sting that makes you want to press start.

---

## Select Screen

**Choose Your Star**

Light, bouncy, playful. Carousel-waltz energy. You're standing in the warm glow of the
big top, picking who you'll be. Gentle, optimistic, a little silly. No danger here yet —
just the smell of sawdust and popcorn and the creak of the ferris wheel in the distance.
Inviting. Warm. Makes you feel like you're about to have fun.

---

## Level 1 — The Circus

**Sawdust Waltz**

The home stage. You know these floors, these striped tents, these hanging lamps. But
something's off. The music box waltz you grew up with is still there, but it's playing
slightly wrong now. The calliope hits a note it shouldn't. Underneath the nostalgia,
there's urgency — you're running, shooting, and the warmth is curdling. Playful turning
unsettling. The corruption is spreading and you can hear it in the melody.

---

## Boss (Tusko Wobble / Ratchet Rumbelow / Grim Vertigo)

**Boss Stomp**

Danger. Pressure. Your heart rate spikes. This isn't melodic — it's rhythmic menace.
Heavy pounding, low growling, staccato hits that land like punches. The arena shrinks.
The camera locks. You're in the kill zone. No room to breathe. The rhythm is the weapon.
Works for any boss: the elephant's lumbering stomp, the ratchet's grinding gears, the
vertigo's spinning dread. One track, universal threat.

---

## Level 2 — Carnival After Dark

**Neon Ferris Wheel**

Midnight. Neon lights buzzing. The carnival is still running but nobody's around anymore.
The ferris wheel creaks overhead, slow and hypnotic. Calliope music warps into minor
keys. The game booths are dark except for flickering neon signs. You're fast, dense,
surrounded by color that shouldn't be this pretty at this hour. Peak arcade energy —
this is where the game hits its stride. Funhouse at midnight, beautiful and wrong.

---

## Level 3 — The Pirate Ship

**Storm Tossed**

The fastest, hardest, most intense. Storm-tossed deck, crashing waves, lightning splitting
the sky. Thunder hits on the downbeat. Cannon fire between phrases. The ship rocks — the
rhythm sways, syncopates, tilts. Ominous brass cutting through wind. You're sprinting
across a tilting deck while the ocean tries to swallow you. Maximum action. Maximum
pressure. The music should make you feel like you're about to die and that's *fun*.

---

## Level 4 — Carrot's Republic

**OBEY THE CARROT**

Absurd totalitarian grandeur. Marching bands playing propaganda jingles. Giant carrot
banners snapping in the wind. Forced-cheering crowds. Everything is garish red and gold.
The melody is triumphant but *too* perfect — it resolves every time, which makes it feel
wrong. Military precision. No swing. No mercy. A dictator's parade that's almost funny
if it weren't so oppressive. You're marching toward his palace and the band won't stop.

---

## Final Boss — Dictator Carrot

**Brilliantly Stupid**

Slow. Grand. Ridiculous. A pompous villain entrance played completely straight-faced.
Wide, sweeping, self-important. He believes his own propaganda and the music sounds like
a man giving a speech to an empty room. Then it starts to collapse — the confidence
cracks, the key shifts, the grandeur falls apart. Half-time at the end. Not scary.
*Stupid.* The final boss isn't a monster — he's an idiot with a botanical weapon, and
the music should sound exactly like that.

---

## Orchestration: Composing 32 Tracks

You are the orchestrator. You do NOT compose music yourself. You delegate to sub-agents.
No validation step. If an agent stops mid-way (cut off, error), relaunch it to finish.
That is your only intervention.

### Context

- **Working dir:** `/home/goglue/src/html-game`
- **Mood brief:** `panic-petal/docs/music.md` (the creative input for all agents)
- **Skill:** `music-composer` (passed to each agent — they know the format and state file path)
- **State file:** `.squid-os/music-composer/petal-panic.json`
- **Jukebox output:** `.squid-os/music-composer/petal-panic.jukebox.html`

### Model

| Model Path | Shortname | Role |
|-----------|-----------|------|
| `ninfer/qwen3.8-27b` | qwen | Composer ×4 per slot |

### Composition Agents

**32 agents total.** 8 slots × 4 isolated agents per slot. Each agent composes exactly ONE track. They never see another agent's output — no cross-contamination.

Per-slot model assignment:

| Variation | Model |
|-----------|-------|
| v1 | `ninfer/qwen3.8-27b` |
| v2 | `ninfer/qwen3.8-27b` |
| v3 | `ninfer/qwen3.8-27b` |
| v4 | `ninfer/qwen3.8-27b` |

Each agent receives:
- The mood paragraph for its slot from `docs/music.md`
- The `music-composer` skill
- Its variation number (v1–v6) for naming

Each agent does NOT receive:
- The existing state file or any previously composed track
- Other agents' output
- Specific BPM, key, or timbre instructions (creative choice belongs to the agent)

Agent prompt template:

```
Compose one track for Petal Panic.

Slot: <SLOT_NAME>
Variation: v<N>

Read the mood brief for this slot in /home/goglue/src/html-game/panic-petal/docs/music.md
(section "<SLOT_HEADING>"). That is your ONLY creative input.

DO NOT read .squid-os/music-composer/petal-panic.json. DO NOT read any jukebox HTML.
DO NOT read any other music files. Compose purely from the mood brief.

Load the music-composer skill. Compose one track that captures this mood with full
NES-era run-and-gun energy. Make it melodic, emotional, memorable. Not repetitive,
not boring, not safe. A hook you can hum. Punk energy. 8-bit chiptune.

Name the track: "<SLOT_NAME> v<N> (qwen)".
Example: "Petal Panic Title v1 (qwen)".

Write it to the state file using the skill's compose command. IMPORTANT: the game name
is EXACTLY "petal-panic" (lowercase, hyphenated: petal-panic, NOT panic-petal). The state
file is .squid-os/music-composer/petal-panic.json. It may already contain other tracks. You
MUST append your new track to the existing tracks, never overwrite them. Read the current
state file first to get existing tracks, then pass [existing... + your new track] to the
compose command with --game petal-panic. If the combined JSON is too large for a shell
argument, write the tracks array to a temp file and feed it via a small python import of
compose.py's validate/write path — same validation, just file-based.

After writing the track, render the jukebox so the user can listen.
```

Tools: `["bash", "read_file", "write_file"]`
Limits: `max_steps: 200`, `max_time: "7m"`, `max_tools: 200`

Launch sequentially. If an agent stops mid-way (cut off, partial write, error),
relaunch the SAME model to finish the job. Never do the composition work yourself.

### Final Step: Jukebox

After all 32 tracks are in the state file:

```bash
python3 .squid-os/skills/music-composer/scripts/compose.py player \
  --game petal-panic \
  --working-dir /home/goglue/src/html-game \
  --out .squid-os/music-composer/petal-panic.jukebox.html
```

Open it. P cycles all 32. Pick 8 favorites. Done.

### Rules

- You are ORCHESTRATOR ONLY. Do not compose notes.
- Launch agents SEQUENTIALLY.
- Agents work BLIND. Never pass them the state file content or other tracks.
- The mood brief in `docs/music.md` is the single source of creative truth.
- No validation. No revision passes. Compose and move on.
- If an agent fails/stops, relaunch it once. If it fails twice, skip and note it.
- Your only job after composition: emit the jukebox HTML.
