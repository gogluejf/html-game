# Foreground-Ownership Extraction — Design Notes

Source: SPRITE_EXTRACTION_README (~/Downloads). Core rule: **Frame = a cluster of related foreground content, not a grid cell.** Rectangles are an output format derived from ownership, never the discovery mechanism.

## Why grid slicing fails on AI sheets
- Frames have different widths/heights; limbs/attacks extend outside apparent cells
- Neighbors may overlap — no clean separator line exists
- One frame may occupy two normal cell positions (wide attack)
- Detached effects (petals, sparks, debris, projectiles) belong to a frame without touching the body
- Destruction frames may be many disconnected fragments with no central body

## Pipeline implemented in extract_frames.py
1. **Alpha mask** — background is already transparent; alpha > threshold (default 16) is the strongest deterministic signal. No color keying.
2. **Connected components** (scipy.ndimage.label) — building blocks, not frames. Character+punch = one component; character+petals = one big + many small.
3. **Row grouping** — y-density projection → bands. Rows come from geometry of the transparent sheet; the vision assessment supplies expected COUNTS per row.
4. **Per-row frame clustering** — x-density within each row band. If exactly expected-1 interior gaps exist → gap-split. More → take the deepest (widest) gaps. Fewer (overlap/fragmentation) → even division of inked width. Wide frames emerge naturally when a separator is missing.
5. **Ownership** — component centroid inside a span → that frame. Misses: small components (area <= satellite-max-area) join the nearest span center within satellite-radius; margin < 12px vs second-nearest → low-confidence flag. Large unassigned components → flagged, never silently dropped.
6. **Bounding rect + margin** — union owned bboxes, min rect, safety margin (default 4px), crop RGBA. Different frames may have different sizes.
7. **Validation** — count vs assessment, edge-touching (foreground on crop border = possible clip), tiny crops. Exit 0 = PASS, 2 = issues.

## Phase roadmap (per README)
- Phase 1 (done): baseline pipeline above
- Phase 2 (driven by real failures): better satellite assignment (direction, neighborhood expansion), dilation-based merging for fragmented frames, watershed/seeded segmentation when regions touch
- Phase 3: richer confidence scoring, orphan detection, JSON-driven state
- Phase 4: vision-assisted recovery for low-confidence cases only (flag → inspect_media → re-run with adjusted params)

## Tuning knobs
| param | default | effect |
|---|---|---|
| --alpha-threshold | 16 | lower keeps faint AA pixels; higher drops dust |
| --min-comp | 4 | drop specks below this area |
| --satellite-max-area | 400 | components <= this may be reassigned as satellites |
| --satellite-radius | 160 | max px from frame center for satellite capture |
| --margin | 4 | transparent padding around each crop |
