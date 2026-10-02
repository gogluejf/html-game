/* compiler.js — universal-format (backbone + parts) -> engine grid track.
 * JS port of scripts/universal.py compile(). One code path: the jukebox always
 * plays compiled grids; new-format songs are compiled here at load time. */

const STEPS = 32;

/** Resolve a time signature string to steps-per-bar at 16th-note resolution.
 * "4/4" → 16, "3/4" → 12, "6/8" → 24, "7/8" → 28, "5/4" → 20, etc.
 * The denominator tells us the note value: /4 = quarter (4 sixteenth-steps),
 * /8 = eighth (2 sixteenth-steps), /2 = half (8 sixteenth-steps). */
function resolveTimeSig(timeSig) {
  if (!timeSig || typeof timeSig !== 'string') return 16; // default 4/4
  const m = timeSig.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return 16;
  const beats = parseInt(m[1], 10);
  const denom = parseInt(m[2], 10);
  // Sixteenth-note steps per beat: 4/(denom/4) = 16/denom * 4... 
  // Actually: a /4 note = 4 sixteenth steps, a /8 note = 2 sixteenth steps, a /2 note = 8 sixteenth steps
  const stepsPerBeat = 16 / denom * 4; // /4→4, /8→2, /2→8, /16→1
  // Wait: 16th note resolution means each step IS a 16th note.
  // A quarter note (/4) = 4 sixteenth notes = 4 steps
  // An eighth note (/8) = 2 sixteenth notes = 2 steps  
  // A half note (/2) = 8 sixteenth notes = 8 steps
  const spb = 4 / (denom / 4); // /4→4, /8→2, /2→8
  return beats * spb;
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
  const start = bassOverride ? _SEMITONES[bassOverride] : _SEMITONES[root];
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

function expandKitEntry(entry) {
  // Verbatim 32-step form (list of {k,s,h}) — lossless migration format.
  if (Array.isArray(entry)) {
    return entry.slice(0, STEPS).map(d => ({ k: !!d.k, s: !!d.s, h: !!d.h, c: !!d.c, oh: d.oh === true, v: (typeof d.v === 'number') ? d.v : undefined }));
  }
  // Beat-notation form (dict): kick/snare beat positions or named patterns.
  const k = new Set(), s = new Set(), h = new Set(), c = new Set(), openHats = new Set();
  const named = { quarters: 4, eighths: 2, sixteenths: 1 };
  for (const inst of ['kick', 'snare']) {
    const val = entry[inst];
    if (!val) continue;
    if (typeof val === 'string' && val in named) {
      for (let i = 0; i < STEPS; i += named[val]) (inst === 'kick' ? k : s).add(i);
    } else {
      for (const beat of String(val).split(/\s+/)) {
        (inst === 'kick' ? k : s).add(Math.round(parseFloat(beat) * 4));
      }
    }
  }
  const hat = entry.hat;
  if (hat) {
    if (typeof hat === 'string' && hat in named) {
      for (let i = 0; i < STEPS; i += named[hat]) h.add(i);
    } else {
      for (const beat of String(hat).split(/\s+/)) h.add(Math.round(parseFloat(beat) * 4));
    }
  }
  // Open hats: explicit beat list, each marked oh=true.
  const ohat = entry.openHat;
  if (ohat) {
    if (typeof ohat === 'string' && ohat in named) {
      for (let i = 0; i < STEPS; i += named[ohat]) h.add(i), openHats.add(i);
    } else {
      for (const beat of String(ohat).split(/\s+/)) { const i = Math.round(parseFloat(beat) * 4); h.add(i); openHats.add(i); }
    }
  }
  // Crash cymbal: explicit beat list.
  const crash = entry.crash;
  if (crash) {
    if (typeof crash === 'string' && crash in named) {
      for (let i = 0; i < STEPS; i += named[crash]) c.add(i);
    } else {
      for (const beat of String(crash).split(/\s+/)) c.add(Math.round(parseFloat(beat) * 4));
    }
  }
  return Array.from({ length: STEPS }, (_, i) => ({ k: k.has(i), s: s.has(i), h: h.has(i), c: c.has(i), oh: openHats.has(i) || undefined }));
}

/** bars (arrays of cells each) -> flat cells (identity, padded to stepWidth/bar). */
function barsToCells(bars, stepWidth = 16) {
  const out = [];
  for (const bar of bars) {
    const b = bar.slice(0, stepWidth);
    while (b.length < stepWidth) b.push(null);
    out.push(...b);
  }
  return out;
}

/** Compile a universal backbone+parts pair into an engine grid track. */
export function compile(backbone, parts) {
  const form = backbone.form;
  const kit = parts.drumKit || {};
  const voices = parts.voices || {};

  // Resolve time signature to steps-per-bar (16th-note resolution).
  // "4/4" → 16, "3/4" → 12, "6/8" → 24, "7/8" → 28
  const stepWidth = resolveTimeSig(backbone.timeSig);

  const bassSingle = !!parts._bass_single;
  let sharedBass = null;
  if (bassSingle) {
    const first = form[0].section;
    sharedBass = barsToCells((parts.bass || {})[first] || [[...Array(stepWidth).fill(null)]], stepWidth).slice(0, STEPS);
  }
  const secContent = {};
  for (const sec of new Set(form.map(f => f.section))) {
    const leadBars = (parts.lead || {})[sec] || [[...Array(stepWidth).fill(null)]];
    const layerBars = (parts.layer || {})[sec];
    const bassBars = (parts.bass || {})[sec] || [[...Array(stepWidth).fill(null)]];
    secContent[sec] = {
      lead: barsToCells(leadBars, stepWidth),
      layer: layerBars ? barsToCells(layerBars, stepWidth) : null,
      bass: barsToCells(bassBars, stepWidth),
      pad: (parts.pad || {})[sec] || {},
    };
  }

  const phrases = [];
  const secBarOffset = {};
  for (const f of form) {
    const sec = f.section;
    const nph = f.bars / 2;
    if (nph < 1) throw new Error(`section ${sec}: bars must be >= 2`);
    const s = secContent[sec];
    const drumSet = expandKitEntry(kit[f.drums] || {});
    const off = secBarOffset[sec] || 0;
    for (let p = 0; p < nph; p++) {
      const gbar = off + p * 2;
      const lo = gbar * stepWidth, hi = (gbar + 2) * stepWidth;
      const padMap = {};
      for (const [stKey, notes] of Object.entries(s.pad)) {
        const stAbs = parseInt(stKey, 10);
        if (stAbs >= lo && stAbs < hi) padMap[String(stAbs - lo)] = notes;
      }
      const bassSlice = bassSingle ? sharedBass : s.bass.slice(lo, hi);
      phrases.push({
        lead: s.lead.slice(lo, hi),
        layer: s.layer ? s.layer.slice(lo, hi) : null,
        bass: bassSlice,
        pad: padMap,
        drums: drumSet,
      });
    }
    secBarOffset[sec] = off + nph * 2;
  }

  // Dedupe drum sets in level order (matches source slot layout).
  const uniqueSets = [], setIdx = new Map();
  for (const lvl of [...new Set(form.map(f => parseInt(f.drums.replace('lvl',''), 10)))].sort((a,b)=>a-b)) {
    const entry = kit['lvl' + lvl];
    if (Array.isArray(entry)) {
      const key = JSON.stringify(entry.slice(0, STEPS).map(d => [!!d.k, !!d.s, !!d.h]));
      if (!setIdx.has(key)) {
        setIdx.set(key, uniqueSets.length);
        uniqueSets.push(entry.slice(0, STEPS).map(d => ({ k: !!d.k, s: !!d.s, h: !!d.h })));
      }
    }
  }
  for (const ph of phrases) {
    const key = JSON.stringify(ph.drums.map(d => [!!d.k, !!d.s, !!d.h]));
    if (!setIdx.has(key)) {
      setIdx.set(key, uniqueSets.length);
      uniqueSets.push(ph.drums.map(d => ({ k: !!d.k, s: !!d.s, h: !!d.h })));
    }
  }

  // Per-phrase drum level table. Authoritative source = backbone form's drum
  // assignment: each phrase gets the setIdx of ITS OWN section's pattern.
  // This guarantees the engine plays exactly what the architect assigned —
  // not a dedup-order coincidence.
  const drumLevels = form.flatMap(f =>
    Array.from({ length: f.bars / 2 }, () => setIdx.get(JSON.stringify(
      expandKitEntry(kit[f.drums] || {}).map(d => [!!d.k, !!d.s, !!d.h])))));

  const allBassSame = new Set(phrases.map(p => JSON.stringify(p.bass))).size === 1;
  const track = {
    name: backbone.name,
    timeSig: backbone.timeSig || "4/4",
    bpm: backbone.bpm,
    steps: STEPS,
    drums: uniqueSets,
    drumLevels,
    phraseLens: form.map(f => f.bars / 2),
    sections: form,
    leads: phrases.map(ph => ph.lead),
    pads: phrases.map(ph => ph.pad),
    bass: allBassSame ? phrases[0].bass : phrases.map(ph => ph.bass),
    leadLayers: phrases.map(ph => ph.layer),
  };
  for (const [k, v] of Object.entries(voices)) if (v != null) track[k] = v;
  for (const k of ['genre', 'vibe', 'createdAt', 'revision']) {
    if (parts[k] != null) track[k] = parts[k];
  }
  return track;
}
