# Petal Panic — Shared Art Style (house rule for ALL assets)

This is the single source of truth for visual consistency. It applies to every
hero, enemy, boss, object, and level layer. Per-character sheets reference this
file instead of restating it. Do NOT copy these rules into individual character
docs — keep them here so the whole roster stays coherent.

---

## 1. Era & theme
- **1930s vintage circus / "Grande Spectacle" carnival.** Old-time bigtop, not modern.
- Everything reads as *aged and used*: weathered canvas, scuffed wood, tarnished
  brass, faded paint, dust in the air. Nothing looks brand-new or glossy-modern.
- Strong circus iconography: stars, bunting, pennant flags, striped poles, banners,
  lanterns, barrels, cannons, targets, drums, ropes. French-circus lettering
  ("CIRQUE", "GRANDE SPECTACLE", "ETOILES", "CIRCUS").

## 2. Render technique
- Modern digital painting in a **comic-book / stylized-anime crossover** idiom.
  NOT pixel art. Painted at high resolution, downscaled for in-game use.
- Smooth anti-aliased edges; no dithering, no visible pixel grid.
- **Outline:** one thin dark contour (~1–2 px after scale) tracing the outer
  silhouette only. Lighter interior lines separate form (seams, joints, folds).
  No heavy cartoon outline.
- **Shading:** cel + soft hybrid — one clear shadow band per form plus one broad
  highlight on the main lit surface. Keep it to two values per surface so forms
  stay readable at small size.

## 3. Lighting
- **Fixed warm key light from upper-left**, always. Same direction for every frame
  and every asset so the roster feels like one scene.
- Light quality is **warm tungsten / lantern glow** (carnival night), not neutral
  daylight. Warm highlights, cool-neutral shadows.
- A subtle warm rim/accent edge on the lit side of characters ties them to the
  bigtop lighting.

## 4. Palette (shared base)
- Roster anchors: aged cream `#EFE6D0`, deep red `#8E1E2C` / bright red `#D40A2C`,
  gold/brass `#C9A227`, near-black `#161014`.
- **Aging pass on everything:** desaturate ~10–15%, lift blacks toward warm grey,
  add faint sepia. No pure white, no pure black, no neon.
- Each character gets a locked sub-palette (base / shadow / deep-shadow / accent /
  trim) built ON TOP of these anchors. Fur/hide/skin tones vary per species but
  keep the same 3-step shading structure and the same warm aging.

## 5. Backgrounds & level layers
- **Background (parallax, behind play area):** painted bigtop interior — striped
  red/cream canvas, bunting, hanging lanterns, silhouetted crowd, star banners,
  a curtained entrance. Softly lit, slightly hazy, lower contrast than sprites.
- **Foreground (in front of play area):** the stage lip — weathered wooden planks
  with red/cream star valance, plus set dressing (barrels, cannon, crates, drums,
  cannonballs, target, hay). Solid, higher contrast, catches the warm key light.
- Sprites sit BETWEEN these two layers. Characters must read clearly against both
  the hazy background and the busy foreground.

## 6. Canvas & compositing
- Fully transparent alpha on all sprites and the foreground cutout. No baked
  ground shadow — the engine adds contact shadows.
- Fixed canvas size and character bounding box per sprite sheet so all frames are
  grid-consistent and feet land on the same baseline.

## 7. Frame-reuse rules (all animated characters)
- **Recognition anchors** (face, emblem items, costume pattern, key accessories)
  stay pixel-stable across frames.
- Motion comes only from limbs, cape/cloak, skirt, hair/fur mass, and tail — never
  redraw the face or costume pattern per frame.
- Keep bone lengths and pivot points identical to the character's neutral rest pose.
- Every frame keeps the same upper-left warm lighting and the same aging pass.
