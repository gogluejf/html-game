# sprite-engine

Sheet tooling for the `cat/entity/anim` asset convention: audit, reassemble
(split mixed sheets into per-anim sheets by gluing existing frames — never
re-cropping), and a browsable gallery server.

## Layout

```
scripts/
  audit.py        dry-run auditor (frame counts, bbox drift, target collisions)
  reassemble.py   additive per-anim sheet builder (kind-tagged twin JSONs)
  server/
    gallery.py    sheet gallery HTTP server (thumbnails + game/category/kind filters)
    server.sh     start/stop/status/go wrapper (detached, pidfile-tracked)
PLAN.md           split-sheet-per-anim plan + status (repo root: sprite-engine/)
```

## Gallery

```bash
bash .squid-os/skills/sprite-engine/scripts/server/server.sh go
# → prints http://localhost:8799
```

Open `http://localhost:8799` (or LAN IP). Filters: game / category / kind
dropdowns; click a card for full-size view with its path. Stop with `server.sh stop`.

The gallery scans the live assets tree on every request — it always mirrors
what's on disk (no session state, no cache).

## Conventions enforced

- Sheet JSON schema: `file, size, rows, cols, kind, description, entities[]`
  where each entity has `name, anim, frames_dir, frames[{file,row,col,bbox}]`
- `kind`: `animation` | `tile_variant` | `entity_variant` (required at
  registration via sprite-gen `--add-sheet kind=...`)
- One action per sheet: `{project}/assets/{cat}/{entity}/{anim}_sheet.{png,json}`
- Frames: `{anim}_f{N}.png` in the same dir

## Typical flows

- **Split a mixed sheet:** `python3 sprite-engine/audit.py` → review →
  `python3 sprite-engine/reassemble.py [--project X] [--dry-run]`
- **Register a fresh AI sheet:** sprite-gen `--add-sheet cat=.. entity=.. anim=.. src=.. rows=.. cols=.. kind=.. description=".."`
- **Browse/verify:** gallery above, or the sprite-crop editor for per-frame tuning
