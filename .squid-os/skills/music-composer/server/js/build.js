// notes.js is a classic script loaded before this module (see index.html); it puts _NOTE on window.
const _NOTE = window._NOTE;
/** Resolve a note token to {hz, mul}. Tokens: "A4" (1x), "A4:2" (2x = croche),
   * "A4:3" (3x = dotted croche), "A4:4" (4x = quarter). Numbers pass through as Hz. */
  export function resolveNote(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return { hz: v, mul: 1 };
    if (typeof v === 'string') {
      const m = v.match(/^([A-G][#b]?[1-6])(?::([1-8]))?$/);
      if (m && Object.prototype.hasOwnProperty.call(_NOTE, m[1])) {
        return { hz: _NOTE[m[1]], mul: m[2] ? parseInt(m[2], 10) : 1 };
      }
    }
    throw new Error('Bad note token: ' + JSON.stringify(v));
  }
  export function resolveMeasure(arr) { return arr.map(resolveNote); }

  export function buildTrack(t) {
    const stepsPerMeasure = t.stepsPerMeasure || t.steps || 32;
    const drums = (t.drumSets || t.drums).map(set => set.map(d => ({ k: !!d.k, s: !!d.s, h: !!d.h, c: !!d.c, oh: d.oh === true, v: (typeof d.v === 'number') ? d.v : undefined })));
    // bass: single measure OR a per-measure bank (same length as leads).
    const isBassBank = Array.isArray(t.bass) && t.bass.length > 0 && Array.isArray(t.bass[0]);
    const bass = isBassBank ? t.bass.map(resolveMeasure) : resolveMeasure(t.bass);
    const leads = t.leads.map(resolveMeasure);
    const pads = t.pads.map(p => {
      const o = {};
      for (const k in p) o[k] = p[k].map(n => resolveNote(n));
      return o;
    });
    let leadLayers = null;
    if (t.leadLayers) {
      // Flat form: one measure (or null) per measure index.
      // Legacy nested form (banks of measures indexed by level) is normalized:
      // a non-null bank contributes its first measure to each level slot.
      const arr = t.leadLayers;
      const looksNested = arr.some(b => b !== null && Array.isArray(b) && Array.isArray(b[0]) && b[0].length === stepsPerMeasure);
      if (looksNested) {
        leadLayers = arr.map(bank => bank === null ? null : resolveMeasure(bank[0]));
      } else {
        leadLayers = arr.map(b => b === null ? null : resolveMeasure(b));
      }
    }
    return {
      name: t.name, bpm: t.bpm,
      stepsPerMeasure,
      beatsInMeasure: t.beatsInMeasure || 4,
      parts: t.parts || t.sections || [],
      drumSets: drums,
      drumLevels: t.drumLevels || null,   // per-measure drum-set index (authoritative from backbone)
      bass, leads, pads,
      phraseLens: t.phraseLens || t.leads.map(() => 1), // legacy alias: every unit is one measure
      numCycles: t.numCycles || 3,
      leadLayers,
      bassType:t.bassType, bassCut:t.bassCut, bassDur:t.bassDur,
      padType:t.padType, padCut:t.padCut, padDur:t.padDur,
      leadType:t.leadType, leadCut:t.leadCut, leadDur:t.leadDur, vib:t.vib,
      layerType:t.layerType, layerCut:t.layerCut, layerDur:t.layerDur,
      kickTop:t.kickTop, kickBot:t.kickBot,
    };
  }
