// ---------- pointer interaction (unified box engine) + rigid body propagation ----------
import { app } from './state.js';
import { cv, $, evPos, c2s, dbg } from './viewport.js';
import { curFrameIdx, editingLocked } from './geometry.js';
import { draw, boxList, hitHandle, inside } from './draw.js';
import { syncPanel } from './panel.js';
import { pushUndo } from './undo.js';
import { buildMeleeBoxList } from './meleeBoxes.js';
import { buildMarkerList } from './markers.js';
import { moveElement } from './rigidbody.js';
import { LS_KEY } from './save.js';

// ---------- box resize math ----------
function resizeBox(box, anchorId, sx, sy, orig, keepRatio){
  let x1=orig.x, y1=orig.y, x2=orig.x+orig.w, y2=orig.y+orig.h;
  if (anchorId.includes('w')) x1=sx; else if (anchorId.includes('e')) x2=sx;
  if (anchorId.includes('n')) y1=sy; else if (anchorId.includes('s')) y2=sy;
  let w=x2-x1, h=y2-y1;
  if (keepRatio && orig.w>0 && orig.h>0){
    const rx=w/orig.w, ry=h/orig.h, r=Math.max(Math.abs(rx),Math.abs(ry));
    w=orig.w*r*Math.sign(w||1); h=orig.h*r*Math.sign(h||1);
    x2=x1+w; y2=y1+h;
  }
  if (w<1) w=1; if (h<1) h=1;
  box.x=Math.round(x1); box.y=Math.round(y1); box.w=Math.round(w); box.h=Math.round(h);
}

// ---------- hover detection (unified for all boxes) ----------
export function bringToFront(key){
  // Remove every prior occurrence, including index 0, before moving to front.
  // Duplicate entries draw the same translucent fill repeatedly.
  app.boxZOrder = [key, ...app.boxZOrder.filter(k => k !== key)];
}

// pivot hit-test: within ~12 screen-px of the marker center
function hitPivot(sx, sy){
  if (!app.show.pivot || !app.cur.st.pivot) return false;
  const tol = 12/app.zoom;
  return Math.abs(sx - app.cur.st.pivot.x) <= tol && Math.abs(sy - app.cur.st.pivot.y) <= tol;
}
// marker hit-test: returns index or -1
function hitMarker(sx, sy){
  if (!app.show.markerView || !app.cur.st.markers) return -1;
  const tol = 14/app.zoom;
  for (let i=0; i<app.cur.st.markers.length; i++){
    const m = app.cur.st.markers[i];
    if (Math.abs(sx-m.x) <= tol && Math.abs(sy-m.y) <= tol) return i;
  }
  return -1;
}
// marker radius handle hit-test: returns idx or -1 (checks all markers with radius)
function hitMarkerRadiusHandle(sx, sy){
  if (!app.show.markerView || !app.cur.st.markers || app.cur.st.playing) return -1;
  const tol = 10/app.zoom;
  for (let i=0; i<app.cur.st.markers.length; i++){
    const m = app.cur.st.markers[i];
    if (!m.radiusOn || m.radius <= 0) continue;
    const hx = m.x + m.radius, hy = m.y;
    if (Math.abs(sx-hx) <= tol && Math.abs(sy-hy) <= tol) return i;
  }
  return -1;
}

// true if any RECT box (sprite/collision/melee) claims this point via its
// handles or body — used to let the front-most element beat marker dots.
function rectBoxAt(sx, sy){
  for (const b of boxList()){
    if (!b.rect) break;   // reached the first point entry — nothing above claims it
    if (hitHandle(b.rect, sx, sy)) return true;
    if (inside(b.rect, sx, sy)) return true;
  }
  return false;
}

