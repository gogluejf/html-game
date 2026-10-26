// ---------- rigid body utilities (single source of truth for propagation) ----------
// Every code path that moves/scales the animation body (pointer drag, side-panel
// number inputs, keyboard nudges) goes through these two functions. They decide
// what follows what: ALL FRAMES mode = the whole body is one rigid unit.

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

// Scale the ENTIRE body about its shared bounding-box center by (rx, ry).
// Works on current state directly (no before-snapshot needed): each element's
// center and size scale about the body center, so everything stays glued.
export function scaleAllAbout(rx, ry){
  const st = app.cur.st;
  // compute shared center over collision + all frames + all melee boxes
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const c0=st.collision;
  minX=Math.min(minX,c0.x); minY=Math.min(minY,c0.y); maxX=Math.max(maxX,c0.x+c0.w); maxY=Math.max(maxY,c0.y+c0.h);
  for (let i=0;i<st.frames.length;i++){
    const f=st.frames[i], im=app.cur.imgs[i]; if(!im) continue;
    const w=im.naturalWidth*f.scale.sx, h=im.naturalHeight*f.scale.sy;
    minX=Math.min(minX,f.offset.x-w/2); minY=Math.min(minY,f.offset.y-h/2);
    maxX=Math.max(maxX,f.offset.x+w/2); maxY=Math.max(maxY,f.offset.y+h/2);
    const bxArr = f.boxes || [];
    for (const b of bxArr){
      minX=Math.min(minX,b.x); minY=Math.min(minY,b.y);
      maxX=Math.max(maxX,b.x+b.w); maxY=Math.max(maxY,b.y+b.h); }
  }
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
  // frames: scale size + reposition center on its scaled ray from C
  for (let i=0;i<st.frames.length;i++){
    const fr=st.frames[i];
    fr.scale.sx=Math.max(.05,fr.scale.sx*rx); fr.scale.sy=Math.max(.05,fr.scale.sy*ry);
    fr.offset.x=Math.round(cx+(fr.offset.x-cx)*rx);
    fr.offset.y=Math.round(cy+(fr.offset.y-cy)*ry);
  }
  // collision (shared across frames)
  const ccx=c0.x+c0.w/2, ccy=c0.y+c0.h/2;
  st.collision.w=Math.max(1,Math.round(c0.w*rx));
  st.collision.h=Math.max(1,Math.round(c0.h*ry));
  st.collision.x=Math.round(cx+(ccx-cx)*rx - st.collision.w/2);
  st.collision.y=Math.round(cy+(ccy-cy)*ry - st.collision.h/2);
  // melee boxes per frame
  for (let i=0;i<st.frames.length;i++){
    const fr=st.frames[i];
    const bxArr = fr.boxes || [];
    for (let bi=0; bi<bxArr.length; bi++){
      const m=bxArr[bi];
      const mcx=m.x+m.w/2, mcy=m.y+m.h/2;
      m.w=Math.max(1,Math.round(m.w*rx));
      m.h=Math.max(1,Math.round(m.h*ry));
      m.x=Math.round(cx+(mcx-cx)*rx - m.w/2);
      m.y=Math.round(cy+(mcy-cy)*ry - m.h/2);
    }
  }
  // pivot: a point — scale its position about the shared center (no size)
  if (st.pivot){
    st.pivot.x=Math.round(cx+(st.pivot.x-cx)*rx);
    st.pivot.y=Math.round(cy+(st.pivot.y-cy)*ry);
  }
  // markers: scale position + radius about center
  for (const m of st.markers){
    m.x=Math.round(cx+(m.x-cx)*rx);
    m.y=Math.round(cy+(m.y-cy)*ry);
    if (m.radiusOn) m.radius=Math.max(1,Math.round(m.radius*rx));
  }
}

// ---------- element intents: the ONLY move/resize API ----------
// UI code (panel, canvas drag, keyboard) calls these. They make the
// ALL-FRAMES decision in ONE place, so every input path behaves identically:
//   single frame -> only that element changes
//   ALL FRAMES   -> the whole body moves / scales as one rigid unit
// key: 'sprite' | 'collision' | 'box_<i>'

export function moveElement(key, nx, ny){
  const st = app.cur.st;
  if (key === 'sprite'){
    const fi = Math.round(st.frameIdx % st.frames.length);
    const f = st.frames[fi];
    if (app.show.allFrames){ shiftAll(nx - f.offset.x, ny - f.offset.y); }
    else { f.offset.x = nx; f.offset.y = ny; }
  } else if (key === 'collision'){
    if (app.show.allFrames){ shiftAll(nx - st.collision.x, ny - st.collision.y); }
    else { st.collision.x = nx; st.collision.y = ny; }
  } else if (key.startsWith('box_')){
    const b = st.frames[Math.round(st.frameIdx % st.frames.length)].boxes[parseInt(key.slice(4), 10)];
    if (!b) return;
    if (app.show.allFrames){ shiftAll(nx - b.x, ny - b.y); }
    else { b.x = nx; b.y = ny; }
  }
}

export function resizeElement(key, nw, nh){
  const st = app.cur.st;
  const fi = Math.round(st.frameIdx % st.frames.length);
  if (key === 'sprite'){
    const im = app.cur.imgs[fi]; if (!im) return;
    const f = st.frames[fi];
    const rx = nw / (im.naturalWidth * f.scale.sx), ry = nh / (im.naturalHeight * f.scale.sy);
    if (app.show.allFrames){ scaleAllAbout(rx, ry); }
    else { f.scale.sx = Math.max(.05, f.scale.sx * rx); f.scale.sy = Math.max(.05, f.scale.sy * ry); }
  } else if (key === 'collision'){
    const c = st.collision;
    const rx = nw / c.w, ry = nh / c.h;
    if (app.show.allFrames){ scaleAllAbout(rx, ry); }
    else { c.w = Math.max(1, nw); c.h = Math.max(1, nh); }
  } else if (key.startsWith('box_')){
    const b = st.frames[fi].boxes[parseInt(key.slice(4), 10)];
    if (!b) return;
    const rx = nw / b.w, ry = nh / b.h;
    if (app.show.allFrames){ scaleAllAbout(rx, ry); }
    else { b.w = Math.max(1, nw); b.h = Math.max(1, nh); }
  }
}

// Scale ONE element's size by ratio about its own center (position untouched).
// Used by panel scale inputs where the user types a target scale value.
export function scaleElement(key, rx, ry){
  const st = app.cur.st;
  const fi = Math.round(st.frameIdx % st.frames.length);
  if (key === 'sprite'){
    const f = st.frames[fi];
    if (app.show.allFrames){ scaleAllAbout(rx, ry); }
    else { f.scale.sx = Math.max(.05, f.scale.sx * rx); f.scale.sy = Math.max(.05, f.scale.sy * ry); }
  } else if (key === 'collision'){
    const c = st.collision;
    if (app.show.allFrames){ scaleAllAbout(rx, ry); }
    else { c.w = Math.max(1, Math.round(c.w * rx)); c.h = Math.max(1, Math.round(c.h * ry)); }
  } else if (key.startsWith('box_')){
    const b = st.frames[fi].boxes[parseInt(key.slice(4), 10)];
    if (!b) return;
    if (app.show.allFrames){ scaleAllAbout(rx, ry); }
    else { b.w = Math.max(1, Math.round(b.w * rx)); b.h = Math.max(1, Math.round(b.h * ry)); }
  }
}
