# Prompt Templates

Generic, reusable prompt building blocks for sprite sheet generation. The background is ALWAYS requested as a fully transparent PNG — never pink, black, or any painted/gradient backdrop.

## Background Rule (always apply)

Every sheet prompt MUST include this line, verbatim:

```
Background: FULLY TRANSPARENT (alpha channel). No color fill, no gradient, no vignette, no painted backdrop. Pure transparency behind every sprite.
```

After download, verify corner alpha = 0 with PIL. If GPT returns a painted/gradient backdrop instead, re-prompt in the SAME chat: "Keep everything identical, but make the background 100% transparent PNG with true alpha — remove all painted backdrop."

## Full Style Block (first sprite in a session)

Use when there are NO prior sprites in the conversation. Describes ONLY the art look — never the background (that's handled by the Background Rule above).

```
STYLE: crisp high-detail hand-drawn sprite art, [THEME] color palette ([COLORS]). Sharp clean edges, consistent flat shading with one highlight + one shadow step, high contrast, symmetrical, front-facing, no perspective. Consistent style across every sprite. Glowing accent cores/eyes where fitting. 1px dark rim outline.
```

Replace `[THEME]` with e.g. "aquatic bioluminescent", "hand-painted circus", "cyberpunk". Replace `[COLORS]` with e.g. "cyan, teal, magenta, poison-green, orange".

## Continuation Phrase (subsequent sprites)

Do NOT repeat the full style block. Anchor to what's already in context:

```
continuing the exact same [style_name] as the [prior entity] sheets above
```

## Layout Template

```
LAYOUT: [R] rows x [C] columns on a FULLY TRANSPARENT background (alpha channel, no color fill, no gradient, no vignette). Each row is one unique [entity]; the [C] columns are its [C] animation frames shown left-to-right. All cells exactly the same size ([CELL]x[CELL] px), evenly spaced. No text, no labels, no numbers, no grid lines, no borders between cells. Image [W] wide x [H] tall.
```

Where W = C * CELL, H = R * CELL.

## Containment Rule (always apply)

```
CONTAINMENT: each sprite must fit COMPLETELY inside its own cell. Any extending element (projectile, extended arm/fist, weapon, cape, smoke, particles, effects, motion trails, hair) must stay within that sprite's OWN cell — if a pose would extend past the box, compress the reach so it fits. Nothing may be cut off at a cell edge; frame each sprite with a small even margin. All sprites the same scale relative to their cells, vertically aligned (same ground/anchor line per row).
```

## Frame Description Patterns

- Wing flap: "wings up -> mid -> down -> mid"
- Puff cycle: "small -> mid -> big with spikes out -> mid"
- Jaw: "closed -> opening -> wide open -> closing"
- Tentacle sway: "phase 1 -> phase 2 -> phase 3 -> phase 4"
- Inflate/squeeze: "fully inflated fat -> slightly squished -> most squished thin/wide -> slightly squished"
- Bob/hover: "up -> mid -> down -> mid"
- Glow pulse: "dim -> bright -> max glow -> bright"

## Cell Size Guidelines

| Entity type | Cell size | Notes |
|---|---|---|
| Enemies | 256x256 | Small-medium, 4-8 per sheet |
| Power-ups | 256x256 | Small, 3-6 per sheet |
| Player ship | 256x256 | Single row, 4 frames |
| Bosses | 512x512 | Large, detailed, 2-4 per sheet |
| Background | Single image | No grid, match canvas aspect ratio |
