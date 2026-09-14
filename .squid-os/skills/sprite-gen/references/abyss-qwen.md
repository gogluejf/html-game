# Abyss-Qwen Sprite Template

Project-specific prompt template for **abyss-qwen** (aquatic neo-arcade deep-sea game).
Style anchor: `aquatic neo-arcade deep-sea`. Palette: bioluminescent cyan, teal, magenta, poison-green, orange glowing accents.

Use this instead of the generic `prompt-templates.md` when generating abyss-qwen sprites. Background is ALWAYS a fully transparent PNG — never black/pink/gradient.

## Style Block (first sprite only)

```
STYLE: crisp 16-bit neo-arcade pixel art, aquatic bioluminescent deep-sea theme, neon colors (cyan, teal, magenta, poison-green, orange) glowing against darkness. Sharp hard edges, NO anti-aliasing, NO gradients on the sprites themselves, flat shading with one highlight + one shadow step, high contrast, symmetrical, front-facing, no perspective. Consistent style across every sprite. Glowing accent cores/eyes. 1px dark rim outline.
```

For subsequent sprites use the continuation phrase instead:
```
continuing the exact same aquatic neo-arcade deep-sea style as the [prior entity] sheets above
```

## Layout + Containment (always include)

```
LAYOUT: [R] rows x [C] columns on a FULLY TRANSPARENT background (alpha channel, no color fill, no gradient, no vignette). Each row is one unique [entity]; the [C] columns are its [C] animation frames shown left-to-right. All cells exactly the same size ([CELL]x[CELL] px), evenly spaced. No text, no labels, no numbers, no grid lines, no borders between cells. Image [W] wide x [H] tall.

CONTAINMENT: each sprite fits COMPLETELY inside its own cell. Any extending element (projectile, extended arm/fist, tentacle, weapon, smoke, particles, glow effects, motion trails) stays within that frame's OWN cell — if a pose would extend past the box, compress the reach so it fits. Nothing clipped at a cell edge; small even margin around each sprite. All sprites the same scale relative to their cells, vertically aligned (same anchor line per row).
```

## Pose-fits-cell reminder (per row)

When writing each row's frame descriptions, pick poses that physically fit one cell. For aquatic entities especially: keep tentacles/jets/bubbles INSIDE the frame; a spout or jet stream must not cross into the neighbor. Describe frames distinctly and loopable.

## Cell sizes

| Entity | Cell | Notes |
|---|---|---|
| Enemies | 256x256 | 4-8 per sheet |
| Power-ups | 256x256 | 3-6 per sheet |
| Player ship | 256x256 | single row, 4 frames |
| Bosses | 512x512 | 2-4 per sheet |
