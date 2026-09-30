// ---------- frame filmstrip (bottom-right unfold) ----------
// A read-only strip showing every frame of the current animation, each drawn in
// its own cell aligned to the SHARED min/max bounds of all frames (sprite +
// collision + melee). Boxes are full-line half-opaque, no anchor handles. Cells
// are separated by a dashed line; the playing frame gets a focus outline.

import { app, FILM } from './state.js';
import { $ } from './viewport.js';
import { curFrameIdx } from './geometry.js';
import { syncPanel } from './panel.js';
import { draw as mainDraw } from './draw.js';
import { saveState } from './save.js';

export { FILM };

function filmBounds(st){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const c=st.collision;
  if (c){ minX=Math.min(minX,c.x); minY=Math.min(minY,c.y); maxX=Math.max(maxX,c.x+c.w); maxY=Math.max(maxY,c.y+c.h); }
  for (let i=0;i<st.frames.length;i++){
    const f=st.frames[i], im=app.cur.imgs[i]; if(!im) continue;
    const w=im.naturalWidth*f.scale.sx, h=im.naturalHeight*f.scale.sy;
    minX=Math.min(minX,f.offset.x-w/2); minY=Math.min(minY,f.offset.y-h/2);
    maxX=Math.max(maxX,f.offset.x+w/2); maxY=Math.max(maxY,f.offset.y+h/2);
    const bxArr = f.boxes || [];
    for (const m of bxArr){
      minX=Math.min(minX,m.x); minY=Math.min(minY,m.y);
      maxX=Math.max(maxX,m.x+m.w); maxY=Math.max(maxY,m.y+m.h); }
  }
  if (!isFinite(minX)){ minX=minY=0; maxX=maxY=1; }
  return { minX, minY, w:maxX-minX, h:maxY-minY };
}

export function drawFilm(){
  if (!FILM.on || !app.cur || !app.cur.st) return;
  const st=app.cur.st, n=st.frames.length;
  if (app.filmCells.length !== n){
    $('filmScroll').innerHTML=''; app.filmCells=[];
    for (let i=0;i<n;i++){
      const cell=document.createElement('div'); cell.className='fcell';
      cell.title='go to frame '+(i+1);
      cell.addEventListener('click', ()=>{ if(!app.cur||!app.cur.st) return; app.cur.st.frameIdx=i%app.cur.st.frames.length; app.acc=0; app._selectedBox=null; syncPanel(); mainDraw(); });
      const num=document.createElement('span'); num.className='fnum'; num.textContent=i+1;
      const cv2=document.createElement('canvas');
      cell.appendChild(num); cell.appendChild(cv2);
      $('filmScroll').appendChild(cell);
      app.filmCells.push({ el:cell, canvas:cv2 });
    }
  }
  const B=filmBounds(st);
  // The cell canvas fills the drawer's usable height (drawer 176 - 4 border -
  // 16 scroll padding = 156px). Content is scaled to fit inside with a small
  // internal margin, so collision/sprite/melee extending in any direction are
  // never clipped.
  const availH = 116 - 4 - FILM.pad*2;   // ~96px usable content height
  const margin = 6;                       // internal margin inside the canvas
  const scale=Math.min(1, (availH-margin*2)/B.h);
  const cw=Math.ceil(B.w*scale)+margin*2, chh=availH;
  const dpr=Math.min(2, window.devicePixelRatio||1);
  for (let i=0;i<n;i++){
    const { canvas:fc, el }=app.filmCells[i];
    fc.width=cw*dpr; fc.height=chh*dpr; fc.style.width=cw+'px'; fc.style.height=chh+'px';
    const g=fc.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0);
    g.fillStyle = app.bgColor; g.fillRect(0,0,cw,chh);   // follow the canvas BG setting
    const ox=margin-B.minX*scale, oy=margin-B.minY*scale;
    const X=wx=>ox+wx*scale, Y=wy=>oy+wy*scale;
    const f=st.frames[i], im=app.cur.imgs[i];
    // The filmstrip ALWAYS shows sprite + collision + melee regardless of the
    // canvas view toggles — those only affect the main canvas, not this strip.
    g.lineWidth=1.5;
    if (st.collision){
      const bx=X(st.collision.x), by=Y(st.collision.y), bw=st.collision.w*scale, bh=st.collision.h*scale;
      g.fillStyle='rgba(62,240,255,.1)'; g.fillRect(bx,by,bw,bh);
      g.strokeStyle='rgba(62,240,255,.7)'; g.strokeRect(bx,by,bw,bh);
    }
    const fBoxes = f.boxes || [];
    for (const mb of fBoxes){
      const mx=X(mb.x), my=Y(mb.y), mw=mb.w*scale, mh=mb.h*scale;
      g.fillStyle='rgba(255,157,46,.1)'; g.fillRect(mx,my,mw,mh);
      g.strokeStyle='rgba(255,157,46,.7)'; g.strokeRect(mx,my,mw,mh);
    }
    // markers (per-animation, same position in every cell)
    if (st.markers){
      for (const mk of st.markers){
        const mkx=X(mk.x), mky=Y(mk.y);
        g.fillStyle='#ff5a5a';
        g.beginPath(); g.arc(mkx, mky, 3, 0, Math.PI*2); g.fill();
        if (mk.radiusOn && mk.radius > 0){
          g.strokeStyle='rgba(255,90,90,.6)';
          g.setLineDash([3,2]);
          g.beginPath(); g.arc(mkx, mky, mk.radius*scale, 0, Math.PI*2); g.stroke();
          g.setLineDash([]);
        }
      }
    }
    if (im){
      const w=im.naturalWidth*f.scale.sx, h=im.naturalHeight*f.scale.sy;
      const sxp=X(f.offset.x-w/2), syp=Y(f.offset.y-h/2);
      g.drawImage(im, sxp, syp, w*scale, h*scale);
      g.fillStyle='rgba(180,123,255,.06)'; g.fillRect(sxp,syp,w*scale,h*scale);
      g.strokeStyle='rgba(180,123,255,.7)'; g.strokeRect(sxp,syp,w*scale,h*scale);
    }
    el.classList.toggle('focus', i===curFrameIdx());
  }
  // refit drawer width to this content — smooth short animation so frame/sprite
  // changes glide to the new size instead of hard-jumping; skipped while an
  // open/close transition is running so it doesn't fight that animation.
  if (FILM.on && !FILM._animating){
    const dw=$('filmDrawer');
    const cellsW = $('filmScroll').scrollWidth;
    const full = cellsW + 34;
    const cap = Math.round(window.innerWidth*0.85);
    const target = Math.min(full, cap) + 'px';
    if (dw.style.width !== target){
      dw.style.transition='width .12s ease-out';
      dw.style.width = target;
    }
  }
}

