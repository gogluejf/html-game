#!/usr/bin/env python3
"""music-composer CLI — backbone-first song creation.

Subcommands:
  arch     Create a backbone (song structure) from musical args.
  parts    Create a parts file (notes, drums, voices) from musical args.
  validate Compile all songs in a game dir; report errors.
  list     List songs with metadata.
  remove   Delete a song by name.
  set-vibe Set vibe description on a song.

The AI passes musical decisions as structured arguments. This script builds
the JSON files underneath. No manual JSON editing needed.
"""
import argparse, json, os, re, sys
from datetime import datetime

# ─── Note validation ────────────────────────────────────────────────────────

NOTE_NAMES = set()
for _l in "C D E F G A B":
    for _o in range(1, 7):
        NOTE_NAMES.add(f"{_l}{_o}")
        if _l not in ("E", "B"):
            NOTE_NAMES.add(f"{_l}#{_o}")
_FLAT_FROM = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}
for _f in _FLAT_FROM:
    for _o in range(1, 7):
        NOTE_NAMES.add(f"{_f}{_o}")

_NOTE_TOKEN = re.compile(r"^([A-G][#b]?[1-6])(?::([1-8]))?$")


def _err(msg):
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def is_note(v):
    if v is None:
        return True
    if not isinstance(v, str):
        return False
    m = _NOTE_TOKEN.match(v)
    return bool(m) and m.group(1) in NOTE_NAMES


# ─── Time signature ─────────────────────────────────────────────────────────

def resolve_time_sig(ts):
    """'4/4' → 16 steps/bar, '3/4' → 12, '6/8' → 24, '7/8' → 28."""
    if not ts:
        return 16
    m = re.match(r"^(\d+)\s*/\s*(\d+)$", ts)
    if not m:
        return 16
    beats, denom = int(m.group(1)), int(m.group(2))
    steps_per_beat = 4 // (denom // 4) if denom >= 4 else 4 * (4 // denom)
    # /4 → 4 steps, /8 → 2 steps, /2 → 8 steps
    if denom == 4:
        steps_per_beat = 4
    elif denom == 8:
        steps_per_beat = 2
    elif denom == 2:
        steps_per_beat = 8
    elif denom == 16:
        steps_per_beat = 1
    else:
        steps_per_beat = 4
    return beats * steps_per_beat


# ─── Beat notation parser ───────────────────────────────────────────────────
# Format: notes separated by spaces, bars separated by |
# Duration suffixes: . (dotted = 2x), ~ (hold = 2 beats)
# Rest: _
# Bass shorthand: "E2 E3 x16" = repeat pair 16 times

def parse_beat_notation(s, step_width=16):
    """Parse beat notation into a list of bar arrays (each bar = step_width cells).
    
    Notes are placed on eighth-note grid by default (2 steps per beat in 4/4).
    | separates bars. . doubles duration. ~ holds 2 beats. _ is rest.
    """
    s = s.strip()
    if not s:
        return []

    # Handle bass shorthand: "X Y xN"
    m = re.match(r"^(.+?)\s+x(\d+)$", s)
    if m:
        pattern_str = m.group(1)
        repeats = int(m.group(2))
        # Parse one cycle of the pattern
        cycle_cells = _parse_single_bar(pattern_str, step_width)
        # Tile to fill required bars
        total_cells = []
        for _ in range(repeats * 2):  # xN means N pairs = N*2 bars worth
            total_cells.extend(cycle_cells)
        # Split into bars
        bars = []
        for i in range(0, len(total_cells), step_width):
            bar = total_cells[i:i+step_width]
            while len(bar) < step_width:
                bar.append(None)
            bars.append(bar)
        return bars

    # Standard: split by | into bars
    bar_strs = [b.strip() for b in s.split("|")]
    bars = []
    for bs in bar_strs:
        bars.append(_parse_single_bar(bs, step_width))
    return bars


