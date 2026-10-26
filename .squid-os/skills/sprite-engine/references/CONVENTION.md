# Sprite Asset Convention — Single Source of Truth

The one reference for how sprite assets are laid out on disk and what a sheet
JSON contains. **Read this before any mutation.** The three skills that touch
assets (@skill:sprite-gen, @skill:sprite-crop, @skill:sprite-engine) share this
convention; each owns exactly one stage of the pipeline and one data domain.

## Folder layout

```
{project}/assets/{category}/{entity}/
    {anim}_sheet.png        # raw generated sheet (one action per sheet)
    {anim}_sheet.json       # TWIN — always next to its PNG, exact base-name parity
    {anim}_f1.png ... {anim}_fN.png   # cropped frames, FLAT in the entity dir
```

- One action per sheet. A long animation may span multiple grid rows (`rows=2`
  for a 2×N layout) but is still ONE action / ONE sheet.
- The twin JSON sits beside its PNG with identical base name (`run_sheet.png` ↔
  `run_sheet.json`). It never lives elsewhere.
- Cropped frames land flat in the same entity folder as `{anim}_f{N}.png` — no
  per-frame subfolders.
- `{category}` mirrors the assets tree (heroes, enemies, boss, projectiles, …)
  and doubles as the editor's group header.

## Sheet JSON schema

Top-level fields:

| field | type | meaning |
|-------|------|---------|
| `file` | string | sheet PNG path relative to repo root (twin JSON sits next to it) |
| `size` | string | actual image dimensions `WxH` |
| `rows` / `cols` | int | grid layout (usually `rows=1`) |
| `kind` | string | `animation` \| `tile_variant` \| `entity_variant` (required) |
| `description` | string | one-liner of what the sheet is visually |
| `entities[]` | array | one entry per action row (or spanned group) |
| `original_prompt` | string? | prompt sent to GPT, or reverse-engineered |
| `crop` | object? | written by record_crop.py (`frames_dir`, `pass`) |
| `updated` | string? | last-write timestamp |

Entity fields: `name`, `anim`, `frames_dir`, and after cropping
`frames[{file,row,col,bbox}]`. With `--span`, an entity also carries `row` as an
array of grid rows.

**`kind` values:** `animation` (a playable anim), `tile_variant` (style/size
variant tiles), `entity_variant` (per-entity variant). These are the only values
sprite-gen's `--add-sheet` accepts.

Full machine-checkable schema: [sheet-schema.json](sheet-schema.json) (forward
compatible — unknown props allowed so gameplay metadata can be added later).

## Two data domains, single writers

A sheet JSON holds two independent domains. Each has exactly ONE writer; writers
never touch the other domain's fields. Never hand-edit either.

**Crop data** — written ONLY by @skill:sprite-crop `record_crop.py`:
- per frame: `file`, `row`, `col`, `bbox`
- per entity: `name`, `anim`, `frames[]`
- sheet-level: the `crop` block (`frames_dir`, `pass`)

**Tuning data** — written ONLY by @skill:sprite-engine `record_tuning.py`
(the sprite editor's save backend):
- per anim (entity): `speed`, `playback`, `direction`, `collision`, `pivot`, `markers`
- per frame: `offset`, `scale`, `boxes`, `durUnits`

Sheet-level visual fields (`file`, `size`, `rows`, `cols`, `kind`,
`description`, `original_prompt`) belong to @skill:sprite-gen `state --add-sheet`
and are never touched by crop or tuning.

## Registry

`.squid-os/sprite-sheets/<project>.meta.json` — owned by @skill:sprite-gen
`state`. Fields: `chat_url`, `style_name`, `palette`, `assets_dir` (+ `project`,
`updated`). **No sheet JSONs live here anymore** — the legacy
`.squid-os/sprite-sheets/<proj>/<label>/` registry layout is dead.

## Project discovery

A project = a subdir of the repo root that contains an `assets/` folder. Its
meta file's `assets_dir` points at that folder (e.g. `petal-panic/assets`).
The editor derives its writable prefixes from every `*.meta.json`'s `assets_dir`.

## Pipeline stages

1. **gen** — @skill:sprite-gen downloads the sheet and writes the `--add-sheet`
   twin (`{anim}_sheet.json`) next to the PNG.
2. **crop** — @skill:sprite-crop runs `extract_frames.py` then `record_crop.py`
   (writes crop data + bboxes into the twin).
3. **tune** — @skill:sprite-engine editor + `record_tuning.py` (writes tuning data).
4. **audit** — @skill:sprite-engine `audit.py` reports clean (exit 0).
