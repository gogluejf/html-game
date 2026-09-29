# Petal Panic — Sprite Sheet Frame-Reference Prompt (reusable SYSTEM)

Reusable LAYOUT/STRUCTURE prompt. It defines HOW a sprite sheet is laid out — it
describes NO character and NO style. To build a real generation prompt, stack this
on top of `art_style.md` (style) + the character's `*_frame_reference.md` (identity).

Paste the block below verbatim as the leading "system" section of any sprite-sheet
request.

=====================================================================
SYSTEM PROMPT — SPRITE SHEET LAYOUT (always applied)
=====================================================================
You are generating a single game-sprite animation sheet for a 2D side-scrolling
platformer, on ONE fully transparent canvas.

HARD RULES — READ FIRST (these override everything else):
1. NO TEXT ANYWHERE. Do not write any words, letters, numbers, labels, captions,
   frame titles, frame numbers, annotations, watermarks, or signatures on the
   image — not above, below, between, or over the characters. The output must
   contain ONLY the character artwork and nothing else.
2. FULLY TRANSPARENT BACKGROUND. The entire canvas is alpha-transparent. No paper,
   no cream/beige backdrop, no stage, no ground plane, no drop shadow under the
   feet. Only the character (and its motion elements) exist on the canvas.
3. TRUE SIDE-VIEW (PROFILE) SPRITES. Every frame is drawn in strict 90-degree
   side profile, exactly like a classic 2D platformer / run-and-gun game (think
   side-scroller hero). The character always faces the SAME horizontal direction
   (default: facing RIGHT). Never draw a front-facing, back-facing, or 3/4-angle
   pose. This is a flat side-view silhouette, not a portrait.

FRAME DISPOSITION
- All frames sit in a SINGLE horizontal row, left to right, in sequence order
  (frame 1 at far left, last frame at far right).
- Frames are equal HEIGHT and share one common vertical baseline: in grounded
  frames the lowest contact point lands on the SAME ground line across the sheet.
  (In airborne frames the body rises above that line — that is expected.)
- By default each frame occupies an EQUAL-WIDTH cell.
- EXTENDED-ELEMENT EXCEPTION: if a frame's action reaches beyond the normal body
  box (a long kick, a weapon swing, a whip/ribbon extension, a lunge), that frame
  uses a DOUBLE-WIDTH cell so the extended element is never clipped. Others stay
  single-width.
- Even spacing: a small consistent gutter separates cells; frames never overlap.

CONSISTENCY ACROSS FRAMES
- Character scale, proportions, costume, face, palette, and outline weight are
  IDENTICAL in every frame. Do not redraw or restyle per frame.
- Recognition anchors (face, emblem items, key accessories, costume pattern) stay
  stable. Motion comes only from limbs, cape/cloak, skirt, hair/fur mass, tail,
  and any active weapon/extension.
- Keep bone lengths and joint pivots identical to the neutral pose.
- Fixed upper-left warm key light and shading structure in every frame.

ANIMATION QUALITY
- Frames must read as a smooth, playable sequence when played in order — clear
  anticipation, action, and follow-through, with believable weight and arc.
- Secondary motion (hair, cape, skirt) trails and settles naturally between beats.

OUTPUT
- One wide horizontal PNG sheet, transparent background, zero text, all frames in
  strict side profile facing the same direction.
=====================================================================

## How to assemble a full prompt
1. Paste this SYSTEM block first.
2. Append the STYLE section (condensed from `art_style.md`).
3. Append the SUBJECT section (the target character's `*_frame_reference.md`).
4. Append a SEQUENCE section: name the move, give the GENERAL motion description
   (arc / timing / feel), the frame count, and which frames need double-width
   cells. Prefer a concise overall motion description over a rigid per-frame pose
   list, so the model fills in natural in-betweens.
