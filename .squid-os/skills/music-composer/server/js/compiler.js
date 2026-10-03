/* compiler.js — measure-based architecture.
 * backbone (architect) + parts (composer) -> flat per-measure engine grid.
 *
 * Vocabulary: song → part → measure → beat → step (16th-note tick).
 * The architect drives everything: parts, measure counts, bpm, timeSig, and
 * which drum track each part plays. The compiler stores notes verbatim per
 * measure. The engine is a dumb player walking measures in order. */

/** Resolve a time signature to steps-per-measure at 16th-note resolution.
 * "4/4" → 16, "3/4" → 12, "6/8" → 24, "7/8" → 28, "5/4" → 20.
 * Standard sigs (denom 2/4/8) resolve exactly: a /4 note = 4 sixteenth-steps,
 * a /8 note = 2, a /2 note = 8. Exotic sigs (e.g. 4/7) fall back to the
 * 4-steps-per-beat convention and are rounded to an integer grid. */
export function resolveTimeSig(timeSig) {
  if (!timeSig || typeof timeSig !== 'string') return 16; // default 4/4
  const m = timeSig.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return 16;
  const beats = parseInt(m[1], 10);
  const denom = parseInt(m[2], 10);
  const spb = (denom === 2 || denom === 4 || denom === 8) ? 4 / (denom / 4) : 4;
  return Math.round(beats * spb);
}

const _SEMITONES = { C:0,"C#":1,D:2,"D#":3,E:4,F:5,"F#":6,G:7,"G#":8,A:9,"A#":10,B:11 };
const _FROM_SEMI = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const _QUALITY_INTERVALS = {
  "m": [0,3,7], "7": [0,4,7,10], "m7": [0,3,7,10],
  "maj7": [0,4,7,11], "dim": [0,3,6], "aug": [0,4,8],
};

