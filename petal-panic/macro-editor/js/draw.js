// ---------- draw (macro editor) ----------
// Renders the selected macro: unit grid, blocks (filled), platforms (thin
// surface), and placement slots (colored dots). Macro space: x right, y UP,
// row 0 = ground at the bottom. Canvas flips y so ground sits low on screen.
//
// Clearance model:
//   - AREA entry/exit clear (hEntryClear/hExitClear, vEntryClear/vExitClear)
//     are GAME-LEVEL zones (hero spawn / exit flag) — drawn as dark-yellow
//     bands at the two ends of the area box. The first macro starts AFTER the
//     area entry band; the last macro ends BEFORE the area exit band.
//   - Macros carry NO entry/exit clear of their own anymore: spacing between
//     set-pieces is baked into each macro's authored unit coordinates. Units
//     draw at (areaEc + u.x) for horizontal, at (u.x) for vertical.

import { app, SLOT_COLORS, COL_BLOCK, COL_PLATFORM, COL_GRID, COL_GRID_MAJOR } from './state.js';
import { cv, ctx, s2c, setDrawHook } from './viewport.js';

let _consts = { unitPxX:72, unitPxY:48, platformDrawH:6 };
export function setConstants(c){ 
  _consts = c; 
}

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
    if (app.show.zone) drawZoneBox(app.cur.st);   // area bounding box + entry/exit (behind units)
    drawMacro(app.cur.st);
    drawTitle(app.cur.st);                        // fixed top-center name label (viewer-style)
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('select a macro', cssW/2, cssH/2);
  }
}

// ---------- macro name label — fixed at top-center of canvas (viewer-style) ----------
// Mirrors the sprite editor's master label: bold cyan with glow + dark outline.
// Follows the same labels toggle (L / tglLabels) as the block/platform labels.
function drawTitle(macro){
  if (!app.show.labels) return;
  const text = macro.name || macro.id || '';
  if (!text) return;
  ctx.save();
  ctx.font = 'bold 26px Courier New';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const tx = app.cssW/2, ty = 14;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(7,9,18,.9)';
  ctx.strokeText(text, tx, ty);
  ctx.shadowColor = '#3ef0ff';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#3ef0ff';
  ctx.fillText(text, tx, ty);
  ctx.restore();
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
    const [sx1, sy1] = W(maxX, y);
    ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(sx1, sy0); ctx.stroke();
  }
  // ground line (row 0) emphasized
  ctx.strokeStyle = 'rgba(90,255,138,.5)';
  ctx.lineWidth = 2;
  const [gx0, gy0] = W(minX, 0);
  const [gx1] = W(maxX, 0);
  ctx.beginPath(); ctx.moveTo(gx0, gy0); ctx.lineTo(gx1, gy0); ctx.stroke();

  // ---------- origin axes (like the sprite editor) ----------
  // Draw X and Y axes at the BODY origin: after the AREA entry clear only.
  // Horizontal: x-axis = ground line (y=0), y-axis = after the area-in band.
  // Vertical: V_ENTRY_CLEAR = 0, so the origin is at the zone bottom/left edge.
  const c = _consts;
  const vertical = app.cur?.st?.orientation === 'vertical';
  const areaEc = vertical ? c.vEntryClear : c.hEntryClear;

  let ox, oy;
  if (vertical){
    ox = 0;                       // left edge (no x-offset for vertical)
    oy = areaEc * c.unitPxY;      // up by the area entry amount (0 in practice)
  } else {
    ox = areaEc * c.unitPxX;      // right by the area entry amount
    oy = 0;                       // ground level
  }
  const [screenX, screenY] = W(ox, oy);
  if (screenX >= -40 && screenX <= app.cssW + 40 && screenY >= -40 && screenY <= app.cssH + 40){
    ctx.save();
    // Draw both axes through the origin point
    ctx.strokeStyle = 'rgba(90,106,144,.8)';
    ctx.lineWidth = 1.5;
    // Y-axis (vertical line)
    ctx.beginPath();
    ctx.moveTo(screenX, 0); ctx.lineTo(screenX, app.cssH);
    ctx.stroke();
    // X-axis (horizontal line)
    ctx.beginPath();
    ctx.moveTo(0, screenY); ctx.lineTo(app.cssW, screenY);
    ctx.stroke();
    // origin dot
    ctx.fillStyle = 'rgba(150,170,210,.9)';
    ctx.font = '11px Courier New';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('0,0', screenX + 4, screenY - 4);
    ctx.restore();
  }
}

