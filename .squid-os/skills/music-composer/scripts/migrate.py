#!/usr/bin/env python3
"""migrate.py — convert legacy grid songs to universal backbone+parts format.

Usage: python3 migrate.py <game-dir>
  e.g. python3 migrate.py .squid-os/music-composer/petal-panic

For each legacy .json (not parts-*, not in backbones/):
  - Creates backbones/<slug>.json  (form structure)
  - Creates parts-<slug>.json      (notes, drums, voices)
  - Removes the original legacy file

Already-migrated songs (backbone exists) are skipped.
"""
import json
import os
import sys


def steps_to_bars(steps_32):
    """Split a 32-step array into 2 bars of 16."""
    return [list(steps_32[:16]), list(steps_32[16:])]


def migrate_song(path):
    with open(path) as f:
        d = json.load(f)

    slug = os.path.splitext(os.path.basename(path))[0]
    name = d.get("name", slug)
    bpm = d["bpm"]
    leads = d["leads"]
    bass = d["bass"]
    layers = d.get("leadLayers") or []
    pads = d.get("pads") or []
    drums = d["drums"]
    n_phrases = len(leads)
    drum_levels = d.get("drumLevels")
    if drum_levels is None:
        # Abyss-style: no explicit drumLevels, player falls back to phrase index
        drum_levels = list(range(n_phrases))

    # --- Backbone ---
    form = []
    for i in range(n_phrases):
        form.append({
            "section": f"s{i}",
            "bars": 2,
            "drums": f"lvl{drum_levels[i]}",
        })

    backbone = {
        "name": name,
        "bpm": bpm,
        "timeSig": "4/4",
        "form": form,
        "drumLevels": drum_levels,
    }

    # --- Parts ---
    # Drum kit: map index → 'lvlN' key
    drum_kit = {}
    for idx, drum_set in enumerate(drums):
        drum_kit[f"lvl{idx}"] = drum_set

    # Lead: per-section, split 32 steps into 2 bars
    lead = {}
    for i in range(n_phrases):
        lead[f"s{i}"] = steps_to_bars(leads[i])

    # Layer: only include non-null entries
    layer = {}
    if layers and isinstance(layers, list):
        for i, l in enumerate(layers):
            if l is not None:
                layer[f"s{i}"] = steps_to_bars(l)

    # Bass: shared (32 steps) vs per-phrase
    bass_single = False
    bass_parts = {}
    if isinstance(bass, list):
        if len(bass) == 32:
            # Single shared bass line
            bass_single = True
            bass_parts[f"s0"] = steps_to_bars(bass)
        elif len(bass) == n_phrases:
            # Per-phrase bass (each entry is 32 steps)
            for i in range(n_phrases):
                if isinstance(bass[i], list) and len(bass[i]) == 32:
                    bass_parts[f"s{i}"] = steps_to_bars(bass[i])
                else:
                    # Might be 8-step entries (half phrases?)
                    # Pad to 32 then split
                    b = list(bass[i]) + [None] * (32 - len(bass[i]))
                    bass_parts[f"s{i}"] = steps_to_bars(b[:32])
        else:
            # Fallback: treat as single
            bass_single = True
            b = list(bass) + [None] * (32 - len(bass))
            bass_parts[f"s0"] = steps_to_bars(b[:32])

    # Pads: per-section dict
    pad = {}
    if isinstance(pads, list):
        for i, p in enumerate(pads):
            if p:
                pad[f"s{i}"] = p

    # Voices: copy all voice/timbre params
    voice_keys = [
        "bassType", "bassCut", "bassDur",
        "padType", "padCut", "padDur",
        "leadType", "leadCut", "leadDur",
        "vib",
        "layerType", "layerCut", "layerDur",
        "kickTop", "kickBot",
    ]
    voices = {}
    for k in voice_keys:
        if k in d and d[k] is not None:
            voices[k] = d[k]

    parts = {
        "name": name,
        "genre": d.get("genre"),
        "vibe": d.get("vibe"),
        "createdAt": d.get("createdAt"),
        "revision": d.get("revision", 1),
        "drumKit": drum_kit,
        "lead": lead,
        "layer": layer,
        "bass": bass_parts,
        "pad": pad,
        "_bass_single": bass_single,
        "voices": voices,
    }

    return backbone, parts


def main():
    if len(sys.argv) < 2:
        print("usage: python3 migrate.py <game-dir>")
        sys.exit(1)

    game_dir = sys.argv[1]
    if not os.path.isdir(game_dir):
        print(f"error: {game_dir} not found")
        sys.exit(1)

    bb_dir = os.path.join(game_dir, "backbones")
    os.makedirs(bb_dir, exist_ok=True)

    migrated = 0
    skipped = 0
    errors = 0

    for fname in sorted(os.listdir(game_dir)):
        if not fname.endswith(".json"):
            continue
        if fname.startswith("parts-"):
            continue

        slug = fname[:-5]  # strip .json
        bb_path = os.path.join(bb_dir, slug + ".json")
        parts_path = os.path.join(game_dir, f"parts-{slug}.json")

        # Skip if already migrated
        if os.path.exists(bb_path) and os.path.exists(parts_path):
            skipped += 1
            continue

        src_path = os.path.join(game_dir, fname)
        try:
            backbone, parts = migrate_song(src_path)

            with open(bb_path, "w") as f:
                json.dump(backbone, f, indent=2)
            with open(parts_path, "w") as f:
                json.dump(parts, f, indent=2)

            # Remove legacy file
            os.remove(src_path)
            migrated += 1
            print(f"  ✓ {fname} → backbones/{slug}.json + parts-{slug}.json")

        except Exception as e:
            errors += 1
            print(f"  ✗ {fname}: {e}")

    print(f"\nDone: {migrated} migrated, {skipped} skipped, {errors} errors")


if __name__ == "__main__":
    main()
