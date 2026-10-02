// ---------- draw (macro editor) ----------
// Renders the selected macro: unit grid, blocks (filled), platforms (thin
// surface), and placement slots (colored dots). Macro space: x right, y UP,
// row 0 = ground at the bottom. Canvas flips y so ground sits low on screen.

import { app, SLOT_COLORS, COL_BLOCK, COL_PLATFORM, COL_GRID, COL_GRID_MAJOR } from './state.js';
import { cv, ctx, s2c, setDrawHook } from './viewport.js';

let _consts = { unitPxX:72, unitPxY:48, platformDrawH:6 };
export function setConstants(c){ _consts = c; }

// world (unit*px, y-up) -> canvas px via viewport transform
function W(x, y){ return s2c(x, y); }

export function draw(){
  const { cssW, cssH } = app;
  ctx.clearRect(0, 0, cssW, cssH);
  // background
  ctx.fillStyle = '#0a0c14';
  ctx.fillRect(0, 0, cssW, cssH);

  if (app.show.grid) drawGrid();
  if (app.cur && app.cur.st){
    drawMacro(app.cur.st);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('select a macro', cssW/2, cssH/2);
  }
}

function drawGrid(){
  const ux = _consts.unitPxX, uy = _consts.unitPxY;
  // Determine visible world range (y-up). Screen top = max world y.
  const [wx0] = [0];
  // corners in world coords: invert s2c for the four screen corners
  const toWorld = (sx, sy) => {
    const wx = (sx - app.cssW/2)/app.zoom + app.panX;
    const wy = app.panY - (sy - app.cssH/2)/app.zoom;
    return [wx, wy];
  };
  const [minX, maxY] = toWorld(0, 0);
  const [maxX, minY] = toWorld(app.cssW, app.cssH);

  ctx.lineWidth = 1;
  // vertical lines (x)
  let startX = Math.floor(minX / ux) * ux;
  for (let x = startX; x <= maxX; x += ux){
    const major = Math.round(x/ux) % 4 === 0;
    ctx.strokeStyle = major ? COL_GRID_MAJOR : COL_GRID;
    const [sx0, sy0] = W(x, minY);
    const [, sy1] = W(x, maxY);
    ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(sx0, sy1); ctx.stroke();
  }
  // horizontal lines (y)
  let startY = Math.floor(minY / uy) * uy;
  for (let y = startY; y <= maxY; y += uy){
    const major = Math.round(y/uy) % 4 === 0;
    ctx.strokeStyle = major ? COL_GRID_MAJOR : COL_GRID;
    const [sx0, sy0] = W(minX, y);
    const [sx1] = W(maxX, y);
    ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(sx1, sy0); ctx.stroke();
  }
  // ground line (row 0) emphasized
  ctx.strokeStyle = 'rgba(90,255,138,.5)';
  ctx.lineWidth = 2;
  const [gx0, gy0] = W(minX, 0);
  const [gx1] = W(maxX, 0);
  ctx.beginPath(); ctx.moveTo(gx0, gy0); ctx.lineTo(gx1, gy0); ctx.stroke();
}

function drawMacro(macro){
  const ux = _consts.unitPxX, uy = _consts.unitPxY, ph = _consts.platformDrawH;
  const units = macro.units || [];
  const placements = macro.placements || [];

  // blocks first (behind platforms)
  for (const u of units){
    if (u.kind !== 'block') continue;
    const x = u.x ?? 0;
    const y = u.y ?? 0;
    const h = u.height ?? 1;
    const x0 = x * ux, y0 = y * uy, x1 = (x+1)*ux, y1 = (y+h)*uy;
    const [sx0, syTop] = W(x0, y1);   // top-left (higher y = up)
    const [sx1, syBot] = W(x1, y0);   // bottom-right
    ctx.fillStyle = 'rgba(90,255,138,.28)';
    ctx.fillRect(sx0, syTop, sx1-sx0, syBot-syTop);
    ctx.strokeStyle = COL_BLOCK;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx0, syTop, sx1-sx0, syBot-syTop);
    if (app.show.labels){
      labelAt((sx0+sx1)/2, (syTop+syBot)/2, `B${h}`);
    }
  }

  // platforms (thin surface at the top of their occupied row)
  for (const u of units){
    if (u.kind !== 'platform') continue;
    const x = u.x ?? 0;
    const y = u.y ?? 0;
    const w = u.width ?? 1;
    const faceY = (y+1) * uy;          // landing face elevation
    const x0 = x * ux, x1 = (x+w)*ux;
    const [sx0, syFace] = W(x0, faceY);
    const [sx1] = W(x1, faceY);
    ctx.fillStyle = 'rgba(62,240,255,.35)';
    ctx.fillRect(sx0, syFace - ph/2, sx1-sx0, ph);
    ctx.strokeStyle = COL_PLATFORM;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx0, syFace - ph/2, sx1-sx0, ph);
    if (app.show.labels){
      labelAt((sx0+sx1)/2, syFace - ph - 6, `P${w}`);
    }
  }

  // slots (dots) — type-colored, sitting one level above their support
  if (app.show.slots){
    for (const p of placements){
      const col = p.x ?? 0;
      const row = p.y ?? 0;             // elevation the slot rests ON
      const cx = (col + 0.5) * ux;
      const cy = (row + 1) * uy;        // one level above the supporting surface
      const [sx, sy] = W(cx, cy);
      const color = SLOT_COLORS[p.type] || '#fff';
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(4, 6*app.zoom), 0, Math.PI*2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

function labelAt(x, y, text){
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.font = `${Math.max(10, 12*app.zoom)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.textBaseline = 'alphabetic';
}

setDrawHook(draw);
