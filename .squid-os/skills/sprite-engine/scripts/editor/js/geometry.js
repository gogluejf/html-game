// ---------- shared geometry / frame math ----------
// Pure helpers over the current entity's state (cur.st). Used by draw, pointer,
// panel, and filmstrip so they all agree on frame rects, collision, and edit locks.

import { app } from './state.js';

export function curFrameIdx(){ return app.cur.st.frameIdx % app.cur.st.frames.length; }

// When ALL FRAMES mode is on, per-frame edits (offset/scale/melee) propagate to
// EVERY frame so the whole animation moves as one rigid body. Collision is already
// shared across frames, so it follows automatically. Returns the list of frames to
// mutate for the current frame index; otherwise just that one frame.
export function targetFrames(fi){
  if (app.show.allFrames && app.cur && app.cur.st) return app.cur.st.frames;
  return [ app.cur.st.frames[fi] ];
}

export function frameRect(st, fi){
  const im = app.cur.imgs[fi]; if (!im) return null;
  const f = st.frames[fi];
  const w = im.naturalWidth*f.scale.sx, h = im.naturalHeight*f.scale.sy;
  return { x: f.offset.x - w/2, y: f.offset.y - h/2, w, h };
}

// box rects (stored directly in sprite-space)
// Collision & melee are physically shifted together with the frames on any
// position reset, so they live in the same space as the sprite and follow it.
export function collisionRect(fi){ return { ...app.cur.st.collision }; }

// while playing OR rotating, per-frame sprite edits are locked (view-only)
export function editingLocked(){ return !!(app.cur && app.cur.st && (app.cur.st.playing || (app.cur.st.rot && app.cur.st.rot.playing))); }

export function boxesVisible(){ return app.show.meleeView; }
