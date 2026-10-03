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
import argparse, json, os, re, sys, uuid
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
# Duration suffixes: . (dotted = 1.5x), ~ (hold = 2 beats)
# Rest: _
# NOTE: no repeat shorthand (xN). Write every bar explicitly — repetition is
# how songs get boring; M3 (progression) requires new material per section.

def parse_beat_notation(s, step_width=16):
    """Parse beat notation into a list of bar arrays (each bar = step_width cells).

    Notes are placed on eighth-note grid by default (2 steps per beat in 4/4).
    | separates bars. . doubles duration. ~ holds 2 beats. _ is rest.
    There is NO xN repeat — write each bar out explicitly.
    """
    s = s.strip()
    if not s:
        return []

    # Reject any leftover xN repeat token with a clear message (it was removed).
    if re.search(r"\bx\d+", s):
        _err(f"xN repeat not supported: {s!r} — write each bar explicitly and vary them")

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
    k_set, s_set, h_set, c_set, oh_set = set(), set(), set(), set(), set()
    named = {"quarters": 4, "eighths": 2, "sixteenths": 1}

    if not spec_str or spec_str.strip() == "{}":
        return [{"k": False, "s": False, "h": False} for _ in range(STEPS)]

    # Parse key:value pairs — value is either "quoted beats" or a bare named pattern
    pairs = re.findall(r'(\w+)\s*:\s*(?:"([^"]*)"|(\w+))', spec_str)
    for inst, quoted, bare in pairs:
        val = (quoted if quoted else bare).strip()
        if inst == "openHat":
            target = oh_set
        elif inst == "crash":
            target = c_set
        elif inst == "hat":
            target = h_set
        else:
            target = None
        if val in named:
            interval = named[val]
            for i in range(0, STEPS, interval):
                _add_drum(inst, i, k_set, s_set, h_set, c_set, oh_set)
        else:
            for beat_str in val.split():
                try:
                    beat = float(beat_str)
                    step = round(beat * 4)  # beat → 16th note step
                    if 0 <= step < STEPS:
                        _add_drum(inst, step, k_set, s_set, h_set, c_set, oh_set)
                except ValueError:
                    pass

    out = []
    for i in range(STEPS):
        cell = {"k": i in k_set, "s": i in s_set, "h": i in h_set}
        if i in c_set:
            cell["c"] = True
        if i in oh_set:
            cell["oh"] = True
        out.append(cell)
    return out


def _add_drum(inst, step, k_set, s_set, h_set, c_set=None, oh_set=None):
    if inst == "kick":
        k_set.add(step)
    elif inst == "snare":
        s_set.add(step)
    elif inst == "hat":
        h_set.add(step)
    elif inst == "openHat":
        if oh_set is not None:
            oh_set.add(step)
        h_set.add(step)
    elif inst == "crash":
        if c_set is not None:
            c_set.add(step)


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


def _bb_parts(b):
    """Normalize a backbone to the parts schema (new 'parts' or legacy 'form')."""
    if b.get("parts"): return b["parts"]
    return [{"part": e.get("part") or e["section"],
             "measures": e.get("measures", e["bars"]),
             "drum": e.get("drum") or e["drums"]} for e in b.get("form", [])]

def state_dir(game, working_dir="."):
    return os.path.join(working_dir, ".squid-os", "music-composer", game)


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s or "untitled"


# ─── Commands ───────────────────────────────────────────────────────────────

