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
  :root{--bg:#05070f;--panel:#0d1220;--border:#2a4060;--cyan:#3ef0ff;--gold:#ffe23e;--dim:#7a8ab0;--text:#e0ecff;}
  *{box-sizing:border-box;}
  html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font-family:'Courier New',monospace;overflow-x:hidden;}
  #wrap{display:flex;flex-direction:column;align-items:center;padding:40px 20px 130px;gap:24px;min-height:100vh;}
  #title{font-size:42px;font-weight:bold;letter-spacing:6px;color:var(--cyan);text-shadow:0 0 24px var(--cyan);margin:0;text-transform:uppercase;}
  #sub{font-size:14px;color:var(--dim);letter-spacing:4px;margin-top:-12px;}
  #now{font-size:28px;color:var(--gold);min-height:36px;text-shadow:0 0 14px var(--gold);font-weight:bold;text-align:center;}
  #list{display:flex;flex-direction:column;gap:10px;min-width:320px;max-width:500px;width:100%;}
  #list .row{font-size:22px;padding:10px 20px;border:2px solid var(--border);border-radius:8px;cursor:pointer;color:#a0b4d8;transition:all .12s;user-select:none;text-align:center;background:var(--panel);}
  #list .row:hover{border-color:var(--cyan);color:#fff;background:#142030;}
  #list .row.on{border-color:var(--gold);color:#fff;background:rgba(255,226,62,.1);box-shadow:0 0 16px rgba(255,226,62,.25);}
  /* Transport bar */
  #transport{position:fixed;bottom:0;left:0;right:0;z-index:100;background:linear-gradient(to top,#080c18 0%,#0d1220 100%);border-top:2px solid var(--border);padding:14px 24px 18px;display:flex;align-items:center;gap:14px;user-select:none;box-shadow:0 -4px 40px rgba(0,0,0,.6);}
  .tbtn{width:42px;height:42px;border:2px solid #4a6a90;border-radius:8px;background:#152030;color:#e0ecff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;}
  .tbtn:hover{border-color:var(--cyan);color:#fff;background:#1e3050;transform:scale(1.08);}
  .tbtn:active{transform:scale(.93);}
  .tbtn svg{width:20px;height:20px;fill:currentColor;}
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
  #tl-time{font-size:14px;color:#a0b4d8;min-width:110px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums;font-weight:bold;}
  #tl-title{font-size:14px;color:var(--gold);font-weight:bold;letter-spacing:.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 0 8px rgba(255,226,62,.3);line-height:1.2;}
  #log-ind{position:fixed;top:12px;right:16px;z-index:200;font-size:12px;font-weight:bold;letter-spacing:1px;padding:6px 12px;border-radius:6px;background:#1a0d0d;border:2px solid #ff4444;color:#ff6666;display:none;box-shadow:0 0 12px rgba(255,68,68,.4);}
  #log-ind.on{display:block;}
  /* Mode toggles */
  #modes-t{display:flex;gap:6px;flex-shrink:0;}
  #modes-t .mode{font-size:12px;font-weight:bold;letter-spacing:1.5px;padding:7px 14px;border:2px solid #4a6a90;border-radius:6px;cursor:pointer;color:#a0b4d8;transition:all .15s;user-select:none;background:#152030;}
  #modes-t .mode:hover{border-color:var(--cyan);color:#fff;background:#1e3050;}
  #modes-t .mode.on{border-color:var(--cyan);color:#fff;background:rgba(62,240,255,.15);box-shadow:0 0 12px rgba(62,240,255,.3);}
</style>
</head>
<body>
<div id="log-ind">● LOGGING — press L to save</div>
<div id="wrap">
  <div><h1 id="title">Music for __GAME__</h1><div id="sub">JUKEBOX</div></div>
  <div id="now">&nbsp;</div>
  <div id="list"></div>
</div>
<div id="transport">
  <button class="tbtn" id="tb-prev" title="Restart song / double-click for previous"><svg viewBox="0 0 24 24"><polygon points="15 4 5 12 15 20 15 4"></polygon><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"></line></svg></button>
  <button class="tbtn play-btn" id="tb-play" title="Play/Pause (Space)"><svg viewBox="0 0 24 24" id="play-icon"><polygon points="7 4 20 12 7 20 7 4"></polygon></svg></button>
  <button class="tbtn" id="tb-next" title="Next song"><svg viewBox="0 0 24 24"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="5" y1="5" x2="5" y2="19" stroke="currentColor" stroke-width="2"></line></svg></button>
  <div id="tl-wrap">
    <div id="tl-title"></div>
    <div id="phrase-labels"></div>
    <div id="timeline"><div id="tl-progress"></div><div id="tl-dividers"></div><div id="tl-dot"></div></div>
  </div>
  <div id="tl-time">0:00 / 0:00</div>
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
    this._lastProgress = 0;
    this.onTrackChange = null;
    this.onPlayStateChange = null;
    this._neverStarted = true;
    this._pendingSeek = null;
    this._wasPlaying = false;
    this._dotOverride = false;  // user manually placed dot while not playing
    this._loadPrefs();
  }

  _loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('jukebox-prefs') || '{}');
      this.seq = !!p.seq; this.rep = !!p.rep; this.shf = !!p.shf;
    } catch (e) {}
  }
  _savePrefs() {
    try { localStorage.setItem('jukebox-prefs', JSON.stringify({ seq: this.seq, rep: this.rep, shf: this.shf })); } catch (e) {}
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
    if (this.shf) {
      let i; do { i = Math.floor(Math.random() * this.tracks.length); } while (i === this.current && this.tracks.length > 1);
      this.play(i);
    } else if (this.rep && !this.seq) {
      this.play(this.current);
    } else if (this.seq) {
      const nx = this.current + 1;
      if (nx >= this.tracks.length) {
        if (this.rep) this.play(0);
        else this.stop();
      } else {
        this.play(nx);
      }
    } else {
      this.stop();
    }
  }

  play(i) {
    this.init();
    if (this.player.ctx.state === 'suspended') this.player.ctx.resume();
    this.current = i;
    this.player.start(i);
    this.playing = true;
    this._neverStarted = false;
    this._wasPlaying = true;
    this._dotOverride = false;
    this._lastProgress = 0;
    console.log('[pp] play(' + i + ') pendingSeek=' + this._pendingSeek + ' engine bar/step=' + this.player.seq.barCount + '/' + this.player.seq.stepIndex);
    if (this._pendingSeek !== null && this._pendingSeek > 0) {
      const ps = this._pendingSeek;
      this.seek(ps);
      this._pendingSeek = null;
      console.log('[pp] play -> seeked to ' + ps + ' engine now bar/step=' + this.player.seq.barCount + '/' + this.player.seq.stepIndex + ' position()=' + this.position().toFixed(3));
    }
    if (this.onTrackChange) this.onTrackChange(i);
    if (this.onPlayStateChange) this.onPlayStateChange(true);
  }

  stop() {
    if (!this.player) return;
    this.player.stop();
    this.playing = false;
    this._wasPlaying = false;
    this._lastProgress = 0;
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  }

  pause() {
    if (!this.player || !this.playing) return;
    this.player.pause();
    this.playing = false;
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  }

  resume() {
    if (!this.player || this.playing) return;
    this.player.resume();
    this.playing = true;
    if (this.onPlayStateChange) this.onPlayStateChange(true);
  }

  togglePause() {
    if (this.playing) { this.pause(); return; }
    // If we've never started anything (fresh page), start track 0
    if (!this.player || this._neverStarted) { this.play(0); return; }
    this.resume();
  }

  next() {
    const n = this.tracks.length;
    this.play((this.current + 1) % n);
  }

  prev() {
    const n = this.tracks.length;
    this.play((this.current - 1 + n) % n);
  }

  restart() {
    this.play(this.current);
  }

  /** Seek to fraction 0..1. Uses engine.seekToStep(). */
  seek(frac) {
    frac = Math.max(0, Math.min(1, frac));
    if (!this.playing) {
      this._pendingSeek = frac;
      this._lastProgress = frac;
      this._dotOverride = true;
      return;
    }
    if (!this.player) return;
    const trk = this.player.seq.tracks[this.current];
    if (!trk) return;
    const pl = trk.phraseLens || [1,1,1,1,1,1,1,1];
    const totalSteps = pl.reduce((s, l) => s + 32 * l, 0);
    const targetStep = Math.floor(frac * totalSteps);
    this.player.seekToStep(targetStep);
    this._lastProgress = frac;
    console.log('[pp] seek(' + frac.toFixed(3) + ') totalSteps=' + totalSteps + ' targetStep=' + targetStep + ' engine bar/step=' + this.player.seq.barCount + '/' + this.player.seq.stepIndex + ' position()=' + this.position().toFixed(3));
  }

  /**
   * Current position as fraction 0..1.
   * Reads the ENGINE'S ACTUAL stepIndex + barCount so it stays in sync
   * with real audio playback (including pause/seek/loop).
   */
  position() {
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
    this.init();
    const ind = document.getElementById('log-ind');
    if (this.player.seq._logEnabled) {
      this.disableLog();
      this.downloadLog();
      if (ind) ind.classList.remove('on');
      console.log('[jukebox] log saved');
    } else {
      this.enableLog();
      if (ind) ind.classList.add('on');
      console.log('[jukebox] logging enabled — press L again to save+stop');
    }
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

// Track change → update list highlight + now-playing label
sc.onTrackChange = (i) => {
  const names = sc.tracks.map(t => t.name);
  nowEl.textContent = '\u25cf NOW PLAYING: ' + (i+1) + ' ' + names[i];
  tlTitle.textContent = (i+1) + '. ' + names[i];
  renderList();
};
sc.onPlayStateChange = (playing) => {
  if (!playing && sc._startTime === null) {
    nowEl.textContent = '\u23f8 PAUSED';
  }
};

let _listTimer = null, _listCount = 0, _listIdx = 0;
function renderList() {
  listEl.innerHTML = sc.tracks.map((t, i) =>
    '<div class="row ' + (i === sc.current ? 'on' : '') + '" data-i="' + i + '">' + (i+1) + '. ' + t.name + '</div>'
  ).join('');
  listEl.querySelectorAll('.row').forEach(el => {
    el.addEventListener('click', () => {
      const i = parseInt(el.dataset.i, 10);
      _listIdx = i;
      // Already playing → single click switches song immediately
      if (sc.playing) { sc.play(i); return; }
      // Not playing → single click focuses (select + dot to start), double plays
      _listCount++;
      if (_listCount === 1) {
        sc.current = i;
        // Keep dot where user dragged it (pending seek), else reset to 0
        const pos = (sc._pendingSeek !== null && sc._pendingSeek > 0) ? sc._pendingSeek : 0;
        sc._lastProgress = pos;
        tlDot.style.left = (pos * 100) + '%';
        tlProg.style.width = (pos * 100) + '%';
        tlTitle.textContent = (i+1) + '. ' + sc.tracks[i].name;
        nowEl.textContent = '\u25cb SELECTED: ' + (i+1) + ' ' + sc.tracks[i].name;
        renderList();
        _listTimer = setTimeout(() => { _listCount = 0; }, 400);
      } else if (_listCount >= 2) {
        clearTimeout(_listTimer);
        _listCount = 0;
        sc.play(i);
      }
    });
  });
}

// Prev button: single=restart, double=prev song (1s grace)
let _prevTimer = null, _prevCount = 0;
tbPrev.addEventListener('click', () => {
  _prevCount++;
  if (_prevCount === 1) {
    _prevTimer = setTimeout(() => { _prevCount = 0; sc.restart(); }, 1000);
  } else if (_prevCount >= 2) {
    clearTimeout(_prevTimer); _prevCount = 0; sc.prev();
  }
});
tbPlay.addEventListener('click', () => sc.togglePause());
tbNext.addEventListener('click', () => sc.next());
mtSeq.addEventListener('click', () => { sc.setMode('seq'); syncModes(); });
mtRep.addEventListener('click', () => { sc.setMode('rep'); syncModes(); });
mtShf.addEventListener('click', () => { sc.setMode('shf'); syncModes(); });

function syncModes() {
  mtSeq.classList.toggle('on', sc.seq);
  mtRep.classList.toggle('on', sc.rep);
  mtShf.classList.toggle('on', sc.shf);
}

// Keyboard
window.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { e.preventDefault(); sc.next(); }
  else if (e.code === 'ArrowDown' || e.code === 'ArrowRight') { e.preventDefault(); sc.next(); }
  else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') { e.preventDefault(); sc.prev(); }
  else if (e.code === 'KeyM') { sc.toggleMute(); }
  else if (e.code === 'KeyS') { e.preventDefault(); sc.setMode('seq'); syncModes(); }
  else if (e.code === 'KeyR') { e.preventDefault(); sc.setMode('rep'); syncModes(); }
  else if (e.code === 'KeyH') { e.preventDefault(); sc.setMode('shf'); syncModes(); }
  else if (e.code === 'Space') { e.preventDefault(); sc.togglePause(); }
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

// Main render loop: read sc.position() (engine stepIndex), update DOM
setInterval(() => {
  // Playing → read real engine position (accurate even right after a seek).
  // Not playing → show where the dot was dragged (_pendingSeek) or 0.
  let p;
  if (sc.playing) {
    p = sc.position();
  } else if (sc._wasPlaying && !sc._dotOverride) {
    // Paused mid-song, user hasn't moved the dot → freeze at audio position
    p = sc.position();
  } else {
    // Stopped, or user manually placed the dot → show where they put it
    p = (sc._lastProgress > 0) ? sc._lastProgress : 0;
  }
  tlDot.style.left = (p * 100) + '%';
  tlProg.style.width = (p * 100) + '%';
  const dur = sc.duration();
  tlTime.textContent = fmt(p * dur) + ' / ' + fmt(dur);
  if (sc.playing) {
    playIcon.innerHTML = '<rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/>';
    tbPlay.classList.remove('paused');
  } else {
    playIcon.innerHTML = '<polygon points="7 4 20 12 7 20 7 4"/>';
    tbPlay.classList.add('paused');
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
  console.log('[pp] TL click frac=' + f.toFixed(3) + ' playing=' + sc.playing + ' player=' + !!sc.player + ' pendingBefore=' + sc._pendingSeek);
  sc.seek(f);
  console.log('[pp] TL click after: pending=' + sc._pendingSeek + ' lastProg=' + sc._lastProgress);
});

// Initial render + restore saved mode prefs to UI
renderList();
syncModes();
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
