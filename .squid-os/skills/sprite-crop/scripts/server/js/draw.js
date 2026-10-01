// ---------- drawing: the main canvas render + box helpers ----------
import { app, COL_COLL, COL_MELEE, COL_SCALE, COL_MARKER, HANDLE_R, hexA } from './state.js';
import { cv, ctx, $, finfo, dbg, s2c, setDrawHook } from './viewport.js';
import { curFrameIdx, targetFrames, frameRect, collisionRect, editingLocked, boxesVisible } from './geometry.js';
import { gridStep } from './viewport.js';

// register draw() as the viewport's redraw hook (setZoom -> draw)
setDrawHook(draw);

export function handlePts(r){
  const cx=r.x+r.w/2, cy=r.y+r.h/2;
  return [
    {id:'nw',x:r.x,y:r.y},{id:'n',x:cx,y:r.y},{id:'ne',x:r.x+r.w,y:r.y},
    {id:'w',x:r.x,y:cy},{id:'e',x:r.x+r.w,y:cy},
    {id:'sw',x:r.x,y:r.y+r.h},{id:'s',x:cx,y:r.y+r.h},{id:'se',x:r.x+r.w,y:r.y+r.h}
  ];
}

export function drawBox(rect, color, showHandles, dashed, hotHandle, hotBody){
  const [x, y] = s2c(rect.x, rect.y);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = (hotBody||hotHandle) ? 3 : 2;
  if (dashed) ctx.setLineDash([6,4]);
  ctx.strokeRect(x, y, rect.w*app.zoom, rect.h*app.zoom);
  ctx.setLineDash([]);
  if (showHandles){
    for (const p of handlePts(rect)){
      const [px, py] = s2c(p.x, p.y);
      const hot = hotHandle === p.id;
      ctx.fillStyle = hot ? '#fff' : color;
      const r = hot ? HANDLE_R+2 : HANDLE_R;
      ctx.fillRect(px-r, py-r, r*2, r*2);
    }
  }
  ctx.restore();
}

export function hitHandle(rect, sx, sy){
  const tol = 9/app.zoom;   // constant ~9 screen-px hit area regardless of zoom
  for (const p of handlePts(rect)) if (Math.abs(sx-p.x)<=tol && Math.abs(sy-p.y)<=tol) return p.id;
  return null;
}

export function inside(r, x, y){ return x>=r.x && x<=r.x+r.w && y>=r.y && y<=r.y+r.h; }

// find the manifest entity matching the current name (for char/anim label text)
function currentEntity(){
  for (const l of app.manifest.labels) for (const e of l.entities) if (e.name===app.cur.name) return e;
  return null;
}