function chordNotes(name, rootOct = 1) {
  const m = name.match(/^([A-G])(#?)(?:\/([A-G]))?(m7|maj7|dim|aug|7|m)?$/);
  if (!m) throw new Error('unknown chord: ' + name);
  const [, root, , bassOverride, quality] = m;
  const intervals = quality ? _QUALITY_INTERVALS[quality] : [0, 4, 7];
  const start = bassOverride ? _SEMITONES[root] : _SEMITONES[root];
  const out = [];
  let cur = start;
  for (const iv of intervals) {
    let semi = start + iv;
    while (semi <= cur) semi += 12;
    const octv = rootOct + Math.floor(semi / 12);
    out.push(_FROM_SEMI[semi % 12] + octv);
    cur = semi;
  }
  return out;
}

/** Expand one drum-track entry into a per-measure grid of {k,s,h,c,oh}.
 * Grid width = stepsPerMeasure (NOT a fixed constant). Beat notation "N"
 * maps to step N * stepsPerBeat so it stays correct for any timeSig.
 * Named patterns (quarters/eighths/sixteenths) tile the measure grid.
 * Legacy 32-step verbatim grids are resampled onto the measure grid. */
function expandKitEntry(entry, stepsPerMeasure, stepsPerBeat) {
  const namedSteps = { quarters: 4, eighths: 2, sixteenths: 1 }; // in 16th units
  const k = new Set(), s = new Set(), h = new Set(), c = new Set(), openHats = new Set();
  const addNamed = (set, inst, val) => {
    const unit = namedSteps[val]; // 16th-note spacing
    for (let i = 0; i < stepsPerMeasure; i += unit) set.add(i);
  };
  const addBeats = (set, val, stepsPerBeat) => {
    for (const beat of String(val).split(/\s+/)) {
      const f = parseFloat(beat);
      if (Number.isNaN(f)) continue;
      const step = Math.round(f * stepsPerBeat);
      if (step >= 0 && step < stepsPerMeasure) set.add(step);
    }
  };
  if (Array.isArray(entry)) {
    // Verbatim form (list of {k,s,h}). The measure grid is 16th-note
    // resolution: 4/4 → 16 steps. Legacy grids stored at 32-step width are
    // downsampled 2:1 (step j = old step 2j) so beat positions stay exact;
    // any other mismatched width falls back to proportional resampling.
    if (entry.length === stepsPerMeasure) {
      return entry.map(d => ({ k: !!d.k, s: !!d.s, h: !!d.h, c: !!d.c, oh: d.oh === true,
        v: (typeof d.v === 'number') ? d.v : undefined }));
    }
    const out = [];
    for (let i = 0; i < stepsPerMeasure; i++) {
      let d;
      if (entry.length === stepsPerMeasure * 2) {
        d = entry[i * 2] || {};                      // exact 2:1 downsample
      } else {
        const j = Math.min(entry.length - 1, Math.floor(i * entry.length / stepsPerMeasure));
        d = entry[j] || {};                          // proportional resample
      }
      out.push({ k: !!d.k, s: !!d.s, h: !!d.h, c: !!d.c, oh: d.oh === true,
        v: (typeof d.v === 'number') ? d.v : undefined });
    }
    return out;
  }
  if (!entry || typeof entry !== 'object') return null;
  // stepsPerBeat: precomputed by caller (stepsPerMeasure / beatsInMeasure).
  const spb = stepsPerBeat || 4;
  for (const inst of ['kick', 'snare']) {
    const val = entry[inst];
    if (!val) continue;
    const target = inst === 'kick' ? k : s;
    if (typeof val === 'string' && val in namedSteps) addNamed(target, inst, val);
    else addBeats(target, val, spb);
  }
  if (entry.hat) {
    if (typeof entry.hat === 'string' && entry.hat in namedSteps) addNamed(h, 'hat', entry.hat);
    else addBeats(h, entry.hat, spb);
  }
  if (entry.openHat) {
    if (typeof entry.openHat === 'string' && entry.openHat in namedSteps) {
      addNamed(h, 'openHat', entry.openHat);
      for (let i = 0; i < stepsPerMeasure; i += namedSteps[entry.openHat]) openHats.add(i);
    } else {
      addBeats(h, entry.openHat, spb);
      for (const beat of String(entry.openHat).split(/\s+/)) {
        const f = parseFloat(beat);
        if (!Number.isNaN(f)) { const st = Math.round(f * spb); if (st >= 0 && st < stepsPerMeasure) openHats.add(st); }
      }
    }
  }
  if (entry.crash) {
    if (typeof entry.crash === 'string' && entry.crash in namedSteps) addNamed(c, 'crash', entry.crash);
    else addBeats(c, entry.crash, spb);
  }
  return Array.from({ length: stepsPerMeasure }, (_, i) => ({
    k: k.has(i), s: s.has(i), h: h.has(i), c: c.has(i), oh: openHats.has(i) || undefined,
  }));
}

/** measures (arrays of cells each) -> flat cells, padded to stepWidth/measure. */
function measuresToCells(measures, stepWidth) {
  const out = [];
  for (const m of measures) {
    const mm = m.slice(0, stepWidth);
    while (mm.length < stepWidth) mm.push(null);
    out.push(...mm);
  }
  return out;
}

/** Normalize a backbone to the new schema (parts/measures/drum).
 * Accepts both new ("parts") and legacy ("form" with section/bars/drums). */
function normalizeBackbone(backbone) {
  if (Array.isArray(backbone.parts)) return backbone;
  const form = backbone.form || [];
  return {
    name: backbone.name,
    bpm: backbone.bpm,
    timeSig: backbone.timeSig,
    parts: form.map(f => ({
      part: f.part || f.section,
      measures: f.measures != null ? f.measures : f.bars,
      drum: f.drum || f.drums,
    })),
  };
}

/** Compile a backbone+parts pair into a flat per-measure engine grid. */
export function compile(rawBackbone, parts) {
  const backbone = normalizeBackbone(rawBackbone);
  const partList = backbone.parts;
  const kit = parts.drumKit || {};
  const voices = parts.voices || {};

  const timeSig = backbone.timeSig || "4/4";
  const stepsPerMeasure = resolveTimeSig(timeSig);
  const tsigMatch = timeSig.match(/^(\d+)\s*\/\s*(\d+)$/);
  const beatsInMeasure = tsigMatch ? parseInt(tsigMatch[1], 10) : 4;
  const stepsPerBeat = stepsPerMeasure / beatsInMeasure;

  const bassSingle = !!parts._bass_single;
  let sharedBass = null;
  if (bassSingle) {
    const first = partList[0].part;
    sharedBass = measuresToCells((parts.bass || {})[first] || [[...Array(stepsPerMeasure).fill(null)]], stepsPerMeasure)
      .slice(0, stepsPerMeasure);
  }

  // Per-part content (repeated part names reuse the same material).
  const partContent = {};
  for (const p of new Set(partList.map(p => p.part))) {
    const leadM = (parts.lead || {})[p] || [[...Array(stepsPerMeasure).fill(null)]];
    const layerM = (parts.layer || {})[p];
    const bassM = (parts.bass || {})[p] || [[...Array(stepsPerMeasure).fill(null)]];
    partContent[p] = {
      lead: measuresToCells(leadM, stepsPerMeasure),
      layer: layerM ? measuresToCells(layerM, stepsPerMeasure) : null,
      bass: measuresToCells(bassM, stepsPerMeasure),
      pad: (parts.pad || {})[p] || {},
    };
  }

  // Walk parts in order, emitting ONE measure object per measure.
  const measures = [];
  const partMeasureOffset = {};
  for (const pf of partList) {
    const n = pf.measures;
    if (!Number.isInteger(n) || n < 2) {
      throw new Error(`part ${pf.part}: measures must be an integer >= 2 (got ${n})`);
    }
    const pc = partContent[pf.part];
    const off = partMeasureOffset[pf.part] || 0;
    for (let m = 0; m < n; m++) {
      const gMeasure = off + m;
      const lo = gMeasure * stepsPerMeasure, hi = lo + stepsPerMeasure;
      const padMap = {};
      for (const [stKey, notes] of Object.entries(pc.pad)) {
        const stAbs = parseInt(stKey, 10);
        if (stAbs >= lo && stAbs < hi) padMap[String(stAbs - lo)] = notes;
      }
      const bassSlice = bassSingle ? sharedBass : pc.bass.slice(lo, hi);
      measures.push({
        lead: pc.lead.slice(lo, hi),
        layer: pc.layer ? pc.layer.slice(lo, hi) : null,
        bass: bassSlice,
        pad: padMap,
        drum: pf.drum, // drum TRACK NAME — resolved to a set index below
      });
    }
    partMeasureOffset[pf.part] = off + n;
  }

  // Dedupe drum tracks into numbered sets (order = first appearance in parts).
  const drumSets = [], setIdx = new Map();
  const ensureSet = (grid) => {
    const key = JSON.stringify(grid.map(d => [!!d.k, !!d.s, !!d.h, !!d.c, !!d.oh]));
    if (!setIdx.has(key)) {
      setIdx.set(key, drumSets.length);
      drumSets.push(grid.map(d => ({ k: !!d.k, s: !!d.s, h: !!d.h, c: !!d.c, oh: d.oh || undefined })));
    }
    return setIdx.get(key);
  };
  for (const m of measures) {
    const entry = kit[m.drum];
    const grid = entry ? expandKitEntry(entry, stepsPerMeasure, stepsPerBeat)
      : Array.from({ length: stepsPerMeasure }, () => ({ k: false, s: false, h: false }));
    m.drum = ensureSet(grid);
  }

  const allBassSame = new Set(measures.map(mm => JSON.stringify(mm.bass))).size === 1;
  const track = {
    name: backbone.name,
    timeSig,
    bpm: backbone.bpm,
    stepsPerMeasure,
    beatsInMeasure,
    parts: partList,                       // architect's plan, verbatim (UI timeline)
    measures,                              // flat, one entry per measure, song order
    drumSets,                              // unique expanded drum grids
    leads: measures.map(mm => mm.lead),
    pads: measures.map(mm => mm.pad),
    bass: allBassSame ? measures[0].bass : measures.map(mm => mm.bass),
    leadLayers: measures.map(mm => mm.layer),
    // Legacy aliases so old engine code paths keep working during migration:
    steps: stepsPerMeasure,
    drums: drumSets,
    phraseLens: measures.map(() => 1),     // legacy alias (every unit = one measure)
    drumLevels: measures.map(mm => mm.drum),
    sections: partList,
  };
  for (const [k, v] of Object.entries(voices)) if (v != null) track[k] = v;
  for (const k of ['genre', 'vibe', 'createdAt', 'revision', 'uuid']) {
    if (parts[k] != null) track[k] = parts[k];
  }
  return track;
}
