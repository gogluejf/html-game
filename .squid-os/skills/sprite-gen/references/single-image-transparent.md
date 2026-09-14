# Single-Image Transparency Regen Prompt

For full-bleed / single images that only need their solid background made transparent — NO grid, NO sprite layout, keep the EXACT original composition and dimensions. Use for home-screen backdrops, logos, select screens, etc.

## Usage
Same flow as sheet regen (new chat in the reused tab, upload the image, send this prompt, wait, download), but:
- The prompt below has NO grid/row/col language.
- Preserve the EXACT output pixel dimensions given.
- Validate transparency by ALPHA (corners + a few interior bg sample points = 0), not by how it looks.

## Prompt (fill [W]x[H] with the exact original dimensions)

**CLEAN SINGLE IMAGE — TRANSPARENT BACKGROUND ONLY**

Recreate the image shown above EXACTLY as provided — same composition, same artwork, same colors, same framing, same level of detail. Do NOT redesign, restyle, add or remove any element, and do NOT change the aspect ratio or layout. The ONLY change is the background.

OUTPUT SIZE: exactly [W] pixels wide x [H] pixels tall. Keep every element in its exact original position and scale.

BACKGROUND (the only change):
- Make the background FULLY TRANSPARENT (alpha channel). Remove any solid color fill (e.g. pink), gradient, or flat backdrop so it becomes pure transparency.
- Keep ALL foreground artwork fully intact and opaque — every character, object, curtain, prop, light, and detail must remain exactly as drawn, with clean crisp edges.
- Where the artwork reaches the image edge (full-bleed elements like curtains or a crowd along the bottom), keep those opaque — only remove the true empty/background areas.

QUALITY:
- High resolution, crisp clean edges, no halos, no stray colored fringe, no artifacts.
- No text, labels, watermarks, or borders added.

Deliver ONE single image at exactly [W]x[H] with the identical composition to the source and a fully transparent background.
