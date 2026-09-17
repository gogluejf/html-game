#!/usr/bin/env python3
"""music-composer: validate a composition and emit a standalone jukebox player.

Subcommands:
  compose  --game GAME --tracks TRACKS_JSON   validate + write state file
  validate --file STATE_FILE                  validate only (no write)
  player   --game GAME --out OUT_HTML         inline engine + composition into HTML

The state file lives at <working-dir>/.squid-os/music-composer/GAME.json.
Tracks use note NAMES (A4, C5) or null; every phrase array must be exactly 32 steps.
"""
import argparse, json, os, re, sys

NOTE_NAMES = set()
for _l in "C D E F G A B":
    for _o in range(1, 6):
        NOTE_NAMES.add(f"{_l}{_o}")
        # sharps exist between every pair except E->F and B->C
        if _l not in ("E", "B"):
            NOTE_NAMES.add(f"{_l}#{_o}")
# flats are the same pitches spelled down from the next natural
_FLAT_FROM = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}
for _f in _FLAT_FROM:
    for _o in range(1, 6):
        NOTE_NAMES.add(f"{_f}{_o}")

# Note token: naturals or sharps/flats (C4, C#4, Db4), optional ":N" duration.
_NOTE_TOKEN = re.compile(r"^([A-G][#b]?[1-5])(?::([1-8]))?$")

STEPS = 32


def _err(msg):
    print("VALIDATION FAIL:", msg, file=sys.stderr)
    sys.exit(1)


def is_note(v):
    if v is None or isinstance(v, (int, float)):
        return True
    if not isinstance(v, str):
        return False
    m = _NOTE_TOKEN.match(v)
    return bool(m) and m.group(1) in NOTE_NAMES


def check_phrase(arr, label):
    if not isinstance(arr, list) or len(arr) != STEPS:
        _err(f"{label}: must be exactly {STEPS} entries, got {len(arr) if isinstance(arr,list) else type(arr).__name__}")
    for i, v in enumerate(arr):
        if not is_note(v):
            _err(f"{label}[{i}]: bad note token {v!r} (use a name like 'A4' or null)")


def check_track(t, idx):
    name = t.get("name", f"track{idx}")
    # drums: 4 sets of 32 {k,s,h}
    drums = t.get("drums")
    if not isinstance(drums, list) or len(drums) != 4:
        _err(f"{name}: drums must be an array of 4 sets")
    for li, sset in enumerate(drums):
        if not isinstance(sset, list) or len(sset) != STEPS:
            _err(f"{name}: drums[{li}] must be {STEPS} entries")
        for si, d in enumerate(sset):
            if not isinstance(d, dict):
                _err(f"{name}: drums[{li}][{si}] must be {{k,s,h}}")
    # bass: single 32-step phrase OR a per-phrase bank (same length as leads).
    # A bank lets the low end PROGRESS with the chord changes (v2 feature).
    nph = len(t.get("leads") or [])
    bass = t.get("bass")
    if isinstance(bass, list) and bass and isinstance(bass[0], list):
        if len(bass) != nph:
            _err(f"{name}: bass bank length must match number of phrases ({nph})")
        for pi, p in enumerate(bass):
            check_phrase(p, f"{name}.bass[{pi}]")
    else:
        check_phrase(bass, f"{name}.bass")
    # leads bank
    leads = t.get("leads")
    if not isinstance(leads, list) or len(leads) == 0:
        _err(f"{name}: leads must be a non-empty phrase bank")
    for pi, p in enumerate(leads):
        check_phrase(p, f"{name}.leads[{pi}]")
    # pads bank (same length as leads)
    pads = t.get("pads")
    if not isinstance(pads, list) or len(pads) != len(leads):
        _err(f"{name}: pads bank length must match leads ({len(leads)})")
    for pi, p in enumerate(pads):
        if not isinstance(p, dict):
            _err(f"{name}.pads[{pi}]: must be an object mapping step->chord")
        for k, chord in p.items():
            if not str(k).isdigit():
                _err(f"{name}.pads[{pi}][{k}]: step key must be an integer index")
            if not isinstance(chord, list):
                _err(f"{name}.pads[{pi}][{k}]: chord must be an array of notes")
            for n in chord:
                if not is_note(n):
                    _err(f"{name}.pads[{pi}][{k}]: bad note {n!r}")
    # phraseLens
    pl = t.get("phraseLens", [1] * len(leads))
    if not isinstance(pl, list) or len(pl) != len(leads):
        _err(f"{name}: phraseLens length must match number of phrases ({len(leads)})")
    for i, v in enumerate(pl):
        if not isinstance(v, int) or v < 1:
            _err(f"{name}.phraseLens[{i}]: must be a positive integer (2-bar blocks)")
    # drumLevels optional (v2 dream construction): one level 0..3 per phrase.
    # Required when the track has more than 4 phrases; otherwise the engine
    # falls back to level = phrase index.
    dl = t.get("drumLevels")
    nph = len(leads)
    if nph > 4 and dl is None:
        _err(f"{name}: {nph} phrases require an explicit drumLevels array (one value 0-3 per phrase)")
    if dl is not None:
        if not isinstance(dl, list) or len(dl) != nph:
            _err(f"{name}: drumLevels length must match number of phrases ({nph})")
        for i, v in enumerate(dl):
            if v not in (0, 1, 2, 3):
                _err(f"{name}.drumLevels[{i}]: must be 0, 1, 2 or 3")
    # leadLayers optional.
    # v2 flat form: one 32-step phrase (or null) per phrase index.
    # Legacy nested form: banks indexed by level, each bank = N phrases.
    ll = t.get("leadLayers")
    if ll is not None:
        if not isinstance(ll, list):
            _err(f"{name}: leadLayers must be an array or null")
        looks_nested = any(
            b is not None and isinstance(b, list) and b
            and isinstance(b[0], list) and len(b[0]) == STEPS
            for b in ll
        )
        if looks_nested:
            # legacy: length = number of drum levels (4), each bank = N phrases
            if len(ll) != 4:
                _err(f"{name}: legacy leadLayers must have 4 level slots")
            for li, bank in enumerate(ll):
                if bank is None:
                    continue
                if not isinstance(bank, list) or len(bank) != nph:
                    _err(f"{name}.leadLayers[{li}]: bank must have {nph} phrases")
                for pi, p in enumerate(bank):
                    check_phrase(p, f"{name}.leadLayers[{li}][{pi}]")
        else:
            # v2 flat: one phrase-or-null per phrase index
            if len(ll) != nph:
                _err(f"{name}: leadLayers length must match number of phrases ({nph})")
            for pi, p in enumerate(ll):
                if p is None:
                    continue
                check_phrase(p, f"{name}.leadLayers[{pi}]")
    # bpm
    if not isinstance(t.get("bpm"), (int, float)):
        _err(f"{name}: bpm required (number)")


def validate_tracks(tracks):
    if not isinstance(tracks, list) or len(tracks) == 0:
        _err("tracks must be a non-empty JSON array")
    for i, t in enumerate(tracks):
        if not isinstance(t, dict):
            _err(f"track[{i}] must be an object")
        check_track(t, i)


def state_path(game, working_dir):
    return os.path.join(working_dir, ".squid-os", "music-composer", f"{game}.json")


def _stamp_tracks(tracks):
    """Ensure every track has createdAt (ISO local datetime) and revision (int).
    genre is left as-is (may be absent)."""
    from datetime import datetime
    now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    for t in tracks:
        if not isinstance(t, dict):
            continue
        if "createdAt" not in t or not t.get("createdAt"):
            t["createdAt"] = now
        if t.get("revision") is None:
            t["revision"] = 1