def _parse_single_bar(bar_str, step_width=16):
    """Parse one bar of beat notation into step_width cells."""
    cells = [None] * step_width
    if not bar_str or bar_str == "_":
        return cells

    tokens = bar_str.split()
    pos = 0  # current position in steps (eighth-note grid = every 2 steps in 4/4)
    # In 4/4: 16 steps = 8 eighth notes. Each token defaults to 2 steps (one eighth).
    # In other sigs: step_width varies but we still use proportional spacing.
    default_step = max(1, step_width // 8)  # 8th note equivalent

    for tok in tokens:
        if pos >= step_width:
            break
        if tok == "_":
            pos += default_step
            continue

        # Parse duration suffix
        dur_mult = 1
        note = tok
        if note.endswith("~"):
            dur_mult = 4  # hold 2 beats = 4 eighths
            note = note[:-1]
        elif note.endswith("."):
            dur_mult = 3  # dotted = 1.5x → 3 eighths
            note = note[:-1]

        # Bare ~ or . with no note = rest for that duration
        if not note or note == "":
            pos += default_step * dur_mult
            continue

        if not is_note(note):
            _err(f"bad note token {tok!r} in bar {bar_str!r}")

        step_len = default_step * dur_mult
        # Fill the duration with the note (first cell has it, rest are null)
        cells[pos] = note
        for d in range(1, step_len):
            if pos + d < step_width:
                cells[pos + d] = None
        pos += step_len

    return cells


# ─── Drum kit parser ────────────────────────────────────────────────────────

def parse_drum_spec(spec_str, step_width=16):
    """Parse drum spec like 'snare:"2 4" kick:"1 2 3 4" hat:eighths'
    into a 32-step [{k,s,h}] array (always 32 for engine compatibility).
    """
    STEPS = 32
    k_set, s_set, h_set = set(), set(), set()
    named = {"quarters": 4, "eighths": 2, "sixteenths": 1}

    if not spec_str or spec_str.strip() == "{}":
        return [{"k": False, "s": False, "h": False} for _ in range(STEPS)]

    # Parse key:value pairs
    pairs = re.findall(r'(\w+)\s*:\s*"([^"]*)"', spec_str)
    for inst, val in pairs:
        val = val.strip()
        if val in named:
            interval = named[val]
            for i in range(0, STEPS, interval):
                _add_drum(inst, i, k_set, s_set, h_set)
        else:
            for beat_str in val.split():
                try:
                    beat = float(beat_str)
                    step = round(beat * 4)  # beat → 16th note step
                    if 0 <= step < STEPS:
                        _add_drum(inst, step, k_set, s_set, h_set)
                except ValueError:
                    pass

    return [{"k": i in k_set, "s": i in s_set, "h": i in h_set} for i in range(STEPS)]


def _add_drum(inst, step, k_set, s_set, h_set):
    if inst == "kick":
        k_set.add(step)
    elif inst == "snare":
        s_set.add(step)
    elif inst == "hat":
        h_set.add(step)


# ─── Pad parser ─────────────────────────────────────────────────────────────

def parse_pad_spec(spec_str, total_bars, step_width=16):
    """Parse pad spec like 'Em x4 C x2 D x2' into {step_offset: [chord_notes]} dict.
    xN = hold N bars. Step offsets are relative to section start.
    """
    CHORD_INTERVALS = {
        "": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10],
        "m7": [0, 3, 7, 10], "maj7": [0, 4, 7, 11],
        "dim": [0, 3, 6], "aug": [0, 4, 8],
    }
    SEMITONES = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
                 "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    FROM_SEMI = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

    def chord_notes(name, root_oct=2):
        m = re.match(r"^([A-G])(#?)(m7|maj7|dim|aug|7|m)?$", name)
        if not m:
            return [f"C{root_oct}"]
        root, sharp, quality = m.group(1), m.group(2), m.group(3) or ""
        root_name = root + sharp
        intervals = CHORD_INTERVALS.get(quality, [0, 4, 7])
        start = SEMITONES[root_name]
        notes = []
        cur = start
        for iv in intervals:
            semi = start + iv
            while semi <= cur:
                semi += 12
            octv = root_oct + semi // 12
            notes.append(f"{FROM_SEMI[semi % 12]}{octv}")
            cur = semi
        return notes

    result = {}
    if not spec_str:
        return result

    # Parse chord tokens: "Em x4 C x2" or just "Em C D"
    tokens = spec_str.split()
    pos_bar = 0
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        # Check for xN
        hold = 1
        if i + 1 < len(tokens) and tokens[i + 1].startswith("x"):
            try:
                hold = int(tokens[i + 1][1:])
                i += 1
            except ValueError:
                pass
        if pos_bar >= total_bars:
            break
        notes = chord_notes(tok)
        # Place chord at the start of this bar's span
        step_offset = pos_bar * step_width
        result[str(step_offset)] = notes
        pos_bar += hold
        i += 1

    return result