export function draw(){
  const cur = app.cur;
  if (!cur || !cur.st) return;
  const st = cur.st;
  // Clear the FULL canvas at identity transform, then apply dpr for drawing.
  // This guarantees no residual content from previous frames accumulates.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = app.bgColor;
  ctx.fillRect(0, 0, cv.width, cv.height);
  // Now apply dpr scaling for all subsequent drawing (which uses CSS-pixel coords)
  const dpr = Math.min(2, window.devicePixelRatio||1);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // ---------- full-screen grid + shared origin coords ----------
  const step = gridStep();
  const [ox, oy] = s2c(0, 0);   // where sprite origin (0,0) lands on screen
  if (app.show.grid){
    ctx.lineWidth = 1;
    // minor lines
    ctx.strokeStyle = 'rgba(30,40,70,.5)';
    ctx.beginPath();
    let gx = ox % (step*app.zoom); if (gx < 0) gx += step*app.zoom;
    for (let x=gx; x<app.cssW; x+=step*app.zoom){ ctx.moveTo(x+.5,0); ctx.lineTo(x+.5,app.cssH); }
    let gy = oy % (step*app.zoom); if (gy < 0) gy += step*app.zoom;
    for (let y=gy; y<app.cssH; y+=step*app.zoom){ ctx.moveTo(0,y+.5); ctx.lineTo(app.cssW,y+.5); }
    ctx.stroke();
  }
  // ---------- axes through origin ----------
  if (app.show.axes){
    ctx.strokeStyle = 'rgba(90,106,144,.8)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ox,0); ctx.lineTo(ox,app.cssH);
    ctx.moveTo(0,oy); ctx.lineTo(app.cssW,oy);
    ctx.stroke();
    ctx.fillStyle = 'rgba(150,170,210,.9)'; ctx.font = '11px Courier New';
    ctx.fillText('0,0', ox+4, oy-4);
    ctx.fillText('+x \u25B6', ox+step*app.zoom+4, oy-4);
    ctx.fillText('\u25BC +y', ox+4, oy+step*app.zoom+12);
  }
  const fi = curFrameIdx();
  const im = cur.imgs[fi];
  const rotDeg = (st.rot && st.rot.angle) || 0;
  const rad = rotDeg * Math.PI / 180;
  const pv = st.pivot || { x:0, y:0 };
  // ---------- rotated context: pivot at center ----------
  ctx.save();
  const [pvx, pvy] = s2c(pv.x, pv.y);
  ctx.translate(pvx, pvy);
  ctx.rotate(rad);
  ctx.translate(-pvx, -pvy);
  // draw sprite
  if (im){
    const f = st.frames[fi];
    const w = im.naturalWidth*f.scale.sx, h = im.naturalHeight*f.scale.sy;
    const [dx, dy] = s2c(f.offset.x - w/2, f.offset.y - h/2);
    ctx.drawImage(im, dx, dy, w*app.zoom, h*app.zoom);
  }
  // ALL FRAMES ghost view: while paused, draw every frame's image at its own
  // position/scale with alpha so you can see the whole animation at once.
  if (app.show.allFrames && !st.playing && st.frames.length > 1){
    ctx.save();
    ctx.globalAlpha = 0.35;
    for (let i=0;i<st.frames.length;i++){
      if (i===fi) continue;
      const gim = cur.imgs[i]; if (!gim) continue;
      const gf = st.frames[i];
      const gw = gim.naturalWidth*gf.scale.sx, gh = gim.naturalHeight*gf.scale.sy;
      const [gdx, gdy] = s2c(gf.offset.x - gw/2, gf.offset.y - gh/2);
      ctx.drawImage(gim, gdx, gdy, gw*app.zoom, gh*app.zoom);
    }
    ctx.restore();
  }
  // draw boxes (rotated with sprite)
  // While PLAYING: "display" style — solid line + light fill, NO anchor handles.
  // While PAUSED: full edit style with handles so you can grab/resize.
  const playing = !!st.playing;
  const boxes = boxList();
  for (const b of [...boxes].reverse()){
    if (playing){
      const [x, y] = s2c(b.rect.x, b.rect.y);
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      ctx.fillRect(x, y, b.rect.w*app.zoom, b.rect.h*app.zoom);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, b.rect.w*app.zoom, b.rect.h*app.zoom);
      ctx.restore();
    } else {
      const hovered = app.hover && app.hover.box===b.key;
      const dragging = app.drag && app.drag.kind!=='pan' && app.drag.key===b.key;
      // panel highlight or selected: solid fill
      const panelHl = app._panelHighlight === b.key || app._selectedBox === b.key;
      if (panelHl){
        const [hx, hy] = s2c(b.rect.x, b.rect.y);
        ctx.save();
        ctx.fillStyle = hexA(b.color, 0.35);
        ctx.fillRect(hx, hy, b.rect.w*app.zoom, b.rect.h*app.zoom);
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(hx, hy, b.rect.w*app.zoom, b.rect.h*app.zoom);
        ctx.restore();
      }
      drawBox(b.rect, b.color, true, !dragging && !(app._selectedBox===b.key),
        hovered ? app.hover.handle : null, !!(hovered && app.hover.body));
      // label above box
      if (b.label){
        const [lx, ly] = s2c(b.rect.x + b.rect.w/2, b.rect.y);
        ctx.save();
        ctx.font = '11px Courier New';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = b.color;
        ctx.fillText(b.label, lx, ly - 4);
        ctx.restore();
      }
    }
  }
  ctx.restore();
  // ---------- sprite name label (viewer-style) — fixed at top-center of canvas ----------
  if (app.show.label){
    const _curEn2 = currentEntity();
    const ch = (_curEn2 && _curEn2.char) ? _curEn2.char : cur.name;
    const anim = (_curEn2 && _curEn2.anim) ? _curEn2.anim : '';
    const text = anim ? (ch + ' — ' + anim) : ch;
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
  // ---------- pivot marker (NOT rotated — always upright target) ----------
  if (app.show.pivot && st.pivot){
    const [px, py] = s2c(st.pivot.x, st.pivot.y);
    const R = 10;   // screen-px radius
    ctx.save();
    ctx.strokeStyle = '#ffe23e';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = '#ffe23e';
    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI*2); ctx.fill();
    // crosshair ticks
    ctx.beginPath();
    ctx.moveTo(px-R-4, py); ctx.lineTo(px-R+2, py);
    ctx.moveTo(px+R-2, py); ctx.lineTo(px+R+4, py);
    ctx.moveTo(px, py-R-4); ctx.lineTo(px, py-R+2);
    ctx.moveTo(px, py+R-2); ctx.lineTo(px, py+R+4);
    ctx.stroke();
    ctx.restore();
  }
  finfo.textContent = `frame ${fi+1}/${st.frames.length}  \u2014  ${st.frames[fi].name}`;
  // ---------- markers (NOT rotated — always upright, like pivot) ----------
  if (app.show.markerView && st.markers){
    for (let mi=0; mi<st.markers.length; mi++){
      const m = st.markers[mi];
      const [mx, my] = s2c(m.x, m.y);
      const selected = app._selectedBox === 'marker_'+mi;
      const panelHl = app._panelHighlight === 'marker_'+mi;
      ctx.save();
      // radius circle
      if (m.radiusOn && m.radius > 0){
        const hl = selected || panelHl;
        if (hl){
          ctx.fillStyle = hexA(COL_MARKER, 0.15);
          ctx.beginPath();
          ctx.arc(mx, my, m.radius*app.zoom, 0, Math.PI*2);
          ctx.fill();
        }
        ctx.strokeStyle = COL_MARKER;
        ctx.lineWidth = hl ? 2.5 : 1.5;
        if (!hl) ctx.setLineDash([4,3]);
        ctx.beginPath();
        ctx.arc(mx, my, m.radius*app.zoom, 0, Math.PI*2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // dot
      const dotR = selected ? 7 : 5;
      ctx.fillStyle = COL_MARKER;
      ctx.beginPath();
      ctx.arc(mx, my, dotR, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      // selection ring
      if (selected || panelHl){
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(mx, my, 12, 0, Math.PI*2);
        ctx.stroke();
      }
      // radius resize handle at 3 o'clock (visible when paused + radius on)
      if (m.radiusOn && m.radius > 0 && !st.playing){
        const [hx, hy] = s2c(m.x + m.radius, m.y);
        const hot = (selected || panelHl);
        ctx.fillStyle = hot ? '#fff' : COL_MARKER;
        ctx.fillRect(hx-4, hy-4, 8, 8);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(hx-4, hy-4, 8, 8);
      }
      // label above dot (or above radius circle)
      if (m.label){
        const labelY = m.radiusOn && m.radius > 0 ? my - m.radius*app.zoom - 6 : my - dotR - 6;
        ctx.font = '11px Courier New';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = COL_MARKER;
        ctx.fillText(m.label, mx, labelY);
      }
      ctx.restore();
    }
  }
  // DEBUG state readout (temporary)
  const mode = app.drag ? 'DRAG:'+app.drag.kind : (app.hover ? 'HOVER:'+(app.hover.handle||'body') : 'IDLE');
  dbg.textContent = `mode=${mode}  drag=${app.drag?app.drag.kind:'null'}  hover=${app.hover?JSON.stringify(app.hover):'null'}`;
}

// build the list of visible boxes in z-order (front first) for hit-testing/draw
export function boxList(){
  const cur = app.cur;
  const st = cur.st, fi = curFrameIdx(), im = cur.imgs[fi];
  const byKey = {};
  if (app.show.spriteView && im) byKey.sprite    = { key:'sprite',    rect:frameRect(st, fi), color:COL_SCALE };
  if (app.show.collision)        byKey.collision = { key:'collision', rect:collisionRect(fi), color:COL_COLL  };
  // melee boxes collection
  if (boxesVisible()){
    const fBoxes = st.frames[fi].boxes || [];
    fBoxes.forEach((b, i) => {
      byKey['box_'+i] = { key:'box_'+i, rect:{x:b.x,y:b.y,w:b.w,h:b.h}, color:COL_MELEE, label:b.label, idx:i };
    });
  }
  // pivot is a point, not a rect — handled separately in hover/drag
  // return in z-order (front first) so hit-testing respects last-touched:
  // app.boxZOrder holds keys front-to-back; unknown keys fall behind.
  const ordered = [];
  for (const k of app.boxZOrder){ if (byKey[k]) ordered.push(byKey[k]); }
  for (const b of Object.values(byKey)) if (!ordered.includes(b)) ordered.push(b);
  return ordered;
}