def cmd_compose(a):
    if a.tracks == "@file":
        try:
            with open(a.file) as f:
                tracks = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            _err(f"cannot read --file {a.file}: {e}")
    else:
        try:
            tracks = json.loads(a.tracks)
        except json.JSONDecodeError as e:
            _err(f"--tracks is not valid JSON: {e}")
    validate_tracks(tracks)
    _stamp_tracks(tracks)
    path = state_path(a.game, a.working_dir)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump({"game": a.game, "tracks": tracks}, f, indent=2)
    print(f"PASS: wrote {path} ({len(tracks)} tracks)")


def cmd_validate(a):
    with open(a.file) as f:
        data = json.load(f)
    tracks = data.get("tracks", data)
    validate_tracks(tracks)
    print(f"PASS: {a.file} ({len(tracks)} tracks)")


def _load_state(game, working_dir):
    path = state_path(game, working_dir)
    try:
        with open(path) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        _err(f"cannot read state {path}: {e}")
    if not isinstance(data, dict) or "tracks" not in data:
        _err(f"{path} is not a valid state file (missing 'tracks')")
    return path, data


def _save_state(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def cmd_add(a):
    """Add one track to an existing game's track list."""
    path, data = _load_state(a.game, a.working_dir)
    # Track source: inline JSON object, @file (object or array), or stdin (-).
    raw = a.track
    if raw == "-":
        raw = sys.stdin.read()
    elif raw.startswith("@"):
        fp = raw[1:]
        try:
            with open(fp) as f:
                raw = f.read()
        except OSError as e:
            _err(f"cannot read --track file {fp}: {e}")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        _err(f"--track is not valid JSON: {e}")
    new_tracks = parsed if isinstance(parsed, list) else [parsed]
    validate_tracks(new_tracks)  # reject malformed tracks before touching state
    _stamp_tracks(new_tracks)
    # Reject duplicates by name.
    existing = {t.get("name") for t in data["tracks"]}
    dupes = [t.get("name") for t in new_tracks if t.get("name") in existing]
    if dupes:
        _err(f"track(s) already present: {', '.join(dupes)}")
    data["tracks"].extend(new_tracks)
    _save_state(path, data)
    print(f"PASS: added {len(new_tracks)} -> {path} ({len(data['tracks'])} tracks)")


def cmd_remove(a):
    """Remove track(s) from an existing game by name (repeatable) or index."""
    path, data = _load_state(a.game, a.working_dir)
    names = set(a.name or [])
    idxs = set(int(x) for x in (a.index or []))
    if not names and not idxs:
        _err("provide at least one --name or --index")
    kept, removed = [], 0
    for i, t in enumerate(data["tracks"]):
        hit = (i in idxs) or (t.get("name") in names)
        if hit:
            removed += 1
        else:
            kept.append(t)
    if removed == 0:
        _err(f"no matching track(s) found (names={sorted(names)}, indices={sorted(idxs)})")
    data["tracks"] = kept
    _save_state(path, data)
    print(f"PASS: removed {removed} -> {path} ({len(kept)} tracks)")


def cmd_list(a):
    """List a game's tracks with 0-based indices, bpm, and vibe."""
    _, data = _load_state(a.game, a.working_dir)
    for i, t in enumerate(data["tracks"]):
        bpm = t.get("bpm", "")
        vibe = (t.get("vibe") or "").strip()
        genre = t.get("genre") or "?"
        rev = t.get("revision")
        rev = "?" if rev is None else str(rev)
        print(f"{i:>3}  {str(bpm) + ' BPM':>8}  [{genre}] r{rev:<2}  {t.get('name','?')}" + (f"  — {vibe}" if vibe else ""))
    print(f"({len(data['tracks'])} tracks)")


def cmd_set_vibe(a):
    """Set the vibe description on track(s) by --name and/or --index.

    The vibe is a short human phrase (10-25 words) describing the intended
    feel/style of the song. It is display metadata only (shown dimmed in the
    playlist); it does not affect playback or validation. Repeatable so several
    tracks can be tagged in one call: each --name/--index pairs with the next
    --vibe in order.
    """
    path, data = _load_state(a.game, a.working_dir)
    # Build an ordered list of (selector, vibe) pairs from parallel args.
    names = a.name or []
    idxs = [int(x) for x in (a.index or [])]
    vibes = a.vibe or []
    sel_count = len(names) + len(idxs)
    if sel_count == 0:
        _err("provide at least one --name or --index")
    if len(vibes) != sel_count:
        _err(f"--vibe count ({len(vibes)}) must match selector count ({sel_count})")
    # Map selectors to track indices.
    name_to_idx = {}
    for i, t in enumerate(data["tracks"]):
        name_to_idx.setdefault(t.get("name"), i)
    targets = []
    for nm in names:
        if nm not in name_to_idx:
            _err(f"no track named '{nm}'")
        targets.append(name_to_idx[nm])
    for ix in idxs:
        if not (0 <= ix < len(data["tracks"])):
            _err(f"index {ix} out of range (0-{len(data['tracks'])-1})")
        targets.append(ix)
    updated = 0
    for idx, vibe in zip(targets, vibes):
        data["tracks"][idx]["vibe"] = vibe.strip()
        updated += 1
    _save_state(path, data)
    print(f"PASS: set vibe on {updated} track(s) -> {path}")


def _parse_kv(pairs):
    """Parse a list of 'key=value' strings into a dict. Values are parsed as
    JSON when they look like JSON (object/array/number/bool/null), else kept
    as the raw string."""
    out = {}
    for pair in pairs or []:
        if "=" not in pair:
            _err(f"--set expects key=value, got {pair!r}")
        k, v = pair.split("=", 1)
        k = k.strip()
        s = v.strip()
        # Try JSON first; fall back to the literal string.
        try:
            out[k] = json.loads(s)
        except json.JSONDecodeError:
            out[k] = v
    return out


def cmd_edit(a):
    """Update metadata fields on track(s) by --name and/or --index, then bump
    each matched track's revision by 1. Fields come from repeatable
    --set key=value pairs (value parsed as JSON when it looks like JSON)."""
    path, data = _load_state(a.game, a.working_dir)
    names = set(a.name or [])
    idxs = set(int(x) for x in (a.index or []))
    if not names and not idxs:
        _err("provide at least one --name or --index")
    updates = _parse_kv(a.set)
    if not updates:
        _err("provide at least one --set key=value")
    edited = 0
    for i, t in enumerate(data["tracks"]):
        hit = (i in idxs) or (t.get("name") in names)
        if not hit:
            continue
        for k, v in updates.items():
            t[k] = v
        t["revision"] = int(t.get("revision", 0)) + 1
        edited += 1
    if edited == 0:
        _err(f"no matching track(s) found (names={sorted(names)}, indices={sorted(idxs)})")
    _save_state(path, data)
    print(f"PASS: edited {edited} track(s) -> {path}")


PLAYER_TMPL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MUSIC FOR __GAME__</title>
<style>
  :root{--bg:#05070f;--panel:#0d1220;--border:#2a4060;--cyan:#3ef0ff;--gold:#ffe23e;--dim:#7a8ab0;--text:#e0ecff;}
  *{box-sizing:border-box;}
  html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font-family:'Courier New',monospace;overflow-x:hidden;}
  #wrap{display:flex;flex-direction:column;align-items:center;padding:0 20px 130px;gap:0;min-height:100vh;}
  #header{position:sticky;top:0;z-index:50;width:100%;max-width:728px;display:flex;flex-direction:column;align-items:center;gap:14px;padding:28px 0 18px;background:linear-gradient(to bottom,var(--bg) 70%,rgba(5,7,15,0));}
  #title{font-size:42px;font-weight:bold;letter-spacing:6px;color:var(--cyan);text-shadow:0 0 24px var(--cyan);margin:0;text-transform:uppercase;}
  #sub{font-size:14px;color:var(--dim);letter-spacing:4px;margin-top:-12px;}
  #now{font-size:28px;color:var(--gold);min-height:36px;text-shadow:0 0 14px var(--gold);font-weight:bold;text-align:center;}
  #list{display:flex;flex-direction:column;gap:6px;min-width:340px;max-width:728px;width:100%;}
  #list .row{display:grid;grid-template-columns:28px minmax(0,1fr) auto 64px 24px;column-gap:12px;align-items:center;padding:9px 16px 28px;border:2px solid var(--border);border-radius:8px;cursor:pointer;color:#a0b4d8;transition:all .12s;user-select:none;background:var(--panel);}
  #list .row:hover{border-color:var(--cyan);background:#142030;}
  #list .row.on{border-color:var(--gold);background:rgba(255,226,62,.1);box-shadow:0 0 16px rgba(255,226,62,.25);}
  #list .row .num{grid-column:1;font-size:15px;font-weight:bold;color:var(--dim);font-variant-numeric:tabular-nums;align-self:center;}
  #list .row.on .num{color:var(--gold);}
  #list .row .nm{grid-column:2;font-size:22px;color:#a0b4d8;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  #list .row.on .nm{color:#fff;}
  #list .row .chips{grid-column:3;display:flex;flex-direction:row;gap:10px;align-items:center;justify-content:flex-end;align-self:center;}
  #list .row .chip{font-size:11px;font-weight:bold;letter-spacing:.5px;padding:2px 8px;border-radius:999px;white-space:nowrap;}
  #list .row .chip.genre{color:var(--gold);background:rgba(255,226,62,.1);border:1px solid rgba(255,226,62,.35);}
  #list .row .bpm{grid-column:4;justify-self:end;font-size:13px;font-weight:normal;color:var(--cyan);opacity:.75;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right;}
  #list .row .fav{grid-column:5;align-self:start;margin-top:2px;cursor:pointer;color:var(--dim);display:flex;align-items:center;transition:transform .12s,color .12s;padding:2px;}
  #list .row .fav:hover{color:#ff8fa5;transform:scale(1.2);}
  #list .row .fav svg{width:16px;height:16px;display:block;}
  #list .row .fav.on{color:#ff3b5c;}
  #list .row .fav.on svg{filter:drop-shadow(0 0 4px rgba(255,59,92,.6));}
  /* Transport bar */
  #transport{position:fixed;bottom:0;left:0;right:0;z-index:100;background:linear-gradient(to top,#080c18 0%,#0d1220 100%);border-top:2px solid var(--border);padding:14px 24px 18px;display:flex;align-items:center;gap:14px;user-select:none;box-shadow:0 -4px 40px rgba(0,0,0,.6);}
  .tbtn{width:42px;height:42px;border:2px solid #4a6a90;border-radius:8px;background:#152030;color:#e0ecff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;}
  .tbtn:hover{border-color:var(--cyan);color:#fff;background:#1e3050;transform:scale(1.08);}
  .tbtn:active{transform:scale(.93);}
  .tbtn svg{width:20px;height:20px;fill:currentColor;pointer-events:none;}
  .tbtn.play-btn{width:50px;height:50px;border-color:var(--cyan);color:var(--cyan);background:#0d1825;box-shadow:0 0 14px rgba(62,240,255,.25);}
  .tbtn.play-btn:hover{box-shadow:0 0 24px rgba(62,240,255,.45);background:#152535;}
  .tbtn.play-btn.paused{border-color:var(--gold);color:var(--gold);box-shadow:0 0 14px rgba(255,226,62,.25);}
  /* Timeline */
  #tl-wrap{flex:1;display:flex;flex-direction:column;gap:4px;min-width:0;}
  #phrase-labels{display:flex;gap:1px;font-size:10px;color:var(--dim);letter-spacing:.5px;text-transform:uppercase;font-weight:bold;}
  #phrase-labels span{flex:1;text-align:center;overflow:hidden;white-space:nowrap;}
  #timeline{position:relative;height:34px;background:var(--panel);border:2px solid var(--border);border-radius:8px;cursor:pointer;overflow:hidden;transition:border-color .15s;}
  #timeline:hover{border-color:rgba(62,240,255,.5);}
  #tl-progress{position:absolute;top:0;left:0;height:100%;background:linear-gradient(90deg,rgba(62,240,255,.1),rgba(62,240,255,.22));pointer-events:none;border-right:2px solid rgba(62,240,255,.4);}
  #tl-dividers{position:absolute;top:0;left:0;right:0;height:100%;display:flex;pointer-events:none;}
  #tl-dividers .div{flex:1;border-right:1px solid rgba(62,240,255,.18);}
  #tl-dividers .div:last-child{border-right:none;}
  #tl-dot{position:absolute;top:50%;left:0;width:16px;height:16px;border-radius:50%;background:var(--gold);box-shadow:0 0 12px rgba(255,226,62,.8),0 0 4px rgba(255,226,62,1);transform:translate(-50%,-50%);cursor:grab;z-index:2;transition:box-shadow .1s,width .1s,height .1s;}
  #tl-dot:hover{width:22px;height:22px;box-shadow:0 0 20px rgba(255,226,62,1),0 0 8px rgba(255,226,62,1);}
  #tl-dot:active{cursor:grabbing;}
  #tl-head{display:flex;align-items:baseline;gap:22px;min-width:0;}
  #tl-time{font-size:13px;color:#a0b4d8;flex-shrink:0;font-variant-numeric:tabular-nums;font-weight:bold;white-space:nowrap;}
  #tl-title{font-size:14px;color:var(--gold);font-weight:bold;letter-spacing:.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 0 8px rgba(255,226,62,.3);line-height:1.2;min-width:0;}
  #log-ind{position:fixed;top:12px;right:16px;z-index:200;font-size:12px;font-weight:bold;letter-spacing:1px;padding:6px 12px;border-radius:6px;background:#1a0d0d;border:2px solid #ff4444;color:#ff6666;display:none;box-shadow:0 0 12px rgba(255,68,68,.4);}
  #log-ind.on{display:block;}
  /* Mode toggles */
  #modes-t{display:flex;gap:6px;flex-shrink:0;}
  #modes-t .mode{font-size:12px;font-weight:bold;letter-spacing:1.5px;padding:7px 14px;border:2px solid #4a6a90;border-radius:6px;cursor:pointer;color:#a0b4d8;transition:all .15s;user-select:none;background:#152030;}
  #modes-t .mode:hover{border-color:var(--cyan);color:#fff;background:#1e3050;}
  #modes-t .mode.on{border-color:var(--cyan);color:#fff;background:rgba(62,240,255,.15);box-shadow:0 0 12px rgba(62,240,255,.3);}
  /* Side info panel (now-playing details) */
  #wrap{flex-direction:row;align-items:flex-start;justify-content:center;gap:32px;}
  #main-col{display:flex;flex-direction:column;align-items:center;width:100%;max-width:728px;}
  #side-panel{width:340px;flex-shrink:0;background:var(--panel);border:2px solid var(--border);border-radius:12px;padding:22px;display:flex;flex-direction:column;gap:14px;position:sticky;top:150px;box-shadow:0 8px 40px rgba(0,0,0,.5);}
  #side-panel.hidden{display:none;}
  #sp-art{width:100%;aspect-ratio:1/1;border-radius:10px;background:radial-gradient(circle at 50% 40%,#1a2740,#0a0f1c);display:flex;align-items:center;justify-content:center;font-size:64px;color:var(--cyan);text-shadow:0 0 24px var(--cyan);border:2px solid var(--border);}
  #sp-title{font-size:24px;font-weight:bold;color:#fff;line-height:1.2;text-shadow:0 0 12px rgba(62,240,255,.3);}
  #sp-badges{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
  #sp-genre{font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:var(--gold);background:rgba(255,226,62,.12);border:1px solid rgba(255,226,62,.4);padding:4px 10px;border-radius:999px;}
  #sp-bpm{font-size:12px;font-weight:bold;color:var(--cyan);background:rgba(62,240,255,.1);border:1px solid rgba(62,240,255,.35);padding:4px 10px;border-radius:999px;font-variant-numeric:tabular-nums;}
  #sp-fav{cursor:pointer;color:var(--dim);display:flex;align-items:center;margin-left:auto;transition:transform .12s,color .12s;padding:4px;}
  #sp-fav:hover{color:#ff8fa5;transform:scale(1.15);}
  #sp-fav svg{width:22px;height:22px;display:block;}
  #sp-fav.on{color:#ff3b5c;}
  #sp-fav.on svg{filter:drop-shadow(0 0 5px rgba(255,59,92,.7));}
  #sp-meta{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dim);}
  #sp-meta .k{color:var(--dim);letter-spacing:1px;text-transform:uppercase;font-size:10px;margin-right:6px;}
  #sp-meta .v{color:#a0b4d8;font-variant-numeric:tabular-nums;}
  #sp-vibe-label{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--dim);margin-top:4px;}
  #sp-vibe{font-size:13px;color:#a0b4d8;line-height:1.5;font-style:italic;}
  /* Side-panel transport (under the card) */
  #sp-transport{display:flex;flex-direction:column;gap:14px;margin-top:6px;padding-top:16px;border-top:2px solid var(--border);}
  #sp-tl-head{display:flex;justify-content:space-between;font-size:12px;color:#a0b4d8;font-variant-numeric:tabular-nums;font-weight:bold;}
  #sp-timeline{position:relative;height:6px;background:var(--panel);border:1px solid var(--border);border-radius:999px;cursor:pointer;overflow:visible;}
  #sp-tl-progress{position:absolute;top:0;left:0;height:100%;background:rgba(62,240,255,.35);border-radius:999px;pointer-events:none;}
  #sp-tl-dot{position:absolute;top:50%;left:0;width:14px;height:14px;border-radius:50%;background:var(--gold);box-shadow:0 0 10px rgba(255,226,62,.8);transform:translate(-50%,-50%);cursor:grab;z-index:2;transition:width .1s,height .1s;}
  #sp-tl-dot:hover{width:18px;height:18px;}
  #sp-tl-dot:active{cursor:grabbing;}
  #sp-btns{display:flex;align-items:center;justify-content:center;gap:18px;}
  #sp-btns .tbtn{width:56px;height:56px;border-radius:12px;}
  #sp-btns .tbtn svg{width:26px;height:26px;}
  #sp-btns .play-btn{width:72px;height:72px;border-color:var(--cyan);box-shadow:0 0 16px rgba(62,240,255,.25);}
  #sp-btns .play-btn svg{width:32px;height:32px;}
  @media (max-width:820px){
    #wrap{flex-direction:column;align-items:center;}
    #side-panel{position:static;width:100%;max-width:560px;}
  }
</style>
</head>
<body>
<div id="log-ind">● LOGGING — press L to save</div>
<div id="wrap">
  <div id="main-col">
    <div id="header">
      <h1 id="title">Music for __GAME__</h1><div id="sub">JUKEBOX</div>
      <div id="now">&nbsp;</div>
    </div>
    <div id="list"></div>
  </div>
  <aside id="side-panel" class="hidden">
    <div id="sp-art">&#9834;</div>
    <div id="sp-title">&ndash;</div>
    <div id="sp-badges">
      <span id="sp-genre">&ndash;</span>
      <span id="sp-bpm">&ndash;</span>
      <span id="sp-fav" title="Favorite"></span>
    </div>
    <div id="sp-meta">
      <div><span class="k">Created</span><span class="v" id="sp-created">&ndash;</span></div>
      <div><span class="k">Revision</span><span class="v" id="sp-revision">&ndash;</span></div>
    </div>
    <div id="sp-vibe-label">Vibe</div>
    <div id="sp-vibe">&ndash;</div>
    <div id="sp-transport">
      <div id="sp-tl-head"><span id="sp-time-cur">0:00</span><span id="sp-time-dur">0:00</span></div>
      <div id="sp-timeline"><div id="sp-tl-progress"></div><div id="sp-tl-dot"></div></div>
      <div id="sp-btns">
        <button class="tbtn" id="sp-prev" title="Restart / previous"><svg viewBox="0 0 24 24"><polygon points="15 4 5 12 15 20 15 4"></polygon><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"></line></svg></button>
        <button class="tbtn play-btn" id="sp-play" title="Play/Pause"><svg viewBox="0 0 24 24" id="sp-play-icon"><polygon points="7 4 20 12 7 20 7 4"></polygon></svg></button>
        <button class="tbtn" id="sp-next" title="Next song"><svg viewBox="0 0 24 24"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="5" y1="5" x2="5" y2="19" stroke="currentColor" stroke-width="2"></line></svg></button>
      </div>
    </div>
  </aside>
</div>
<div id="transport">
  <button class="tbtn" id="tb-prev" title="Restart song / double-click for previous"><svg viewBox="0 0 24 24"><polygon points="15 4 5 12 15 20 15 4"></polygon><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"></line></svg></button>
  <button class="tbtn play-btn" id="tb-play" title="Play/Pause (Space)"><svg viewBox="0 0 24 24" id="play-icon"><polygon points="7 4 20 12 7 20 7 4"></polygon></svg></button>
  <button class="tbtn" id="tb-next" title="Next song"><svg viewBox="0 0 24 24"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="5" y1="5" x2="5" y2="19" stroke="currentColor" stroke-width="2"></line></svg></button>
  <div id="tl-wrap">
    <div id="tl-head"><span id="tl-title"></span><span id="tl-time">0:00 / 0:00</span></div>
    <div id="phrase-labels"></div>
    <div id="timeline"><div id="tl-progress"></div><div id="tl-dividers"></div><div id="tl-dot"></div></div>
  </div>
  <div id="modes-t">
    <div class="mode" id="mt-seq" title="Sequence (S)"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;display:inline;vertical-align:-2px;margin-right:4px;"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"></line></svg>SEQ</div>
    <div class="mode" id="mt-rep" title="Repeat (R)"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;display:inline;vertical-align:-2px;margin-right:4px;"><polyline points="17 2 21 6 17 10"></polyline><path d="M3 12v-2a4 4 0 0 1 4-4h14"></path><polyline points="7 22 3 18 7 14"></polyline><path d="M21 12v2a4 4 0 0 1-4 4H3"></path></svg>REP</div>
    <div class="mode" id="mt-shf" title="Shuffle (H)"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;display:inline;vertical-align:-2px;margin-right:4px;"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>SHF</div>
  </div>
</div>
<script>
__ENGINE__
</script>
<script>
const TRACKS=__TRACKS__;

/* ── SongController: single source of truth for playback state ─────────── */
class SongController {
  constructor(tracks) {
    this.tracks = tracks;
    this.player = null;
    this.current = 0;
    this.playing = false;
    this.muted = false;
    this.seq = false;
    this.rep = false;
    this.shf = false;
    this.onTrackChange = null;
    this.onPlayStateChange = null;
    this._neverStarted = true;
    // Single source of truth for "user manually placed the dot while NOT playing".
    // Set by seek()/select() while paused/stopped; cleared on play(). The render
    // loop honors it instead of clobbering the dot with live engine position.
    this._manualPos = null;
    // -- favorites (track indices), persisted to localStorage --
    // Must be initialized BEFORE _loadPrefs() so the saved favs aren't wiped.
    this.favorites = [];
    this._loadPrefs();
    // -- always-on action log --
    this._actionLog = [];
  }

  /** Log a user action with full state snapshot. Always on. */
  _logAction(action) {
    const t = (performance.now() / 1000).toFixed(3);
    const pos = this.position().toFixed(4);
    const eng = this.player ? ('bar=' + this.player.seq.barCount + '/step=' + this.player.seq.stepIndex) : 'noEngine';
    const line = t + ' | ' + action + ' | track=' + (this.current+1) + ' "' + this.tracks[this.current].name + '" | playing=' + this.playing + ' | pos=' + pos + ' | manualPos=' + this._manualPos + ' | ' + eng;
    this._actionLog.push(line);
    if (this._actionLog.length > 2000) this._actionLog.splice(0, 500);
    console.log('[jukebox] ' + line);
  }

  exportLog() {
    const NL = String.fromCharCode(10);
    const text = this._actionLog.join(NL);
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'jukebox-actions-' + Date.now() + '.log';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  _loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('jukebox-prefs') || '{}');
      this.seq = !!p.seq; this.rep = !!p.rep; this.shf = !!p.shf;
      if (Array.isArray(p.favs)) this.favorites = p.favs.slice();
    } catch (e) {}
  }
  _savePrefs() {
    try { localStorage.setItem('jukebox-prefs', JSON.stringify({ seq: this.seq, rep: this.rep, shf: this.shf, favs: this.favorites })); } catch (e) {}
  }

  isFav(i) { return this.favorites.indexOf(i) !== -1; }
  toggleFav(i) {
    const at = this.favorites.indexOf(i);
    if (at === -1) this.favorites.push(i); else this.favorites.splice(at, 1);
    this._savePrefs();
    // Update just the heart in place (no full re-render, keeps hover state).
    const el = document.querySelector('#list .row[data-i="' + i + '"] .fav');
    if (el) { el.classList.toggle('on', this.isFav(i)); el.innerHTML = this._heartSVG(this.isFav(i)); }
    // Keep the side-panel heart in sync if this is the currently-shown track.
    if (typeof window.__syncSpFav === 'function') window.__syncSpFav();
    return this.isFav(i);
  }
  _heartSVG(on) {
    return '<svg viewBox="0 0 24 24" ' + (on ? 'fill="#ff3b5c" stroke="#ff3b5c"' : 'fill="none" stroke="currentColor"') + ' stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  }

  init() {
    if (this.player) return;
    this.player = new MusicEngine.Player({ tracks: this.tracks });
    const seq = this.player.seq;
    seq._origStart = seq.start.bind(seq);
    seq._origStop = seq.stop.bind(seq);
    seq.next = () => this._onSongEnd();
    seq.shuffleNext = () => this._onSongEnd();
    this.player.seq.tracks.forEach(t => { t.autoNext = true; });
  }

  _onSongEnd() {
    this._logAction('SONG_END');
    if (this.shf) {
      let i; do { i = Math.floor(Math.random() * this.tracks.length); } while (i === this.current && this.tracks.length > 1);
      this._playSeamless(i);
    } else if (this.rep && !this.seq) {
      this._playSeamless(this.current);   // repeat ONE: loop same song, no clock reset
    } else if (this.seq) {
      const nx = this.current + 1;
      if (nx >= this.tracks.length) {
        if (this.rep) this._playSeamless(0);
        else this.stop();
      } else {
        this._playSeamless(nx);
      }
    } else {
      this.stop();
    }
  }

  /** Song-to-song transition that stays on the beat grid. If we're already
   *  playing, use the engine's seamless restart (counters reset, scheduler and
   *  nextNoteTime untouched) so there's no off-grid "now+0.06" jump. If we're
   *  not playing (e.g. first start after a stop), fall back to a full play(). */
  _playSeamless(i) {
    if (this.player && this.playing && typeof this.player.seq._loopRestart === 'function') {
      this._logAction('PLAY #' + (i+1) + ' (seamless)');
      this.current = i;
      this._manualPos = null;
      this.player.seq._loopRestart(i);
      if (this.onTrackChange) this.onTrackChange(i);
      return;
    }
    this.play(i);
  }

  play(i) {
    this.init();
    this._logAction('PLAY #' + (i+1));
    if (this.player.ctx.state === 'suspended') this.player.ctx.resume();
    const wasCurrent = (i === this.current);
    this.current = i;
    // A manual dot placement only applies to the song it was set on. If we're
    // starting a different song, drop it so the new track starts at 0.
    if (!wasCurrent) this._manualPos = null;
    this.player.start(i);
    this.playing = true;
    this._neverStarted = false;
    // If the user placed the dot while paused/stopped, start FROM that position.
    if (this._manualPos !== null && this._manualPos > 0) {
      this.seek(this._manualPos);
    }
    this._manualPos = null;
    if (this.onTrackChange) this.onTrackChange(i);
    if (this.onPlayStateChange) this.onPlayStateChange(true);
  }

  stop() {
    if (!this.player) return;
    this.player.stop();
    this.playing = false;
    // Engine position is now meaningless (barCount/stepIndex are stale); the
    // dot should sit at 0. Clear any manual placement so we don't show a
    // leftover drag position after a full stop.
    this._manualPos = null;
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  }

  pause() {
    if (!this.player || !this.playing) return;
    this._logAction('PAUSE');
    this.player.pause();
    this.playing = false;
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  }

  resume() {
    if (!this.player || this.playing) return;
    this._logAction('RESUME');
    // If a manual dot position was set while paused, seek there first, then clear it
    if (this._manualPos !== null && this._manualPos > 0) {
      const frac = this._manualPos;
      this._manualPos = null;   // clear BEFORE seek so seek() takes the playing branch
      this.player.resume();
      this.playing = true;
      this.seek(frac);
    } else {
      this._manualPos = null;
      this.player.resume();
      this.playing = true;
    }
    if (this.onPlayStateChange) this.onPlayStateChange(true);
  }

  togglePause() {
    if (this.playing) { this.pause(); return; }
    // If we've never started anything (fresh page), start track 0
    if (!this.player || this._neverStarted) { this.play(0); return; }
    this.resume();
  }

  next() {
    this._logAction('NEXT');
    const n = this.tracks.length;
    if (this.playing) {
      // Playing → jump to and play the next song, dot at 0.
      this._manualPos = null;
      this.play((this.current + 1) % n);
    } else {
      // Paused/stopped → just select the next song (dot at 0), stay stopped.
      this.select((this.current + 1) % n);
    }
  }

  prev() {
    const n = this.tracks.length;
    if (this.playing) {
      this._manualPos = null;
      this.play((this.current - 1 + n) % n);
    } else {
      this.select((this.current - 1 + n) % n);
    }
  }

  /** Restart the CURRENT song from position 0, preserving play/pause state. */
  restart() {
    if (this.playing) {
      this._manualPos = null;
      this.play(this.current);
    } else {
      this.select(this.current);
    }
  }

  /** Media-player prev: if within first 1s of current song → previous song,
   *  otherwise restart current song at 0. Preserves play/pause state. */
  prevSmart() {
    this._logAction('PREV pos=' + this.position().toFixed(3));
    const nearStart = this.position() < (1.0 / Math.max(1, this.duration()));
    if (nearStart) {
      // Previous song at 0, keep state
      const n = this.tracks.length;
      if (this.playing) {
        this._manualPos = null;
        this.play((this.current - 1 + n) % n);
      } else {
        this.select((this.current - 1 + n) % n);
      }
    } else {
      // Restart current song at 0, keep state
      this.restart();
    }
  }

  /** Select a song WITHOUT playing it: highlight, dot to 0, no audio. */
  select(i) {
    this.init();
    this.current = i;
    // Tell the ENGINE to load this track (without starting audio), so a later
    // resume() plays the correct song instead of the stale one.
    this.player.setTrack(i);
    this._manualPos = 0;   // dot explicitly at zero
    this._logAction('SELECT #' + (i+1));
    if (this.onTrackChange) this.onTrackChange(i);
  }

  /** Seek to fraction 0..1. Uses engine.seekToStep() while playing; while
   *  paused/stopped it records a manual position so play() can start from it. */
  seek(frac) {
    frac = Math.max(0, Math.min(1, frac));
    this._logAction('SEEK ' + frac.toFixed(3) + (this.playing ? '' : ' (paused->manual)'));
    if (!this.playing) {
      this._manualPos = frac;
      return;
    }
    if (!this.player) return;
    const trk = this.player.seq.tracks[this.current];
    if (!trk) return;
    const pl = trk.phraseLens || [1,1,1,1,1,1,1,1];
    const totalSteps = pl.reduce((s, l) => s + 32 * l, 0);
    const targetStep = Math.floor(frac * totalSteps);
    this.player.seekToStep(targetStep);
  }

  /**
   * Current position as fraction 0..1.
   * Reads the ENGINE'S ACTUAL stepIndex + barCount so it stays in sync
   * with real audio playback (including pause/seek/loop).
   */
  position() {
    // If the user manually placed the dot while not playing, report that.
    if (this._manualPos !== null) return this._manualPos;
    if (!this.player) return 0;
    const seq = this.player.seq;
    const trk = seq.tracks[this.current];
    if (!trk) return 0;
    const pl = trk.phraseLens || [1,1,1,1,1,1,1,1];
    const totalSteps = pl.reduce((s, l) => s + 32 * l, 0);
    // Absolute step = barCount full blocks of 32 + current stepIndex within block
    const absStep = (seq.barCount || 0) * 32 + (seq.stepIndex || 0);
    // barCount wraps via modulo in the engine? No — it increments forever.
    // But the song loops when barCount hits totalBlocks. We need position
    // within ONE song cycle:
    const totalBlocks = pl.reduce((a, b) => a + b, 0);
    const cycleBlock = (seq.barCount || 0) % totalBlocks;
    const pos = (cycleBlock * 32 + (seq.stepIndex || 0)) / totalSteps;
    return Math.max(0, Math.min(1, pos));
  }

  duration() {
    const trk = this.player ? this.player.seq.tracks[this.current] : this.tracks[this.current];
    if (!trk) return 0;
    const pl = trk.phraseLens || [1,1,1,1,1,1,1,1];
    const totalSteps = pl.reduce((s, l) => s + 32 * l, 0);
    return totalSteps * (60 / trk.bpm) / 4;
  }

  name() {
    return this.tracks[this.current].name;
  }

  setMode(which) {
    if (which === 'seq') { this.seq = !this.seq; if (this.seq) this.shf = false; }
    else if (which === 'rep') { this.rep = !this.rep; if (this.rep) this.shf = false; }
    else { this.shf = !this.shf; if (this.shf) { this.seq = false; this.rep = false; } }
    this._savePrefs();
  }

  toggleMute() {
    this.init();
    this.muted = this.player.toggleMute();
  }

  /* -- debug logging -- */
  enableLog() { this.init(); this.player.seq.enableLog(); }
  disableLog() { if (this.player) this.player.seq.disableLog(); }
  downloadLog() {
    if (!this.player) return;
    const text = this.player.seq.flushLog();
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'jukebox-ticks-' + Date.now() + '.log';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  toggleLog() {
    // Always-on logs: L exports BOTH the controller action log (PLAY/PAUSE/NEXT/
    // SEEK/SELECT...) AND the engine tick log (TICK step/bar/t, START, LOOP) so a
    // song-end loop glitch can be traced tick-by-tick.
    const NL = String.fromCharCode(10);
    let text = '===== ACTION LOG =====' + NL + this._actionLog.join(NL);
    if (this.player && this.player.seq && typeof this.player.seq.flushLog === 'function') {
      text += NL + NL + '===== ENGINE TICK LOG =====' + NL + this.player.seq.flushLog();
    }
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'jukebox-log-' + Date.now() + '.log';
    a.click();
    URL.revokeObjectURL(a.href);
    console.log('[jukebox] full log exported (actions + engine ticks)');
  }
}

/* ── UI wiring ──────────────────────────────────────────────────────────── */
const sc = new SongController(TRACKS);
const nowEl = document.getElementById('now');
const listEl = document.getElementById('list');
const tbPrev = document.getElementById('tb-prev');
const tbPlay = document.getElementById('tb-play');
const tbNext = document.getElementById('tb-next');
const tlEl = document.getElementById('timeline');
const tlProg = document.getElementById('tl-progress');
const tlDot = document.getElementById('tl-dot');
const tlTime = document.getElementById('tl-time');
const mtSeq = document.getElementById('mt-seq');
const mtRep = document.getElementById('mt-rep');
const mtShf = document.getElementById('mt-shf');
const playIcon = document.getElementById('play-icon');
const tlTitle = document.getElementById('tl-title');
const sidePanel = document.getElementById('side-panel');
const spTitle = document.getElementById('sp-title');
const spGenre = document.getElementById('sp-genre');
const spBpm = document.getElementById('sp-bpm');
const spFav = document.getElementById('sp-fav');
const spCreated = document.getElementById('sp-created');
const spRevision = document.getElementById('sp-revision');
const spVibe = document.getElementById('sp-vibe');

// Format an ISO datetime (e.g. 2026-09-17T06:19:54) as "Sep 17, 2026 · 6:19 AM".
function fmtDate(iso) {
  if (!iso) return '\u2013';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return mon + ' ' + d.getDate() + ', ' + d.getFullYear() + ' \u00b7 ' + h + ':' + m + ' ' + ampm;
}

// Per-genre color palette so each style gets its own hue in the list + panel.
// Normalizes the genre string, then matches against known styles; falls back to
// a hash-based pick from the palette so unseen genres still get a stable color.
const GENRE_COLORS = [
  ['#ff5d5d', 'rgba(255,93,93,.14)'],   // red
  ['#ffa040', 'rgba(255,160,64,.14)'],  // orange
  ['#ffe23e', 'rgba(255,226,62,.14)'],  // gold
  ['#a8e05f', 'rgba(168,224,95,.14)'],  // lime
  ['#5fe08a', 'rgba(95,224,138,.14)'],  // green
  ['#3ef0c8', 'rgba(62,240,200,.14)'],  // teal
  ['#3ef0ff', 'rgba(62,240,255,.14)'],  // cyan
  ['#5aa8ff', 'rgba(90,168,255,.14)'],  // blue
  ['#8a7bff', 'rgba(138,123,255,.14)'], // indigo
  ['#c86bff', 'rgba(200,107,255,.14)'], // purple
  ['#ff6bd6', 'rgba(255,107,214,.14)'],// pink
  ['#ff8fb0', 'rgba(255,143,176,.14)'] // rose
];
// Explicit keyword -> palette index for the common styles we actually use.
const GENRE_KEYWORDS = {
  metal:0, thrash:0, punk:1, 'speed punk':1, 'punk metal':1, speed:0,
  trance:6, techno:6, dubstep:9, industrial:9, breakbeat:7, electro:7,
  jazz:2, 'acid jazz':2, fusion:2, bossa:4, reggae:4, funk:3, soul:3,
  chiptune:5, 'drum and bass':5, '8-bit':5, march:8, anthem:8, dirge:11,
  gothic:11, darkwave:10, ambient:10, horror:11, baroque:8, celtic:4,
  folk:4, psych:10, psychedelic:10, disco:2, house:6, tropical:6,
  neoclassical:7, lofi:3, 'lo-fi':3, hip:3, waltz:11
};
function genreColor(genre) {
  if (!genre) return null;
  const g = String(genre).toLowerCase();
  // Exact keyword hit first.
  if (GENRE_KEYWORDS[g] != null) return GENRE_COLORS[GENRE_KEYWORDS[g]];
  // Then substring match (longest keyword wins).
  let best = -1, bestLen = 0;
  for (const k in GENRE_KEYWORDS) {
    if (g.indexOf(k) !== -1 && k.length > bestLen) { best = GENRE_KEYWORDS[k]; bestLen = k.length; }
  }
  if (best >= 0) return GENRE_COLORS[best];
  // Fallback: stable hash into the palette.
  let h = 0; for (let i = 0; i < g.length; i++) h = (h * 31 + g.charCodeAt(i)) >>> 0;
  return GENRE_COLORS[h % GENRE_COLORS.length];
}

function renderSidePanel() {
  const t = sc.tracks[sc.current];
  if (!t) { sidePanel.classList.add('hidden'); return; }
  sidePanel.classList.remove('hidden');
  spTitle.textContent = t.name || '\u2013';
  spGenre.textContent = t.genre || '\u2013';
  const gc = genreColor(t.genre);
  if (gc) { spGenre.style.color = gc[0]; spGenre.style.background = gc[1]; spGenre.style.borderColor = gc[0] + '66'; }
  else { spGenre.style.color = ''; spGenre.style.background = ''; spGenre.style.borderColor = ''; }
  spBpm.textContent = (t.bpm != null ? t.bpm + ' BPM' : '\u2013');
  const fav = sc.isFav(sc.current);
  spFav.classList.toggle('on', fav);
  spFav.innerHTML = sc._heartSVG(fav);
  spFav.title = fav ? 'Unfavorite' : 'Favorite';
  spCreated.textContent = fmtDate(t.createdAt);
  spRevision.textContent = (t.revision != null ? 'r' + t.revision : '\u2013');
  spVibe.textContent = (t.vibe && String(t.vibe).trim()) ? t.vibe : '\u2013';
}

// Refresh only the side-panel heart (used by toggleFav so list + panel stay in sync).
window.__syncSpFav = function() {
  const fav = sc.isFav(sc.current);
  spFav.classList.toggle('on', fav);
  spFav.innerHTML = sc._heartSVG(fav);
  spFav.title = fav ? 'Unfavorite' : 'Favorite';
};
spFav.addEventListener('click', () => { sc.toggleFav(sc.current); });

// Track change → update list highlight + now-playing label + side panel
sc.onTrackChange = (i) => {
  const names = sc.tracks.map(t => t.name);
  nowEl.textContent = '\u25cf NOW PLAYING: ' + (i+1) + ' ' + names[i];
  tlTitle.textContent = (i+1) + '. ' + names[i];
  renderList();
  renderSidePanel();
};
sc.onPlayStateChange = (playing) => {
  if (!playing && sc._startTime === null) {
    nowEl.textContent = '\u23f8 PAUSED';
  }
};

let _listTimer = null, _listCount = 0, _listIdx = 0;
function renderList() {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  listEl.innerHTML = sc.tracks.map((t, i) => {
    const gc = genreColor(t.genre);
    const genreStyle = gc ? 'style="color:' + gc[0] + ';background:' + gc[1] + ';border-color:' + gc[0] + '55"' : '';
    const fav = sc.isFav(i);
    return '<div class="row ' + (i === sc.current ? 'on' : '') + '" data-i="' + i + '">' +
      '<span class="num">' + (i+1) + '</span>' +
      '<span class="nm" title="' + esc(t.name) + '">' + esc(t.name) + '</span>' +
      '<span class="chips">' +
        (t.genre ? '<span class="chip genre" ' + genreStyle + '>' + esc(t.genre) + '</span>' : '') +
      '</span>' +
      (t.bpm != null ? '<span class="bpm">' + t.bpm + ' BPM</span>' : '') +
      '<span class="fav' + (fav ? ' on' : '') + '" title="' + (fav ? 'Unfavorite' : 'Favorite') + '">' + sc._heartSVG(fav) + '</span>' +
    '</div>';
  }).join('');
  listEl.querySelectorAll('.row').forEach(el => {
    el.addEventListener('click', () => {
      const i = parseInt(el.dataset.i, 10);
      _listIdx = i;
      // Already playing → single click switches song immediately.
      if (sc.playing) { sc.play(i); return; }
      // Not playing → single click selects (highlight, dot to 0), double plays.
      _listCount++;
      if (_listCount === 1) {
        sc.select(i);
        nowEl.textContent = '\u25cb SELECTED: ' + (i+1) + ' ' + sc.tracks[i].name;
        _listTimer = setTimeout(() => { _listCount = 0; }, 400);
      } else if (_listCount >= 2) {
        clearTimeout(_listTimer);
        _listCount = 0;
        sc.play(i);
      }
    });
    // Heart toggles favorite without triggering play/select.
    const favEl = el.querySelector('.fav');
    if (favEl) favEl.addEventListener('click', (e) => {
      e.stopPropagation();
      sc.toggleFav(parseInt(el.dataset.i, 10));
    });
  });
}

// Prev button: single=restart current, double=previous song (1s grace).
// Shared with the Left-arrow key so both behave identically.
function onPrevClick() {
  sc.prevSmart();
}
tbPrev.addEventListener('click', e => { onPrevClick(); e.currentTarget.blur(); });
tbPlay.addEventListener('click', e => { sc.togglePause(); e.currentTarget.blur(); });
tbNext.addEventListener('click', e => { sc.next(); e.currentTarget.blur(); });
mtSeq.addEventListener('click', e => { sc.setMode('seq'); syncModes(); e.currentTarget.blur(); });
mtRep.addEventListener('click', e => { sc.setMode('rep'); syncModes(); e.currentTarget.blur(); });
mtShf.addEventListener('click', e => { sc.setMode('shf'); syncModes(); e.currentTarget.blur(); });

function syncModes() {
  mtSeq.classList.toggle('on', sc.seq);
  mtRep.classList.toggle('on', sc.rep);
  mtShf.classList.toggle('on', sc.shf);
}

// Keyboard (mirrors the transport buttons exactly)
window.addEventListener('keydown', e => {
  // If a transport button still has focus, let the browser's native Space/Enter
  // activation handle it — otherwise we'd double-toggle. (blur() on click above
  // normally prevents this; this is a safety net.)
  const btnFocused = document.activeElement && document.activeElement.tagName === 'BUTTON';
  if (e.code === 'Space' || e.code === 'Enter') {
    if (btnFocused) return;   // native button activation will fire the same action
    if (e.code === 'Space') { e.preventDefault(); sc.togglePause(); }
    return;
  }
  if (e.code === 'KeyP') { e.preventDefault(); sc.next(); }
  else if (e.code === 'ArrowDown' || e.code === 'ArrowRight') { e.preventDefault(); sc.next(); }
  else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') { e.preventDefault(); onPrevClick(); }
  else if (e.code === 'KeyM') { sc.toggleMute(); }
  else if (e.code === 'KeyS') { e.preventDefault(); sc.setMode('seq'); syncModes(); }
  else if (e.code === 'KeyR') { e.preventDefault(); sc.setMode('rep'); syncModes(); }
  else if (e.code === 'KeyH') { e.preventDefault(); sc.setMode('shf'); syncModes(); }
  else if (e.code === 'KeyL') { e.preventDefault(); sc.toggleLog(); }
});


// ── Timeline rendering (reads from sc.position()) ────────────────────────
(function buildTimeline() {
  const divs = document.getElementById('tl-dividers');
  const labels = document.getElementById('phrase-labels');
  const names = ['0','0b','1','1b','2','3','4','tag'];
  for (let i = 0; i < 8; i++) {
    const d = document.createElement('div'); d.className = 'div'; divs.appendChild(d);
    const l = document.createElement('span'); l.textContent = names[i]; labels.appendChild(l);
  }
})();

function fmt(s) {
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

// Main render loop. One rule: show sc.position(). While playing that reads the
// live engine position; while paused/stopped it honors a manual dot placement
// (_manualPos) and otherwise freezes at the paused audio position. No clobbering.
setInterval(() => {
  const p = sc.position();
  tlDot.style.left = (p * 100) + '%';
  tlProg.style.width = (p * 100) + '%';
  const dur = sc.duration();
  tlTime.textContent = fmt(p * dur) + ' / ' + fmt(dur);
  // Side-panel mirror (skip while user is dragging its dot)
  if (!spDragging) {
    spTlDot.style.left = (p * 100) + '%';
    spTlProg.style.width = (p * 100) + '%';
  }
  spTimeCur.textContent = fmt(p * dur);
  spTimeDur.textContent = fmt(dur);
  if (sc.playing) {
    playIcon.innerHTML = '<rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/>';
    spPlayIcon.innerHTML = '<rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/>';
    tbPlay.classList.remove('paused');
    spPlay.classList.remove('paused');
  } else {
    playIcon.innerHTML = '<polygon points="7 4 20 12 7 20 7 4"/>';
    spPlayIcon.innerHTML = '<polygon points="7 4 20 12 7 20 7 4"/>';
    tbPlay.classList.add('paused');
    spPlay.classList.add('paused');
  }
}, 50);

// Drag dot → seek
let dragging = false;
tlDot.addEventListener('mousedown', e => { dragging = true; e.preventDefault(); e.stopPropagation(); });
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  const r = tlEl.getBoundingClientRect();
  const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  tlDot.style.left = (f * 100) + '%';
  tlProg.style.width = (f * 100) + '%';
});
window.addEventListener('mouseup', e => {
  if (!dragging) return;
  dragging = false;
  const r = tlEl.getBoundingClientRect();
  sc.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
});
tlEl.addEventListener('click', e => {
  if (dragging) return;
  const r = tlEl.getBoundingClientRect();
  const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  sc.seek(f);
});

/* ── Side-panel transport: bigger controls + simple line scrubber ─────── */
const spPrev = document.getElementById('sp-prev');
const spPlay = document.getElementById('sp-play');
const spNext = document.getElementById('sp-next');
const spPlayIcon = document.getElementById('sp-play-icon');
const spTlEl = document.getElementById('sp-timeline');
const spTlProg = document.getElementById('sp-tl-progress');
const spTlDot = document.getElementById('sp-tl-dot');
const spTimeCur = document.getElementById('sp-time-cur');
const spTimeDur = document.getElementById('sp-time-dur');
spPrev.addEventListener('click', e => { onPrevClick(); e.currentTarget.blur(); });
spPlay.addEventListener('click', e => { sc.togglePause(); e.currentTarget.blur(); });
spNext.addEventListener('click', e => { sc.next(); e.currentTarget.blur(); });
let spDragging = false;
function _spSeekFromEvent(e) {
  const r = spTlEl.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
}
spTlDot.addEventListener('mousedown', e => { spDragging = true; e.preventDefault(); e.stopPropagation(); });
spTlEl.addEventListener('mousedown', e => {
  if (e.target === spTlDot) return;
  spDragging = true;
  sc.seek(_spSeekFromEvent(e));
  e.preventDefault();
});
window.addEventListener('mousemove', e => {
  if (!spDragging) return;
  const f = _spSeekFromEvent(e);
  spTlDot.style.left = (f * 100) + '%';
  spTlProg.style.width = (f * 100) + '%';
});
window.addEventListener('mouseup', e => {
  if (!spDragging) return;
  spDragging = false;
  sc.seek(_spSeekFromEvent(e));
});

// Initial render + restore saved mode prefs to UI
renderList();
renderSidePanel();
syncModes();
// Populate the transport-bar title for the initially-selected track (track 0).
// onTrackChange only fires on a *change*, so the first song's title would
// otherwise stay blank until the user switches songs.
tlTitle.textContent = '1. ' + sc.tracks[sc.current].name;
</script>
</body>
</html>
"""


def cmd_player(a):
    path = state_path(a.game, a.working_dir)
    if not os.path.exists(path):
        _err(f"state file not found: {path} (run compose first)")
    with open(path) as f:
        data = json.load(f)
    engine_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "engine.js")
    engine_path = os.path.normpath(engine_path)
    if not os.path.exists(engine_path):
        _err(f"engine asset not found: {engine_path}")
    with open(engine_path) as f:
        engine = f.read()
    html = PLAYER_TMPL.replace("__GAME__", a.game).replace("__ENGINE__", engine).replace("__TRACKS__", json.dumps(data["tracks"]))
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as f:
        f.write(html)
    print(f"PASS: wrote {a.out}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("compose"); c.add_argument("--game", required=True); c.add_argument("--tracks", default="[]"); c.add_argument("--file", default=None, help="read tracks JSON from file (use --tracks @file)"); c.add_argument("--working-dir", default=".")
    v = sub.add_parser("validate"); v.add_argument("--file", required=True)
    p = sub.add_parser("player"); p.add_argument("--game", required=True); p.add_argument("--out", required=True); p.add_argument("--working-dir", default=".")
    ad = sub.add_parser("add", help="add track(s) to a game's list"); ad.add_argument("--game", required=True); ad.add_argument("--track", required=True, help='JSON object, array, "@file", or "-" for stdin'); ad.add_argument("--working-dir", default=".")
    rm = sub.add_parser("remove", help="remove track(s) by --name and/or --index"); rm.add_argument("--game", required=True); rm.add_argument("--name", action="append"); rm.add_argument("--index", action="append"); rm.add_argument("--working-dir", default=".")
    ls = sub.add_parser("list", help="list a game's tracks with indices"); ls.add_argument("--game", required=True); ls.add_argument("--working-dir", default=".")
    sv = sub.add_parser("set-vibe", help="set short vibe description on track(s) by --name/--index"); sv.add_argument("--game", required=True); sv.add_argument("--name", action="append"); sv.add_argument("--index", action="append"); sv.add_argument("--vibe", action="append", required=True, help="one per selector, in order"); sv.add_argument("--working-dir", default=".")
    ed = sub.add_parser("edit", help="update metadata fields on track(s) and bump revision"); ed.add_argument("--game", required=True); ed.add_argument("--name", action="append"); ed.add_argument("--index", action="append"); ed.add_argument("--set", action="append", required=True, help="key=value (repeatable); value parsed as JSON when it looks like JSON"); ed.add_argument("--working-dir", default=".")
    a = ap.parse_args()
    {"compose": cmd_compose, "validate": cmd_validate, "player": cmd_player,
     "add": cmd_add, "remove": cmd_remove, "list": cmd_list, "set-vibe": cmd_set_vibe, "edit": cmd_edit}[a.cmd](a)


if __name__ == "__main__":
    main()
