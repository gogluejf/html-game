# Jukebox Player — Expected Behavior Spec

Reference for the transport/UI behavior of the standalone jukebox player that
`compose.py player` generates (see `<skill-folder>/assets/engine.js` for the
audio engine and `<skill-folder>/scripts/compose.py` for the SongController +
UI wiring). This is the source of truth for how every control should behave.
Keep this in sync when changing the player template or engine.

## Modes (SEQ / REP / SHF)

| Action | Result |
|---|---|
| **SEQ** toggle | Auto-advance to next song when current ends. Deselects SHF. |
| **REP** toggle | Repeat the same song when it ends. Deselects SHF. |
| **SHF** toggle | Random-order playback. Deselects SEQ and REP. |
| **SEQ + REP both on** | Play all songs in order, then loop back to start (whole playlist repeats). |
| **No mode (default)** | Play one song, stop when it ends. |
| Persistence | Mode state saved to `localStorage`; restored on page load. |

### Song-end behavior (driven by modes)

| Mode state | When a song finishes |
|---|---|
| Default | Stop. |
| REP only | Loop the **same** song (seamless, grid-aligned). |
| SEQ only | Advance to next; at last song → stop. |
| SEQ + REP | Advance; at last song → wrap to song 1 and keep going. |
| SHF | Jump to a random other song. |

Song-to-song transitions use the engine's `_loopRestart()` (counters reset,
scheduler and `nextNoteTime` untouched) so there is no off-grid jump or phase
drift at the loop point.

## Transport buttons

| Control | While playing | While paused/stopped |
|---|---|---|
| **Play/Pause** (button or Space) | Pause (freeze mid-song). | Resume from exact position. If never started → play song 1. |
| **Next** (P / → / ↓) | Jump to & play next song, dot at 0. | Select next song (dot at 0), stay stopped. |
| **Prev** (← / ↑) | `prevSmart`: if within first ~1s of song → previous song; else restart current at 0. | Same logic but stays paused (selects instead of plays). |
| **Mute** (M) | Toggle master mute. | Toggles regardless of state. |

> The prev button uses the media-player `prevSmart` model (position-based:
> near start → previous, otherwise restart). It is shared with the Left/Up
> arrow keys so both behave identically.

## List rows (song list)

| Click | Not playing | Already playing |
|---|---|---|
| **Single click** | Select/focus only: highlight moves, dot → 0, title shows "○ SELECTED", no audio. | Immediately switch to & play that song. |
| **Double click** (within 400ms) | Start playing that song. | Same as single (already playing). |

Selecting a track while paused loads it into the engine (`setTrack`) without
starting audio, so a later resume plays the correct song.

## Timeline (bar + gold dot)

| Action | While playing | While paused/stopped |
|---|---|---|
| **Click bar** | Seek audio to that position immediately. | Store as pending seek (`_manualPos`); dot moves visually. |
| **Drag dot** | Live-seek as you drag; commit on release. | Move dot visually; store pending seek. On play, starts from there. |
| Dot at rest | Tracks live engine position. | Frozen at paused position until you seek or select. |

## Keyboard shortcuts

| Key | Action |
|---|---|
| **Space** | Play/Pause (same as button; guarded so it never double-fires with a focused button). |
| **P / → / ↓** | Next. |
| **← / ↑** | Prev (`prevSmart`). |
| **S / R / H** | Toggle SEQ / REP / SHF. |
| **M** | Mute. |
| **L** | Export full log file (action log + engine tick log). |

## Logging (always-on)

- Every controller action logs full state: `PLAY / PAUSE / RESUME / NEXT / PREV / SEEK / SELECT / SONG_END`.
- The engine logs every tick: `TICK step/bar/t`, `START`, `STOP`, `LOOP_RESTART`.
- **L** downloads both combined into one `.log` file for diagnosing timing or
  state-desync bugs.

## Consistency guarantees

- UI `current` and engine track always match — the SongController is the single
  source of truth for which track is active.
- Selecting a track while paused loads it into the engine, so resume plays the
  right song (no stale-track bug).
- Song-to-song transitions are grid-aligned (no off-grid jump / phase drift).
- Button clicks and keyboard shortcuts trigger identical code paths (no
  double-toggle from button focus).
