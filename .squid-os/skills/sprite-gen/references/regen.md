# Generic Sheet Regeneration Prompt

Reusable, size-agnostic prompt to send (in the SAME ChatGPT conversation) when a generated sheet has layout problems: baked-in labels/numbers, grid lines, sprites overflowing into neighboring cells, clipped parts, uneven box sizes, or inconsistent scale/alignment.

## Usage
1. Stay in the project's existing chat URL (style consistency).
2. Attach/reference the bad sheet already in context ("the sprite sheet shown above").
3. Send this prompt verbatim. No dimensions — GPT measures the source grid and reproduces it uniformly.
4. Wait, download (overwrite the old sheet), inspect_media, re-crop via @skill:sprite-crop.

## Prompt

**FIXED SPRITE SHEET — CLEAN REGENERATION**

Regenerate the sprite sheet shown above, keeping every character, style, pose, and animation frame EXACTLY as provided. Do not redesign, restyle, or alter any character — same art style, same proportions, same colors, same expressions. Only fix the layout and presentation problems below.

GRID LAYOUT (strict):
- Keep the SAME grid structure as the original image: the same number of rows and columns in the same arrangement. Each row is one action/animation; each column is one sequential frame of that row's action, left to right.
- Make EVERY cell exactly the same size as every other cell — a perfect uniform grid. If any box in the source image is a different size, or the boxes are unevenly spaced, resize and reposition them so ALL cells are identical squares/rectangles, evenly spaced and perfectly aligned.
- Render the sheet at HIGH RESOLUTION: large enough that every sprite is crisp and detailed (aim for at least ~300px per cell side, scaling up proportionally for the whole grid). No blurriness, no compression artifacts.

CONTENT RULES (strict):
- The image must contain ONLY the sprites. NO text, NO labels, NO numbers, NO captions, NO titles, NO watermarks, NO borders or lines between cells. Nothing but the characters on the background.
- Background: fully transparent (alpha channel). No pink, no color fill, no gradient — pure transparency behind every sprite.

CONTAINMENT RULE (critical — this is where sheets usually fail):
- Each sprite must fit COMPLETELY inside its own virtual cell box. Nothing may cross a cell boundary into a neighboring cell.
- DO NOT just draw an extending element and hope it fits — that is what causes overflow. Instead, CHANGE THE POSE so it physically fits the box:
  - A punch/throw: bend the arm at the elbow and pull the fist/projectile back toward the body so it stays inside the frame. Do NOT fully extend the limb past the box. If a projectile must leave the hand, keep its full flight path INSIDE this frame's own cell.
  - Capes, hair, tentacles, weapons, smoke, particles, motion trails: shorten or curl them so they end well before the cell edge.
- Conversely, nothing may be cut off: the ENTIRE sprite must be visible within its box. No part of the character (limb, head, feet, hat) may be clipped at the cell edge. Frame each sprite with a small even margin so the whole figure fits comfortably inside.
- Leave clear empty space between every sprite and its neighbors — no touching, no overlapping across any edge (left, right, top, bottom).

SCALE & ALIGNMENT RULE:
- All sprites across the entire sheet must be the SAME scale relative to their cells — no sprite bigger or smaller than another for the same character. Consistent size from frame to frame and row to row.
- Vertically consistent alignment: the character's anchor point (e.g. feet/ground line) sits at the same vertical position in every cell of a row. No drifting up or down between frames.
- Horizontally centered within each cell where the pose allows; keep the composition balanced.

QUALITY RULES:
- Crisp, clean lines. HD hand-drawn look matching the original art exactly.
- Frames within each row remain clearly distinct and smoothly sequential (loopable), exactly as in the source.
- Perfectly clean edges, no stray pixels outside the sprites.

Deliver ONE single image: the same row/column count as the source, all cells identical size, transparent background, zero text, every sprite fully visible, same scale, aligned, and fully contained inside its own cell.
