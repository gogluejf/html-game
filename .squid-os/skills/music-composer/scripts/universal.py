#!/usr/bin/env python3
"""Universal-format <-> engine-grid conversion for music-composer v3.

One format on disk (backbone + parts); the 32-step grid is a compiled detail.
This module is the single source of truth for both directions:

  to_universal(track)   legacy/compiled grid track -> {backbone, parts}
  compile(backbone, parts)  universal -> engine grid track (what the scheduler plays)

Beat notation (lead/layer/bass): space = next eighth slot, '|' = bar line
(4 beats), '_' = rest, suffix '.' = dotted (1.5 slots), '~' = hold (2 slots).
Bass shorthand 'X Y xN' repeats the pair N times. Pads: chord names with
optional 'xN' bar spans ('Em x4', 'C/E x2').
"""
import re

STEPS = 32            # one phrase block = 2 bars = 8 beats
SLOTS_PER_BAR = 8     # eighth-note slots per 4/4 bar

CHORDS = {
    "C": ["C", "E", "G"], "D": ["D", "F#", "A"], "E": ["E", "G#", "B"],
    "F": ["F", "A", "C"], "G": ["G", "B", "D"], "A": ["A", "C#", "E"],
    "B": ["B", "D#", "F#"],
    "Cm": ["C", "D#", "G"], "Dm": ["D", "F", "A"], "Em": ["E", "G", "B"],
    "Fm": ["F", "A#", "C"], "Gm": ["G", "A#", "D"], "Am": ["A", "C", "E"],
    "Bm": ["B", "D", "F#"],
    "C7": ["C", "E", "G", "A#"], "D7": ["D", "F#", "A", "C"],
    "E7": ["E", "G#", "B", "D"], "F7": ["F", "A", "C", "D#"],
    "G7": ["G", "B", "D", "F"], "A7": ["A", "C#", "E", "G"],
    "B7": ["B", "D#", "F#", "A"],
    "Cdim": ["C", "D#", "F"], "Edim": ["E", "G", "A#"], "Bdim": ["B", "D", "F"],
    "Cmaj7": ["C", "E", "G", "B"], "Emaj7": ["E", "G#", "B", "D#"],
    "Amaj7": ["A", "C#", "E", "G#"],
}


_QUALITY_INTERVALS = {
    None: [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "m7": [0, 3, 7, 10],
    "maj7": [0, 4, 7, 11], "dim": [0, 3, 6], "aug": [0, 4, 8],
}
_SEMITONES = {"C":0,"C#":1,"D":2,"D#":3,"E":4,"F":5,"F#":6,"G":7,"G#":8,"A":9,"A#":10,"B":11}
_FROM_SEMI = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]


def _chord_root_quality(name):
    m = re.match(r"^([A-G])(#?)(?:/([A-G]))?(m7|maj7|dim|aug|7|m)?$", name)
    if not m:
        raise ValueError(f"unknown chord: {name}")
    return m.group(1) + m.group(2), m.group(3), m.group(4)


