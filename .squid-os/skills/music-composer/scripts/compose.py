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
  /* Mode toggles */
  #modes-t{display:flex;gap:6px;flex-shrink:0;}
  #modes-t .mode{font-size:12px;font-weight:bold;letter-spacing:1.5px;padding:7px 14px;border:2px solid #4a6a90;border-radius:6px;cursor:pointer;color:#a0b4d8;transition:all .15s;user-select:none;background:#152030;}
  #modes-t .mode:hover{border-color:var(--cyan);color:#fff;background:#1e3050;}
  #modes-t .mode.on{border-color:var(--cyan);color:#fff;background:rgba(62,240,255,.15);box-shadow:0 0 12px rgba(62,240,255,.3);}
</style>
</head>
<body>
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
let player=null,modeSeq=false,modeRep=false,modeShf=false,lastShown=-1,_tlStart=null;
const nowEl=document.getElementById('now'),listEl=document.getElementById('list');
const tbPrev=document.getElementById('tb-prev'),tbPlay=document.getElementById('tb-play'),tbNext=document.getElementById('tb-next');
const tlEl=document.getElementById('timeline'),tlProg=document.getElementById('tl-progress'),tlDot=document.getElementById('tl-dot'),tlTime=document.getElementById('tl-time');
const mtSeq=document.getElementById('mt-seq'),mtRep=document.getElementById('mt-rep'),mtShf=document.getElementById('mt-shf');
const playIcon=document.getElementById('play-icon');
function decideNextAction(){if(modeShf)return'random';if(modeRep&&!modeSeq)return'same';if(modeSeq)return'next';return'stop';}
function applyModes(){if(!player)return;player.seq.tracks.forEach(t=>{t.autoNext=true;t.repeatOne=false;t.shuffle=false;});}
function installSongEndHooks(){
  const seq=player.seq,n=()=>seq.tracks.length;
  seq._origStart=seq._origStart||seq.start.bind(seq);seq._origStop=seq._origStop||seq.stop.bind(seq);
  seq.next=function(){const act=decideNextAction(),N=n();if(act==='stop'){seq._origStop();return;}if(act==='same'){seq._origStart(seq.current);return;}if(act==='random'){let i;do{i=Math.floor(Math.random()*N);}while(i===seq.current&&N>1);seq._origStart(i);return;}const nx=seq.current+1;if(nx>=N){if(modeRep)seq._origStart(0);else seq._origStop();return;}seq._origStart(nx);};
  seq.shuffleNext=function(){const act=decideNextAction();if(act!=='random'){seq.next();return;}let i;do{i=Math.floor(Math.random()*n());}while(i===seq.current&&n()>1);seq._origStart(i);};
}
function setMode(w){
  if(w==='seq'){modeSeq=!modeSeq;if(modeSeq)modeShf=false;}
  else if(w==='rep'){modeRep=!modeRep;if(modeRep)modeShf=false;}
  else{modeShf=!modeShf;if(modeShf){modeSeq=false;modeRep=false;}}
  syncModeUI();applyModes();
}
function syncModeUI(){mtSeq.classList.toggle('on',modeSeq);mtRep.classList.toggle('on',modeRep);mtShf.classList.toggle('on',modeShf);}
function ensure(){if(!player){player=new MusicEngine.Player({tracks:TRACKS});installSongEndHooks();applyModes();renderList();}if(player.ctx.state==='suspended')player.ctx.resume();}
function renderList(){const names=player.getNames();listEl.innerHTML=names.map((n,i)=>'<div class="row '+(i===player.current?'on':'')+'" data-i="'+i+'">'+(i+1)+'. '+n+'</div>').join('');listEl.querySelectorAll('.row').forEach(el=>el.addEventListener('click',()=>playTrack(parseInt(el.dataset.i,10))));}
function showNow(){const names=player.getNames();nowEl.textContent=player.playing?('\u25cf NOW PLAYING: '+(player.current+1)+' '+names[player.current]):'\u23f8 PAUSED';lastShown=player.current;renderList();_tlStart=performance.now();}
function playTrack(i){ensure();applyModes();player.start(i);showNow();}
setInterval(()=>{if(!player||!player.playing)return;if(player.current!==lastShown){lastShown=player.current;showNow();}},250);
function nextTrack(){ensure();const n=player.seq.tracks.length;playTrack((player.current+1)%n);}
function prevTrack(){ensure();const n=player.seq.tracks.length;playTrack((player.current-1+n)%n);}
function restartSong(){if(!player)return;ensure();player.start(player.current);_tlStart=performance.now();}
function togglePause(){ensure();if(player.playing){player.pause();tbPlay.classList.add('paused');showNow();}else{player.resume();tbPlay.classList.remove('paused');showNow();}}
// Prev: single=restart, double=prev song (1s grace)
let _prevTimer=null,_prevCount=0;
tbPrev.addEventListener('click',()=>{_prevCount++;if(_prevCount===1){_prevTimer=setTimeout(()=>{_prevCount=0;restartSong();},1000);}else if(_prevCount>=2){clearTimeout(_prevTimer);_prevCount=0;prevTrack();}});
window.addEventListener('keydown',e=>{
  if(e.code==='KeyP'){e.preventDefault();nextTrack();}
  else if(e.code==='ArrowDown'||e.code==='ArrowRight'){e.preventDefault();nextTrack();}
  else if(e.code==='ArrowUp'||e.code==='ArrowLeft'){e.preventDefault();prevTrack();}
  else if(e.code==='KeyM'){ensure();player.toggleMute();}
  else if(e.code==='KeyS'){e.preventDefault();setMode('seq');}
  else if(e.code==='KeyR'){e.preventDefault();setMode('rep');}
  else if(e.code==='KeyH'){e.preventDefault();setMode('shf');}
  else if(e.code==='Space'){e.preventDefault();togglePause();}
});
document.body.addEventListener('click',()=>{ensure();});
tbPlay.addEventListener('click',togglePause);
tbNext.addEventListener('click',nextTrack);
mtSeq.addEventListener('click',()=>setMode('seq'));
mtRep.addEventListener('click',()=>setMode('rep'));
mtShf.addEventListener('click',()=>setMode('shf'));
// Timeline
(function(){
  const divs=document.getElementById('tl-dividers'),labels=document.getElementById('phrase-labels');
  const names=['0','0b','1','1b','2','3','4','tag'];
  for(let i=0;i<8;i++){const d=document.createElement('div');d.className='div';divs.appendChild(d);const l=document.createElement('span');l.textContent=names[i];labels.appendChild(l);}
})();
function trackDuration(trk){const pl=trk.phraseLens||[1,1,1,1,1,1,1,1];return pl.reduce((s,l)=>s+32*l,0)*(60/trk.bpm)/4;}
function getProgress(){if(!player)return 0;const trk=player.seq.tracks[player.current];if(!trk)return 0;if(_tlStart===null)_tlStart=performance.now();return Math.min(1,(performance.now()-_tlStart)/1000/trackDuration(trk));}
function seekTo(frac){
  if(!player)return;
  const trk=player.seq.tracks[player.current];
  if(!trk)return;
  const pl=trk.phraseLens||[1,1,1,1,1,1,1,1];
  const totalSteps=pl.reduce((s,l)=>s+32*l,0);
  const targetStep=Math.floor(frac*totalSteps);
  // Use the engine's real seek: sets stepIndex/barCount/phraseCount correctly
  player.seekToStep(targetStep);
  _tlStart=performance.now();
}
function fmt(s){const m=Math.floor(s/60);return m+':'+String(Math.floor(s%60)).padStart(2,'0');}
let _lastP=0;
setInterval(()=>{
  if(!player)return;
  const p=getProgress();
  // Detect loop: progress jumped backwards significantly = song restarted
  if(p<_lastP-0.3){_tlStart=performance.now();}
  _lastP=p;
  tlDot.style.left=(p*100)+'%';tlProg.style.width=(p*100)+'%';
  const trk=player.seq.tracks[player.current];
  if(trk){const d=trackDuration(trk);tlTime.textContent=fmt(p*d)+' / '+fmt(d);}
  if(player.playing){playIcon.innerHTML='<rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/>';tbPlay.classList.remove('paused');}
  else{playIcon.innerHTML='<polygon points="7 4 20 12 7 20 7 4"/>';tbPlay.classList.add('paused');}
},50);
let dragging=false;
tlDot.addEventListener('mousedown',e=>{dragging=true;e.preventDefault();e.stopPropagation();});
window.addEventListener('mousemove',e=>{if(!dragging)return;const r=tlEl.getBoundingClientRect();const f=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));tlDot.style.left=(f*100)+'%';tlProg.style.width=(f*100)+'%';});
window.addEventListener('mouseup',e=>{if(!dragging)return;dragging=false;const r=tlEl.getBoundingClientRect();seekTo(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)));});
tlEl.addEventListener('click',e=>{if(dragging)return;const r=tlEl.getBoundingClientRect();seekTo(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)));});
listEl.innerHTML=TRACKS.map((t,i)=>'<div class="row" data-i="'+i+'">'+(i+1)+'. '+t.name+'</div>').join('');
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
