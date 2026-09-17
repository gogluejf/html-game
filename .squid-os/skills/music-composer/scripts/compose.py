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


PLAYER_TMPL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MUSIC FOR __GAME__</title>
<style>
  html,body{margin:0;min-height:100%;background:#05070f;color:#cfe4ff;font-family:'Courier New',monospace;}
  #wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:48px 20px;gap:26px;box-sizing:border-box;}
  #title{font-size:44px;font-weight:bold;letter-spacing:6px;color:#3ef0ff;text-shadow:0 0 24px #3ef0ff;margin:0;text-transform:uppercase;}
  #sub{font-size:16px;color:#5a6a90;letter-spacing:3px;margin-top:-14px;}
  #now{font-size:30px;color:#ffe23e;min-height:38px;text-shadow:0 0 14px #ffe23e;font-weight:bold;}
  #list{display:flex;flex-direction:column;gap:12px;min-width:340px;}
  #list .row{font-size:24px;padding:10px 22px;border:2px solid #1b2540;border-radius:8px;cursor:pointer;
             color:#8fa0d0;transition:all .12s;user-select:none;text-align:center;}
  #list .row:hover{border-color:#3ef0ff;color:#cfe4ff;background:rgba(62,240,255,.06);}
  #list .row.on{border-color:#ffe23e;color:#fff;background:rgba(255,226,62,.10);box-shadow:0 0 16px rgba(255,226,62,.25);}
  #modes{display:flex;gap:14px;margin-top:-8px;}
  #modes .mode{display:flex;align-items:center;gap:7px;font-size:15px;letter-spacing:2px;padding:6px 13px;border:2px solid #1b2540;border-radius:8px;cursor:pointer;
               color:#5a6a90;user-select:none;transition:all .12s;}
  #modes .mode svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
  #modes .mode:hover{border-color:#3ef0ff;color:#cfe4ff;}
  #modes .mode.on{border-color:#3ef0ff;color:#fff;background:rgba(62,240,255,.10);box-shadow:0 0 14px rgba(62,240,255,.3);}
  #hint{font-size:15px;color:#5a6a90;letter-spacing:1px;}
</style>
</head>
<body>
<div id="wrap">
  <div>
    <h1 id="title">Music for __GAME__</h1>
    <div id="sub">JUKEBOX</div>
  </div>
  <div id="now">&nbsp;</div>
  <div id="modes">
    <div class="mode" id="m-seq" title="auto-advance to next song when one finishes (S)">
      <svg viewBox="0 0 24 24"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>SEQ
    </div>
    <div class="mode" id="m-rep" title="repeat the current song forever (R)">
      <svg viewBox="0 0 24 24"><polyline points="17 2 21 6 17 10"></polyline><path d="M3 12v-2a4 4 0 0 1 4-4h14"></path><polyline points="7 22 3 18 7 14"></polyline><path d="M21 12v2a4 4 0 0 1-4 4H3"></path></svg>REP
    </div>
    <div class="mode" id="m-shf" title="pick a random song when one finishes (H)">
      <svg viewBox="0 0 24 24"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>SHF
    </div>
    <div class="mode" id="m-pause" title="pause / resume playback (Space)">
      <svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>PAUSE
    </div>
  </div>
  <div id="list"></div>
  <div id="hint">click a song &middot; P / &#8594; = next &middot; &#8592; = prev &middot; M = mute &middot; S/R/H = seq/repeat/shuffle &middot; Space = pause</div>
</div>
<script>
__ENGINE__
</script>
<script>
const TRACKS = __TRACKS__;
let player = null;
// Playback modes (mutually exclusive): seq = next song in order,
// rep = repeat current song, shf = random song. All off = stop after one play.
let modeSeq = true, modeRep = false, modeShf = false;
const nowEl = document.getElementById('now');
const listEl = document.getElementById('list');
const mSeq = document.getElementById('m-seq');
const mRep = document.getElementById('m-rep');
const mShf = document.getElementById('m-shf');
const mPause = document.getElementById('m-pause');

function applyModes(){
  if (!player) return;
  player.seq.tracks.forEach(t => { t.autoNext = modeSeq || modeRep || modeShf; t.repeatOne = modeRep; t.shuffle = modeShf; });
}
function setMode(which){
  // Toggling a mode on turns the others off (one behavior at a time).
  if (which === 'seq'){ modeSeq = !modeSeq; modeRep = false; modeShf = false; }
  else if (which === 'rep'){ modeRep = !modeRep; modeSeq = false; modeShf = false; }
  else { modeShf = !modeShf; modeSeq = false; modeRep = false; }
  mSeq.classList.toggle('on', modeSeq);
  mRep.classList.toggle('on', modeRep);
  mShf.classList.toggle('on', modeShf);
  applyModes();
  console.log('[jukebox] mode: ' + (modeRep ? 'repeat' : modeShf ? 'shuffle' : modeSeq ? 'sequence' : 'off'));
}

function ensure(){
  if (!player){
    player = new MusicEngine.Player({ tracks: TRACKS });
    renderList();
  }
  if (player.ctx.state === 'suspended') player.ctx.resume();
}
function renderList(){
  const names = player.getNames();
  listEl.innerHTML = names.map((n,i)=>`<div class="row ${i===player.current?'on':''}" data-i="${i}">${i+1}. ${n}</div>`).join('');
  listEl.querySelectorAll('.row').forEach(el=>el.addEventListener('click',()=>playTrack(parseInt(el.dataset.i,10))));
}
function showNow(){
  const names = player.getNames();
  nowEl.textContent = player.playing ? ('\u25cf NOW PLAYING: '+(player.current+1)+' '+names[player.current]) : '\u23f8 PAUSED';
  lastShown = player.current;
  renderList();
}
function playTrack(i){
  ensure();
  applyModes();
  player.start(i);
  console.log('[jukebox] play -> #'+(i+1), player.getNames()[i]);
  showNow();
}
// Keep the "now playing" display in sync with the engine (covers both
// manual P/click changes and automatic song-sequence advances).
// Only touch the DOM when the current track actually changed, so the
// row highlight never flickers mid-song.
let lastShown = -1;
setInterval(()=>{
  if (!player || !player.playing) return;
  if (player.current !== lastShown) { lastShown = player.current; showNow(); }
}, 250);
function nextTrack(){
  ensure();
  const started = player.playing;
  const n = player.seq.tracks.length;
  const target = started ? (player.current + 1) % n : 0;
  playTrack(target);
}
function prevTrack(){
  ensure();
  const n = player.seq.tracks.length;
  const target = (player.current - 1 + n) % n;
  playTrack(target);
}
mSeq.addEventListener('click', ()=>setMode('seq'));
mRep.addEventListener('click', ()=>setMode('rep'));
mShf.addEventListener('click', ()=>setMode('shf'));
function togglePause(){
  ensure();
  if (player.playing) {
    player.pause();
    mPause.classList.add('on');
    showNow();
  } else {
    player.resume();
    mPause.classList.remove('on');
    showNow();
  }
}
mPause.addEventListener('click', togglePause);
window.addEventListener('keydown', (e)=>{
  if (e.code === 'KeyP'){ e.preventDefault(); nextTrack(); }
  else if (e.code === 'ArrowDown' || e.code === 'ArrowRight'){ e.preventDefault(); nextTrack(); }
  else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft'){ e.preventDefault(); prevTrack(); }
  else if (e.code === 'KeyM'){ ensure(); player.toggleMute(); }
  else if (e.code === 'KeyS'){ e.preventDefault(); setMode('seq'); }
  else if (e.code === 'KeyR'){ e.preventDefault(); setMode('rep'); }
  else if (e.code === 'KeyH'){ e.preventDefault(); setMode('shf'); }
  else if (e.code === 'Space'){ e.preventDefault(); togglePause(); }
});
document.body.addEventListener('click', ()=>{ ensure(); });
// Render the clickable track list up front (before any audio starts).
listEl.innerHTML = TRACKS.map((t,i)=>`<div class="row" data-i="${i}">${i+1}. ${t.name}</div>`).join('');
listEl.querySelectorAll('.row').forEach(el=>el.addEventListener('click',()=>playTrack(parseInt(el.dataset.i,10))));
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
    a = ap.parse_args()
    {"compose": cmd_compose, "validate": cmd_validate, "player": cmd_player}[a.cmd](a)


if __name__ == "__main__":
    main()