def chord_notes(name, root_oct=1):
    """Chord name -> note names stacked upward from the (bass) root."""
    root, bass_override, quality = _chord_root_quality(name)
    intervals = _QUALITY_INTERVALS[quality]
    start = _SEMITONES[bass_override] if bass_override else _SEMITONES[root]
    out, cur = [], start
    for iv in intervals:
        semi = start + iv
        while semi <= cur:
            semi += 12
        octv = root_oct + (semi // 12)
        out.append(_FROM_SEMI[semi % 12] + str(octv))
        cur = semi
    return out


# --------------------------------------------------------------------------
# Beat-notation parsing / rendering
# --------------------------------------------------------------------------

_QUALITY_INTERVALS = {
    None: [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "m7": [0, 3, 7, 10],
    "maj7": [0, 4, 7, 11], "dim": [0, 3, 6], "aug": [0, 4, 8],
}
_SEMITONES = {"C":0,"C#":1,"D":2,"D#":3,"E":4,"F":5,"F#":6,"G":7,"G#":8,"A":9,"A#":10,"B":11}
_FROM_SEMI = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]


def _pc(s):
    m = re.match(r"^([A-G])(#?)[1-5]$", s)
    return (m.group(1), m.group(2)) if m else None


def _letter_pcs(letters):
    out = set()
    for L in letters:
        out.add((L[0], "#" if len(L) > 1 else ""))
    return frozenset(out)


_CHORD_PCS = {name: _letter_pcs(letters) for name, letters in CHORDS.items()}


def _guess_chord(notes):
    """Note-name list -> best chord name by pitch-class set, root-disambiguated."""
    target = frozenset(x for x in (_pc(n) for n in notes) if x)
    if not target:
        return "C"
    root_pc = _pc(notes[0])
    exact = [cname for cname, pcs in _CHORD_PCS.items() if pcs == target]
    if exact:
        def chord_root_pc(cname):
            m = re.match(r"^([A-G])(#?)", cname)
            return (m.group(1), m.group(2)) if m else None
        for cname in exact:
            if chord_root_pc(cname) == root_pc:
                return cname
        return exact[0]
    cands = [(len(pcs), cname) for cname, pcs in _CHORD_PCS.items() if target <= pcs]
    if cands:
        cands.sort()
        return cands[0][1]
    root = _pc(notes[0])
    root_s = root[0] + root[1] if root else "C"
    third = _pc(notes[1]) if len(notes) > 1 else None
    third_s = third[0] + third[1] if third else "?"
    return f"{root_s}?({third_s})"


def bar_to_cells(bar):
    """One bar of eighth-note cells (pad/truncate to 8) -> 16 sixteenth cells.
    Each eighth occupies exactly two 16th slots (identity at 8th resolution)."""
    bar = (bar + [None] * 8)[:8]
    out = []
    for c in bar:
        out += [c, c]
    return out


def phrase_to_bars(cells16):
    """32 sixteenth cells -> two bars of eighth-note arrays (lossless for 8th-res content)."""
    def half(cs):
        bar = []
        for k in range(0, 16, 2):
            a = cs[k]
            b = cs[k + 1] if k + 1 < len(cs) else None
            bar.append(a if a is not None else b)
        return bar
    return [half(cells16[:16]), half(cells16[16:])]


# --------------------------------------------------------------------------
# Drum kit expansion
# --------------------------------------------------------------------------

def expand_kit_entry(entry):
    """drumKit entry -> 32-step {k,s,h} list. Accepts the verbatim 32-step form
    (list of {k,s,h}) or the human beat-notation form (dict)."""
    if isinstance(entry, list):
        return [{"k": bool(d.get("k")), "s": bool(d.get("s")), "h": bool(d.get("h"))}
                for d in entry[:STEPS]]
    k = set(); s = set(); h = set()
    for inst in ("kick", "snare"):
        val = entry.get(inst)
        if not val:
            continue
        if isinstance(val, str) and val in ("eighths", "sixteenths", "quarters"):
            step = {"quarters": 4, "eighths": 2, "sixteenths": 1}[val]
            hits = set(range(0, STEPS, step))
        else:
            hits = set()
            for beat in str(val).split():
                pos = int(round(float(beat) * 4))   # beat -> sixteenth
                hits.add(pos)                        # single 16th hit
        if inst == "kick":
            k |= hits
        else:
            s |= hits
    hat = entry.get("hat")
    if hat:
        if isinstance(hat, str) and hat in ("eighths", "sixteenths", "quarters"):
            step = {"quarters": 4, "eighths": 2, "sixteenths": 1}[hat]
            h = set(range(0, STEPS, step))
        else:
            for beat in str(hat).split():
                pos = int(round(float(beat) * 4))
                h.add(pos)
    return [{"k": i in k, "s": i in s, "h": i in h} for i in range(STEPS)]


def kit_to_beats(drum_set):
    """32-step {k,s,h} list -> drumKit-style entry (beat positions).
    Consecutive 16ths collapse to their start beat; regular patterns get names."""
    def to_beats(flags):
        idx = [i for i in range(STEPS) if flags[i]]
        starts = []
        i = 0
        while i < len(idx):
            # a single 16th hit occupies at most 2 consecutive steps
            j = i
            if j + 1 < len(idx) and idx[j + 1] == idx[j] + 1:
                j += 1
            starts.append(idx[i])
            i = j + 1
        beats = [s / 4 for s in starts]
        # name common patterns
        if beats == [float(i) for i in range(0, 8, 2)]:
            return "quarters"
        if beats == [float(i) for i in range(0, 8)]:
            return "eighths"
        return " ".join(str(int(b)) if b == int(b) else f"{b:g}" for b in beats)
    e = {}
    ks = [d["k"] for d in drum_set]
    ss = [d["s"] for d in drum_set]
    hs = [d["h"] for d in drum_set]
    if any(hs) and all(hs[::2]) and not any(hs[1::2]):
        e["hat"] = "eighths"
    elif any(hs):
        e["hat"] = to_beats(hs)
    if any(ss):
        e["snare"] = to_beats(ss)
    if any(ks):
        e["kick"] = to_beats(ks)
    return e


# --------------------------------------------------------------------------
# Section naming heuristic (migration)
# --------------------------------------------------------------------------

def name_sections(n_phrases, drum_levels):
    """Assign conventional section names from drum-level shape (migration aid)."""
    if n_phrases == 4:
        return ["hook", "build", "peak", "tag"]
    names = []
    for i, lvl in enumerate(drum_levels):
        if i == 0:
            names.append("intro" if lvl == 0 else "hook")
        elif i == 1:
            names.append("hook")
        elif i in (2, 3):
            names.append("build")
        elif i in (4, 5):
            names.append("peak")
        elif i == 6:
            names.append("bridge")
        else:
            names.append("tag")
    return names


# --------------------------------------------------------------------------
# to_universal: compiled/legacy grid track -> {backbone, parts}
# --------------------------------------------------------------------------

def _compress16(cells16):
    """16th-resolution cells -> 8th slots (pairwise; second wins if they differ)."""
    out = []
    k = 0
    while k < len(cells16):
        a = cells16[k]
        b = cells16[k + 1] if k + 1 < len(cells16) else None
        out.append(a if a is not None else b)
        k += 2
    return out


def to_universal(t):
    """Compiled/legacy grid track -> {backbone, parts} (lossless for 8th-res content)."""
    leads = t["leads"]
    n = len(leads)
    lens = t.get("phraseLens") or [1] * n
    levels = t.get("drumLevels") or list(range(n))
    if max(levels) > 3:
        raise ValueError("drum level out of range")
    orig_levels = t.get("drumLevels")
    drums = t["drums"]
    layers = t.get("leadLayers") or [None] * n
    bass_bank = isinstance(t["bass"][0], list) if t.get("bass") else False

    names = name_sections(n, levels)
    form = [{"section": names[i], "bars": lens[i] * 2, "drums": f"lvl{levels[i]}"}
            for i in range(n)]

    # drumKit stores the original 32-step sets VERBATIM, one entry per distinct
    # level value used (lossless — unused t["drums"] slots may differ and are dropped).
    kit = {}
    for lvl in sorted(set(levels)):
        key = f"lvl{lvl}"
        kit[key] = [{"k": bool(d["k"]), "s": bool(d["s"]), "h": bool(d["h"])}
                    for d in drums[lvl]]

    # Group contiguous phrases by section name.
    groups = []   # (sec, [phrase idx...])
    i = 0
    while i < n:
        j = i
        while j + 1 < n and names[j + 1] == names[i]:
            j += 1
        groups.append((names[i], list(range(i, j + 1))))
        i = j + 1

    def phrase_cells(idx_list, source):
        """Concatenate phrases' raw 16th cells (dicts normalized to names)."""
        cells = []
        for p in idx_list:
            ph = source[p] if source is not None else None
            if ph is None:
                cells += [None] * 32
                continue
            for c in ph:
                note = c.get("note") if isinstance(c, dict) else c
                cells.append(note)
        return cells

    def cells_to_bars(cells):
        """16th cells -> list of 16-cell bars."""
        bars = []
        for k in range(0, len(cells), 16):
            bars.append(list(cells[k:k+16]))
        return bars

    parts_lead, parts_layer, parts_bass, parts_pad = {}, {}, {}, {}
    _bass_single = False
    for sec, idx_list in groups:
        total_bars = sum(lens[p] for p in idx_list) * 2
        # lead
        parts_lead[sec] = cells_to_bars(phrase_cells(idx_list, leads))[:total_bars]
        # layer
        if any(layers[p] for p in idx_list):
            parts_layer[sec] = cells_to_bars(phrase_cells(idx_list, layers))[:total_bars]
        # bass: single shared groove (store once) OR a per-phrase bank (per group).
        if bass_bank:
            parts_bass[sec] = cells_to_bars(phrase_cells(idx_list, t["bass"]))
        elif not parts_bass:
            cells = []
            for c in t["bass"]:
                note = c.get("note") if isinstance(c, dict) else c
                cells.append(note)
            parts_bass[sec] = cells_to_bars(cells)
            _bass_single = True
        # pads: per-phrase maps at true note resolution (lossless).
        # Stored as {step_offset_in_section(16ths): [note names]} — every step kept.
        pad_map = {}
        for bi, p in enumerate(idx_list):
            pp = t["pads"][p]
            for st_key in sorted(pp.keys(), key=int):
                st = int(st_key)
                off = bi * 32 + st
                notes = [x.get("note") if isinstance(x, dict) else x for x in pp[st_key]]
                if notes:
                    pad_map[str(off)] = notes
        parts_pad[sec] = pad_map

    backbone = {
        "name": t["name"],
        "bpm": t["bpm"],
        "timeSig": [4, 4],
        "form": form,
    }
    if orig_levels is not None:
        backbone["drumLevels"] = list(orig_levels)
    parts = {
        "name": t["name"],
        "genre": t.get("genre"),
        "vibe": t.get("vibe"),
        "createdAt": t.get("createdAt"),
        "revision": t.get("revision", 1),
        "drumKit": kit,
        "lead": parts_lead,
        "layer": parts_layer,
        "bass": parts_bass,
        "pad": parts_pad,
        "_bass_single": _bass_single,
        "voices": {
            "bassType": t.get("bassType"), "bassCut": t.get("bassCut"), "bassDur": t.get("bassDur"),
            "padType": t.get("padType"), "padCut": t.get("padCut"), "padDur": t.get("padDur"),
            "leadType": t.get("leadType"), "leadCut": t.get("leadCut"), "leadDur": t.get("leadDur"),
            "vib": t.get("vib"),
            "layerType": t.get("layerType"), "layerCut": t.get("layerCut"), "layerDur": t.get("layerDur"),
            "kickTop": t.get("kickTop"), "kickBot": t.get("kickBot"),
        },
    }
    return backbone, parts


# --------------------------------------------------------------------------
# compile: universal -> engine grid track
# --------------------------------------------------------------------------

def _bars_to_16(bars):
    """List of 16-cell bars -> flat 16th cells (identity; pads/truncates to 16)."""
    out = []
    for bar in bars:
        out += (bar + [None] * 16)[:16]
    return out


def compile(backbone, parts):
    form = backbone["form"]
    kit = parts.get("drumKit", {})
    voices = parts.get("voices", {})

    # Per-section content at full section length; shorter content tiles.
    sections = {}
    for f in form:
        sec = f["section"]
        if sec in sections:
            continue
        bars_needed = f["bars"]
        # NOTE: the FIRST form entry for a section may be shorter than later ones
        # (sections can repeat with different lengths). Use the MAX length seen.
        lead_bars = parts.get("lead", {}).get(sec) or [[None] * 16]
        layer_bars = parts.get("layer", {}).get(sec)
        bass_bars = parts.get("bass", {}).get(sec) or [[None] * 16]
        pad_raw = parts.get("pad", {}).get(sec) or {}
        sections[sec] = {
            "lead": _bars_to_16(lead_bars),
            "layer": _bars_to_16(layer_bars) if layer_bars else None,
            "bass": _bars_to_16(bass_bars),
            "pad": pad_raw,
        }
    # Single-groove bass: every phrase uses the same 32-cell pattern.
    _bass_single = parts.get("_bass_single", False)
    if _bass_single:
        first_sec = next(iter(sections))
        _shared_bass = sections[first_sec]["bass"][:32]

    phrases = []
    sec_bar_offset = {}     # section -> running bar offset across its form entries
    for f in form:
        sec = f["section"]
        nph = f["bars"] // 2
        if nph < 1:
            raise ValueError(f"section {sec}: bars must be >= 2")
        s = sections[sec]
        drum_set = expand_kit_entry(kit.get(f["drums"], {}))
        off = sec_bar_offset.get(sec, 0)
        for p in range(nph):
            gbar = off + p * 2                     # global bar of this phrase in section
            lo, hi = gbar * 16, (gbar + 2) * 16    # 16th-cell window (16 cells/bar)
            pad_map = {}
            for st_key, notes in s["pad"].items():
                st_abs = int(st_key)
                if lo <= st_abs < hi:
                    pad_map[str(st_abs - lo)] = notes
            bass_slice = _shared_bass if _bass_single else s["bass"][lo:hi]
            phrases.append({
                "lead": s["lead"][lo:hi],
                "layer": s["layer"][lo:hi] if s["layer"] else None,
                "bass": bass_slice,
                "pad": pad_map,
                "drums": drum_set,
            })
        sec_bar_offset[sec] = off + nph * 2

    # Dedupe drum sets in first-use order so slot indices match the source track.
    unique_sets, set_idx = [], {}
    for lvl in sorted(set(int(f["drums"][3:]) for f in form)):
        entry = kit.get(f"lvl{lvl}")
        if isinstance(entry, list):
            key = tuple((bool(d.get("k")), bool(d.get("s")), bool(d.get("h"))) for d in entry[:STEPS])
            if key not in set_idx:
                set_idx[key] = len(unique_sets)
                unique_sets.append([{"k": k_, "s": s_, "h": h_} for k_, s_, h_ in key])
    for ph in phrases:
        key = tuple((d["k"], d["s"], d["h"]) for d in ph["drums"])
        if key not in set_idx:
            set_idx[key] = len(unique_sets)
            unique_sets.append(ph["drums"])

    all_bass_same = len({tuple(p["bass"]) for p in phrases}) == 1
    track = {
        "name": backbone["name"],
        "bpm": backbone["bpm"],
        "steps": STEPS,
        "drums": unique_sets,
        "drumLevels": list(backbone.get("drumLevels") or [set_idx[tuple((d["k"], d["s"], d["h"]) for d in ph["drums"])] for ph in phrases]),
        "phraseLens": [f["bars"] // 2 for f in form],
        "leads": [ph["lead"] for ph in phrases],
        "pads": [ph["pad"] for ph in phrases],
        "bass": [ph["bass"] for ph in phrases] if not all_bass_same else phrases[0]["bass"],
        "leadLayers": [ph["layer"] for ph in phrases],
        **{k: v for k, v in voices.items() if v is not None},
    }
    for k in ("genre", "vibe", "createdAt", "revision"):
        if parts.get(k) is not None:
            track[k] = parts[k]
    return track