# ─── Voice parser ───────────────────────────────────────────────────────────

VOICE_KEYS = {
    "bassType", "bassCut", "bassDur",
    "padType", "padCut", "padDur",
    "leadType", "leadCut", "leadDur", "vib",
    "layerType", "layerCut", "layerDur",
    "kickTop", "kickBot",
}


def parse_voices(kv_list):
    """Parse ['leadType=square', 'leadCut=2600', 'vib=4'] into dict."""
    out = {}
    for pair in kv_list or []:
        if "=" not in pair:
            continue
        k, v = pair.split("=", 1)
        k, v = k.strip(), v.strip()
        if k not in VOICE_KEYS:
            continue
        # Try numeric
        try:
            out[k] = int(v)
        except ValueError:
            try:
                out[k] = float(v)
            except ValueError:
                out[k] = v
    return out


# ─── File paths ─────────────────────────────────────────────────────────────

def state_dir(game, working_dir="."):
    return os.path.join(working_dir, ".squid-os", "music-composer", game)


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s or "untitled"


# ─── Commands ───────────────────────────────────────────────────────────────

def cmd_arch(a):
    """Create a backbone from musical args."""
    sections = []
    for s in a.section:
        parts = s.split(",")
        if len(parts) != 3:
            _err(f"--section expects name,bars,drums got {s!r}")
        sec_name, bars, drums = parts[0].strip(), int(parts[1]), parts[2].strip()
        sections.append({"section": sec_name, "bars": bars, "drums": drums})

    backbone = {
        "name": a.name,
        "bpm": a.bpm,
        "timeSig": a.time_sig,
        "form": sections,
    }

    d = state_dir(a.game, a.working_dir)
    bb_dir = os.path.join(d, "backbones")
    os.makedirs(bb_dir, exist_ok=True)

    slug = slugify(a.name)
    path = os.path.join(bb_dir, f"{slug}.json")
    with open(path, "w") as f:
        json.dump(backbone, f, indent=2)

    total_bars = sum(s["bars"] for s in sections)
    spb = resolve_time_sig(a.time_sig)
    secs_per_bar = spb / 4 / (a.bpm / 60)  # rough: steps_per_bar / 4 beats / bpm*60
    duration = total_bars * (4 / (a.bpm / 60))  # bars * seconds_per_bar (4 beats)
    print(f"PASS: backbone '{a.name}' → {path}")
    print(f"      {len(sections)} sections, {total_bars} bars, {a.time_sig}, {a.bpm} BPM, ~{int(duration//60)}:{int(duration%60):02d}")


