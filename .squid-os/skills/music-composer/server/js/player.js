import { makeSfx } from './sfx.js';
import { buildTrack } from './build.js';

/**
 * Player facade — one AudioContext + MusicSequencer over a resolved track list.
 * Mirrors the legacy window.MusicEngine.Player API:
 *   new Player({ tracks }) -> start(i), stop(), pause(), resume(), setTrack(i),
 *   next(), shuffleNext(), seekToStep(abs), toggleMute(), current, playing,
 *   getNames()
 */
export class Player {
  constructor(opts) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    // sequencer.js is a classic script (loaded before this module) so it puts
    // MusicSequencer on window.
    this.seq = new window.MusicSequencer(makeSfx(this.ctx));
    // Replace seq.tracks with resolved tracks.
    this.seq.tracks = opts.tracks.map(buildTrack);
    this.muted = false;
  }

  start(i) {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.seq.start(i == null ? 0 : i);
  }
  stop() { this.seq.stop(); }
  pause() { this.seq.pause(); }
  resume() { this.seq.resume(); }
  setTrack(i) { this.seq.setTrack(i); }
  next() { this.seq.next(); }
  shuffleNext() { this.seq.shuffleNext(); }
  seekToStep(absStep) { this.seq.seekToStep(absStep); }
  getNames() { return this.seq.tracks.map(t => t.name); }

  get current() { return this.seq.current; }
  get playing() { return this.seq.playing; }

  toggleMute() {
    this.muted = !this.muted;
    const t = this.ctx.currentTime;
    this.seq.master.gain.cancelScheduledValues(t);
    this.seq.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, t, 0.01);
    return this.muted;
  }
}
