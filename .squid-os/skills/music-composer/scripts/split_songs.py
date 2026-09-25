#!/usr/bin/env python3
"""Split music-composer state into one JSON file per song.

Before:  .squid-os/music-composer/<game>.json   {"game":..., "tracks":[ ... ]}
After:   .squid-os/music-composer/<game>/<slug>.json   (one track each)
         + <game>.meta.json                        {"game":...}

Ordering lives in createdAt. The original playlist order is NOT creation-time
order (it's curated), so we REWRITE each track's createdAt to a fake-but-
realistic value that strictly increases in current array order: start from the
track's real timestamp and nudge any out-of-order/duplicate values forward by
1 minute until the whole list is monotonic. Result: unique, close-together
dates that encode the exact playlist order. Future adds get now() -> sort to
the bottom. Edits must NOT touch createdAt (cmd_edit refuses to overwrite it),
so a revision bump can never reorder a song.

Slug = lowercased name, non-alnum runs collapsed to '-', trimmed. Pretty name
is kept inside each file as "name".

--dry prints the plan; --force overwrites existing target files. The original
<game>.json is left untouched (delete manually once verified).
"""
import argparse, json, os, re, sys, time
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent  # repo root
MC_DIR = ROOT / ".squid-os" / "music-composer"


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s or "untitled"


def assign_order_dates(tracks):
    """Return a list of strictly-increasing ISO datetimes preserving array order.
    Each starts from the track's real createdAt; out-of-order/dup values are
    nudged forward 1 minute so the sequence is monotonic and realistic."""
    prev = None
    out = []
    for t in tracks:
        base = (t.get("createdAt") or "2026-01-01T00:00:00").split(".")[0]
        dt = datetime.fromisoformat(base)
        if prev is not None and dt <= prev:
            dt = prev + timedelta(minutes=1)
        prev = dt
        out.append(dt.strftime("%Y-%m-%dT%H:%M:%S"))
    return out


def migrate(game, dry, force):
    src = MC_DIR / f"{game}.json"
    if not src.exists():
        print(f"SKIP {game}: no {src.name}")
        return 0
    d = json.load(open(src))
    tracks = d.get("tracks", [])

    # Rewrite createdAt to a strictly-increasing, order-preserving sequence.
    order_dates = assign_order_dates(tracks)

    proj_dst = MC_DIR / game
    written = skipped = 0
    seen_slugs = {}
    for i, t in enumerate(tracks):
        t["createdAt"] = order_dates[i]

        slug = slugify(t.get("name"))
        # guard against slug collisions (shouldn't happen, but be safe)
        if slug in seen_slugs:
            seen_slugs[slug] += 1
            slug = f"{slug}-{seen_slugs[slug]}"
        else:
            seen_slugs[slug] = 1

        out = proj_dst / f"{slug}.json"
        if out.exists() and not force:
            print(f"  SKIP (exists) {out.relative_to(ROOT)}")
            skipped += 1
            continue
        if dry:
            print(f"  WOULD WRITE {out.relative_to(ROOT)}  ({len(json.dumps(t))} bytes)")
        else:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(t, indent=2) + "\n")
        written += 1

    meta_out = MC_DIR / f"{game}.meta.json"
    if dry:
        print(f"  WOULD WRITE {meta_out.relative_to(ROOT)}  {{\"game\": {json.dumps(game)}}}")
    else:
        meta_out.write_text(json.dumps({"game": game}, indent=2) + "\n")

    print(f"{game}: {len(tracks)} songs -> wrote {written}, skipped {skipped}")
    return written


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("games", nargs="*")
    args = ap.parse_args()

    games = args.games or sorted(p.stem for p in MC_DIR.glob("*.json")
                                 if not p.stem.endswith(".meta"))
    for g in games:
        migrate(g, args.dry, args.force)
    if args.dry:
        print("\nDRY RUN — nothing written.")


if __name__ == "__main__":
    main()