def cmd_parts(a):
    """Create or update a parts file from musical args.

    Modular: only updates the sections/fields you pass. If the parts file
    already exists, it merges (your new args overwrite matching keys,
    everything else is preserved). If it doesn't exist, creates fresh.
    """
    step_width = 16

    # Check if backbone exists to get timeSig
    d = state_dir(a.game, a.working_dir)
    slug = slugify(a.name)
    bb_path = os.path.join(d, "backbones", f"{slug}.json")
    if os.path.exists(bb_path):
        with open(bb_path) as f:
            bb = json.load(f)
        step_width = resolve_time_sig(bb.get("timeSig", "4/4"))
        total_bars_by_section = {}
        for entry in bb.get("form", []):
            sec = entry["section"]
            total_bars_by_section[sec] = total_bars_by_section.get(sec, 0) + entry["bars"]
    else:
        _err(f"backbone not found: {bb_path} (run arch first)")

    parts_path = os.path.join(d, f"parts-{slug}.json")

    # Load existing parts if present (merge mode), else start fresh
    if os.path.exists(parts_path):
        with open(parts_path) as f:
            parts = json.load(f)
        is_update = True
    else:
        parts = {
            "name": a.name,
            "genre": "",
            "vibe": "",
            "createdAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%S.%f"),
            "revision": 0,
            "drumKit": {},
            "lead": {},
            "layer": {},
            "bass": {},
            "pad": {},
            "_bass_single": False,
            "voices": {},
        }
        is_update = False

    # Update metadata (only if provided)
    if a.genre:
        parts["genre"] = a.genre
    if a.vibe:
        parts["vibe"] = a.vibe

    # Merge lead sections (only the ones you pass)
    for spec in a.lead or []:
        if "=" not in spec:
            _err(f"--lead expects section=notation got {spec!r}")
        sec, notation = spec.split("=", 1)
        sec = sec.strip()
        bars = parse_beat_notation(notation.strip(), step_width)
        expected = total_bars_by_section.get(sec, len(bars))
        while len(bars) < expected:
            bars.append([None] * step_width)
        parts.setdefault("lead", {})[sec] = bars[:expected]

    # Merge layer sections
    for spec in a.layer or []:
        if "=" not in spec:
            continue
        sec, notation = spec.split("=", 1)
        sec = sec.strip()
        bars = parse_beat_notation(notation.strip(), step_width)
        expected = total_bars_by_section.get(sec, len(bars))
        while len(bars) < expected:
            bars.append([None] * step_width)
        parts.setdefault("layer", {})[sec] = bars[:expected]

    # Merge bass
    bass_single = a.bass_single
    if a.bass:
        for spec in a.bass:
            if "=" in spec:
                sec, notation = spec.split("=", 1)
                sec = sec.strip()
                bars = parse_beat_notation(notation.strip(), step_width)
                expected = total_bars_by_section.get(sec, len(bars))
                while len(bars) < expected:
                    bars.append([None] * step_width)
                parts.setdefault("bass", {})[sec] = bars[:expected]
            else:
                bars = parse_beat_notation(spec.strip(), step_width)
                first_sec = bb["form"][0]["section"] if bb.get("form") else "s0"
                expected = total_bars_by_section.get(first_sec, len(bars))
                while len(bars) < expected:
                    bars.append([None] * step_width)
                parts.setdefault("bass", {})[first_sec] = bars[:expected]
                bass_single = True
    if bass_single:
        parts["_bass_single"] = True

    # Merge pads
    for spec in a.pad or []:
        if "=" not in spec:
            continue
        sec, notation = spec.split("=", 1)
        sec = sec.strip()
        expected = total_bars_by_section.get(sec, 4)
        parts.setdefault("pad", {})[sec] = parse_pad_spec(notation.strip(), expected, step_width)

    # Merge drum kit
    for spec in a.drum or []:
        if "=" not in spec:
            continue
        name, spec_str = spec.split("=", 1)
        parts.setdefault("drumKit", {})[name.strip()] = parse_drum_spec(spec_str.strip(), step_width)

    # Merge voices
    if a.voice:
        new_voices = parse_voices(a.voice)
        parts.setdefault("voices", {}).update(new_voices)

    # Bump revision on update
    if is_update:
        parts["revision"] = int(parts.get("revision", 0)) + 1

    os.makedirs(d, exist_ok=True)
    with open(parts_path, "w") as f:
        json.dump(parts, f, indent=2)

    action = "updated" if is_update else "created"
    n_sections = len(set(e["section"] for e in bb.get("form", [])))
    print(f"PASS: {action} parts '{a.name}' → {parts_path} (rev {parts['revision']})")
    print(f"      {n_sections} sections in backbone, {len(parts.get('drumKit',{}))} drum patterns")


