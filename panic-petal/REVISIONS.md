# Petal Panic — Remaining Sprite Fixes (Round 2)

## dictator_carrot (boss)

| Issue | Frames | Fix |
|-------|--------|-----|
| `punch` f4, f5 — still has pink leak on left where fist extends beyond grid cell | punch_f4, punch_f5 | Re-crop tighter to grid boundary; accept that fist is at edge OR widen source crop zone by 10-15px left only |

## doodle_dink (enemies)

| Issue | Frames | Fix |
|-------|--------|-----|
| ALL frames badly cropped — only portion of sprite visible, shifted off-center | All 20 frames (sheet 1 + 2) | Full re-crop from source. The prepped image was cut wrong. Need to verify cell boundaries match actual sprite positions, not uniform math |
| `death` row — headbutt frame is centered in middle of grid line, bleeding both sides | death frames | Verify row boundaries are correct for this strip layout |

## ratzo_ringleader (enemies)

| Issue | Frames | Fix |
|-------|--------|-----|
| `charge` f1 — tiny leak at bottom (still present after fix) | charge_f1 | Clear bottom 10px more aggressively |

## projectile_4 (projectiles)

| Issue | Frames | Fix |
|-------|--------|-----|
| Over-cropped — sprites too small now (aggressive trim removed too much) | All 24 frames | Re-crop from prepped image with less aggressive bottom/top trim (only remove number zone, keep full sprite) |

---

## Notes

- **doodle_dink** is the biggest problem — needs a full re-crop done carefully with visual verification of each cell boundary against the actual sprite position.
- **carrot punch f4/f5** — the fundamental issue is the fist extends past the cell boundary in the source art. Options: (a) accept slight clip, (b) widen crop into neighbor cell and mask out neighbor, (c) inpaint the missing fist pixels.
- **projectile_4** — over-trimmed. The numbers were in the bottom ~30px but I trimmed 20% which ate into the sprite. Re-do with precise number-zone removal only.