def cmd_arch(a):
    """Create a backbone from musical args. The architect drives everything:
    parts (name + measure count + drum track), bpm, timeSig. Nothing else."""
    part_list = []
    for s in a.part:
        fields = s.split(",")
        if len(fields) != 3:
            _err(f"--part expects name,measures,drum got {s!r}")
        p_name, n_measures, drum = fields[0].strip(), int(fields[1]), fields[2].strip()
        if n_measures < 2:
            _err(f"part '{p_name}': measures must be >= 2 (got {n_measures})")
        part_list.append({"part": p_name, "measures": n_measures, "drum": drum})

    backbone = {
        "name": a.name,
        "bpm": a.bpm,
        "timeSig": a.time_sig,
        "parts": part_list,
    }

    d = state_dir(a.game, a.working_dir)
    bb_dir = os.path.join(d, "backbones")
    os.makedirs(bb_dir, exist_ok=True)

    slug = slugify(a.name)
    path = os.path.join(bb_dir, f"{slug}.json")
    with open(path, "w") as f:
        json.dump(backbone, f, indent=2)

    total_measures = sum(p["measures"] for p in part_list)
    m = a.time_sig.split("/")
    beats = int(m[0]) if m and m[0].isdigit() else 4
    duration = total_measures * beats * (60 / a.bpm)  # measures × seconds/measure
    print(f"PASS: backbone '{a.name}' → {path}")
    print(f"      {len(part_list)} parts, {total_measures} measures, {a.time_sig}, {a.bpm} BPM, ~{int(duration//60)}:{int(duration%60):02d}")


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
        total_measures_by_part = {}
        for entry in _bb_parts(bb):
            pn = entry["part"]
            total_measures_by_part[pn] = total_measures_by_part.get(pn, 0) + entry["measures"]
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
            "uuid": str(uuid.uuid4()),
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
    if a.scale:
        parts["scale"] = a.scale

    # Merge lead sections (only the ones you pass)
    for spec in a.lead or []:
        if "=" not in spec:
            _err(f"--lead expects part=notation got {spec!r}")
        sec, notation = spec.split("=", 1)
        sec = sec.strip()
        bars = parse_beat_notation(notation.strip(), step_width)
        expected = total_measures_by_part.get(sec, len(bars))
        while len(bars) < expected:
            bars.append([None] * step_width)
        parts.setdefault("lead", {})[sec] = bars[:expected]
        # M2 density report — INFORMATIONAL only. Sparsity is often correct
        # (jazz/ambient/lo-fi). This line never blocks or fails; it just makes
        # fill ratio visible at write time. Do NOT re-run parts to raise density
        # just to clear this note.
        sparse_ok = "-sparse" in sec
        for bi, bar in enumerate(bars[:expected]):
            fill = sum(1 for c in bar if c) / max(1, len(bar))
            tag = "" if (fill >= 0.5 or sparse_ok) else "  (sparse — fine for jazz/ambient/ballad)"
            print(f"    info: lead {sec} bar{bi+1}: {int(fill*100):3d}% filled{tag}")

    # Merge layer sections
    for spec in a.layer or []:
        if "=" not in spec:
            continue
        sec, notation = spec.split("=", 1)
        sec = sec.strip()
        bars = parse_beat_notation(notation.strip(), step_width)
        expected = total_measures_by_part.get(sec, len(bars))
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
                expected = total_measures_by_part.get(sec, len(bars))
                while len(bars) < expected:
                    bars.append([None] * step_width)
                parts.setdefault("bass", {})[sec] = bars[:expected]
                bass_single = False   # per-section bass overrides shared mode
            else:
                bars = parse_beat_notation(spec.strip(), step_width)
                first_sec = _bb_parts(bb)[0]["part"] if _bb_parts(bb) else "s0"
                expected = total_measures_by_part.get(first_sec, len(bars))
                while len(bars) < expected:
                    bars.append([None] * step_width)
                parts.setdefault("bass", {})[first_sec] = bars[:expected]
                bass_single = True
    if bass_single:
        parts["_bass_single"] = True
    elif "bass" in parts and len([s for s in parts["bass"]]) >= 2:
        # Per-section bass fully specified → clear any stale shared flag.
        parts["_bass_single"] = False

    # Merge pads
    for spec in a.pad or []:
        if "=" not in spec:
            continue
        sec, notation = spec.split("=", 1)
        sec = sec.strip()
        expected = total_measures_by_part.get(sec, 4)
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
    n_parts = len(set(e["part"] for e in _bb_parts(bb)))
    print(f"PASS: {action} parts '{a.name}' → {parts_path} (rev {parts['revision']})")
    print(f"      {n_parts} parts in backbone, {len(parts.get('drumKit',{}))} drum tracks")


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
            plist = _bb_parts(bb)
            part_names = set(e["part"] for e in plist)
            lead_parts = set(parts.get("lead", {}).keys())
            missing = part_names - lead_parts
            if missing:
                print(f"  ✗ {pf}: lead missing parts: {missing}")
                fail += 1
                continue
            drum_keys = set(parts.get("drumKit", {}).keys())
            drum_refs = set(e["drum"] for e in plist)
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