def cmd_validate(a):
    """Validate all songs in a game dir by simulating the compiler."""
    d = state_dir(a.game, a.working_dir)
    if not os.path.isdir(d):
        _err(f"no songs dir: {d}")

    bb_dir = os.path.join(d, "backbones")
    parts_files = [f for f in os.listdir(d) if f.startswith("parts-") and f.endswith(".json")]

    ok, fail = 0, 0
    for pf in sorted(parts_files):
        slug = pf[6:-5]
        bb_path = os.path.join(bb_dir, f"{slug}.json")
        if not os.path.exists(bb_path):
            print(f"  ✗ {pf}: missing backbone")
            fail += 1
            continue
        try:
            with open(bb_path) as f:
                bb = json.load(f)
            with open(os.path.join(d, pf)) as f:
                parts = json.load(f)
            # Basic checks
            form = bb.get("form", [])
            sections_in_form = set(e["section"] for e in form)
            lead_sections = set(parts.get("lead", {}).keys())
            missing = sections_in_form - lead_sections
            if missing:
                print(f"  ✗ {pf}: lead missing sections: {missing}")
                fail += 1
                continue
            drum_keys = set(parts.get("drumKit", {}).keys())
            drum_refs = set(e["drums"] for e in form)
            bad_drums = drum_refs - drum_keys
            if bad_drums:
                print(f"  ✗ {pf}: drum refs not in kit: {bad_drums}")
                fail += 1
                continue
            ok += 1
            print(f"  ✓ {pf}")
        except Exception as e:
            print(f"  ✗ {pf}: {e}")
            fail += 1

    print(f"\n{ok} OK, {fail} failed, {ok + fail} total")
    if fail > 0:
        sys.exit(1)


def cmd_list(a):
    """List songs in a game dir."""
    d = state_dir(a.game, a.working_dir)
    if not os.path.isdir(d):
        _err(f"no songs dir: {d}")
    parts_files = sorted(f for f in os.listdir(d) if f.startswith("parts-") and f.endswith(".json"))
    if not parts_files:
        print("(no songs)")
        return
    for i, pf in enumerate(parts_files):
        with open(os.path.join(d, pf)) as f:
            p = json.load(f)
        slug = pf[6:-5]
        bb_path = os.path.join(d, "backbones", f"{slug}.json")
        time_sig = "?"
        n_sections = "?"
        if os.path.exists(bb_path):
            with open(bb_path) as f:
                bb = json.load(f)
            time_sig = bb.get("timeSig", "?")
            n_sections = len(bb.get("form", []))
        bpm = p.get("bpm") or bb.get("bpm", "?") if os.path.exists(bb_path) else p.get("bpm", "?")
        genre = p.get("genre", "?")
        vibe = (p.get("vibe") or "")[:40]
        print(f"{i:>3}  {str(bpm) + ' BPM':>8}  {time_sig:>4}  {n_sections:>2} sec  [{genre}]  {p.get('name','?')}")
        if vibe:
            print(f"       {vibe}")
    print(f"({len(parts_files)} songs)")


