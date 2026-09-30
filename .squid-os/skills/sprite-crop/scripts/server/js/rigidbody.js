// ---------- rigid body utilities (single source of truth for propagation) ----------
// Used by keyboard nudges and any code that moves an element and wants the whole
// animation body to follow as one unit. The pointer drag engine keeps its own
// inline copies (shiftAllLocal/scaleAllAboutLocal) so the BOX table stays
// self-contained; these exported helpers cover the non-drag paths.

import { app } from './state.js';

// Shift the ENTIRE body (all frames + collision + all boxes + pivot + markers) by (dx, dy).
export function shiftAll(dx, dy){
  const st = app.cur.st;
  for (let i=0;i<st.frames.length;i++){
    st.frames[i].offset.x += dx;
    st.frames[i].offset.y += dy;
    const bxArr = st.frames[i].boxes || [];
    for (const b of bxArr){ b.x += dx; b.y += dy; }
  }
  st.collision.x += dx; st.collision.y += dy;
  if (st.pivot){ st.pivot.x += dx; st.pivot.y += dy; }
  for (const m of st.markers){ m.x += dx; m.y += dy; }
}

// Shift ONE element + propagate to all frames (rigid body).
// All element types move the ENTIRE body — they are all part of the same rigid unit.
// type: 'sprite' | 'collision' | 'box', idx: box index (unused, kept for clarity)
export function shiftElement(type, idx, dx, dy){
  shiftAll(dx, dy);
}
