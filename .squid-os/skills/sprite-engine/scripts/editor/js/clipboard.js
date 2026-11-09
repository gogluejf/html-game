// ---------- clipboard: Ctrl+C / Ctrl+V for sprite, collision, hit boxes, markers ----------
// Session-only (in-memory) clipboard — mirrors the macro editor's approach and
// keeps browser storage clean. Copy captures the SELECTED element of the current
// frame; paste applies it to the CURRENT frame (and every frame when the
// FRAMES/all-frames ghost toggle is on).
//
// Paste semantics per element type:
//   sprite     → overwrites the frame's offset + scale (one per frame)
//   collision  → overwrites x/y/w/h (one per entity); pivot re-centered to the
//                new box center so the anchor follows the body
//   hit box    → label match in target frame → position/size overwritten in
//                place; no match → appended as a NEW box with that label
//   marker     → same label-match rule as hit boxes (markers are per-entity)

import { app, COLL_PAD } from './state.js';
import { curFrameIdx, targetFrames } from './geometry.js';
import { commit } from './commit.js';
import { showToast } from './toast.js';

let clip = null;   // { kind:'sprite'|'collision'|'box'|'marker', data:{...} } | null

export function copySelected(){
  if (!app.cur || !app.cur.st || !app._selectedBox) return;
  const st = app.cur.st, fi = curFrameIdx(), f = st.frames[fi];
  const sel = app._selectedBox;
  let kind = null, data = null;
  if (sel === 'sprite'){
    kind = 'sprite';
    data = { offset: { ...f.offset }, scale: { ...f.scale } };
  } else if (sel === 'collision'){
    kind = 'collision';
    data = { ...st.collision };
  } else if (sel.startsWith('box_')){
    const b = f.boxes[parseInt(sel.slice(4), 10)];
    if (!b) return;
    kind = 'box';
    data = { ...b };
  } else if (sel.startsWith('marker_')){
    const m = st.markers[parseInt(sel.slice(7), 10)];
    if (!m) return;
    kind = 'marker';
    data = { ...m };
  }
  if (!kind) return;
  clip = { kind, data };
  const names = { sprite:'Sprite offset/scale', collision:'Collision box', box:data.label, marker:data.label };
  showToast(`Copied ${names[kind]}`, 'success');
}

export function pasteClipboard(){
  if (!clip || !app.cur || !app.cur.st) return;
  const st = app.cur.st;
  const targets = targetFrames(curFrameIdx());   // frame objects — all frames when ghost toggle is on
  const c = clip;

  commit(() => {
    if (c.kind === 'sprite'){
      targets.forEach(f => {
        f.offset = { ...c.data.offset };
        f.scale = { ...c.data.scale };
      });
    } else if (c.kind === 'collision'){
      st.collision = { ...c.data };
      // Keep the pivot anchored to the body: re-center it exactly like the
      // R (recenter) tool does, so pasting a body doesn't leave a floating pivot.
      st.pivot = { x: Math.round(st.collision.x + st.collision.w / 2),
                   y: Math.round(st.collision.y + st.collision.h / 2) };
    } else if (c.kind === 'box'){
      targets.forEach(f => {
        const boxes = f.boxes || (f.boxes = []);
        const existing = boxes.find(b => b.label === c.data.label);
        if (existing){
          // Same label already here → overwrite position/size in place.
          existing.x = c.data.x; existing.y = c.data.y;
          existing.w = c.data.w; existing.h = c.data.h;
        } else {
          // No such label in this frame → create it (easy multi-frame paste).
          boxes.push({ ...c.data });
        }
      });
    } else if (c.kind === 'marker'){
      const markers = st.markers || (st.markers = []);
      const existing = markers.find(m => m.label === c.data.label);
      if (existing){
        Object.assign(existing, c.data);
      } else {
        markers.push({ ...c.data });
      }
    }
  });

  // Select the pasted element so it's immediately grabbable.
  if (c.kind === 'sprite') app._selectedBox = 'sprite';
  else if (c.kind === 'collision') app._selectedBox = 'collision';
  else if (c.kind === 'box'){
    const boxes = st.frames[curFrameIdx()].boxes || [];
    const idx = boxes.findIndex(b => b.label === c.data.label);
    if (idx >= 0) app._selectedBox = 'box_' + idx;
  }
  else if (c.kind === 'marker'){
    const markers = st.markers || [];
    const idx = markers.findIndex(m => m.label === c.data.label);
    if (idx >= 0) app._selectedBox = 'marker_' + idx;
  }
  const n = targets.length > 1 ? ` → ${targets.length} frames` : '';
  showToast(`Pasted ${c.data.label ?? c.kind}${n}`, 'success');
}

// Cut = copy + delete, for ALL element types. Sprite/collision are singletons
// per frame/entity, so "delete" means resetting their values to defaults —
// the captured data still goes to the clipboard for pasting elsewhere.
export function cutSelected(){
  if (!app.cur || !app.cur.st || !app._selectedBox) return;
  copySelected();
  if (!clip) return;
  const st = app.cur.st, fi = curFrameIdx(), f = st.frames[fi];
  const sel = app._selectedBox;

  commit(() => {
    if (sel === 'sprite'){
      f.offset = { x:0, y:0 };
      f.scale = { sx:1, sy:1 };
    } else if (sel === 'collision'){
      // Reset to the factory box for this frame's sprite size (same math as
      // defaultState: padded box anchored left-bottom at the origin).
      const W = f.crop.w || 32, H = f.crop.h || 32;
      st.collision = { x: COLL_PAD, y: -H + COLL_PAD, w: Math.max(1, W - COLL_PAD*2), h: Math.max(1, H - COLL_PAD*2) };
      st.pivot = { x: Math.round(st.collision.x + st.collision.w / 2),
                   y: Math.round(st.collision.y + st.collision.h / 2) };
    } else if (sel.startsWith('box_')){
      const idx = parseInt(sel.slice(4), 10);
      if (f.boxes[idx]) f.boxes.splice(idx, 1);
    } else if (sel.startsWith('marker_')){
      const idx = parseInt(sel.slice(7), 10);
      if (st.markers[idx]) st.markers.splice(idx, 1);
    }
  });

  app._selectedBox = null;
  const names = { sprite:'Sprite offset/scale', collision:'Collision box', box:clip.data.label, marker:clip.data.label };
  showToast(`Cut ${names[clip.kind]}`, 'success');
}
