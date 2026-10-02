/* SongController — single source of truth for playback state.
 * Ported verbatim from the standalone jukebox template (behavior spec intact):
 * seq/rep/shf modes, seamless song-end transitions, favorites + prefs in
 * localStorage, manual dot placement while paused, always-on action log. */
export class SongController {
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
      if (typeof p.cur === 'number' && p.cur >= 0 && p.cur < this.tracks.length) this.current = p.cur;
    } catch (e) {}
  }
  _savePrefs() {
    try { localStorage.setItem('jukebox-prefs', JSON.stringify({ seq: this.seq, rep: this.rep, shf: this.shf, favs: this.favorites, cur: this.current })); } catch (e) {}
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
    return '<svg viewBox="0 0 24 24" ' + (on ? 'fill="#ff3b5c" stroke="#ff3b5c"' : 'fill="none" stroke="currentColor"') + ' stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  }

  init() {
    if (this.player) return;
    this.player = new window.MusicPlayer.Player({ tracks: this.tracks });
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
      this._savePrefs();
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
    this._savePrefs();
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
    // If we've never started anything (fresh page), start the current track
    // (restored from localStorage if available).
    if (!this.player || this._neverStarted) { this.play(this.current); return; }
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
    this._savePrefs();
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