def cmd_show_arch(a):
    """Show a song's backbone structure."""
    d = state_dir(a.game, a.working_dir)
    slug = slugify(a.name)
    path = os.path.join(d, "backbones", f"{slug}.json")
    if not os.path.exists(path):
        _err(f"no backbone for '{a.name}' in {a.game}")
    with open(path) as f:
        bb = json.load(f)
    print(f"{'='*50}")
    print(f"  {bb['name']}")
    print(f"  {bb['bpm']} BPM  {bb.get('timeSig','4/4')}")
    print(f"{'='*50}")
    total_bars = 0
    cur_bar = 0
    for i, entry in enumerate(bb["form"]):
        bars = entry["bars"]
        total_bars += bars
        print(f"  {i+1:>2}. {entry['section']:<12} bars {cur_bar+1:>2}-{cur_bar+bars:<2}  drums={entry['drums']}")
        cur_bar += bars
    spb = resolve_time_sig(bb.get("timeSig", "4/4"))
    duration = total_bars * (spb / 4) / (bb["bpm"] / 60)
    print(f"{'-'*50}")
    print(f"  Total: {total_bars} bars, ~{int(duration//60)}:{int(duration%60):02d}")
    # Show distinct sections and their total bar counts
    from collections import OrderedDict
    sec_bars = OrderedDict()
    for e in bb["form"]:
        sec_bars[e["section"]] = sec_bars.get(e["section"], 0) + e["bars"]
    print(f"\n  Distinct sections (for --lead/--pad/--bass):")
    for sec, bars in sec_bars.items():
        print(f"    {sec:<12} {bars} bars")


def cmd_show_parts(a):
    """Show a song's parts summary."""
    d = state_dir(a.game, a.working_dir)
    slug = slugify(a.name)
    path = os.path.join(d, f"parts-{slug}.json")
    if not os.path.exists(path):
        _err(f"no parts for '{a.name}' in {a.game}")
    with open(path) as f:
        p = json.load(f)
    print(f"{'='*50}")
    print(f"  {p['name']}  (rev {p.get('revision',1)})")
    print(f"  Genre: {p.get('genre','?')}")
    print(f"  Vibe:  {p.get('vibe','')}")
    print(f"{'='*50}")
    print(f"\n  Drum kit ({len(p.get('drumKit',{}))} patterns):")
    for name, pattern in p.get("drumKit", {}).items():
        kicks = sum(1 for x in pattern if x.get("k"))
        snares = sum(1 for x in pattern if x.get("s"))
        hats = sum(1 for x in pattern if x.get("h"))
        print(f"    {name:<10} kick={kicks} snare={snares} hat={hats}")
    print(f"\n  Lead sections:")
    for sec, bars in p.get("lead", {}).items():
        notes = sum(1 for bar in bars for cell in bar if cell is not None)
        total_cells = sum(len(bar) for bar in bars)
        print(f"    {sec:<12} {len(bars)} bars, {notes}/{total_cells} cells filled")
    if p.get("layer"):
        print(f"\n  Layer sections:")
        for sec, bars in p["layer"].items():
            notes = sum(1 for bar in bars for cell in bar if cell is not None)
            print(f"    {sec:<12} {len(bars)} bars, {notes} notes")
    print(f"\n  Bass: {'shared (single)' if p.get('_bass_single') else 'per-section'}")
    for sec, bars in p.get("bass", {}).items():
        notes = sum(1 for bar in bars for cell in bar if cell is not None)
        print(f"    {sec:<12} {len(bars)} bars, {notes} notes")
    if p.get("pad"):
        print(f"\n  Pad sections:")
        for sec, chords in p["pad"].items():
            print(f"    {sec:<12} {len(chords)} chord placements")
    if p.get("voices"):
        print(f"\n  Voices:")
        for k, v in p["voices"].items():
            print(f"    {k} = {v}")


def cmd_remove(a):
    """Remove a song by name."""
    d = state_dir(a.game, a.working_dir)
    slug = slugify(a.name)
    removed = 0
    for path in [
        os.path.join(d, "backbones", f"{slug}.json"),
        os.path.join(d, f"parts-{slug}.json"),
    ]:
        if os.path.exists(path):
            os.remove(path)
            removed += 1
    if removed == 0:
        _err(f"no song matching '{a.name}'")
    print(f"PASS: removed '{a.name}' ({removed} files)")


