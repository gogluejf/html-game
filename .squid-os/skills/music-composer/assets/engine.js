/* music-composer engine — standalone build of MusicSequencer.
 * Exposes window.MusicEngine with:
 *   createTracks(tracksJson) -> tracks (resolves note names to Hz)
 *   new Player({tracks})     -> {start(i), stop(), setTrack(i), current, playing}
 * Note names (A4, C5, ...) are resolved via _NOTE; null = rest.
 */
const _NOTE = {
  C1:32.70,D1:36.71,E1:41.20,F1:43.65,G1:49.00,A1:55.00,B1:61.74,
  C2:65.41,D2:73.42,E2:82.41,F2:87.31,G2:98.00,A2:110.00,B2:123.47,
  C3:130.81,D3:146.83,E3:164.81,F3:174.61,G3:196.00,A3:220.00,B3:246.94,
  C4:261.63,D4:293.66,E4:329.63,F4:349.23,G4:392.00,A4:440.00,B4:493.88,
  C5:523.25,D5:587.33,E5:659.25,F5:698.46,G5:783.99,A5:880.00,B5:987.77,
};
// Sharps/flats: same physical pitches, spelled up (#) or down (b).
for (const [sharp, flat] of [["C#","Db"],["D#","Eb"],["F#","Gb"],["G#","Ab"],["A#","Bb"]]) {
  for (let o = 1; o <= 5; o++) {
    const hz = _NOTE[sharp[0] + o] * Math.pow(2, 1 / 12);
    _NOTE[sharp + o] = hz;
    _NOTE[flat + o] = hz; // alias — prefer # spelling in compositions
  }
}
const R = null; // rest

class MusicSequencer {
  constructor(sfx) {
    this.sfx = sfx;
    this.ctx = sfx.ctx;
    this.master = sfx.master;
    this.noiseBuffer = sfx.noiseBuffer;

    this.tracks = [this._punk(), this._metal(), this._synthwave(), this._acidjazz()];

    this.playing = false;
    this.current = 0;         // active track index
    this.stepIndex = 0;       // next 16th-note to schedule
    this.barCount = 0;        // total 2-bar blocks played (drives phrase progression)
    this.nextNoteTime = 0;    // audio-clock time of next step
    this.timerId = null;
    this._liveOscs = new Set();

    this.lookahead = 0.12;
    this.tickMs = 25;
    // -- debug logging --
    this._logBuf = [];
    this._logEnabled = false;
  }

  enableLog() { this._logEnabled = true; this._log('LOG: enabled'); }
  disableLog() { this._logEnabled = false; this._log('LOG: disabled'); }
  flushLog() { const out = this._logBuf.join('\n'); this._logBuf = []; return out; }
  _log(msg) {
    if (!this._logEnabled) return;
    const t = (performance.now() / 1000).toFixed(4);
    this._logBuf.push(t + ' ' + msg);
    if (this._logBuf.length > 5000) this._logBuf.splice(0, 1000);
  }

  /* -- public API ---------------------------------------------------------- */

  /** Map wave number (>=1) to a track index (1..3) for normal play.
   *   wave 1 -> track 1 (metal), wave 2 -> track 2 (synthwave),
   *   wave 3 -> track 3 (acid jazz), then cycles. Boss -> track 0 (punk). */
  static intensityForWave(wave) {
    const w = Math.max(1, wave);
    return ((w - 1) % 3) + 1;  // 1, 2, 3, 1, 2, 3, ...
  }

  start(trackIndex) {
    trackIndex = (trackIndex == null) ? this.current : trackIndex;
    this._log('START track=' + trackIndex + ' ctxNow=' + this.ctx.currentTime.toFixed(4));
    this.stop();
    this.current = Math.max(0, Math.min(this.tracks.length - 1, trackIndex | 0));
    this.playing = true;
    this.stepIndex = 0;
    this.barCount = 0;
    this.phraseCount = 0;   // total phrase-events played (drives drum level)
    this.nextNoteTime = this.ctx.currentTime + 0.06;
    this._log('START done nextNoteTime=' + this.nextNoteTime.toFixed(4) + ' delta=' + (this.nextNoteTime - this.ctx.currentTime).toFixed(4));

    this._busFilter = this.ctx.createBiquadFilter();
    this._busFilter.type = "lowpass";
    this._busFilter.frequency.value = 12000;
    this._busFilter.Q.value = 0.6;
    this._busGain = this.ctx.createGain();
    this._busGain.gain.value = 0.5;
    this._busFilter.connect(this._busGain);
    this._busGain.connect(this.master);

    this.timerId = setInterval(() => this._schedule(), this.tickMs);
  }

  /** Advance to the next track, restarting from phrase 0. */
  next() {
    const n = this.tracks.length;
    if (n < 2) return;
    const i = (this.current + 1) % n;
    if (this.playing) this.start(i); else this.setTrack(i);
  }

  /** Pick a random other track (shuffle). */
  shuffleNext() {
    const n = this.tracks.length;
    if (n < 2) return;
    let i;
    do { i = Math.floor(Math.random() * n); } while (i === this.current);
    if (this.playing) this.start(i); else this.setTrack(i);
  }

  stop() {
    this._log('STOP playing=' + this.playing + ' stepIdx=' + this.stepIndex + ' bar=' + this.barCount);
    if (this.timerId !== null) { clearInterval(this.timerId); this.timerId = null; }
    this.playing = false;
    const t = this.ctx.currentTime;
    this._liveOscs.forEach((n) => { try { n.stop(t + 0.02); } catch (e) {} });
    this._liveOscs.clear();
    if (this._busFilter) { try { this._busFilter.disconnect(); } catch (e) {} this._busFilter = null; }
    if (this._busGain)   { try { this._busGain.disconnect(); } catch (e) {} this._busGain = null; }
  }

  /** True pause: freeze the scheduler mid-song, keep all state. */
  pause() {
    if (!this.playing) return;
    if (this.timerId !== null) { clearInterval(this.timerId); this.timerId = null; }
    this.playing = false;
    // Kill only the currently-sounding oscillators (the lookahead tail).
    const t = this.ctx.currentTime;
    this._liveOscs.forEach((n) => { try { n.stop(t + 0.03); } catch (e) {} });
    this._liveOscs.clear();
    // Save position so resume() can pick up exactly here.
    this._pausedStep = this.stepIndex;
    this._pausedBar = this.barCount;
    this._pausedPhrase = this.phraseCount;
    this._pausedTrack = this.current;
  }

