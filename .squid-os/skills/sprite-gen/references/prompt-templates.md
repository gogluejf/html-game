# Prompt Templates

## Full Style Block (first sprite in a session)

Use this when there are NO prior sprites in the conversation:



Replace  with e.g. "aquatic bioluminescent", "cyberpunk", "fantasy", etc.
Replace  with e.g. "cyan, teal, magenta, poison-green, orange".

## Continuation Phrase (subsequent sprites)



## Layout Template



Where W = C * CELL, H = R * CELL.

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

## Background Prompt Template