function drawMacro(macro){
  const ux = _consts.unitPxX, uy = _consts.unitPxY, ph = _consts.platformDrawH;
  const units = macro.units || [];
  const placements = macro.placements || [];

  // Offset matches the game's placeMacro exactly:
  //   Horizontal: px = axisPos + u.x  where axisPos starts at H_ENTRY_CLEAR
  //               → areaEc + u.x (macros have no clears of their own)
  //   Vertical:   py = axisPos + u.y  where axisPos starts at V_ENTRY_CLEAR (0)
  //               → u.y
  const vertical = macro.orientation === 'vertical';
  const areaEc = vertical ? _consts.vEntryClear : _consts.hEntryClear;
  const bodyOffset = areaEc;

  // blocks (offset by the area entry clear only)
  for (const u of units){
    if (u.kind !== 'block') continue;
    const x = (u.x ?? 0) + bodyOffset;
    const y = u.y ?? 0;
    const w = u.width ?? 1, h = u.height ?? 1;
    const x0 = x * ux, y0 = y * uy, x1 = (x+w)*ux, y1 = (y+h)*uy;
    const [sx0, syTop] = W(x0, y1);
    const [sx1, syBot] = W(x1, y0);
    ctx.fillStyle = 'rgba(90,255,138,.28)';
    ctx.fillRect(sx0, syTop, sx1-sx0, syBot-syTop);
    ctx.strokeStyle = COL_BLOCK;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx0, syTop, sx1-sx0, syBot-syTop);
    if (app.show.labels){
      labelAt((sx0+sx1)/2, (syTop+syBot)/2, `B${w}×${h}`);
    }
  }

  // platforms (offset by the area entry clear only)
  for (const u of units){
    if (u.kind !== 'platform') continue;
    const x = (u.x ?? 0) + bodyOffset;
    const y = u.y ?? 0;
    const w = u.width ?? 1;
    const faceY = (y+1) * uy;
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

  // slots (offset by the area entry clear only)
  if (app.show.slots){
    for (const p of placements){
      const col = (p.x ?? 0) + bodyOffset;
      const row = p.y ?? 0;
      const cx = (col + 0.5) * ux;
      const cy = (row + 0.5) * uy;
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

// ---------- area bounding box + entry/exit markers ----------
// Shows the full AREA a macro lives inside (the composer's length budget), so
// you can see how much of a level one macro consumes and where the hero enters
// (X) and exits (flag). The box is the whole area: AREA entry clear → macros →
// AREA exit clear. For vertical macros the width is the fixed one-screen zone
// width.

// Compute the area's unit-space extents for a macro. Shared by the zone overlay
// AND the fit-to-view logic so both always agree on what "the whole area" is.
// Returns { ax0, ax1, ay0, ay1 } in unit space (ay0 = ground = 0).
export function zoneExtents(macro){
  const c = _consts;
  const ec = c.hEntryClear ?? 3, xc = c.hExitClear ?? 3;
  const vertical = macro.orientation === 'vertical';
  const units = macro.units || [];
  let minX = Infinity, maxX = -Infinity, maxY = 0;
  for (const u of units){
    const x0 = u.x ?? 0;
    const x1 = x0 + (u.width ?? 1);
    const yTop = (u.y ?? 0) + (u.kind === 'block' ? (u.height ?? 1) : 1);
    if (x0 < minX) minX = x0;
    if (x1 > maxX) maxX = x1;
    if (yTop > maxY) maxY = yTop;
  }
  if (!isFinite(minX)){ minX = 0; maxX = 0; }   // empty macro
  let ax0, ax1, ay1;
  if (vertical){
    ax0 = 0;
    ax1 = c.vZoneWidthUnits ?? Math.max(maxX, 13);
    ay1 = c.vBudgetUnits ?? Math.max(maxY + ec + xc, 56);
  } else {
    // The box is the FULL AREA length (the level's horizontal budget), NOT the
    // macro's footprint. A single macro occupies only a slice of the area; the
    // rest is filled by other macros at runtime. The area entry/exit clear
    // bands sit at the two ends of this full-length box.
    ax0 = 0;
    ax1 = c.hBudgetUnits ?? 56;
    ay1 = c.hZoneHeightUnits ?? Math.max(maxY + 4, 11);
  }
  return { ax0, ax1, ay0: 0, ay1 };
}

// Content extents for FIT-TO-VIEW only: the actual terrain plus the area
// entry/exit clear bands, but NOT the full zone height. A horizontal area is
// one screen tall (11.25u) yet its terrain sits in the bottom few rows —
// fitting to the full box would center ~8u of empty air and make the zone look
// oversized. Fitting to the content keeps the ground line near the canvas
// center so the zone box reads correctly. The zone OVERLAY itself still draws
// at full height.
export function contentExtents(macro){
  const c = _consts;
  const ec = c.hEntryClear ?? 3, xc = c.hExitClear ?? 3;
  const vertical = macro.orientation === 'vertical';
  const units = macro.units || [];
  let minX = Infinity, maxX = -Infinity, maxY = 0;
  for (const u of units){
    const x0 = u.x ?? 0;
    const x1 = x0 + (u.width ?? 1);
    const yTop = (u.y ?? 0) + (u.kind === 'block' ? (u.height ?? 1) : 1);
    if (x0 < minX) minX = x0;
    if (x1 > maxX) maxX = x1;
    if (yTop > maxY) maxY = yTop;
  }
  if (!isFinite(minX)){ minX = 0; maxX = 0; }   // empty macro
  let cx0, cx1, cy1;
  if (vertical){
    // Full one-screen width; height = terrain top + area exit clear band.
    cx0 = 0;
    cx1 = c.vZoneWidthUnits ?? Math.max(maxX, 13);
    cy1 = maxY + xc;
  } else {
    // Fit to the FULL AREA length (same as the zone box), so the whole 56-unit
    // level — including both area entry/exit clear bands at its ends — stays
    // in frame.
    cx0 = 0;
    cx1 = c.hBudgetUnits ?? 56;
    cy1 = Math.max(maxY + 1, 3);
  }
  return { ax0: cx0, ax1: cx1, ay0: 0, ay1: cy1 };
}

function drawZoneBox(macro){
  const c = _consts;
  const ux = c.unitPxX, uy = c.unitPxY;
  const vertical = macro.orientation === 'vertical';
  // Area-level clearance values from the game's constants (single source of
  // truth in macros.js). Macros have no clears of their own.
  const ec = vertical ? c.vEntryClear : c.hEntryClear;
  const xc = vertical ? c.vExitClear : c.hExitClear;
  const { ax0, ax1, ay0, ay1 } = zoneExtents(macro);

  // Dashed bounding box around the whole area.
  const [bx0, byTop] = W(ax0*ux, ay1*uy);
  const [bx1, byBot] = W(ax1*ux, ay0*uy);
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,226,62,.55)';
  ctx.strokeRect(bx0, byTop, bx1-bx0, byBot-byTop);
  ctx.restore();

  // AREA entry / exit clear zones (shaded bands along the composition axis).
  // Layout: [area-in] ...macros... [area-out]. No macro-level bands anymore —
  // spacing between set-pieces is baked into the authored coordinates.
  const DARK = 'rgba(255,226,62,.18)';   // area clearance
  if (vertical){
    // Vertical: entry at BOTTOM (may be 0), exit at TOP.
    if (ec > 0){
      ctx.fillStyle = DARK;
      const [ex0, eyTop] = W(ax0*ux, ec*uy);
      const [ex1, eyBot] = W(ax1*ux, 0);
      ctx.fillRect(ex0, eyTop, ex1-ex0, eyBot-eyTop);
    }
    // Area exit (top, at very end)
    ctx.fillStyle = DARK;
    const [ax0b, axyTop] = W(ax0*ux, ay1*uy);
    const [ax1b, axyBot] = W(ax1*ux, (ay1-xc)*uy);
    ctx.fillRect(ax0b, axyTop, ax1b-ax0b, axyBot-axyTop);
  } else {
    // Horizontal: entry at LEFT, exit at RIGHT.
    ctx.fillStyle = DARK;
    const [enx0, enyTop] = W(0, ay1*uy);
    const [enx1, enyBot] = W(ec*ux, 0);
    ctx.fillRect(enx0, enyTop, enx1-enx0, enyBot-enyTop);    // area entry (left)
    ctx.fillStyle = DARK;
    const [aexx0, aextop] = W((ax1-xc)*ux, ay1*uy);
    const [aexx1, aexbot] = W(ax1*ux, 0);
    ctx.fillRect(aexx0, aextop, aexx1-aexx0, aexbot-aextop);  // area exit (right, at very end)
  }

  // Entry marker "X" (where the hero spawns) + exit flag — both on the GROUND.
  const markSize = Math.max(10, 14*app.zoom);
  if (vertical){
    drawEntryX(W((ax0+ax1)/2*ux, (ec/2)*uy), markSize);
    drawExitFlag(W((ax0+ax1)/2*ux, (ay1 - xc/2)*uy), markSize);
  } else {
    // Horizontal: entry at the left edge, exit at the right edge, both resting
    // on the ground line (y=0), a little above it so they're visible.
    const gy = uy * 0.5;   // half a unit up from the ground
    drawEntryX(W((ec/2)*ux, gy), markSize);
    drawExitFlag(W((ax1 - xc/2)*ux, gy), markSize);
  }

  // Dimension label along the composition axis.
  const dimLabel = vertical
    ? `${Math.round(ay1)}u tall · ${Math.round(ax1)}u wide`
    : `${Math.round(ax1)}u wide · ${Math.round(ay1)}u tall`;
  ctx.fillStyle = 'rgba(255,226,62,.8)';
  ctx.font = `${Math.max(10, 12*app.zoom)}px monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`AREA  ${dimLabel}`, bx0 + 6, byTop + 4);
  ctx.textBaseline = 'alphabetic';
}

// An "X" marking the entry point (hero spawn).
function drawEntryX([sx, sy], s){
  ctx.strokeStyle = '#5aff8a';
  ctx.lineWidth = Math.max(2, 2.5*app.zoom);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx - s/2, sy - s/2); ctx.lineTo(sx + s/2, sy + s/2);
  ctx.moveTo(sx + s/2, sy - s/2); ctx.lineTo(sx - s/2, sy + s/2);
  ctx.stroke();
  ctx.lineCap = 'butt';
  // small ring so it reads as a marker, not a stray crosshair
  ctx.beginPath();
  ctx.arc(sx, sy, s*0.72, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(90,255,138,.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// A little flag marking the exit.
function drawExitFlag([sx, sy], s){
  ctx.strokeStyle = '#ff5a5a';
  ctx.fillStyle = '#ff5a5a';
  ctx.lineWidth = Math.max(2, 2*app.zoom);
  // pole
  ctx.beginPath(); ctx.moveTo(sx, sy + s/2); ctx.lineTo(sx, sy - s/2); ctx.stroke();
  // pennant
  ctx.beginPath();
  ctx.moveTo(sx, sy - s/2);
  ctx.lineTo(sx + s*0.8, sy - s/2 + s*0.28);
  ctx.lineTo(sx, sy - s/2 + s*0.56);
  ctx.closePath();
  ctx.fill();
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