  /** Resume from the exact step saved by pause(). */
  resume() {
    if (this.playing) return;
    const trk = this.tracks[this._pausedTrack != null ? this._pausedTrack : this.current];
    this.current = this._pausedTrack != null ? this._pausedTrack : this.current;
    this.stepIndex = this._pausedStep || 0;
    this.barCount = this._pausedBar || 0;
    this.phraseCount = this._pausedPhrase || 0;
    this.playing = true;
    this.nextNoteTime = this.ctx.currentTime + 0.06;
    // Rebuild the bus if it was torn down.
    if (!this._busFilter) {
      this._busFilter = this.ctx.createBiquadFilter();
      this._busFilter.type = "lowpass";
      this._busFilter.frequency.value = 12000;
      this._busFilter.Q.value = 0.6;
      this._busGain = this.ctx.createGain();
      this._busGain.gain.value = 0.5;
      this._busFilter.connect(this._busGain);
      this._busGain.connect(this.master);
    }
    this.timerId = setInterval(() => this._schedule(), this.tickMs);
  }

  setTrack(i) {
    i = Math.max(0, Math.min(this.tracks.length - 1, i | 0));
    this.current = i;
    if (this.playing) {
      this.stepIndex = 0;
      this.barCount = 0;
      this.phraseCount = 0;
      this.nextNoteTime = this.ctx.currentTime + 0.04;
    }
  }

  /** Seek to an absolute step within the current track (0-based).
   *  Computes the correct barCount/phraseCount so phrase progression
   *  and drum levels are accurate at the seek point. */
  seekToStep(absStep) {
    const trk = this.tracks[this.current];
    if (!trk) return;
    const lens = trk.phraseLens || trk.leads.map(() => 1);
    const totalBlocks = lens.reduce((a, b) => a + b, 0);
    // Each block = 32 steps. Find which block and step-within-block.
    const block = Math.floor(absStep / 32);
    const stepInBlock = absStep % 32;
    this.stepIndex = stepInBlock;
    this.barCount = block;
    this.phraseCount = block;
    this.nextNoteTime = this.ctx.currentTime + 0.06;
    // Kill any lingering oscillators from before the seek.
    const t = this.ctx.currentTime;
    this._liveOscs.forEach((n) => { try { n.stop(t + 0.02); } catch (e) {} });
    this._liveOscs.clear();
  }

  setIntensity(_n) { /* deferred */ }

  _rearm() {
    if (!this.playing) return;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
  }

  /* -- internal ------------------------------------------------------------ */

  _schedule() {
    const trk = this.tracks[this.current];
    const lens = trk.phraseLens || trk.leads.map(() => 1);
    const totalBlocks = lens.reduce((a, b) => a + b, 0);
    while (this.nextNoteTime < this.ctx.currentTime + this.lookahead) {
      this._log('TICK step=' + this.stepIndex + ' bar=' + this.barCount + ' t=' + this.nextNoteTime.toFixed(4) + ' ctxNow=' + this.ctx.currentTime.toFixed(4) + ' lead=' + (trk.leads[this._phraseIndex(trk)][this.stepIndex] ? 'Y':'-'));
      this._playStep(trk, this.stepIndex, this.nextNoteTime);
      const spb = 60.0 / trk.bpm;
      this.nextNoteTime += spb / 4;              // one 16th note
      this.stepIndex = (this.stepIndex + 1) % trk.steps;
      if (this.stepIndex === 0) { this.barCount++; this.phraseCount++; } // finished a 2-bar block (= one phrase)
      // Song-sequence mode: when the whole song has played through every
      // phrase exactly once (one full cycle), decide what happens next:
      if (trk.autoNext && this.barCount > 0 && this.barCount % totalBlocks === 0) {
        this._log('LOOP detected at bar=' + this.barCount + ' totalBlocks=' + totalBlocks + ' autoNext=' + trk.autoNext + ' repeatOne=' + trk.repeatOne + ' shuffle=' + trk.shuffle);
        if (trk.repeatOne) this.start(this.current);
        else if (trk.shuffle) this.shuffleNext();
        else this.next();
        return;
      }
    }
  }

  /**
   * Map the current bar-block count to a phrase index using each track's
   * per-phrase length table (in bars). e.g. lengths [2,2,1,1] means:
   *   phrase0 for 2 blocks, phrase1 for 2 blocks, phrase2 for 1, phrase3 for 1,
   * then the whole cycle repeats. This gives a build-up feel (long phrases
   * first, quick hits last) instead of a flat round-robin.
   */
  _phraseIndex(trk) {
    const lens = trk.phraseLens || trk.leads.map(() => 1);
    const total = lens.reduce((a, b) => a + b, 0);
    let pos = this.barCount % total;
    for (let i = 0; i < lens.length; i++) {
      if (pos < lens[i]) return i;
      pos -= lens[i];
    }
    return 0;
  }

  /**
   * Drum/arrangement intensity for the current phrase.
   * Preferred: explicit per-phrase table `trk.drumLevels` (one entry per
   * phrase, values 0..3) — required for >4-phrase tracks (dream construction).
   * Fallback (classic 4-phrase tracks): level = phrase index (0->none,
   * 1->light, 2->medium, 3->full).
   */
  _drumLevel(trk) {
    const pi = this._phraseIndex(trk);
    if (trk.drumLevels && trk.drumLevels[pi] != null) return trk.drumLevels[pi];
    return pi;
  }

  _playStep(trk, step, t) {
    const pi = this._phraseIndex(trk);
    const lvl = this._drumLevel(trk);
    const leadPhrase = trk.leads[pi];
    const padPhrase  = trk.pads[pi];
    // Phrase-count-driven drums: light -> medium -> full (drifts across phrases).
    const drumSet = (trk.drums[lvl] != null) ? trk.drums[lvl] : trk.drums;
    const d = drumSet[step];
    if (d.k) this._kick(t, trk);
    if (d.s) this._snare(t, trk);
    if (d.h) this._hat(t, trk);
    const b = (Array.isArray(trk.bass) && trk.bass[pi] != null) ? trk.bass[pi][step] : trk.bass[step];
    if (b) this._bass(t, b.hz, trk, b.mul);
    if (padPhrase && padPhrase[step]) this._pad(t, padPhrase[step], trk);
    const l = leadPhrase[step];
    if (l) this._lead(t, l.hz, trk, l.mul);
    // Extra lead layer: per-phrase banks (null = no layer for that phrase).
    // v2: leadLayers is a flat array with ONE 32-step entry per phrase index,
    // so any number of phrases works (classic tracks put banks at 2 & 3).
    if (trk.leadLayers && trk.leadLayers[pi]) {
      const xl = trk.leadLayers[pi][step];
      if (xl) this._leadLayer(t, xl.hz, trk, lvl, xl.mul);
    }
  }

