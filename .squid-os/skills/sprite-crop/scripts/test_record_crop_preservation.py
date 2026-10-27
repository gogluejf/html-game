#!/usr/bin/env python3
"""Regression tests for record_crop.py metadata preservation and repair."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "record_crop.py"


def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                          capture_output=True, text=True)


def make_env(tmp: Path):
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / "run_f1.png").touch()
    (tmp / "run_f2.png").touch()
    sheet = {
        "file": f"{tmp}/sheet.png",
        "size": "10x10",
        "rows": 1,
        "cols": 2,
        "kind": "animation",
        "description": "test",
        "entities": [
            {
                "name": "hero",
                "anim": "run",
                "frames_dir": str(tmp),
                "speed": 12,
                "playback": "loop",
                "collision": {"x": 1, "y": 2, "w": 3, "h": 4},
                "pivot": {"x": 5, "y": 6},
                "markers": [{"label": "muzzle", "x": 7, "y": 8}],
                "frames": [
                    {"file": "run_f1.png", "row": 0, "col": 0, "bbox": [0, 0, 5, 5],
                     "offset": {"x": 1, "y": 2}, "durUnits": 3},
                    {"file": "run_f2.png", "row": 0, "col": 1, "bbox": [5, 0, 5, 5]},
                ],
            },
            {
                "name": "hero",
                "anim": "idle",
                "frames_dir": str(tmp),
                "speed": 8,
                "frames": [],
            },
        ],
        "crop": {"frames_dir": str(tmp), "pass": "old"},
    }
    sheet_path = tmp / "run_sheet.json"
    sheet_path.write_text(json.dumps(sheet))
    result = {
        "sheet": str(tmp / "sheet.png"),
        "out_dir": str(tmp),
        "frames": [
            {"entity": "hero", "anim": "run", "frame": 1, "file": "run_f1.png",
             "row": 0, "col": 0, "center": [2, 2], "size": [5, 5]},
            {"entity": "hero", "anim": "run", "frame": 2, "file": "run_f2.png",
             "row": 0, "col": 1, "center": [7, 2], "size": [5, 5]},
        ],
    }
    result_path = tmp / "result.json"
    result_path.write_text(json.dumps(result))
    return sheet_path, result_path


def main():
    failures = []
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        sheet_path, result_path = make_env(tmp)
        before = json.loads(sheet_path.read_text())

        # Invalid frames_dir must leave the original file byte-identical.
        bad = run("--sheet", str(sheet_path), "--result", str(result_path),
                  "--frames-dir", str(tmp / "missing"))
        if bad.returncode == 0 or json.loads(sheet_path.read_text()) != before:
            failures.append("invalid input mutated sheet")

        # Repair path should restore missing entity-level values.
        broken = json.loads(sheet_path.read_text())
        for e in broken["entities"]:
            e.pop("frames_dir", None)
        sheet_path.write_text(json.dumps(broken))
        rep = run("--sheet", str(sheet_path), "--repair-frames-dir")
        repaired = json.loads(sheet_path.read_text())
        if rep.returncode != 0:
            failures.append(f"repair failed: {rep.stderr}")
        elif any(not e.get("frames_dir") for e in repaired["entities"]):
            failures.append("repair did not populate all entity frames_dir values")

        # Record crop twice; verify idempotence and metadata preservation.
        first = run("--sheet", str(sheet_path), "--result", str(result_path),
                    "--frames-dir", str(tmp))
        after1 = json.loads(sheet_path.read_text())
        second = run("--sheet", str(sheet_path), "--result", str(result_path),
                     "--frames-dir", str(tmp))
        after2 = json.loads(sheet_path.read_text())
        if first.returncode or second.returncode:
            failures.append(f"record crop failed: {first.stderr}{second.stderr}")
        else:
            run_ent = next(e for e in after1["entities"] if e["anim"] == "run")
            idle_ent = next(e for e in after1["entities"] if e["anim"] == "idle")
            if run_ent.get("speed") != 12 or run_ent.get("collision") != before["entities"][0]["collision"]:
                failures.append("entity tuning lost")
            if run_ent["frames"][0].get("offset") != {"x": 1, "y": 2} or run_ent["frames"][0].get("durUnits") != 3:
                failures.append("per-frame tuning lost")
            if idle_ent.get("speed") != 8:
                failures.append("unrelated entity tuning lost")
            if after1["entities"] != after2["entities"]:
                failures.append("record crop is not idempotent")
            if any(os.path.abspath(e.get("frames_dir", "")) != os.path.abspath(str(tmp)) for e in after1["entities"]):
                failures.append("entity frames_dir not canonicalized")

    if failures:
        print("FAIL:")
        for f in failures:
            print(" -", f)
        raise SystemExit(1)
    print("PASS: record_crop preserves metadata, repairs paths, and is idempotent")


if __name__ == "__main__":
    main()