def cmd_set_vibe(a):
    """Set vibe on a song."""
    d = state_dir(a.game, a.working_dir)
    slug = slugify(a.name)
    path = os.path.join(d, f"parts-{slug}.json")
    if not os.path.exists(path):
        _err(f"no song matching '{a.name}'")
    with open(path) as f:
        p = json.load(f)
    p["vibe"] = a.vibe
    p["revision"] = int(p.get("revision", 0)) + 1
    with open(path, "w") as f:
        json.dump(p, f, indent=2)
    print(f"PASS: set vibe on '{a.name}' (rev {p['revision']})")


# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    # arch
    ar = sub.add_parser("arch", help="create backbone from musical args")
    ar.add_argument("--game", required=True)
    ar.add_argument("--name", required=True)
    ar.add_argument("--bpm", type=int, required=True)
    ar.add_argument("--time-sig", default="4/4")
    ar.add_argument("--section", action="append", required=True,
                    help="name,bars,drums (repeatable). e.g. hook,4,light")
    ar.add_argument("--working-dir", default=".")

    # parts
    pa = sub.add_parser("parts", help="create parts from musical args")
    pa.add_argument("--game", required=True)
    pa.add_argument("--name", required=True)
    pa.add_argument("--genre", default="")
    pa.add_argument("--vibe", default="")
    pa.add_argument("--lead", action="append",
                    help="section=beat_notation (repeatable)")
    pa.add_argument("--layer", action="append",
                    help="section=beat_notation (repeatable)")
    pa.add_argument("--bass", action="append",
                    help="section=beat_notation or bare notation for shared bass")
    pa.add_argument("--bass-single", action="store_true")
    pa.add_argument("--pad", action="append",
                    help="section=chord_spec (repeatable). e.g. hook='Em x4'")
    pa.add_argument("--drum", action="append",
                    help='name=spec (repeatable). e.g. full=\'snare:"2 4" kick:"1 2 3 4" hat:eighths\'')
    pa.add_argument("--voice", action="append",
                    help="key=value (repeatable). e.g. leadType=square vib=4")
    pa.add_argument("--working-dir", default=".")

    # validate
    va = sub.add_parser("validate", help="validate all songs in a game")
    va.add_argument("--game", required=True)
    va.add_argument("--working-dir", default=".")

    # list
    ls = sub.add_parser("list", help="list songs")
    ls.add_argument("--game", required=True)
    ls.add_argument("--working-dir", default=".")

    # show-arch
    sa = sub.add_parser("show-arch", help="show a song's backbone structure")
    sa.add_argument("--game", required=True)
    sa.add_argument("--name", required=True)
    sa.add_argument("--working-dir", default=".")

    # show-parts
    sp = sub.add_parser("show-parts", help="show a song's parts summary")
    sp.add_argument("--game", required=True)
    sp.add_argument("--name", required=True)
    sp.add_argument("--working-dir", default=".")

    # remove
    rm = sub.add_parser("remove", help="remove a song")
    rm.add_argument("--game", required=True)
    rm.add_argument("--name", required=True)
    rm.add_argument("--working-dir", default=".")

    # set-vibe
    sv = sub.add_parser("set-vibe", help="set vibe description")
    sv.add_argument("--game", required=True)
    sv.add_argument("--name", required=True)
    sv.add_argument("--vibe", required=True)
    sv.add_argument("--working-dir", default=".")

    a = ap.parse_args()
    {"arch": cmd_arch, "parts": cmd_parts, "validate": cmd_validate,
     "list": cmd_list, "remove": cmd_remove, "set-vibe": cmd_set_vibe,
     "show-arch": cmd_show_arch, "show-parts": cmd_show_parts}[a.cmd](a)


if __name__ == "__main__":
    main()
