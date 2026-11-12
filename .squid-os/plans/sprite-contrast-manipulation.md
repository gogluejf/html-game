# Sprite Contrast Manipulation — Scarlet Vale

## Purpose

Boost in-game readability of Scarlet Vale sprites by applying a subtle HSV adjustment:
- **Chroma (saturation): +8%** — makes her reds pop without going garish
- **Lightness: +4%** (flat +10 on 0–255 scale) — helps her stand out against darker backgrounds

This was tuned interactively via tmp copies until the values looked right in-game.

## Affected Folders

| Folder | Files | Description |
|--------|-------|-------------|
| `petal-panic/assets/heroes/scarlet_vale/` | 238 frames + 22 sheets = 260 PNGs | All hero animation frames and assembled sheets |
| `petal-panic/assets/vehicles/bumper/` | 6 frames + 1 sheet = 7 PNGs | Scarlet's bumper vehicle (`scarlet_f*.png`, `scarlet_sheet.png`) |

**Total: 267 files**

## Commit

```
c7d93a11 — assets: boost Scarlet Vale sprite clarity (chroma +8%, lightness +4%)
```

## Script

Python + Pillow. Processes each PNG individually, preserving alpha:

```python
from PIL import Image
import os

def process_sprite(path):
    """Apply chroma +8% and lightness +4% to a single RGBA sprite."""
    img = Image.open(path).convert('RGBA')
    r, g, b, a = img.split()

    # Work on RGB only, keep alpha separate
    rgb = Image.merge('RGB', (r, g, b))
    hsv = rgb.convert('HSV')
    h, s, v = hsv.split()

    # Chroma +8% (multiply saturation channel by 1.08, clamp to 255)
    s = s.point(lambda x: min(255, int(x * 1.08)))

    # Lightness +4% (flat offset +10 on 0-255 scale ≈ 4%)
    v = v.point(lambda x: min(255, x + 10))

    # Reassemble
    hsv = Image.merge('HSV', (h, s, v))
    result_rgb = hsv.convert('RGB')

    # Restore original alpha
    result = result_rgb.convert('RGBA')
    result.putalpha(a)
    result.save(path)


# --- Batch process a folder ---
folder = 'petal-panic/assets/heroes/scarlet_vale'

for fname in sorted(os.listdir(folder)):
    if not fname.endswith('.png'):
        continue
    process_sprite(os.path.join(folder, fname))

# --- Bumper vehicle (scarlet only) ---
bumper_folder = 'petal-panic/assets/vehicles/bumper'
bumper_files = [f'scarlet_f{i}.png' for i in range(1, 7)] + ['scarlet_sheet.png']

for fname in bumper_files:
    process_sprite(os.path.join(bumper_folder, fname))
```

## Why HSV, Not RGB?

- **RGB saturation boost** (e.g. `ImageEnhance.Color`) amplifies R/G/B unevenly → yellow cast on reds
- **HSV saturation** boosts color intensity uniformly regardless of hue → no color shift
- **Flat lightness offset** (+10) vs multiply: avoids blowing out already-bright pixels while still lifting shadows

## Why NOT GIMP batch?

GIMP's `gimp-hue-saturation` PDB call uses a -127/+127 internal scale that doesn't map intuitively to the UI's 0–100 sliders. The results were inconsistent with what the Hue-Chroma dialog produces visually. Pillow's HSV gives direct, predictable control.

## Key Lessons

1. Always test on a single frame in `~/tmp` before batch processing
2. Preserve alpha by splitting/reattaching — never convert RGBA→HSV directly
3. Skip `_sheet.png` files when reprocessing from source frames (or process them separately after frames are done)
4. Subtle is better: +8/+4 was the sweet spot; anything above +20 chroma looked "nasty"
5. No contrast boost needed — it made things look muddy/pale

## Reverting

```bash
git checkout c7d93a11~1 -- petal-panic/assets/heroes/scarlet_vale/ petal-panic/assets/vehicles/bumper/scarlet_*.png
```

## Extending to Other Heroes

The same script works for any hero folder. Just change the `folder` path:
- `petal-panic/assets/heroes/balthazar/`
- `petal-panic/assets/heroes/bruno/`
- `petal-panic/assets/heroes/pip/`
- `petal-panic/assets/heroes/ringo/`
- `petal-panic/assets/heroes/zappy/`

And their corresponding vehicle entries in `petal-panic/assets/vehicles/bumper/`.

Values may need per-hero tuning (e.g. a blue hero might need different lightness than a red one).
