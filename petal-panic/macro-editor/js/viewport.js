// ---------- camera / viewport (macro editor) ----------
// Coordinate transforms between screen (CSS px) and macro space. Origin (0,0)
// maps to canvas center + pan; +y is DOWN in screen but we draw the macro with
// row 0 (ground) at the BOTTOM, so world y is flipped in draw.js.

import { app } from './state.js';

export const cv = document.getElementById('cv');
export const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

export const $ = id => document.getElementById(id);
export const tree = $('tree'), finfo = $('finfo');

export function resizeCanvas(){
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  app.cssW = Math.max(1, Math.round(r.width));
  app.cssH = Math.max(1, Math.round(r.height));
  cv.width = Math.max(1, Math.round(app.cssW * dpr));
  cv.height = Math.max(1, Math.round(app.cssH * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// screen(px) <-> macro-space. Origin (0,0) at canvas center + pan.
// Macro space: x right, y UP (row 0 = ground at bottom). We flip y here so
// callers think in "up is positive" and draw.js handles the canvas flip.
export function s2c(x, y){ return [ app.cssW/2 + (x - app.panX)*app.zoom, app.cssH/2 + (app.panY - y)*app.zoom ]; }
export function c2s(x, y){
  const sx = (x - app.cssW/2)/app.zoom + app.panX;
  const sy = app.panY - (y - app.cssH/2)/app.zoom;
  return [sx, sy];
}
export function evPos(e){ const r = cv.getBoundingClientRect(); return [ e.clientX - r.left, e.clientY - r.top ]; }
export function setZoom(nz, cx, cy){
  nz = Math.max(.05, Math.min(32, nz));
  if (cx === undefined){ cx = app.cssW/2; cy = app.cssH/2; }
  const [wx, wy] = c2s(cx, cy);   // macro point under the cursor (before zoom)
  app.zoom = nz;
  // solve pan so that (wx,wy) maps back to the same screen point (cx,cy)
  app.panX = wx - (cx - app.cssW/2)/app.zoom;
  app.panY = wy + (cy - app.cssH/2)/app.zoom;
  app.userZoomed = true;
  $('zoomval').textContent = Math.round(app.zoom*100)+'%';
  if (typeof _drawHook === 'function') _drawHook();
}

let _drawHook = null;
export function setDrawHook(fn){ _drawHook = fn; }