def cmd_audit(a):
    """Craft-instruction audit: check a song's notes against the architect's plan.

    Checks (from references/craft-instructions.md, the M/B/H/D instructions):
      A. Consistency  — parts keys match backbone parts exactly (no stale/missing)
      B. Bass moves   — >=4 distinct pitch events per 4-measure part (B1)
      C. Drums        — every drum track referenced exists and is non-silent
      D. Repetition   — WARN on identical adjacent bars; FAIL only on a pure
                        static section (all bars identical, zero motion)
      E. Intensity    — ladder climb through the body (WARN only)
      F. Peak register— peak must reach/exceed build's top note (M4)
      M/B/H/D        — scale lock, progression, ceiling, walk, bass, pads, drums
    Exit 1 on any FAIL; WARN does not block.
    """
    d = state_dir(a.game, a.working_dir)
    slug = slugify(a.name)
    bb_path = os.path.join(d, "backbones", f"{slug}.json")
    parts_path = os.path.join(d, f"parts-{slug}.json")
    if not os.path.exists(bb_path) or not os.path.exists(parts_path):
        _err(f"song not found: {a.name}")
    with open(bb_path) as f:
        bb = json.load(f)
    with open(parts_path) as f:
        parts = json.load(f)

    plist = _bb_parts(bb)
    step_width = resolve_time_sig(bb.get("timeSig", "4/4"))
    errors, warns = [], []

    # ── A. Consistency: parts keys vs backbone parts ───────────────────────
    part_names = set(e["part"] for e in plist)
    lead_parts = set(parts.get("lead", {}).keys())
    stale = lead_parts - part_names
    missing = part_names - lead_parts
    if missing:
        errors.append(f"A: lead missing parts from backbone: {sorted(missing)}")
    if stale:
        warns.append(f"A: stale parts entries not in backbone (dead data): {sorted(stale)}")
    kit = parts.get("drumKit", {})
    bad_refs = set(e["drum"] for e in plist) - set(kit.keys())
    if bad_refs:
        errors.append(f"A: drum tracks referenced but not defined: {sorted(bad_refs)}")

    # ── B. Bass must move (B1) ────────────────────────────────────────────
    bass_single = bool(parts.get("_bass_single"))
    bass_map = parts.get("bass", {})
    for pn in sorted(part_names):
        bars = bass_map.get(pn)
        if bars is None and bass_single:
            bars = bass_map.get(next(iter(part_names)))
        if not bars:
            continue
        pitches = [c for bar in bars for c in bar if c]
        distinct = len(set(pitches))
        n_meas = len(bars)
        if n_meas >= 4 and distinct < 4:
            errors.append(f"B(Law1): bass '{pn}' has only {distinct} distinct pitch(es) over {n_meas} measures (root pedal)")

    # ── C. Drum tracks exist and are non-silent where assigned ────────────
    def drum_hits(name):
        entry = kit.get(name, {})
        if isinstance(entry, list):
            return sum(1 for dd in entry if dd.get("k") or dd.get("s") or dd.get("h"))
        total = 0
        for inst in ("kick", "snare", "hat"):
            v = entry.get(inst)
            if isinstance(v, str):
                named = {"quarters": 8, "eighths": 16, "sixteenths": 32}
                total += named.get(v, len([x for x in v.split() if x]))
            elif isinstance(v, list):
                total += sum(1 for x in v if x)
        return total

    for e in plist:
        nm = e["drum"]
        if nm == "none":
            continue
        if nm not in kit:
            continue  # already reported in A
        if drum_hits(nm) == 0:
            warns.append(f"C: drum track '{nm}' assigned to part '{e['part']}' but is silent")

    # ── D. Repeated measures (relaxed) ────────────────────────────────────
    # Repetition WITHIN a groove is normal and good. What we actually care
    # about is a section that is a lazy full copy of another (M3 handles that)
    # or a bass/lead that never changes across its whole span. So:
    #   - two identical ADJACENT bars  → WARN (nudge toward variation, not FAIL)
    #   - a bar echoing the one 2 back (period-2) across 4+ bars → WARN
    #   - an ENTIRE section identical to its content in every bar (pure static
    #     loop, zero motion) → FAIL
    def repeat_check(kind, sec_name, bars):
        n = len(bars)
        if n == 0:
            return
        adj_same = sum(1 for i in range(1, n) if bars[i] == bars[i - 1])
        if adj_same:
            warns.append(f"D(repeat): {kind} '{sec_name}' has {adj_same} identical adjacent bar(s) — consider varying at least one (new ending, passing note, or top note)")
        # Pure-static-section check: every bar byte-identical = no motion at all.
        if n >= 2 and all(b == bars[0] for b in bars):
            errors.append(f"D(static): {kind} '{sec_name}' is a pure static loop — all {n} bars identical, zero motion. Vary the bars.")

    for pn in sorted(part_names):
        lead = parts.get("lead", {}).get(pn)
        if lead:
            repeat_check("lead", pn, lead)
        bass = parts.get("bass", {}).get(pn)
        if bass:
            repeat_check("bass", pn, bass)

    # ── E/F. Intensity ladder + peak register ─────────────────────────────
    def note_top(cell_list):
        tops = [int(c[-1]) for c in cell_list if isinstance(c, str) and c[-1].isdigit()]
        return max(tops) if tops else 0

    def bar_score(lead_bar, layer_bar, drum_name, layers_on):
        n_notes = sum(1 for c in (lead_bar or []) if c) + sum(1 for c in (layer_bar or []) if c)
        sc = min(3, n_notes // 3)                      # note count
        reg = note_top(lead_bar or [])
        sc += 0 if reg <= 4 else 2                     # register: oct5 = high
        sc += min(3, drum_hits(drum_name) // 7)        # drum density
        sc += 1 if layers_on else 0                    # extra layer voice
        return sc

    scores = []
    build_top, peak_top = 0, 0
    for e in plist:
        pn = e["part"]
        lead = parts.get("lead", {}).get(pn, [])
        layer = parts.get("layer", {}).get(pn, [])
        for m in range(e["measures"]):
            s0 = m * step_width
            lb = lead[s0:s0 + step_width] if s0 < len(lead) else []
            lbr = layer[s0:s0 + step_width] if layer and s0 < len(layer) else []
            t = note_top(lb)
            if pn.startswith("build"):
                build_top = max(build_top, t)
            if pn.startswith("peak"):
                peak_top = max(peak_top, t)
            scores.append(bar_score(lb, lbr, e["drum"], bool(lbr)))

    # Ladder: average gain across the body (exclude last outro/tag part)
    if len(scores) >= 4:
        body = scores[:-min(2, len(scores) // 3)]
        avg_gain = (body[-1] - body[0]) / max(1, (len(body) - 1) / 2)
        if avg_gain < 0.5:
            warns.append(f"E(Law9): intensity barely climbs: first={body[0]} last={body[-1]} (avg {avg_gain:.2f} pt/2meas, need >=0.5)")
    if build_top and peak_top < build_top:
        errors.append(f"F(Law6): peak top note (oct {peak_top}) never exceeds build's glimpse (oct {build_top})")

    total_measures = sum(e["measures"] for e in plist)
    print(f"audit: {a.name} ({bb.get('bpm')} BPM, {bb.get('timeSig')}, {total_measures} measures)")

    # ── Craft instructions (M1–M5, B1, H1, D1–D5) ─────────────────────────
    run_craft_checks(parts, plist, errors, warns)

    for w in warns:
        print(f"  ⚠ WARN  {w}")
    for e_ in errors:
        print(f"  ✗ FAIL  {e_}")
    if not errors and not warns:
        print("  ✓ all craft checks pass")
    if errors:
        sys.exit(1)


def cmd_list(a):
    """List songs in a game dir, in JUKEBOX order (createdAt asc, 1-indexed)."""
    d = state_dir(a.game, a.working_dir)
    if not os.path.isdir(d):
        _err(f"no songs dir: {d}")
    parts_files = [f for f in os.listdir(d) if f.startswith("parts-") and f.endswith(".json")]
    if not parts_files:
        print("(no songs)")
        return
    # Load all, then sort by createdAt (same key as the jukebox playlist).
    loaded = []
    for pf in parts_files:
        with open(os.path.join(d, pf)) as f:
            p = json.load(f)
        loaded.append((p.get("createdAt", ""), pf, p))
    loaded.sort(key=lambda x: x[0])
    for i, (created, pf, p) in enumerate(loaded):
        slug = pf[6:-5]
        bb_path = os.path.join(d, "backbones", f"{slug}.json")
        time_sig = "?"
        n_parts = "?"
        bpm = p.get("bpm", "?")
        if os.path.exists(bb_path):
            with open(bb_path) as f:
                bb = json.load(f)
            time_sig = bb.get("timeSig", "?")
            n_parts = len(set(e["part"] for e in _bb_parts(bb)))
            bpm = p.get("bpm") or bb.get("bpm", "?")
        genre = p.get("genre", "?")
        uid = (p.get("uuid") or "")[:8]
        vibe = (p.get("vibe") or "")[:40]
        print(f"{i+1:>3}  {str(bpm) + ' BPM':>8}  {time_sig:>4}  {n_parts:>2} pt  [{genre}]  {p.get('name','?')}  ({uid})")
        if vibe:
            print(f"       {vibe}")
    print(f"({len(loaded)} songs)")


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
    plist = _bb_parts(bb)
    total_measures = 0
    cur = 0
    for i, entry in enumerate(plist):
        n = entry["measures"]
        total_measures += n
        print(f"  {i+1:>2}. {entry['part']:<12} measures {cur+1:>2}-{cur+n:<2}  drum={entry['drum']}")
        cur += n
    m = bb.get("timeSig", "4/4").split("/")
    beats = int(m[0]) if m and m[0].isdigit() else 4
    duration = total_measures * beats * (60 / bb["bpm"])
    print(f"{'-'*50}")
    print(f"  Total: {total_measures} measures, ~{int(duration//60)}:{int(duration%60):02d}")
    # Show distinct parts and their total measure counts
    from collections import OrderedDict
    part_meas = OrderedDict()
    for e in plist:
        part_meas[e["part"]] = part_meas.get(e["part"], 0) + e["measures"]
    print(f"\n  Distinct parts (for --lead/--pad/--bass):")
    for pn, n in part_meas.items():
        print(f"    {pn:<12} {n} measures")


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
    print(f"\n  Lead parts:")
    for sec, bars in p.get("lead", {}).items():
        notes = sum(1 for bar in bars for cell in bar if cell is not None)
        total_cells = sum(len(bar) for bar in bars)
        print(f"    {sec:<12} {len(bars)} measures, {notes}/{total_cells} cells filled")
    if p.get("layer"):
        print(f"\n  Layer parts:")
        for sec, bars in p["layer"].items():
            notes = sum(1 for bar in bars for cell in bar if cell is not None)
            print(f"    {sec:<12} {len(bars)} measures, {notes} notes")
    print(f"\n  Bass: {'shared (single)' if p.get('_bass_single') else 'per-part'}")
    for sec, bars in p.get("bass", {}).items():
        notes = sum(1 for bar in bars for cell in bar if cell is not None)
        print(f"    {sec:<12} {len(bars)} measures, {notes} notes")
    if p.get("pad"):
        print(f"\n  Pad parts:")
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


# ─── Craft-instruction checks (M1–M5, B1, H1, D1–D5) ──────────────────────
# See references/craft-instructions.md. These are hard FAILs/WARNs computed
# from the notes themselves — the CLI refuses to bless a song that violates
# them, so bad drafts can't ship silently.

_SCALE_DEFS = {
    "major":       [0, 2, 4, 5, 7, 9, 11],
    "minor":       [0, 2, 3, 5, 7, 8, 10],
    "harmonic-minor": [0, 2, 3, 4, 5, 7, 9, 11],   # natural minor + raised 6th(A) & leading tone(B)
    "phrygian":    [0, 1, 3, 5, 7, 8, 10],
    "dorian":      [0, 2, 3, 5, 7, 9, 10],
    "pentatonic-minor":   [0, 3, 5, 7, 10],
    "pentatonic-major":   [0, 2, 4, 7, 9],
}
_SEMI_PC = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
            "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def _parse_scale(spec):
    """'E-phrygian' / 'Em' / 'C major' -> (root_semitone, allowed_pc_set) or None."""
    if not spec:
        return None
    s = str(spec).replace(" ", "-").lower()
    m = re.match(r"^([a-g])(#?)-(major|minor|harmonic-minor|phrygian|dorian|pentatonic-minor|pentatonic-major)$", s)
    if not m:
        m = re.match(r"^([a-g])(#?)(m|major|minor|phrygian|dorian)$", s)
        if not m:
            return None
        root, sharp, qual = m.group(1).upper(), m.group(2), m.group(3)
        qual = {"m": "minor", "major": "major"}.get(qual, qual)
    else:
        root, sharp, qual = m.group(1).upper(), m.group(2), m.group(3)
    intervals = _SCALE_DEFS.get(qual)
    if not intervals:
        return None
    root_semi = _SEMI_PC[root + sharp]
    allowed = {(root_semi + iv) % 12 for iv in intervals}
    # chromatic seasoning: lowered 7th (dorian color) + raised leading tone.
    # For phrygian the b2 is IN the scale; add the natural 2 (F# in E) as color.
    if qual in ("minor", "harmonic-minor"):
        allowed |= {(root_semi + 10) % 12, (root_semi + 11) % 12}
    if qual == "phrygian":
        # Color notes ABOVE the phrygian base. For E-phrygian (base: E F# G# A B C D),
        # the extra pitches used as seasoning are:
        #   G# = major 3rd  -> root+4
        #   B  = natural 6th -> root+7
        #   C# = minor 7th  -> root+10
        #   D# = leading tone -> root+11
        # (F# is already in the base as the b2.)
        # E-phrygian base intervals [0,1,3,5,7,8,10] from root E(4):
        #   E(4) F#(5) G#(6) A(7) B(8) C(9) D(10)
        # Seasoning for metal/Egyptian color:
        allowed.add((root_semi + 11) % 12)  # D#(3) — leading tone pull into E
        allowed.add((root_semi + 10) % 12)  # C#(2) — wait, that's D... 
        # Actually: root_semi=4, so:
        #   +10 = 14%12 = 2 = C#  ✓ (minor 7th color)
        #   +11 = 15%12 = 3 = D#  ✓ (leading tone)
        # G# is pc 8 = root+4. Add it explicitly (it's the phrygian b3, should be in base):
        allowed.add((root_semi + 4) % 12)   # G#(8) — phrygian b3, ensure present
        allowed.add((root_semi + 2) % 12)   # F#(6) — phrygian b2, ensure present
        allowed.add((root_semi + 10) % 12)  # A#(10) — wait no. root=4, +10=14%12=2=C#. 
        # A# is pc 10 = root+6 from E(4). Add it:
        allowed.add((root_semi + 6) % 12)   # A#(10) — augmented 4th / phrygian #4 color
    return root_semi, allowed


def _pc_of(note):
    m = re.match(r"^([A-G])(#?)[1-6]$", note or "")
    if not m:
        return None
    return (_SEMI_PC[m.group(1) + m.group(2)]) % 12


def _note_height(note):
    """Comparable pitch height (semitones from C1) for interval math."""
    m = re.match(r"^([A-G])(#?)([1-6])$", note or "")
    if not m:
        return None
    return int(m.group(3)) * 12 + _SEMI_PC[m.group(1) + m.group(2)]


def check_m1_scale(parts, errors, warns):
    scale = _parse_scale(parts.get("scale"))
    if not scale:
        warns.append("M1: no 'scale' declared (e.g. \"scale\": \"E-phrygian\") — off-scale check skipped")
        return
    _, allowed = scale
    for voice in ("lead", "layer"):
        for sec, bars in parts.get(voice, {}).items():
            for bi, bar in enumerate(bars):
                bad = [c for c in bar if isinstance(c, str) and _pc_of(c) is not None
                       and _pc_of(c) not in allowed]
                if bad:
                    errors.append(f"M1(scale): {voice} '{sec}' bar {bi+1} off-scale: {bad}")
    for sec, bars in parts.get("bass", {}).items():
        for bi, bar in enumerate(bars):
            bad = [c for c in bar if isinstance(c, str) and _pc_of(c) is not None
                   and _pc_of(c) not in allowed]
            if bad:
                errors.append(f"M1(scale): bass '{sec}' bar {bi+1} off-scale: {bad}")


def _section_pcs(bars):
    pcs = {}
    for bar in bars:
        for c in bar:
            pc = _pc_of(c) if isinstance(c, str) else None
            if pc is not None:
                pcs[pc] = pcs.get(pc, 0) + 1
    return frozenset(pcs.keys())


def _section_signature(bars):
    """Compact signature of a section's lead for variation comparison."""
    notes = [c for bar in bars for c in bar if isinstance(c, str)]
    tops = [_note_height(c) for c in notes if _note_height(c) is not None]
    top = max(tops) if tops else 0
    density = sum(1 for bar in bars for c in bar if c) / max(1, sum(len(bar) for bar in bars))
    return {"top": top, "density": round(density, 2),
            "last_bar": tuple(bars[-1]) if bars else ()}


def check_m3_progression(parts, plist, errors, warns):
    """M3 — surprise on repeat.

    Two clean checks:
      1. No two ADJACENT body sections may be identical (lazy copy-paste).
      2. A RETURNING hook (a section name that appears again) must VARY at
         least one dimension vs its first appearance:
             ending (last bar) / higher top note / added layer / density / drums.
         Repeating the riff is GOOD; repeating it with zero change is boring.
    """
    body_idx = [i for i, e in enumerate(plist)
                if not e["part"].startswith(("intro", "tag", "outro"))]
    lead = parts.get("lead", {})
    layer = parts.get("layer", {})
    drum_of = {e["part"]: e["drum"] for e in plist}

    def has_layer(pn):
        return bool(layer.get(pn))

    sigs = {}   # part name -> first signature seen
    for i in body_idx:
        pn = plist[i]["part"]
        bars = lead.get(pn)
        if not bars:
            continue
        if pn not in sigs:
            sigs[pn] = _section_signature(bars)
            sigs[pn]["drum"] = drum_of.get(pn)
            sigs[pn]["layer"] = has_layer(pn)
        else:
            # RETURN of an earlier section — require a variation.
            prev = sigs[pn]
            cur = _section_signature(bars)
            varied = (
                cur["last_bar"] != prev["last_bar"]             # different ending
                or cur["top"] > prev["top"]                     # higher top note
                or (has_layer(pn) and not prev["layer"])        # added layer
                or abs(cur["density"] - prev["density"]) > 0.15  # busier/sparser
                or drum_of.get(pn) != prev["drum"]              # drums stepped
            )
            if not varied:
                errors.append(f"M3(repeat): '{pn}' returns but changes nothing vs its first appearance — add a surprise (new ending, higher top note, extra layer, or denser drums)")

    # Adjacent-identical check across the whole body sequence (by content).
    content_seq = []
    for i in body_idx:
        pn = plist[i]["part"]
        bars = lead.get(pn)
        if bars:
            content_seq.append((pn, tuple(tuple(b) for b in bars)))
    for a, b in zip(content_seq, content_seq[1:]):
        if a[1] == b[1]:
            errors.append(f"M3(copy): '{a[0]}' and '{b[0]}' are back-to-back identical sections — vary one of them")


def check_m4_ceiling(parts, plist, errors, warns):
    tops = {}
    for e in plist:
        pn = e["part"]
        bars = parts.get("lead", {}).get(pn) or []
        hts = [_note_height(c) for bar in bars for c in bar
               if isinstance(c, str) and _note_height(c) is not None]
        if hts:
            tops[pn] = max(hts)
    def top(prefix):
        return max((v for k, v in tops.items() if k.startswith(prefix)), default=None)
    hook_t, build_t, peak_t = top("hook"), top("build"), top("peak")
    if hook_t and peak_t is not None and peak_t <= hook_t:
        errors.append(f"M4(ceiling): peak top note ({peak_t}) never exceeds hook top ({hook_t}) — the peak has nowhere to go")
    if build_t and peak_t is not None and peak_t < build_t:
        errors.append(f"M4(ceiling): peak top ({peak_t}) below build glimpse ({build_t})")
    traj = " ".join(f"{k}={v}" for k, v in tops.items())
    print(f"  top-note trajectory: {traj}")


def check_m5_walk(parts, errors, warns):
    for sec, bars in parts.get("lead", {}).items():
        seq = [c for bar in bars for c in bar if isinstance(c, str) and _note_height(c) is not None]
        leaps, steps = 0, 0
        unanchored = []
        for i in range(1, len(seq)):
            d = abs(_note_height(seq[i]) - _note_height(seq[i - 1]))
            if d <= 4:                      # step / small skip / repeat
                steps += 1
            elif d <= 7:                    # leap
                leaps += 1
                up = _note_height(seq[i]) > _note_height(seq[i - 1])
                first_bar = i < 8           # entry leap allowance (roughly bar 1)
                # resolution leap down at section end
                tail = i >= len(seq) - 4
                if not (up or first_bar or (not up and tail)):
                    unanchored.append((seq[i - 1], seq[i]))
        total = steps + leaps
        if total >= 8 and leaps / total > 0.30:
            warns.append(f"M5(walk): lead '{sec}' is {leaps}/{total} leaps (>30%) — melody teleports instead of walking")
        if len(unanchored) >= 3:
            errors.append(f"M5(walk): lead '{sec}' has {len(unanchored)} unanchored leaps (downward, mid-section): {unanchored[:3]}")


def check_b1_bass(parts, plist, errors, warns):
    for e in plist:
        pn = e["part"]
        bars = parts.get("bass", {}).get(pn)
        if not bars:
            continue
        roots_per_bar = []
        for bar in bars:
            rs = {_pc_of(c) for c in bar if isinstance(c, str) and _pc_of(c) is not None}
            roots_per_bar.append(rs)
        # pedal check: same single root for 3+ consecutive bars
        run = 1
        for i in range(1, len(roots_per_bar)):
            if roots_per_bar[i] and roots_per_bar[i] == roots_per_bar[i - 1]:
                run += 1
                if run >= 3 and "-pedal" not in pn:
                    errors.append(f"B1(pedal): bass '{pn}' holds one root for {run} bars (bars {i-1+1}-{i+1}) — make it move")
                    break
            else:
                run = 1
        # register check
        for bar in bars:
            for c in bar:
                m = re.match(r"^[A-G]#?([1-6])$", c or "")
                if m and int(m.group(1)) > 3:
                    errors.append(f"B1(register): bass '{pn}' note {c} above octave 3")
                    break


def check_h1_pads(parts, plist, errors, warns):
    scale = _parse_scale(parts.get("scale"))
    tonic = scale[0] if scale else None
    for e in plist:
        pn = e["part"]
        pad = parts.get("pad", {}).get(pn)
        if not pad or e["measures"] < 4:
            continue
        chords = sorted(pad.items(), key=lambda kv: int(kv[0]))
        if len(chords) < 2:
            errors.append(f"H1(static): pads '{pn}' hold one chord across {e['measures']} bars — move the harmony")
        if tonic is not None and pn.startswith("build"):
            for off, notes in chords:
                pcs = {_pc_of(n) for n in notes if _pc_of(n) is not None}
                triad = {(tonic + iv) % 12 for iv in (0, 4, 7)} | {(tonic + iv) % 12 for iv in (0, 3, 7)}
                if pcs and pcs <= triad:
                    warns.append(f"H1(arc): build '{pn}' bar {int(off)//16 + 1} sits on tonic — builds should leave home")


_KICK_BLOCKS = {
    "quarters": {0, 8, 16, 24},
    "eighths": set(range(0, 32, 2)),
    "blast": set(range(32)),
    "push": {0, 10, 16, 26},
}
_FILL_UP = {29, 30, 31}


def _kit_steps(entry, inst):
    letter = {"k": "kick", "s": "snare", "h": "hat"}[inst]
    if isinstance(entry, list):
        return {i for i, d in enumerate(entry) if d.get(inst)}
    val = entry.get(letter) or entry.get(inst)
    out = set()
    named = {"quarters": 4, "eighths": 2, "sixteenths": 1}
    if isinstance(val, str):
        if val in named:
            step = named[val]
            out = set(range(0, 32, step))
        else:
            for b in val.split():
                try:
                    out.add(round(float(b) * 4))
                except ValueError:
                    pass
    return out


def check_drum_kits(parts, plist, errors, warns):
    kit = parts.get("drumKit", {})
    levels = [e["drum"] for e in plist if e["drum"] != "none"]
    ordered = []
    for nm in levels:
        if nm not in ordered:
            ordered.append(nm)
    # D1 backbeat (bar-local: beat 2 = step 8, beat 4 = step 16 of a 32-step bar)
    for nm in ordered:
        entry = kit.get(nm)
        if entry is None or isinstance(entry, list):
            continue
        snare = _kit_steps(entry, "s")
        if snare and not ({8, 16} <= snare):
            errors.append(f"D1(backbeat): kit '{nm}' snare missing beats 2/4 (has steps {sorted(snare)})")
    for nm in ordered:
        entry = kit.get(nm)
        if entry is None:
            continue
        snare = _kit_steps(entry, "s")
        kick = _kit_steps(entry, "k")
        hat = _kit_steps(entry, "h")
        # D4 noise floor + downbeat
        if len(kick) > 24:
            errors.append(f"D4(noise-floor): kit '{nm}' has {len(kick)} kick hits/bar (max 24) — it's a wall, not a beat")
        if kick and 0 not in kick:
            errors.append(f"D4(downbeat): kit '{nm}' kicks exist but step 0 (downbeat) is empty")
        # D4 snare attack zone (bar-local: steps 8-9 and 16-17)
        clash = kick & ({8, 9, 16, 17})
        if clash and snare:
            warns.append(f"D4(snare-zone): kit '{nm}' kicks under the snare at steps {sorted(clash)} — backbeat gets muddy")
        # D2 kick vocabulary
        if kick:
            base = kick - _FILL_UP
            matched = any(base <= block for block in _KICK_BLOCKS.values())
            if not matched:
                warns.append(f"D2(vocabulary): kit '{nm}' kick pattern {sorted(kick)} doesn't match a standard block (quarters/eighths/blast/push) — verify it sounds like a beat")
    # D3 additive ladder by drum-density order
    def density(nm):
        e = kit.get(nm, {})
        return sum(len(_kit_steps(e, i)) for i in ("k", "s", "h"))
    ranked = sorted([nm for nm in ordered if nm in kit], key=density)
    for i in range(1, len(ranked)):
        lo, hi = ranked[i - 1], ranked[i]
        for inst, letter in (("k", "kick"), ("s", "snare"), ("h", "hat")):
            a, b = _kit_steps(kit[lo], inst), _kit_steps(kit[hi], inst)
            removed = a - b
            if removed:
                errors.append(f"D3(additive): kit '{hi}' removes {letter} hits present in '{lo}' (steps {sorted(removed)}) — levels must only add")


def run_craft_checks(parts, plist, errors, warns):
    check_m1_scale(parts, errors, warns)
    check_m3_progression(parts, plist, errors, warns)
    check_m4_ceiling(parts, plist, errors, warns)
    check_m5_walk(parts, errors, warns)
    check_b1_bass(parts, plist, errors, warns)
    check_h1_pads(parts, plist, errors, warns)
    check_drum_kits(parts, plist, errors, warns)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    # arch
    ar = sub.add_parser("arch", help="create backbone from musical args")
    ar.add_argument("--game", required=True)
    ar.add_argument("--name", required=True)
    ar.add_argument("--bpm", type=int, required=True)
    ar.add_argument("--time-sig", default="4/4")
    ar.add_argument("--part", action="append", required=True,
                    help="name,measures,drum (repeatable). e.g. hook,4,light")
    ar.add_argument("--working-dir", default=".")

    # parts
    pa = sub.add_parser("parts", help="create parts from musical args")
    pa.add_argument("--game", required=True)
    pa.add_argument("--name", required=True)
    pa.add_argument("--genre", default="")
    pa.add_argument("--vibe", default="")
    pa.add_argument("--scale", default="",
                    help="scale lock, e.g. 'E-phrygian', 'E-minor', 'C-major' (M1)")
    pa.add_argument("--lead", action="append",
                    help="part=measure_notation (repeatable)")
    pa.add_argument("--layer", action="append",
                    help="part=measure_notation (repeatable)")
    pa.add_argument("--bass", action="append",
                    help="part=measure_notation or bare notation for shared bass")
    pa.add_argument("--bass-single", action="store_true")
    pa.add_argument("--pad", action="append",
                    help="part=chord_spec (repeatable). e.g. hook='Em x4'")
    pa.add_argument("--drum", action="append",
                    help='name=spec (repeatable). e.g. full=\'snare:"2 4" kick:"1 2 3 4" hat:eighths\'')
    pa.add_argument("--voice", action="append",
                    help="key=value (repeatable). e.g. leadType=square vib=4")
    pa.add_argument("--working-dir", default=".")

    # audit
    au = sub.add_parser("audit", help="craft-instruction audit of one song (M/B/H/D + consistency)")
    au.add_argument("--game", required=True)
    au.add_argument("--name", required=True)
    au.add_argument("--working-dir", default=".")

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
     "audit": cmd_audit,
     "list": cmd_list, "remove": cmd_remove, "set-vibe": cmd_set_vibe,
     "show-arch": cmd_show_arch, "show-parts": cmd_show_parts}[a.cmd](a)


if __name__ == "__main__":
    main()
