// Pure editor playback model. Stored frames stay in source order; the cursor
// tracks visits (including the return leg), not just the visible frame index.
export function frameSequence(st){
  const n = st.frames.length;
  const seq = Array.from({length:n}, (_, i) => i);
  const direction = st.direction || 'forward';
  if (direction === 'reverse' || direction === 'ping_pong_reverse') seq.reverse();
  if (n > 1 && direction.startsWith('ping_pong')){
    const back = seq.slice(0, -1).reverse();
    // In a loop the starting endpoint belongs to the NEXT cycle.
    if ((st.playback || 'loop') === 'loop') back.pop();
    seq.push(...back);
  }
  return seq;
}

export function resetSequence(st){
  st.sequencePos = 0;
  st.elapsedUnits = 0;
  st.completed = false;
  st.frameIdx = frameSequence(st)[0] ?? 0;
}

export function seekSequence(st, index){
  const seq = frameSequence(st);
  st.sequencePos = Math.max(0, seq.indexOf(index));
  st.frameIdx = seq[st.sequencePos] ?? 0;
  st.elapsedUnits = 0;
  st.completed = false;
}

export function resumeSequence(st){
  if (st.completed) resetSequence(st);
  // Pausing and resuming an unfinished visit preserves its remaining duration.
}

export function advanceSequence(st, seconds){
  const seq = frameSequence(st);
  if (!seq.length || st.completed || !st.playing) return false;
  if (seq[st.sequencePos] !== st.frameIdx) seekSequence(st, st.frameIdx);
  st.elapsedUnits = (st.elapsedUnits || 0) + Math.max(0, seconds) * st.speed;
  const duration = i => st.frames[i].durUnits || 1;
  // Skip whole cycles after a background-tab delay without an unbounded loop.
  if ((st.playback || 'loop') === 'loop'){
    const cycleUnits = seq.reduce((sum, i) => sum + duration(i), 0);
    st.elapsedUnits %= cycleUnits;
  }
  let changed = false;
  while (st.elapsedUnits >= duration(st.frameIdx)){
    st.elapsedUnits -= duration(st.frameIdx);
    changed = true;
    if (st.sequencePos + 1 === seq.length){
      if (st.playback === 'once'){
        st.completed = true;
        st.elapsedUnits = 0;
        break;
      }
      st.sequencePos = 0;
    } else st.sequencePos++;
    st.frameIdx = seq[st.sequencePos];
  }
  return changed;
}
