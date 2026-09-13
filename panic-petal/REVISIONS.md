# Petal Panic — Sprite Crop Revisions

## ratchet_rumbelow (boss)

| Issue | Frames | Fix |
|-------|--------|-----|
| Sheet 5 "charge" + "roar" should be ONE anim called `roar` f1-f6 | charge_f1-3, roar_f1-3 | Merge into `ratchet_rumbelow_roar_f1..f6`, rename files |
| Badly cropped L/R — missing big parts of body | All sheet 5 frames (roar) | Re-crop with wider cell bounds from source sheet |

## dictator_carrot (boss)

| Issue | Frames | Fix |
|-------|--------|-----|
| `defeat` — bottom wheel of scooter cut off | defeat_f1-f5 | Re-crop with lower row boundary |
| `launch` f3 — pink leak on frame | launch_f3 | Clear stray pink pixels |
| `punch` — fist on left is cropped (fist exceeds cell zone in source) | punch_f1-f5 (esp f4) | Widen crop box left to capture full fist |
| `ride` — bottom wheel of scooter cut off | ride_f1-f5 | Re-crop with lower row boundary |
| `ride` → rename to `sulk` | ride_f1-f5 | Rename files + state |
| `shout` f2 — leak on left edge | shout_f2 | Clear left-edge residue |

## doodle_dink (enemies)

| Issue | Frames | Fix |
|-------|--------|-----|
| Badly cropped each side — grid lines + numbers still visible | ALL frames (sheet 1 + 2) | Full re-crop with proper label exclusion + grid removal |
| Lots of pink leaks | ALL frames | Redo transparency pass |

## gustav_grapplersnout (enemies)

| Issue | Frames | Fix |
|-------|--------|-----|
| `death` f4 — stretched/distorted, grid + numbers visible | death_f4 | Re-crop that single frame |
| `ground_punch` f4 — stretched/distorted, grid + numbers visible | ground_punch_f4 | Re-crop that single frame |
| Tail cropped on slide 3→4 transition (leak between) | crawl_f3/f4 or dumbbell_throw_f3/f4 | Check and fix tail clipping |

## ratzo_ringleader (enemies)

| Issue | Frames | Fix |
|-------|--------|-----|
| `attack` — fish head cropped on f4 bleeds into f5 right edge | attack_f4, attack_f5 | Re-crop with proper cell boundaries |
| `charge` f1 — tiny leak at bottom | charge_f1 | Clear bottom-edge residue |

## toadstool_tilly (enemies)

| Issue | Frames | Fix |
|-------|--------|-----|
| Grid lines + numbers still visible | Multiple frames | Re-crop with grid removal |
| `idle` — leak at bottom (mostly all slides) | idle_f1-f5 | Clear bottom debris / re-crop |

## projectile_4 (projectiles)

| Issue | Frames | Fix |
|-------|--------|-----|
| `circus_ball` — text/numbers baked into frames | circus_ball_f1-f8 | Re-crop excluding label area |
| `fish_bone` — text/numbers baked into frames | fish_bone_f1-f8 | Re-crop excluding label area |
| `peas_tornado` — text baked into frames | peas_tornado_f1-f8 | Re-crop excluding label area |

---

## Priority Order

1. **doodle_dink** — full re-crop (worst damage, all frames affected)
2. **gustav_grapplersnout** — re-crop f4 frames + fix tail
3. **dictator_carrot** — multiple issues (wheel clips, fist clip, rename, leaks)
4. **ratchet_rumbelow sheet 5** — merge + re-crop roar
5. **toadstool_tilly** — grid/numbers + bottom leaks
6. **ratzo_ringleader** — minor (fish bleed, tiny leak)
7. **projectile_4** — remove text/numbers from all 24 frames
