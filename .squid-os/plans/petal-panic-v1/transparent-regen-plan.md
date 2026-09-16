# Petal-Panic — Transparent Sheet Regeneration Plan

## Goal
Regenerate every multi-frame sprite sheet as a **clean, fully transparent PNG** with no labels/numbers/grid lines and no overflow between cells. Each regenerated sheet is saved to `petal-panic/assets/transparent/<same-filename>.png`.

## Per-sheet procedure (repeat for each row below)
1. **New ChatGPT session** — open a fresh chat (`https://chatgpt.com/`), verify logged in. One sheet = one new session.
2. **Upload** the original sheet from `petal-panic/assets/<file>` via the visible image file input.
3. **Send the regen prompt** verbatim from `.squid-os/skills/sprite-gen/references/regen.md`:
   ```bash
   python3 .squid-os/skills/sprite-gen/scripts/sprite_gen.py send --prompt "$(cat /tmp/regen_prompt.txt)" --chat-url "https://chatgpt.com/"
   ```
4. **Wait** for generation: `sprite_gen.py wait --timeout 180 --expected-srcs 1`
5. **Download**: `sprite_gen.py download --output /tmp/<file>_regen.png`
6. **Assess acceptability** with `inspect_media` on the downloaded PNG. Accept if ALL true:
   - background transparent (corner alpha ≈ 0)
   - no text / labels / numbers / grid lines
   - same row×col count as original
   - sprites fit their cells (no overflow into neighbors, nothing clipped)
   - consistent scale + alignment
7. **If acceptable** → copy to `petal-panic/assets/transparent/<file>` and mark ✅ done.
8. **If GPT returns an "image violation" / safety refusal** → retry in a NEW chat. **Max 2 retries.** After 2 failures mark ❌ failed (note reason).
9. **Update this table** after every sheet (✅ / ⏳ in-progress / ❌ failed).