// Size the drawer to fit the current filmstrip content (cells + handle).
// Pure width set — the caller controls whether it animates via style.transition.
export function filmFitWidth(){
  const dw=$('filmDrawer');
  const cellsW = $('filmScroll').scrollWidth;            // cells + their padding
  const full = cellsW + 34;                              // + handle width
  const cap = Math.round(window.innerWidth*0.85);
  dw.style.width = Math.min(full, cap) + 'px';
}

export function initFilmstrip(){
  $('filmBtn').addEventListener('click', ()=>{
    FILM.on=!FILM.on;
    const dw=$('filmDrawer');
    if (FILM.on){
      // build + size cells first (instant)
      FILM._animating=true;
      drawFilm();
      FILM._animating=false;
      const target = Math.min($('filmScroll').scrollWidth + 34, Math.round(window.innerWidth*0.85));
      dw.classList.add('on');
      // force collapsed start, then animate out on the next frame
      FILM._animating=true;
      dw.style.transition='none';
      dw.style.width='34px';
      requestAnimationFrame(()=>{
        dw.style.transition='width .18s ease-out';
        dw.style.width=target+'px';
        setTimeout(()=>{ FILM._animating=false; }, 200);
      });
    } else {
      dw.classList.remove('on');
      FILM._animating=true;
      dw.style.transition='width .18s ease-out';
      dw.style.width = '34px';
      setTimeout(()=>{ FILM._animating=false; }, 200);
    }
    $('filmBtn').classList.toggle('on', FILM.on);
    saveState();
  });
}

// Apply the current FILM.on state to the drawer/button DOM (no animation).
// Used to restore the saved open/closed state on load.
export function applyFilmState(){
  const dw=$('filmDrawer');
  dw.classList.toggle('on', FILM.on);
  $('filmBtn').classList.toggle('on', FILM.on);
  if (FILM.on){
    drawFilm();
    dw.style.transition='none';
    const target = Math.min($('filmScroll').scrollWidth + 34, Math.round(window.innerWidth*0.85));
    dw.style.width=target+'px';
  } else {
    dw.style.transition='none';
    dw.style.width='34px';
  }
}
