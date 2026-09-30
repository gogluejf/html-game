// ---------- camera / viewport ----------
// Coordinate transforms between screen (CSS px) and sprite space, plus canvas
// sizing. Origin (0,0) maps to canvas center + pan; +y is down. When rotation is
// active, c2s inverse-rotates around the pivot so hit-testing/drag work in the
// unrotated local frame.

import { app } from './state.js';

export const cv = document.getElementById('cv');
export const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

export const $ = id => document.getElementById(id);
export const tree = $('tree'), finfo = $('finfo');

const dbg = document.createElement('div');
dbg.id = 'dbg';
// DEBUG state readout — hidden by default; show with: document.getElementById('dbg').style.display='block'
dbg.style.cssText = 'display:none;position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99;background:#000;color:#0f0;font:12px monospace;padding:4px 10px;border:1px solid #0f0;border-radius:6px;pointer-events:none;';
document.body.appendChild(dbg);
export { dbg };

// Size the backing store in DEVICE pixels and scale the context by dpr so we
// draw at true resolution. Without this, on Retina displays the low-res buffer
// is GPU-upscaled and semi-transparent box fills resample/blend across frames,
// accumulating toward solid white the more you edit.
export function resizeCanvas(){
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  app.cssW = Math.max(1, Math.round(r.width));
  app.cssH = Math.max(1, Math.round(r.height));
  cv.width = Math.max(1, Math.round(app.cssW * dpr));
  cv.height = Math.max(1, Math.round(app.cssH * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// screen(px) <-> sprite-space. Origin (0,0) maps to canvas center + pan.
export function s2c(x, y){ return [ app.cssW/2 + (x - app.panX)*app.zoom, app.cssH/2 + (y - app.panY)*app.zoom ]; }
export function c2s(x, y){
  let sx = (x - app.cssW/2)/app.zoom + app.panX;
  let sy = (y - app.cssH/2)/app.zoom + app.panY;
  // inverse-rotate around pivot if rotation is active
  const cur = app.cur;
  if (cur && cur.st && cur.st.rot && cur.st.rot.angle !== 0 && cur.st.pivot){
    const rad = cur.st.rot.angle * Math.PI / 180;
    const cos = Math.cos(-rad), sin = Math.sin(-rad);
    const dx = sx - cur.st.pivot.x, dy = sy - cur.st.pivot.y;
    sx = cur.st.pivot.x + dx*cos - dy*sin;
    sy = cur.st.pivot.y + dx*sin + dy*cos;
  }
  return [sx, sy];
}
export function evPos(e){ const r = cv.getBoundingClientRect(); return [ e.clientX - r.left, e.clientY - r.top ]; }
export function setZoom(nz, cx, cy){
  nz = Math.max(.05, Math.min(32, nz));
  if (cx === undefined){ cx = app.cssW/2; cy = app.cssH/2; }   // zoom about center by default
  const [wx, wy] = c2s(cx, cy);   // keep the sprite point under the cursor fixed
  app.zoom = nz;
  app.panX = wx - (cx - app.cssW/2)/app.zoom;
  app.panY = wy - (cy - app.cssH/2)/app.zoom;
  app.userZoomed = true;              // manual zoom: stop auto-fitting on future selects
  $('zoomval').textContent = Math.round(app.zoom*100)+'%';
  // draw() is imported lazily via a callback to avoid a circular import.
  if (typeof _drawHook === 'function') _drawHook();
}

// choose a "nice" grid step (1,2,5,10,20,...) so ~40-80px on screen
export function gridStep(){
  const target = 60/app.zoom;      // desired sprite-px between lines
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1,2,5,10]){ if (m*pow >= target) return m*pow; }
  return 10*pow;
}

// draw() hook — set by draw.js so setZoom can trigger a redraw without importing it.
let _drawHook = null;
export function setDrawHook(fn){ _drawHook = fn; }
