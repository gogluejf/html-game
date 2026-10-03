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
  C6:1046.50,D6:1174.66,E6:1318.51,F6:1396.91,G6:1567.98,A6:1760.00,B6:1975.53,
};
// Sharps/flats: same physical pitches, spelled up (#) or down (b).
for (const [sharp, flat] of [["C#","Db"],["D#","Eb"],["F#","Gb"],["G#","Ab"],["A#","Bb"]]) {
  for (let o = 1; o <= 6; o++) {
    const hz = _NOTE[sharp[0] + o] * Math.pow(2, 1 / 12);
    _NOTE[sharp + o] = hz;
    _NOTE[flat + o] = hz; // alias — prefer # spelling in compositions
  }
}
const R = null; // rest


// Exposed for module consumers (build.js) — classic-script scope is otherwise private.
window._NOTE = _NOTE;
