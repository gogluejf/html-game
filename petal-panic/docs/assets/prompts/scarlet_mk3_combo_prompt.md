# Petal Panic — Sprite-Gen Prompt: SCARLET VALE "MK3" COMBO

Paste this whole block into the image model. It is built from three stacked parts:
(1) SYSTEM — fixed sprite-sheet layout rules, (2) STYLE — shared house style,
(3) SUBJECT + SEQUENCE — Scarlet Vale's identity and the 6-frame move.

=====================================================================
PART 1 — SYSTEM PROMPT (sprite-sheet layout, always applied)
=====================================================================
You are generating a single game-sprite animation sheet on ONE transparent canvas.

LAYOUT RULES (strict):
- Exactly ONE horizontal row of frames, left to right, in sequence order.
- 6 logical frames total for this move.
- Each frame occupies an equal-width cell EXCEPT that any frame whose action
  extends beyond the body silhouette (a long kick, a weapon swing, a ribbon whip,
  a lunge) uses a DOUBLE-WIDTH cell so the extended element is never clipped.
  All cells share the same height and the same vertical baseline; every character
  stands with feet on the SAME ground line across all frames.
- Frames are evenly spaced with a small consistent gutter between them. No overlap.
- The ENTIRE background is fully transparent (alpha). No backdrop, no stage,
  no ground plane, no baked drop shadow under the feet. Only the character (and
  her motion elements) exist on the canvas.
- Character scale, proportions, costume, face, and palette stay IDENTICAL in every
  frame. Only pose and secondary motion (hair mass, cape, skirt, gloves, the
  ribbon) change between frames. Recognition anchors never move or redraw.
- Fixed upper-left warm key light in every frame. Same outline weight everywhere.

OUTPUT: one wide horizontal PNG sheet, transparent background, 6 frames as above.

=====================================================================
PART 2 — SHARED ART STYLE (house rule)
=====================================================================
- 1930s vintage circus / "Grande Spectacle" carnival idiom; modern digital
  comic-book / stylized-anime crossover render. NOT pixel art. Anti-aliased edges,
  no dithering, no visible pixel grid. Painted high-res, crisp at game scale.
- Thin dark outer contour (~1–2 px after scale) tracing the silhouette only;
  lighter interior lines separate form. No heavy cartoon outline.
- Cel + soft shading: one clear shadow band per form plus one broad highlight on
  the main lit surface. Two values per surface max.
- Lighting: fixed WARM key from upper-left, tungsten/lantern quality. Warm
  highlights, cool-neutral shadows, subtle warm rim on the lit edge.
- Palette anchors: aged cream #EFE6D0, deep red #8E1E2C / bright red #D40A2C,
  gold/brass #C9A227, near-black #161014. Apply a faint sepia aging pass
  (desaturate ~10–15%, lift blacks toward warm grey). No pure white/black/neon.
- Transparent alpha background, no baked ground shadow.

=====================================================================
PART 3 — SUBJECT: SCARLET VALE
=====================================================================
Young woman, athletic hourglass figure: small head, cinched waist, long legs, slim
arms and hands. Confident playful expression: closed-lip smile, relaxed arched
brows, half-lidded eyes. Oval face, pointed chin, deep-red full lips, small nose
(one short line), long lashes; eyes hidden behind the mask eye-holes.

Hair: very voluminous curly near-black-plum bob (#1A0E14) flaring past both
shoulders, violet sheen #3A1E33 with magenta-red highlights. A single large
off-white feather plume (#EFE7DA, grey underside #9A8F86) rises from the top-back
of the head; a large five-petal red rose (#D40A2C) pinned on the left side of the
hair (viewer's right).

Costume (identical every frame):
- Black domino mask over the eyes, edges blending into the hairline.
- Strapless corset bodice: black base #140A0E, red heart-shaped center panel,
  gold lacing/studs #C9A227 along seams, sweetheart neckline.
- Matching black hip briefs with a small gold belt/buckle at front.
- Red cape attached at the shoulders, flowing behind and to viewer's left,
  scalloped lower edge.
- Short red petal-skirt over the hips, scalloped edge, shorter than the cape.
- Long black gloves to mid-upper-arm, clean straight cuff just below the elbow.
- Thigh-high semi-transparent black stockings (skin shows through ~40%) with a
  hard horizontal top line at mid-thigh; bare-skin gap above.
- Pointed-toe red stiletto pumps, ~2-inch heel, glossy.

Recognition anchors (never move/redraw): rose, feather plume, mask, corset heart,
gold studs, stocking top line, shoe shape.

SIGNATURE WEAPON — THE RIBBON: a long flowing red silk ribbon (#D40A2C, bright tip
#FF3B5C, dark fold #7E0518) worn at the wrist/corset and used as a whip-like
ranged extension. When active it reads as a smooth tapered silk streak with a few
glossy highlights, trailing and curling.

=====================================================================
PART 4 — SEQUENCE: "MK3" COMBO (6 frames, one row)
=====================================================================
The combo is: KNOW (telegraph) -> KICK -> RIBBON WHIP. Frame widths noted; use a
DOUBLE-WIDTH cell for any frame where the kick leg or the ribbon extends far
beyond the body box.

FRAME 1 — "KNOW" telegraph (single cell):
Scarlet crouches low, weight coiled, one hand raised near the chest gripping the
ribbon tail, ribbon hanging loose and still. Eyes locked forward, confident
smile. Hair and cape settle. This is the wind-up / anticipation beat.

FRAME 2 — "KNOW" peak coil (single cell):
Tighter crouch, torso twisted back, drawn fist/ribbon pulled to the hip like a
loaded spring, cape flaring slightly behind. Maximum tension before release.

FRAME 3 — KICK launch (DOUBLE-WIDTH cell):
She springs up and drives a high front/side kick; the kicking leg EXTENDS FAR
forward and out of the body box (use the double cell so the foot is not clipped).
Free arm swings for balance, ribbon whips upward off the wrist. Cape and skirt
snap with the motion. Impact-ready stance.

FRAME 4 — KICK follow-through (single cell):
Leg begins to retract, momentum carrying the body forward, ribbon now swinging
around in a wide arc. Slight forward lean, confident smirk. Transition beat.

FRAME 5 — RIBBON WHIP extend (DOUBLE-WIDTH cell):
She plants into a strong stance and UNCOILS the ribbon in a long horizontal whip
across the frame; the red silk streak EXTENDS FAR to one side (double cell so the
ribbon tip is not clipped). Body pivots with the throw, hair and cape stream.
Peak range / attack hitbox.

FRAME 6 — RIBBON recover (single cell):
Ribbon retracts toward the wrist in a tight curl, she settles back into a poised
idle-ish stance, one gloved hand holding the ribbon end, calm confident smile.
Clean ending pose that can loop back to idle.

Keep feet on the same baseline, identical costume/palette/face/lighting in all six
frames. Fully transparent background. One horizontal row, 6 frames, equal cells
with double-width cells on frames 3 and 5.