function updateHover(sx, sy){
  const prev = app.hover; app.hover = null;
  if (!editingLocked()){
    // pivot takes priority (small target, drawn on top)
    if (hitPivot(sx, sy)){ app.hover = { box:'pivot' }; finishHover(prev); return; }
    // first element hit wins, in z-order (front-most layer, e.g. the selected one)
    for (const b of boxList()){
      if (!b.rect){
        // marker dot: only wins if no box in front of it claims the point
        if (hitMarker(sx, sy) === b.idx){ app.hover = { box:'marker_'+b.idx, body:true }; break; }
        continue;
      }
      const h = hitHandle(b.rect, sx, sy);
      if (h){ app.hover = { box:b.key, handle:h }; break; }
      if (inside(b.rect, sx, sy)){ app.hover = { box:b.key, body:true }; break; }
    }
    // hovered layer wins hit-testing from now on — promote it to the front
    if (app.hover && app.hover.box !== 'pivot') bringToFront(app.hover.box);
  }
  finishHover(prev);
}
// shared hover tail: redraw-if-changed + cursor feedback
function finishHover(prev){
  const changed = JSON.stringify(prev) !== JSON.stringify(app.hover);
  if (changed) draw();
  if (app.hover && app.hover.box==='pivot') cv.style.cursor = 'grab';
  else if (app.hover && app.hover.box && app.hover.box.startsWith('marker_')) cv.style.cursor = 'move';
  else if (app.hover && app.hover.handle){
    const c = { nw:'nwse-resize', se:'nwse-resize', ne:'nesw-resize', sw:'nesw-resize',
                n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize' }[app.hover.handle];
    cv.style.cursor = c || 'default';
  }
  else if (app.hover && app.hover.body) cv.style.cursor = 'move';
  else cv.style.cursor = 'default';
}

// ---------- BOX behavior table (snap/move/resize per element type) ----------
export const BOX = {
  sprite: {
    snap(st, fi){ const f=st.frames[fi], im=app.cur.imgs[fi]; return { x:f.offset.x-im.naturalWidth*f.scale.sx/2, y:f.offset.y-im.naturalHeight*f.scale.sy/2, w:im.naturalWidth*f.scale.sx, h:im.naturalHeight*f.scale.sy }; },
    move(d, sx, sy){
      const st=app.cur.st;
      const tx=Math.round(sx-d.ox+d.orig.w/2), ty=Math.round(sy-d.oy+d.orig.h/2);
      moveElement('sprite', tx, ty);
    },
    resize(d, sx, sy){
      const o=d.orig, ow=d.ow, oh=d.oh;
      if (d.ratio){
        // SHIFT: LOCK THE CURRENT RATIO. Corners scale BOTH axes uniformly about
        // the box center (a 2:1 stays 2:1). Middle handles (n/s/e/w) scale ONLY
        // their own axis — same as a free drag, just measured against natural dims
        // so it's an absolute mapping from cursor position (no compounding).
        const f0=d.sx0, g0=d.sy0;   // scales captured ONCE at drag start
        const corner=d.anchor.length===2;
        // Relative to the GRAB POINT (cursor at pointerdown), not the box center:
        // k starts at 1 so there's no jump on click; scale only changes as you drag.
        const gx=d.gx, gy=d.gy;     // grab point in sprite space
        let nsx=null, nsy=null;
        if (corner){
          let dx, dy;               // signed distance from grab point along each axis
          if (d.anchor.includes('e')) dx=sx-gx; else if (d.anchor.includes('w')) dx=gx-sx;
          if (d.anchor.includes('s')) dy=sy-gy; else if (d.anchor.includes('n')) dy=gy-sy;
          // convert pixel deltas to a scale factor about the (fixed) center
          const k=Math.max(Math.abs(1+2*dx/o.w),Math.abs(1+2*dy/o.h));
          nsx=Math.max(.05,f0*k); nsy=Math.max(.05,g0*k);
        } else if (d.anchor.includes('e')||d.anchor.includes('w')){
          // horizontal middle: scale X both sides about center, Y untouched
          const dx=(d.anchor.includes('e'))?sx-gx:gx-sx;
          nsx=Math.max(.05,f0*Math.abs(1+2*dx/o.w));
        } else {
          // vertical middle: scale Y both sides about center, X untouched
          const dy=(d.anchor.includes('s'))?sy-gy:gy-sy;
          nsy=Math.max(.05,g0*Math.abs(1+2*dy/o.h));
        }
        // current frame exact; then scale the WHOLE body (all frames + collision
        // + melee) about one shared center so everything stays glued.
        const st=app.cur.st, fi=curFrameIdx();
        const f0f=st.frames[fi];
        if (nsx!==null) f0f.scale.sx=nsx;
        if (nsy!==null) f0f.scale.sy=nsy;
        if (app.show.allFrames && d.before){
          const rx = nsx!==null ? nsx/d.before.frames[fi].sx : 1;
          const ry = nsy!==null ? nsy/d.before.frames[fi].sy : 1;
          scaleAllAboutLocal(st, d.before, rx, ry);
        }
      } else {
        let L=o.x,R=o.x+o.w,T=o.y,B=o.y+o.h;
        if (d.anchor.includes('w'))L=sx; if (d.anchor.includes('e'))R=sx;
        if (d.anchor.includes('n'))T=sy; if (d.anchor.includes('s'))B=sy;
        if (R-L<1){ if(d.anchor.includes('w'))L=R-1; else R=L+1; }
        if (B-T<1){ if(d.anchor.includes('n'))T=B-1; else B=T+1; }
        const nsx=Math.max(.05,(R-L)/ow), nsy=Math.max(.05,(B-T)/oh);
        const ncx=Math.round((L+R)/2), ncy=Math.round((T+B)/2);
        // current frame exact; then scale the WHOLE body about one shared center.
        const st=app.cur.st, fi=curFrameIdx();
        const f0=st.frames[fi]; f0.scale.sx=nsx; f0.scale.sy=nsy; f0.offset.x=ncx; f0.offset.y=ncy;
        if (app.show.allFrames && d.before){
          const rx=nsx/d.before.frames[fi].sx, ry=nsy/d.before.frames[fi].sy;
          scaleAllAboutLocal(st, d.before, rx, ry);
        }
      }
    }
  },
  collision: {
    snap(st, fi){ return {...st.collision}; },
    move(d, sx, sy){
      moveElement('collision', Math.round(sx-d.ox), Math.round(sy-d.oy));
    },
    resize(d, sx, sy){
      const st=app.cur.st, fi=curFrameIdx();
      const c0={...d.box};   // current collision (== before state at start)
      resizeBox(c0, d.anchor, sx, sy, d.orig, d.ratio);
      st.collision.x=c0.x; st.collision.y=c0.y; st.collision.w=c0.w; st.collision.h=c0.h;
      // ALL FRAMES: scale the WHOLE body (frames + collision + melee) about one
      // shared center so everything stays glued.
      if (app.show.allFrames && d.before){
        const b0=d.before.col;
        const rx=b0.w>0?c0.w/b0.w:1, ry=b0.h>0?c0.h/b0.h:1;
        scaleAllAboutLocal(st, d.before, rx, ry);
      }
    }
  },
  // dynamic melee boxes (box_0, box_1, ...) — resolved at runtime via drag.boxIdx
  getBox(idx){
    return {
      snap(st, fi){ const b = st.frames[fi].boxes[idx]; return {...b}; },
      move(d, sx, sy){
        moveElement('box_'+idx, Math.round(sx-d.ox), Math.round(sy-d.oy));
      },
      resize(d, sx, sy){
        const st=app.cur.st, fi=curFrameIdx(), f0=st.frames[fi];
        const b0=f0.boxes[idx]; if(!b0) return;
        const m0={...d.box};
        resizeBox(m0, d.anchor, sx, sy, d.orig, d.ratio);
        b0.x=m0.x; b0.y=m0.y; b0.w=m0.w; b0.h=m0.h;
        if (app.show.allFrames && d.before){
          const bref=d.before.frames[fi].bx[idx];
          if (!bref || bref.w===0 || bref.h===0) return;
          const rx=m0.w/bref.w, ry=m0.h/bref.h;
          scaleAllAboutLocal(st, d.before, rx, ry);
        }
      }
    };
  }
};

// local rigid-body helpers (kept here so the BOX table is self-contained)
function sharedScaleCenter(st, before){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const b0=before.col;
  minX=Math.min(minX,b0.x); minY=Math.min(minY,b0.y); maxX=Math.max(maxX,b0.x+b0.w); maxY=Math.max(maxY,b0.y+b0.h);
  for (let i=0;i<st.frames.length;i++){
    const f=st.frames[i], im=app.cur.imgs[i]; if(!im) continue;
    const b=before.frames[i];
    const w=im.naturalWidth*b.sx, h=im.naturalHeight*b.sy;
    minX=Math.min(minX,b.ox-w/2); minY=Math.min(minY,b.oy-h/2);
    maxX=Math.max(maxX,b.ox+w/2); maxY=Math.max(maxY,b.oy+h/2);
    const bxArr = b.bx || [];
    for (const m of bxArr){
      minX=Math.min(minX,m.x); minY=Math.min(minY,m.y);
      maxX=Math.max(maxX,m.x+m.w); maxY=Math.max(maxY,m.y+m.h); }
  }
  return { cx:(minX+maxX)/2, cy:(minY+maxY)/2 };
}
function scaleAllAboutLocal(st, before, rx, ry){
  const C = sharedScaleCenter(st, before);
  // frames: scale size + reposition center on its scaled ray from C
  for (let i=0;i<st.frames.length;i++){
    const b=before.frames[i], fr=st.frames[i];
    fr.scale.sx=Math.max(.05,b.sx*rx); fr.scale.sy=Math.max(.05,b.sy*ry);
    fr.offset.x=Math.round(C.cx+(b.ox-C.cx)*rx);
    fr.offset.y=Math.round(C.cy+(b.oy-C.cy)*ry);
  }
  // collision (shared across frames)
  const b0=before.col;
  const ccx=b0.x+b0.w/2, ccy=b0.y+b0.h/2;
  st.collision.w=Math.max(1,Math.round(b0.w*rx));
  st.collision.h=Math.max(1,Math.round(b0.h*ry));
  st.collision.x=Math.round(C.cx+(ccx-C.cx)*rx - st.collision.w/2);
  st.collision.y=Math.round(C.cy+(ccy-C.cy)*ry - st.collision.h/2);
  // melee boxes per frame
  for (let i=0;i<st.frames.length;i++){
    const fr=st.frames[i];
    const bxArr = before.frames[i].bx || [];
    for (let bi=0; bi<bxArr.length; bi++){
      if (!fr.boxes[bi]) continue;
      const m=bxArr[bi];
      const mcx=m.x+m.w/2, mcy=m.y+m.h/2;
      fr.boxes[bi].w=Math.max(1,Math.round(m.w*rx));
      fr.boxes[bi].h=Math.max(1,Math.round(m.h*ry));
      fr.boxes[bi].x=Math.round(C.cx+(mcx-C.cx)*rx - fr.boxes[bi].w/2);
      fr.boxes[bi].y=Math.round(C.cy+(mcy-C.cy)*ry - fr.boxes[bi].h/2);
    }
  }
  // pivot: a point — scale its position about the shared center (no size)
  if (st.pivot && before.pivot){
    st.pivot.x=Math.round(C.cx+(before.pivot.x-C.cx)*rx);
    st.pivot.y=Math.round(C.cy+(before.pivot.y-C.cy)*ry);
  }
  // markers: scale position + radius about center
  if (before.markers){
    for (let mi=0; mi<before.markers.length; mi++){
      const m=st.markers[mi], bm=before.markers[mi];
      if (!m || !bm) continue;
      m.x=Math.round(C.cx+(bm.x-C.cx)*rx);
      m.y=Math.round(C.cy+(bm.y-C.cy)*ry);
      if (m.radiusOn) m.radius=Math.max(1,Math.round(bm.radius*rx));
    }
  }
}

export function initPointer(){
cv.addEventListener('pointerdown', e=>{
  if (!app.cur || !app.cur.st) return;
  cv.setPointerCapture(e.pointerId);
  const [cx, cy] = evPos(e); const [sx, sy] = c2s(cx, cy);
  updateHover(sx, sy);   // recompute from the ACTUAL click point (z-order aware)
  const st = app.cur.st, fi = curFrameIdx();
  // while playing: no edits, only pan
  if (editingLocked()){
    app.drag = { kind:'pan', sx0:cx, sy0:cy, panX0:app.panX, panY0:app.panY };
    cv.style.cursor = 'grabbing';
    return;
  }
  // marker radius handle -> drag to resize radius (only when no box in front
  // of the marker claims the point — the front-most element wins)
  const radIdx = hitMarkerRadiusHandle(sx, sy);
  if (radIdx >= 0 && !rectBoxAt(sx, sy)){
    app._selectedBox = 'marker_'+radIdx;   // auto-select the marker
    bringToFront('marker_'+radIdx);
    pushUndo();
    app.drag = { key:'markerRadius', markerIdx:radIdx, undoPushed:true };
    cv.style.cursor = 'nwse-resize';
    draw(); return;
  }
  // marker -> click to select, drag to move (only the marker moves)
  const mkIdx = hitMarker(sx, sy);
  if (mkIdx >= 0 && !rectBoxAt(sx, sy)){
    app._selectedBox = 'marker_'+mkIdx;
    bringToFront('marker_'+mkIdx);
    pushUndo();
    app.drag = { key:'marker', markerIdx:mkIdx, sx, sy, undoPushed:false };
    cv.style.cursor = 'grabbing';
    draw(); return;
  }
  // pivot marker -> drag to reposition
  if (app.hover && app.hover.box==='pivot'){
    pushUndo();
    const pv0 = st.pivot ? {...st.pivot} : null;
    app.drag = { key:'pivot', sx, sy, before: pv0 };
    cv.style.cursor = 'grabbing';
    draw(); return;
  }
  // any visible box under the cursor -> unified move/resize
  if (app.hover && (BOX[app.hover.box] || app.hover.box.startsWith('box_'))){
    bringToFront(app.hover.box);   // last-touched box wins hit-testing
    const isDynBox = app.hover.box.startsWith('box_');
    const boxIdx = isDynBox ? parseInt(app.hover.box.slice(4), 10) : -1;
    // select any element on click (box_N, sprite, collision)
    app._selectedBox = app.hover.box;
    const B = isDynBox ? BOX.getBox(boxIdx) : BOX[app.hover.box];
    const orig = B.snap(st, fi);
    const ref  = app.hover.box==='sprite' ? null : (app.hover.box==='collision' ? st.collision : (isDynBox ? st.frames[fi].boxes[boxIdx] : null));
    // per-frame BEFORE-state for relative propagation (ALL FRAMES mode)
    const before = {
      frames: st.frames.map(f => ({ ox:f.offset.x, oy:f.offset.y, sx:f.scale.sx, sy:f.scale.sy,
                                    bx:(f.boxes||[]).map(b=>({...b})) })),
      col: {...st.collision},
      pivot: st.pivot ? {...st.pivot} : null,
      markers: (st.markers||[]).map(m=>({...m}))
    };
    app.drag = { key:app.hover.box, boxIdx, anchor:app.hover.handle||null, ratio:e.shiftKey, orig,
             box:ref, ox:sx-orig.x, oy:sy-orig.y,
             ow: app.cur.imgs[fi]?app.cur.imgs[fi].naturalWidth:orig.w,
             oh: app.cur.imgs[fi]?app.cur.imgs[fi].naturalHeight:orig.h,
             gx:sx, gy:sy,
             sx0: st.frames[fi].scale.sx, sy0: st.frames[fi].scale.sy,
             before, undoPushed:false };
    draw(); return;
  }
  // empty space -> pan + deselect
  app._selectedBox = null;
  app.drag = { kind:'pan', sx0:cx, sy0:cy, panX0:app.panX, panY0:app.panY };
  cv.style.cursor = 'grabbing';
});

cv.addEventListener('pointermove', e=>{
  if (!app.cur || !app.cur.st) return;
  const [cx, cy] = evPos(e); const [sx, sy] = c2s(cx, cy);
  if (!app.drag) { updateHover(sx, sy); return; }
  if (app.drag.kind==='pan'){
    // move the view so the grabbed screen point stays under the cursor
    app.userZoomed = true;
    app.panX = app.drag.panX0 - (cx - app.drag.sx0)/app.zoom;
    app.panY = app.drag.panY0 - (cy - app.drag.sy0)/app.zoom;
  } else if (app.drag.key==='markerRadius'){
    // Resize marker radius: distance from center to cursor
    const m = app.cur.st.markers[app.drag.markerIdx];
    if (m){
      const dist = Math.sqrt((sx-m.x)*(sx-m.x) + (sy-m.y)*(sy-m.y));
      m.radius = Math.max(1, Math.round(dist));
    }
    syncPanel(); draw(); return;
  } else if (app.drag.key==='marker'){
    // Moving a marker affects ONLY that marker
    if (!app.drag.undoPushed){ pushUndo(); app.drag.undoPushed = true; }
    const m = app.cur.st.markers[app.drag.markerIdx];
    if (m){ m.x=Math.round(sx); m.y=Math.round(sy); }
    syncPanel(); draw(); return;
  } else if (app.drag.key==='pivot'){
    // Moving the pivot affects ONLY the pivot — zero effect on sprite/collision/
    // melee. (Pivot follows those elements when THEY are moved/resized instead.)
    app.cur.st.pivot.x=Math.round(sx);
    app.cur.st.pivot.y=Math.round(sy);
    syncPanel();
  } else if (app.drag.key && (BOX[app.drag.key] || app.drag.key.startsWith('box_'))){
    if (!app.drag.undoPushed){ pushUndo(); app.drag.undoPushed = true; }
    const B = app.drag.key.startsWith('box_') ? BOX.getBox(app.drag.boxIdx) : BOX[app.drag.key];
    if (app.drag.anchor) B.resize(app.drag, sx, sy);
    else                 B.move(app.drag, sx, sy);
  }
  syncPanel(); draw();
});

// DEBUG event trace (temporary)
const trace = [];
function logEv(name, e){
  const t = performance.now().toFixed(0);
  trace.push(`${t} ${name} drag=${app.drag?app.drag.kind:'-'} hover=${app.hover?(app.hover.handle||app.hover.box):'-'}`);
  if (trace.length > 12) trace.shift();
  dbg.title = trace.join('\n');
}
cv.addEventListener('pointerdown',   e=>logEv('DOWN', e));
cv.addEventListener('pointermove',  e=>logEv('MOVE', e));
cv.addEventListener('pointerleave', e=>logEv('LEAVE',e));
window.addEventListener('pointerup', e=>logEv('UP', e));

function endDrag(e){
  const wasDragging = !!app.drag;
  app.drag = null;
  if (!app.cur || !app.cur.st) return;
  // Recompute hover from the actual release position. With pointer capture the event
  // targets the canvas even when the cursor is elsewhere, so use elementFromPoint to
  // decide if we're really over the canvas.
  let sx = -1e9, sy = -1e9;
  if (e && document.elementFromPoint(e.clientX, e.clientY) === cv){
    const [cx, cy] = evPos(e); [sx, sy] = c2s(cx, cy);
  }
  updateHover(sx, sy);          // always redraws when state changes; force it below
  if (wasDragging) draw();      // guarantee the solid line drops back to dotted
  cv.style.cursor = 'default';  // release the grabbing cursor after a pan
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
// No pointermove events fire once the cursor leaves the canvas, so clear hover explicitly:
cv.addEventListener('pointerleave', ()=>{ if (app.hover){ app.hover = null; draw(); cv.style.cursor='default'; } });
window.addEventListener('blur', ()=>{ if (app.hover || app.drag){ app.hover = null; app.drag = null; draw(); cv.style.cursor='default'; } });

// ---------- cross-tab sync: reload state when another tab saves ----------
window.addEventListener('storage', e => {
  if (e.key !== LS_KEY) return;
  // another window wrote to our key — reload the page to pick up its state
  location.reload();
});
}