## Notes
- Source dir: `petal-panic/assets/`
- Output dir: `petal-panic/assets/transparent/`
- Regen prompt source: `.squid-os/skills/sprite-gen/references/regen.md`
- Do NOT overwrite originals — output goes only to `transparent/`.
- Single-image assets (logo, backgrounds, select screens) are OUT OF SCOPE for this plan.
- **Containment exception:** wide attack/lunge poses may overflow their cell (e.g. vine_hound row2c3; overgrown_elephant black attack). ACCEPT these and note "trim on crop" rather than burning retries — crop gives the frame extra room via manual --col-x later.
- **Rate-limit popup is NON-BLOCKING:** GPT shows "too many requests" but usually still generates underneath. Agents must check for a completed image and download it even if the popup is showing; only wait 5 min if no new image appears. If an agent dies on the popup, recover the newest /tmp/*_regen.png.
- **Transparency = ALPHA test, not eyeball:** A transparent PNG looks brown/dark over a dark preview — that's viewer compositing, NOT a painted bg. Judge by corner+gutter alpha (corners≈0 AND gutters mostly 0 = PASS). Never reject a good sheet because of how it renders. See `references/agent-prompt-transparent.md`.

## Progress

| # | File | Category | Status | Note |
|---|------|----------|--------|------|
| 1 | scarlet_vale_sheet.png | heroes | ✅ | done 2026-09-13 |
| 2 | scarlet_vale_sheet_2.png | heroes | ✅ | done 2026-09-13 |
| 3 | scarlet_vale_sheet_3.png | heroes | ✅ | done 2026-09-13 |
| 4 | scarlet_vale_sheet_4.png | heroes | ✅ | done 2026-09-13 |
| 5 | scarlet_vale_sheet_5.png | heroes | ✅ | done 2026-09-13 (2 recalls) |
| 6 | scarlet_vale_sheet_6.png | heroes | ✅ | done 2026-09-13 |
| 7 | balthazar_sheet.png | heroes | ✅ | done 2026-09-13 (edge fringe, accepted) |
| 8 | balthazar_sheet_2.png | heroes | ✅ | done 2026-09-13 (recovered from /tmp) |
| 9 | balthazar_sheet_3.png | heroes | ✅ | done 2026-09-13 |
| 10 | balthazar_sheet_4.png | heroes | ✅ | done 2026-09-13 |
| 11 | balthazar_sheet_5.png | heroes | ✅ | done 2026-09-13 |
| 12 | balthazar_sheet_6.png | heroes | ✅ | done 2026-09-13 |
| 13 | jester_sheet.png | enemies | ✅ | done 2026-09-13 |
| 14 | jester_sheet_2.png | enemies | ✅ | done 2026-09-13 |
| 15 | jackolantern_sheet.png | enemies | ✅ | done 2026-09-13 |
| 16 | vine_hound_sheet.png | enemies | ✅ | done 2026-09-13 (ACCEPTED: row2c3 attack lunge overflows — trim on crop) |
| 17 | boris_loon_sheet.png | enemies | ✅ | done 2026-09-13 |
| 18 | boris_loon_baby_sheet.png | enemies | ✅ | done 2026-09-13 (recovered from /tmp) |
| 19 | violetta_marionetta_sheet.png | enemies | ✅ | done 2026-09-13 (recovered from /tmp) |
| 20 | ratzo_ringleader_sheet.png | enemies | ✅ | done 2026-09-13 |
| 21 | toadstool_tilly_sheet.png | enemies | ✅ | done 2026-09-13 (recovered from /tmp) |
| 22 | gustav_grapplersnout_sheet.png | enemies | ✅ | done 2026-09-13 |
| 23 | doodle_dink_sheet.png | enemies | ✅ | done 2026-09-13 |
| 24 | doodle_dink_sheet_2.png | enemies | ✅ | done 2026-09-13 |
| 25 | tusko_wobble_sheet.png | boss | ✅ | done 2026-09-13 |
| 26 | ratchet_rumbelow_sheet.png | boss | ✅ | done 2026-09-13 |
| 27 | ratchet_rumbelow_sheet_2.png | boss | ✅ | done 2026-09-13 (1 recall) |
| 28 | ratchet_rumbelow_sheet_3.png | boss | ✅ | done 2026-09-13 |
| 29 | ratchet_rumbelow_sheet_4.png | boss | ✅ | done 2026-09-13 |
| 30 | ratchet_rumbelow_sheet_5.png | boss | ✅ | done 2026-09-13 (1 recall) |
| 31 | grim_vertigo_sheet.png | boss | ✅ | done 2026-09-13 (1 recall) |
| 32 | colonel_carrot_sheet.png | boss | ✅ | done 2026-09-13 |
| 33 | colonel_carrot_sheet_2.png | boss | ✅ | done 2026-09-13 |
| 34 | colonel_carrot_sheet_3.png | boss | ✅ | done 2026-09-13 |
| 35 | colonel_carrot_sheet_4.png | boss | ✅ | done 2026-09-13 |
| 36 | powerups_sheet.png | powerups | ✅ | done 2026-09-13 |
| 37 | powerups_sheet_2.png | powerups | ✅ | done 2026-09-13 |
| 38 | projectile_sheet.png | projectiles | ✅ | done 2026-09-13 |
| 39 | projectile_sheet_2.png | projectiles | ✅ | done 2026-09-13 |
| 40 | projectile_sheet_3.png | projectiles | ✅ | done 2026-09-13 |
| 41 | projectile_sheet_4.png | projectiles | ✅ | done 2026-09-13 |
| 42 | coins_sheet.png | objects | ✅ | done 2026-09-13 (1 recall) |

**Total:** 42 sheets · **Done:** 42 · **Remaining:** 0 — ✅ BATCH COMPLETE

## Excluded (not in scope — user removed)
- `barrel_sheet.png`, `barrel_bomb_sheet.png`, `barrel_coin_sheet.png`
- `checkpoint_sheet.png`, `checkpoint_boss_sheet.png`