  /* -- voices -------------------------------------------------------------- */

  _kick(t, trk) {
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(trk.kickTop || 140, t);
    osc.frequency.exponentialRampToValueAtTime(trk.kickBot || 45, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(g); g.connect(this._busFilter);
    osc.start(t); osc.stop(t + 0.18);
    this._track(osc, t + 0.2);
  }

  _snare(t, trk) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 1400;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 2200; bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    const dur = 0.14;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(this._busFilter);
    src.start(t); src.stop(t + dur + 0.02);
    this._track(src, t + dur + 0.05);
  }

  _hat(t, trk) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    const dur = 0.03;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp); hp.connect(g); g.connect(this._busFilter);
    src.start(t); src.stop(t + dur + 0.02);
    this._track(src, t + dur + 0.05);
  }

  _bass(t, freq, trk, mul) {
    const osc = this.ctx.createOscillator();
    osc.type = trk.bassType || "sawtooth";
    osc.frequency.setValueAtTime(freq, t);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(trk.bassCut || 900, t);
    lp.Q.value = 1.2;
    const g = this.ctx.createGain();
    const dur = (trk.bassDur || 0.18) * (mul || 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(lp); lp.connect(g); g.connect(this._busFilter);
    osc.start(t); osc.stop(t + dur + 0.02);
    this._track(osc, t + dur + 0.05);
  }

  _pad(t, freqs, trk) {
    const dur = (trk.padDur || 0.6);
    for (let i = 0; i < freqs.length; i++) {
      const f = typeof freqs[i] === 'object' && freqs[i] !== null ? freqs[i].hz : freqs[i];
      const osc = this.ctx.createOscillator();
      osc.type = trk.padType || "sawtooth";
      osc.frequency.setValueAtTime(f, t);
      osc.detune.value = (i === 0 ? -6 : i === 1 ? 6 : 0);
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = trk.padCut || 1600;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.05);
      g.gain.setValueAtTime(0.09, t + dur - 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(lp); lp.connect(g); g.connect(this._busFilter);
      osc.start(t); osc.stop(t + dur + 0.02);
      this._track(osc, t + dur + 0.05);
    }
  }

  _lead(t, freq, trk, mul) {
    const osc = this.ctx.createOscillator();
    osc.type = trk.leadType || "square";
    osc.frequency.setValueAtTime(freq, t);
    const lfo = this.ctx.createOscillator();
    lfo.type = "sine"; lfo.frequency.value = 5.5;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = trk.vib || 8;
    lfo.connect(lfoGain); lfoGain.connect(osc.detune);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = trk.leadCut || 4000;
    const g = this.ctx.createGain();
    const dur = (trk.leadDur || 0.2) * (mul || 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.24, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(lp); lp.connect(g); g.connect(this._busFilter);
    osc.start(t); osc.stop(t + dur + 0.02);
    lfo.start(t); lfo.stop(t + dur + 0.02);
    this._track(osc, t + dur + 0.05);
    this._track(lfo, t + dur + 0.05);
  }

  /** Softer harmony/counter line that layers over the main lead on later cycles. */
  _leadLayer(t, freq, trk, cyc, mul) {
    const osc = this.ctx.createOscillator();
    osc.type = trk.layerType || "triangle";
    osc.frequency.setValueAtTime(freq, t);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = (trk.layerCut || 3000);
    const g = this.ctx.createGain();
    // Quieter than the main lead so it sits underneath; slightly louder each cycle.
    const peak = 0.12 + cyc * 0.04;
    const dur = (trk.layerDur || 0.24) * (mul || 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(lp); lp.connect(g); g.connect(this._busFilter);
    osc.start(t); osc.stop(t + dur + 0.02);
    this._track(osc, t + dur + 0.05);
  }

  _track(node, doneAt) {
    this._liveOscs.add(node);
    setTimeout(() => { this._liveOscs.delete(node); }, (doneAt - this.ctx.currentTime) * 1000 + 50);
  }

  /* -- track definitions --------------------------------------------------- */
  /* leads/pads are banks of 32-step phrases; phraseLens = bars per phrase. */

  _punk() {
    const E1=_NOTE.E1,E2=_NOTE.E2;
    const E4=_NOTE.E4,B4=_NOTE.B4,A4=_NOTE.A4,D4=_NOTE.D4,G4=_NOTE.G4,R4=R;
    const C5=_NOTE.C5,F4=_NOTE.F4,E5=_NOTE.E5,D5=_NOTE.D5,G5=_NOTE.G5;
    // Cycle-aware drums: [sparse, fuller, fullest] across the 3 arrangement cycles.
    const drums=[[],[],[],[]]; // [none, light=snare, medium=+kick, full=+16th hats/ghosts]
    for(let i=0;i<32;i++){
      drums[0].push({k:false,s:false,h:false});                              // p0: silence
      drums[1].push({k:false,s:(i%8===4),h:false});                          // p1: SNARE backbeat only
      drums[2].push({k:(i%4===0),s:(i%8===4),h:false});                      // p2: + KICK quarters
      drums[3].push({k:(i%4===0||i%8===6),s:(i%8===4||i%16===14),h:true});   // p3: + busy 16th hats & ghost snare
    }
    const bass=[];
    for(let i=0;i<32;i++){bass.push(i%4===2?E2:E1);}
    const leads=[
      [E4,R4,B4,R4, E4,R4,A4,R4, G4,R4,A4,R4, B4,R4,E5,R4,
       E4,R4,B4,R4, A4,R4,B4,R4, E4,R4,G4,R4, A4,R4,B4,R4],
      [A4,R4,B4,R4, C5,R4,B4,R4, A4,R4,G4,R4, F4,R4,G4,R4,
       A4,R4,B4,R4, E5,R4,D5,R4, B4,R4,C5,R4, D5,R4,E5,R4],
      [G4,R4,A4,R4, B4,R4,A4,R4, G4,R4,F4,R4, G4,R4,A4,R4,
       B4,R4,C5,R4, D5,R4,C5,R4, B4,R4,A4,R4, G4,R4,A4,R4],
      [E5,R4,D5,R4, C5,R4,D5,R4, B4,R4,C5,R4, B4,R4,A4,R4,
       B4,R4,C5,R4, D5,R4,E5,R4, G5,R4,E5,R4, D5,R4,C5,R4],
    ];
    const pads=[
      {0:[_NOTE.E2,_NOTE.B2,_NOTE.E3],16:[_NOTE.A2,_NOTE.E3,_NOTE.A3]},
      {0:[_NOTE.A2,_NOTE.C4,_NOTE.E4],16:[_NOTE.G2,_NOTE.B3,_NOTE.D4]},
      {0:[_NOTE.G2,_NOTE.B3,_NOTE.D4],16:[_NOTE.A2,_NOTE.C4,_NOTE.E4]},
      {0:[_NOTE.E2,_NOTE.B2,_NOTE.E3],16:[_NOTE.E2,_NOTE.B2,_NOTE.E3]},
    ];
    // Extra harmony layer: plays on cycles 1 & 2 (index 1,2), one per phrase.
    const leadLayers=[
      null, // p0: no layer
      null, // p1: no layer
      [ // cycle 1: simple octave/third doubling of the riff
        [R4,R4,B4,R4, R4,R4,A4,R4, G4,R4,R4,R4, B4,R4,R4,R4,
         R4,R4,B4,R4, A4,R4,R4,R4, R4,R4,G4,R4, A4,R4,R4,R4],
        [R4,R4,B4,R4, C5,R4,R4,R4, A4,R4,R4,R4, R4,R4,R4,R4,
         R4,R4,B4,R4, E5,R4,R4,R4, B4,R4,C5,R4, R4,R4,R4,R4],
        [R4,R4,A4,R4, B4,R4,R4,R4, G4,R4,F4,R4, R4,R4,R4,R4,
         B4,R4,C5,R4, R4,R4,C5,R4, R4,R4,A4,R4, G4,R4,R4,R4],
        [E5,R4,R4,R4, C5,R4,R4,R4, B4,R4,C5,R4, R4,R4,A4,R4,
         R4,R4,C5,R4, D5,R4,E5,R4, G5,R4,R4,R4, R4,R4,C5,R4],
      ],
      [ // cycle 2: busier counter-line filling the gaps
        [E4,R4,B4,R4, A4,R4,A4,R4, G4,R4,A4,R4, B4,R4,E5,R4,
         A4,R4,B4,R4, A4,R4,B4,R4, E4,R4,G4,R4, A4,R4,B4,R4],
        [A4,R4,B4,R4, C5,R4,B4,R4, A4,R4,G4,R4, F4,R4,G4,R4,
         A4,R4,B4,R4, E5,R4,D5,R4, B4,R4,C5,R4, D5,R4,E5,R4],
        [G4,R4,A4,R4, B4,R4,A4,R4, G4,R4,F4,R4, G4,R4,A4,R4,
         B4,R4,C5,R4, D5,R4,C5,R4, B4,R4,A4,R4, G4,R4,A4,R4],
        [E5,R4,D5,R4, C5,R4,D5,R4, B4,R4,C5,R4, B4,R4,A4,R4,
         B4,R4,C5,R4, D5,R4,E5,R4, G5,R4,E5,R4, D5,R4,C5,R4],
      ],
    ];
    return {
      name:"PUNK", bpm:182, steps:32, drums, bass, leads, pads, phraseLens:[2,2,1,1],
      numCycles:3, leadLayers,
      bassType:"sawtooth", bassCut:1100, bassDur:0.16,
      padType:"sawtooth", padCut:1800, padDur:0.5,
      leadType:"square", leadCut:4200, leadDur:0.18, vib:10,
      layerType:"triangle", layerCut:3200, layerDur:0.18,
      kickTop:150, kickBot:48,
    };
  }

  _metal() {
    const E1=_NOTE.E1,E2=_NOTE.E2;
    const E4=_NOTE.E4,B4=_NOTE.B4,A4=_NOTE.A4,D4=_NOTE.D4,G4=_NOTE.G4,F4=_NOTE.F4,R4=R;
    const C5=_NOTE.C5,D5=_NOTE.D5,E5=_NOTE.E5,G5=_NOTE.G5;
    // Cycle-aware drums: [sparse, fuller, fullest].
    const drums=[[],[],[],[]]; // [none, light=snare, medium=+kick, full=+16th hats/ghosts]
    for(let i=0;i<32;i++){
      drums[0].push({k:false,s:false,h:false});                                     // p0: silence
      drums[1].push({k:false,s:(i%8===4),h:false});                                 // p1: SNARE backbeat only
      drums[2].push({k:(i%4===0||i%8===6),s:(i%8===4),h:false});                    // p2: + KICK (double feel)
      drums[3].push({k:(i%4===0||i%8===2||i%8===6),s:(i%8===4||i%16===14),h:true}); // p3: + 16th hats & ghost snare
    }
    const bass=[];
    for(let i=0;i<32;i++){bass.push(i%8===0?E2:(i%4===2?E2:E1));}
    const leads=[
      [E4,R4,E4,B4, A4,R4,B4,R4, G4,R4,A4,R4, B4,R4,E4,R4,
       D4,R4,D4,A4, G4,R4,A4,R4, E4,R4,G4,R4, B4,R4,A4,R4],
      [B4,R4,A4,R4, G4,R4,A4,R4, B4,R4,C5,R4, D5,R4,C5,R4,
       B4,R4,A4,R4, G4,R4,F4,R4, G4,R4,A4,R4, B4,R4,A4,R4],
      [C5,R4,D5,R4, E5,R4,D5,R4, C5,R4,B4,R4, A4,R4,B4,R4,
       C5,R4,D5,R4, E5,R4,G5,R4, E5,R4,D5,R4, C5,R4,B4,R4],
      [G5,R4,E5,R4, D5,R4,E5,R4, C5,R4,D5,R4, E5,R4,D5,R4,
       C5,R4,B4,R4, A4,R4,B4,R4, G4,R4,A4,R4, B4,R4,A4,R4],
    ];
    const pads=[
      {0:[_NOTE.E2,_NOTE.B2],8:[_NOTE.E2,_NOTE.B2],16:[_NOTE.D2,_NOTE.A2],24:[_NOTE.D2,_NOTE.A2]},
      {0:[_NOTE.B1,_NOTE.E2],8:[_NOTE.A2,_NOTE.E3],16:[_NOTE.G2,_NOTE.D3],24:[_NOTE.A2,_NOTE.E3]},
      {0:[_NOTE.E2,_NOTE.B2],8:[_NOTE.C3,_NOTE.G3],16:[_NOTE.D2,_NOTE.A2],24:[_NOTE.B1,_NOTE.E2]},
      {0:[_NOTE.E2,_NOTE.B2],8:[_NOTE.E2,_NOTE.B2],16:[_NOTE.E2,_NOTE.B2],24:[_NOTE.E2,_NOTE.B2]},
    ];
    const leadLayers=[
      null, // p0: no layer
      null, // p1: no layer
      [ // cycle 1: power-chord fifth doubling
        [R4,R4,E4,B4, A4,R4,R4,R4, G4,R4,A4,R4, B4,R4,R4,R4,
         D4,R4,D4,R4, G4,R4,R4,R4, E4,R4,G4,R4, B4,R4,R4,R4],
        [B4,R4,A4,R4, G4,R4,R4,R4, B4,R4,C5,R4, R4,R4,C5,R4,
         B4,R4,A4,R4, G4,R4,F4,R4, G4,R4,A4,R4, B4,R4,R4,R4],
        [C5,R4,D5,R4, E5,R4,R4,R4, C5,R4,B4,R4, A4,R4,R4,R4,
         C5,R4,D5,R4, E5,R4,G5,R4, R4,R4,D5,R4, C5,R4,R4,R4],
        [G5,R4,E5,R4, D5,R4,R4,R4, C5,R4,D5,R4, R4,R4,D5,R4,
         C5,R4,B4,R4, A4,R4,B4,R4, G4,R4,A4,R4, B4,R4,R4,R4],
      ],
      [ // cycle 2: busy counter-riff
        [E4,R4,E4,B4, A4,R4,B4,R4, G4,R4,A4,R4, B4,R4,E4,R4,
         D4,R4,D4,A4, G4,R4,A4,R4, E4,R4,G4,R4, B4,R4,A4,R4],
        [B4,R4,A4,R4, G4,R4,A4,R4, B4,R4,C5,R4, D5,R4,C5,R4,
         B4,R4,A4,R4, G4,R4,F4,R4, G4,R4,A4,R4, B4,R4,A4,R4],
        [C5,R4,D5,R4, E5,R4,D5,R4, C5,R4,B4,R4, A4,R4,B4,R4,
         C5,R4,D5,R4, E5,R4,G5,R4, E5,R4,D5,R4, C5,R4,B4,R4],
        [G5,R4,E5,R4, D5,R4,E5,R4, C5,R4,D5,R4, E5,R4,D5,R4,
         C5,R4,B4,R4, A4,R4,B4,R4, G4,R4,A4,R4, B4,R4,A4,R4],
      ],
    ];
    return {
      name:"METAL", bpm:158, steps:32, drums, bass, leads, pads, phraseLens:[2,2,1,1],
      numCycles:3, leadLayers,
      bassType:"sawtooth", bassCut:950, bassDur:0.17,
      padType:"sawtooth", padCut:1500, padDur:0.4,
      leadType:"sawtooth", leadCut:3600, leadDur:0.2, vib:14,
      layerType:"sawtooth", layerCut:2800, layerDur:0.2,
      kickTop:130, kickBot:42,
    };
  }

  _synthwave() {
    const A1=_NOTE.A1,A2=_NOTE.A2;
    const E4=_NOTE.E4,G4=_NOTE.G4,F4=_NOTE.F4,A4=_NOTE.A4,C5=_NOTE.C5,D5=_NOTE.D5,E5=_NOTE.E5,R4=R;
    const B4=_NOTE.B4,G5=_NOTE.G5,A3=_NOTE.A3,C4=_NOTE.C4,E3=_NOTE.E3;
    // Cycle-aware drums: [sparse, fuller, fullest] -- four-on-the-floor builds up.
    const drums=[[],[],[],[]]; // [none, light=snare, medium=+kick, full=+16th hats/ghosts]
    for(let i=0;i<32;i++){
      drums[0].push({k:false,s:false,h:false});                                  // p0: silence
      drums[1].push({k:false,s:(i%8===4),h:false});                              // p1: SNARE backbeat only
      drums[2].push({k:(i%4===0),s:(i%8===4),h:false});                          // p2: + four-on-floor KICK
      drums[3].push({k:(i%4===0||i%16===14),s:(i%8===4||i%16===10),h:true});     // p3: + 16th open hats & ghost kick
    }
    // Pulsing synth bass: 8th-note root drive (A minor).
    const bass=[];
    for(let i=0;i<32;i++){bass.push(i%2===0?A1:A2);}
    // EMOTIONAL ARC across the 0-0-1-1-2-3 cycle:
    //   phrase0 = big SLOW hook (quarter notes, wide intervals) -- the "good" one
    //   phrase1 = building rising run into the chorus
    //   phrase2 = HIGH climax (peak register, driving 8ths)
    //   phrase3 = dark LOW drop + resolve back to the hook
    const leads=[
      // 0: the hook -- spacious, singable, memorable
      [A4,R4,C5,R4, E5,R4,C5,R4, A4,R4,B4,R4, C5,R4,E5,R4,
       D5,R4,C5,R4, B4,R4,A4,R4, G4,R4,A4,R4, A4,R4,R4,R4],
      // 1: build -- rising chromatic-ish run, climbing each bar
      [A4,B4,C5,D5, E5,D5,C5,D5, E5,_NOTE.F5,G5,E5, _NOTE.F5,G5,_NOTE.A5,G5,
       G5,_NOTE.A5,G5,E5, D5,E5,_NOTE.F5,G5, E5,D5,C5,D5, E5,R4,R4,R4],
      // 2: climax -- peak register, relentless 8ths
      [_NOTE.A5,G5,E5,G5, _NOTE.A5,G5,E5,G5, _NOTE.A5,_NOTE.A5,_NOTE.A5,G5, _NOTE.A5,G5,E5,G5,
       _NOTE.A5,_NOTE.A5,G5,E5, _NOTE.A5,G5,E5,D5, _NOTE.A5,G5,E5,G5, _NOTE.A5,G5,E5,R4],
      // 3: dark drop -- low register stabs then resolve up into the hook
      [A3,R4,C4,R4, E4,R4,C4,R4, A3,R4,_NOTE.B3,R4, C4,R4,E4,R4,
       _NOTE.D4,R4,C4,R4, _NOTE.B3,R4,A3,R4, G4,R4,A4,R4, A4,R4,C5,R4],
    ];
    const pads=[
      {0:[_NOTE.A2,_NOTE.C4,_NOTE.E4],4:[_NOTE.A2,_NOTE.C4,_NOTE.E4],8:[_NOTE.F2,_NOTE.A3,_NOTE.C4],12:[_NOTE.F2,_NOTE.A3,_NOTE.C4],16:[_NOTE.G2,_NOTE.C4,_NOTE.E4],20:[_NOTE.G2,_NOTE.C4,_NOTE.E4],24:[_NOTE.A2,_NOTE.C4,_NOTE.E4],28:[_NOTE.A2,_NOTE.C4,_NOTE.E4]},
      {0:[_NOTE.C3,_NOTE.E4,_NOTE.G4],4:[_NOTE.C3,_NOTE.E4,_NOTE.G4],8:[_NOTE.B1,_NOTE.D4,_NOTE.F4],12:[_NOTE.B1,_NOTE.D4,_NOTE.F4],16:[_NOTE.A2,_NOTE.C4,_NOTE.E4],20:[_NOTE.A2,_NOTE.C4,_NOTE.E4],24:[_NOTE.G2,_NOTE.B3,_NOTE.D4],28:[_NOTE.G2,_NOTE.B3,_NOTE.D4]},
      {0:[_NOTE.E3,_NOTE.G4,_NOTE.B4],4:[_NOTE.E3,_NOTE.G4,_NOTE.B4],8:[_NOTE.D3,_NOTE.F4,_NOTE.A3],12:[_NOTE.D3,_NOTE.F4,_NOTE.A3],16:[_NOTE.C3,_NOTE.E4,_NOTE.G4],20:[_NOTE.C3,_NOTE.E4,_NOTE.G4],24:[_NOTE.E3,_NOTE.G4,_NOTE.B4],28:[_NOTE.D3,_NOTE.F4,_NOTE.A3]},
      {0:[_NOTE.A2,_NOTE.C4,_NOTE.E4],4:[_NOTE.A2,_NOTE.C4,_NOTE.E4],8:[_NOTE.A2,_NOTE.C4,_NOTE.E4],12:[_NOTE.A2,_NOTE.C4,_NOTE.E4],16:[_NOTE.C3,_NOTE.E4,_NOTE.G4],20:[_NOTE.C3,_NOTE.E4,_NOTE.G4],24:[_NOTE.A2,_NOTE.C4,_NOTE.E4],28:[_NOTE.A2,_NOTE.C4,_NOTE.E4]},
    ];
    const leadLayers=[
      null, // p0: no layer
      null, // p1: no layer
      [ // cycle 1: echoing harmony a third below the hook/build/climax/drop
        [R4,R4,C5,R4, R4,R4,E5,R4, A4,R4,R4,R4, C5,R4,R4,R4,
         R4,R4,D5,R4, B4,R4,R4,R4, G4,R4,R4,R4, A4,R4,R4,R4],
        [A4,R4,R4,R4, C5,R4,R4,R4, E5,R4,R4,R4, G5,R4,R4,R4,
         _NOTE.A5,R4,R4,R4, G5,R4,R4,R4, E5,R4,D5,R4, R4,R4,R4,R4],
        [E5,R4,R4,R4, G5,R4,R4,R4, _NOTE.A5,R4,R4,R4, G5,R4,R4,R4,
         E5,R4,R4,R4, D5,R4,R4,R4, E5,R4,G5,R4, R4,R4,R4,R4],
        [C4,R4,R4,R4, E4,R4,R4,R4, R4,R4,R4,R4, R4,R4,R4,R4,
         C4,R4,R4,R4, _NOTE.B3,R4,R4,R4, G4,R4,R4,R4, A4,R4,R4,R4],
      ],
      [ // cycle 2: arpeggiated counter-line filling the space
        [A4,R4,C5,R4, E5,R4,C5,R4, A4,R4,B4,R4, C5,R4,E5,R4,
         D5,R4,C5,R4, B4,R4,A4,R4, G4,R4,A4,R4, A4,R4,C5,R4],
        [A4,B4,C5,D5, E5,D5,C5,D5, E5,_NOTE.F5,G5,E5, _NOTE.F5,G5,_NOTE.A5,G5,
         G5,_NOTE.A5,G5,E5, D5,E5,_NOTE.F5,G5, E5,D5,C5,D5, R4,R4,R4,R4],
        [_NOTE.A5,R4,G5,R4, E5,R4,G5,R4, _NOTE.A5,R4,_NOTE.A5,R4, G5,R4,E5,R4,
         _NOTE.A5,R4,G5,R4, E5,R4,G5,R4, _NOTE.A5,R4,G5,R4, _NOTE.A5,R4,E5,R4],
        [A3,R4,C4,R4, E4,R4,C4,R4, A3,R4,_NOTE.B3,R4, C4,R4,E4,R4,
         _NOTE.D4,R4,C4,R4, _NOTE.B3,R4,A3,R4, G4,R4,A4,R4, A4,R4,C5,R4],
      ],
    ];
    return {
      name:"SYNTHWAVE", bpm:118, steps:32, drums, bass, leads, pads, phraseLens:[2,2,1,1],
      numCycles:3, leadLayers,
      bassType:"sawtooth", bassCut:800, bassDur:0.22,
      padType:"sawtooth", padCut:2200, padDur:0.5,
      leadType:"square", leadCut:3400, leadDur:0.22, vib:6,
      layerType:"triangle", layerCut:3000, layerDur:0.22,
      kickTop:120, kickBot:40,
    };
  }

  _acidjazz() {
    const A1=_NOTE.A1,D2=_NOTE.D2,E2=_NOTE.E2,G2=_NOTE.G2,C2=_NOTE.C2;
    const C4=_NOTE.C4,E4=_NOTE.E4,G4=_NOTE.G4,D4=_NOTE.D4,F4=_NOTE.F4,A4=_NOTE.A4,C5=_NOTE.C5,E5=_NOTE.E5,D5=_NOTE.D5,R4=R;
    const B4=_NOTE.B4,G5=_NOTE.G5,F5=_NOTE.F5;
    // Cycle-aware drums: [sparse, fuller, fullest] -- loose jazz groove builds.
    const drums=[[],[],[],[]]; // [none, light=rim/snare, medium=+kick, full=+shaker 16ths]
    for(let i=0;i<32;i++){
      drums[0].push({k:false,s:false,h:false});                                                                              // p0: silence
      drums[1].push({k:false,s:(i===8||i===20),h:false});                                                                    // p1: RIM/snare on 2&4 only
      drums[2].push({k:(i===0||i===8||i===16||i===24),s:(i===8||i===20),h:false});                                           // p2: + loose KICK
      drums[3].push({k:(i===0||i===3||i===8||i===10||i===16||i===19||i===24||i===27),s:(i===8||i===20||i===14||i===26),h:(i%2===0)}); // p3: + busy syncopated kick & 16th shaker
    }
    const bass=[
      A1,R4,D2,R4, E2,R4,G2,R4, A1,R4,C2,R4, D2,R4,E2,R4,
      A1,R4,D2,R4, E2,R4,G2,R4, C2,R4,E2,R4, G2,R4,A1,R4
    ];
    const leads=[
      [A4,R4,C5,R4, E5,R4,D5,R4, C5,R4,A4,R4, G4,R4,A4,R4,
       A4,R4,C5,R4, E5,R4,G5,R4, F5,R4,E5,R4, D5,R4,C5,R4],
      [G4,R4,A4,R4, C5,R4,B4,R4, A4,R4,G4,R4, F4,R4,G4,R4,
       A4,R4,C5,R4, D5,R4,E5,R4, D5,R4,C5,R4, A4,R4,G4,R4],
      [C5,R4,B4,R4, A4,R4,B4,R4, G4,R4,A4,R4, C5,R4,B4,R4,
       A4,R4,G4,R4, F4,R4,G4,R4, A4,R4,C5,R4, D5,R4,C5,R4],
      [E5,R4,D5,R4, C5,R4,D5,R4, B4,R4,C5,R4, A4,R4,B4,R4,
       C5,R4,D5,R4, E5,R4,G5,R4, F5,R4,E5,R4, D5,R4,C5,R4],
    ];
    const pads=[
      {0:[_NOTE.A2,_NOTE.C4,_NOTE.E4],4:[_NOTE.D2,_NOTE.F4,_NOTE.A3],8:[_NOTE.E2,_NOTE.G4,_NOTE.B3],12:[_NOTE.G2,_NOTE.C4,_NOTE.E4],16:[_NOTE.A2,_NOTE.C4,_NOTE.E4],20:[_NOTE.D2,_NOTE.F4,_NOTE.A3],24:[_NOTE.E2,_NOTE.G4,_NOTE.B3],28:[_NOTE.G2,_NOTE.C4,_NOTE.E4]},
      {0:[_NOTE.G2,_NOTE.B3,_NOTE.D4],4:[_NOTE.C3,_NOTE.E4,_NOTE.G4],8:[_NOTE.D2,_NOTE.F4,_NOTE.A3],12:[_NOTE.A2,_NOTE.C4,_NOTE.E4],16:[_NOTE.G2,_NOTE.B3,_NOTE.D4],20:[_NOTE.C3,_NOTE.E4,_NOTE.G4],24:[_NOTE.D2,_NOTE.F4,_NOTE.A3],28:[_NOTE.A2,_NOTE.C4,_NOTE.E4]},
      {0:[_NOTE.D2,_NOTE.F4,_NOTE.A3],4:[_NOTE.E2,_NOTE.G4,_NOTE.B3],8:[_NOTE.A2,_NOTE.C4,_NOTE.E4],12:[_NOTE.G2,_NOTE.B3,_NOTE.D4],16:[_NOTE.D2,_NOTE.F4,_NOTE.A3],20:[_NOTE.E2,_NOTE.G4,_NOTE.B3],24:[_NOTE.A2,_NOTE.C4,_NOTE.E4],28:[_NOTE.G2,_NOTE.B3,_NOTE.D4]},
      {0:[_NOTE.A2,_NOTE.C4,_NOTE.E4],4:[_NOTE.G2,_NOTE.B3,_NOTE.D4],8:[_NOTE.D2,_NOTE.F4,_NOTE.A3],12:[_NOTE.E2,_NOTE.G4,_NOTE.B3],16:[_NOTE.A2,_NOTE.C4,_NOTE.E4],20:[_NOTE.G2,_NOTE.B3,_NOTE.D4],24:[_NOTE.D2,_NOTE.F4,_NOTE.A3],28:[_NOTE.E2,_NOTE.G4,_NOTE.B3]},
    ];
    const leadLayers=[
      null, // p0: no layer
      null, // p1: no layer
      [ // cycle 1: soft horn doubling a third above the main line
        [R4,R4,C5,R4, E5,R4,R4,R4, C5,R4,A4,R4, R4,R4,R4,R4,
         A4,R4,C5,R4, E5,R4,G5,R4, R4,R4,E5,R4, D5,R4,R4,R4],
        [G4,R4,A4,R4, C5,R4,B4,R4, R4,R4,R4,R4, F4,R4,R4,R4,
         A4,R4,C5,R4, D5,R4,E5,R4, R4,R4,C5,R4, R4,R4,G4,R4],
        [C5,R4,B4,R4, A4,R4,R4,R4, G4,R4,A4,R4, C5,R4,R4,R4,
         R4,R4,G4,R4, F4,R4,R4,R4, A4,R4,C5,R4, D5,R4,R4,R4],
        [E5,R4,D5,R4, C5,R4,R4,R4, B4,R4,C5,R4, R4,R4,B4,R4,
         C5,R4,D5,R4, E5,R4,G5,R4, F5,R4,R4,R4, D5,R4,R4,R4],
      ],
      [ // cycle 2: walking counter-melody filling the gaps
        [A4,R4,C5,R4, E5,R4,D5,R4, C5,R4,A4,R4, G4,R4,A4,R4,
         A4,R4,C5,R4, E5,R4,G5,R4, F5,R4,E5,R4, D5,R4,C5,R4],
        [G4,R4,A4,R4, C5,R4,B4,R4, A4,R4,G4,R4, F4,R4,G4,R4,
         A4,R4,C5,R4, D5,R4,E5,R4, D5,R4,C5,R4, A4,R4,G4,R4],
        [C5,R4,B4,R4, A4,R4,B4,R4, G4,R4,A4,R4, C5,R4,B4,R4,
         A4,R4,G4,R4, F4,R4,G4,R4, A4,R4,C5,R4, D5,R4,C5,R4],
        [E5,R4,D5,R4, C5,R4,D5,R4, B4,R4,C5,R4, A4,R4,B4,R4,
         C5,R4,D5,R4, E5,R4,G5,R4, F5,R4,E5,R4, D5,R4,C5,R4],
      ],
    ];
    return {
      name:"ACID JAZZ", bpm:104, steps:32, drums, bass, leads, pads, phraseLens:[2,2,1,1],
      numCycles:3, leadLayers,
      bassType:"triangle", bassCut:700, bassDur:0.24,
      padType:"triangle", padCut:2600, padDur:0.7,
      leadType:"triangle", leadCut:3800, leadDur:0.3, vib:10,
      layerType:"triangle", layerCut:3400, layerDur:0.3,
      kickTop:110, kickBot:44,
    };
  }
}

/* ---------------------------------------------------------------------------
 * Input handler
 * -------------------------------------------------------------------------
 * Tracks currently-held keys in a Set. Keydown fires once per press
 * (auto-repeat ignored via e.repeat) which is what we want for actions like
 * shooting; held movement reads from the Set each frame.
 * ------------------------------------------------------------------------- */

/* ---- standalone player wrapper ------------------------------------------ */
(function () {
  function makeSfx(ctx) {
    const master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 1.0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return { ctx, master, noiseBuffer: buf };
  }

  /** Resolve a note token to {hz, mul}. Tokens: "A4" (1x), "A4:2" (2x = croche),
   * "A4:3" (3x = dotted croche), "A4:4" (4x = quarter). Numbers pass through as Hz. */
  function resolveNote(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return { hz: v, mul: 1 };
    if (typeof v === 'string') {
      const m = v.match(/^([A-G][#b]?[1-5])(?::([1-8]))?$/);
      if (m && Object.prototype.hasOwnProperty.call(_NOTE, m[1])) {
        return { hz: _NOTE[m[1]], mul: m[2] ? parseInt(m[2], 10) : 1 };
      }
    }
    throw new Error('Bad note token: ' + JSON.stringify(v));
  }
  function resolvePhrase(arr) { return arr.map(resolveNote); }

  function buildTrack(t) {
    const drums = t.drums.map(set => set.map(d => ({ k: !!d.k, s: !!d.s, h: !!d.h })));
    // bass: single 32-step phrase OR a per-phrase bank (same length as leads).
    const isBassBank = Array.isArray(t.bass) && t.bass.length > 0 && Array.isArray(t.bass[0]);
    const bass = isBassBank ? t.bass.map(resolvePhrase) : resolvePhrase(t.bass);
    const leads = t.leads.map(resolvePhrase);
    const pads = t.pads.map(p => {
      const o = {};
      for (const k in p) o[k] = p[k].map(n => resolveNote(n));
      return o;
    });
    let leadLayers = null;
    if (t.leadLayers) {
      // v2 flat form: one 32-step phrase (or null) per phrase index.
      // Legacy nested form (banks of phrases indexed by level) is normalized:
      // a non-null bank contributes its first phrase to each level slot.
      const arr = t.leadLayers;
      const looksNested = arr.some(b => b !== null && Array.isArray(b) && Array.isArray(b[0]) && b[0].length === (t.steps || 32));
      if (looksNested) {
        leadLayers = arr.map(bank => bank === null ? null : resolvePhrase(bank[0]));
      } else {
        leadLayers = arr.map(b => b === null ? null : resolvePhrase(b));
      }
    }
    return {
      name: t.name, bpm: t.bpm, steps: t.steps || 32,
      drums, bass, leads, pads,
      phraseLens: t.phraseLens || [1,1,1,1],
      drumLevels: t.drumLevels || null,
      numCycles: t.numCycles || 3,
      leadLayers,
      bassType:t.bassType, bassCut:t.bassCut, bassDur:t.bassDur,
      padType:t.padType, padCut:t.padCut, padDur:t.padDur,
      leadType:t.leadType, leadCut:t.leadCut, leadDur:t.leadDur, vib:t.vib,
      layerType:t.layerType, layerCut:t.layerCut, layerDur:t.layerDur,
      kickTop:t.kickTop, kickBot:t.kickBot,
    };
  }

  function Player(opts) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.seq = new MusicSequencer(makeSfx(this.ctx));
    // Replace seq.tracks with resolved tracks.
    this.seq.tracks = opts.tracks.map(buildTrack);
    this.muted = false;
  }
  Player.prototype.start = function (i) {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.seq.start(i == null ? 0 : i);
  };
  Player.prototype.stop = function () { this.seq.stop(); };
  Player.prototype.pause = function () { this.seq.pause(); };
  Player.prototype.resume = function () { this.seq.resume(); };
  Player.prototype.setTrack = function (i) { this.seq.setTrack(i); };
  Player.prototype.next = function () { this.seq.next(); };
  Player.prototype.shuffleNext = function () { this.seq.shuffleNext(); };
  Player.prototype.seekToStep = function (absStep) { this.seq.seekToStep(absStep); };
  Object.defineProperty(Player.prototype, 'current', { get() { return this.seq.current; } });
  Object.defineProperty(Player.prototype, 'playing', { get() { return this.seq.playing; } });
  Player.prototype.getNames = function () { return this.seq.tracks.map(t => t.name); };
  Player.prototype.toggleMute = function () {
    this.muted = !this.muted;
    const t = this.ctx.currentTime;
    this.seq.master.gain.cancelScheduledValues(t);
    this.seq.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, t, 0.01);
    return this.muted;
  };

  window.MusicEngine = {
    createTracks(jsonArray) { return jsonArray.map(buildTrack); },
    Player,
  };
})();
