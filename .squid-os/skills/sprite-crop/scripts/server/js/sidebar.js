// ---------- sidebar: class -> character (alpha) -> animations ----------
import { app } from './state.js';
import { $, tree, resizeCanvas } from './viewport.js';
import { frameUrls } from './loader.js';
import { syncPanel } from './panel.js';
import { draw, boxList } from './draw.js';
import { FILM, drawFilm, filmFitWidth, applyFilmState } from './filmstrip.js';
import { syncUndoButtons } from './undo.js';
import { saveState } from './save.js';
import { setZoom } from './viewport.js';

export function loadFrames(paths){
  return Promise.all(paths.map(p => new Promise(res => {
    const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = p;
  })));
}

// Build the sidebar DOM from the manifest and populate flatList / entityPos.
export function buildSidebar(){
  app.manifest.labels.forEach((lbl, li) => {
    const hd = document.createElement('div'); hd.className='label'; hd.textContent = lbl.name.toUpperCase();
    tree.appendChild(hd);
    // group this class's entities by character (use clean char/anim from manifest)
    const chars = new Map();   // charName -> [{anim, ei}]
    lbl.entities.forEach((en, ei) => {
      const charName = en.char || en.name;
      const anim = en.anim || '';
      if (!chars.has(charName)) chars.set(charName, []);
      chars.get(charName).push({ anim, ei });
    });
    // sort characters A-Z
    for (const cn of [...chars.keys()].sort((a,b)=>a.localeCompare(b))){
      const anims = chars.get(cn).sort((x,y)=>x.anim.localeCompare(y.anim));
      if (anims.length === 1){
        // single animation -> combine char + anim into one row: "name (anim)"
        const a = anims[0], en = lbl.entities[a.ei];
        const row = document.createElement('div'); row.className='ent solo';
        row.innerHTML = `<span>${cn}${a.anim ? ' <b class="animtag">('+a.anim+')</b>' : ''}</span><span class="cnt">${en.frames.length}f</span>`;
        row.addEventListener('click', () => selectEntity(li, a.ei));
        en._el = row;
        tree.appendChild(row);
        app.flatList.push({li, ei:a.ei});
        app.entityPos.set(en.name, {li, ei:a.ei});
      } else {
        const chEl = document.createElement('div'); chEl.className='char'; chEl.textContent = cn;
        tree.appendChild(chEl);
        for (const a of anims){
          const en = lbl.entities[a.ei];
          const row = document.createElement('div'); row.className='ent anim';
          row.innerHTML = `<span>${a.anim}</span><span class="cnt">${en.frames.length}f</span>`;
          row.addEventListener('click', () => selectEntity(li, a.ei));
          en._el = row;
          tree.appendChild(row);
          app.flatList.push({li, ei:a.ei});
          app.entityPos.set(en.name, {li, ei:a.ei});
        }
      }
    }
  });
}

// default box geometry (initial view)
// Every frame's left-bottom corner sits at origin (0,0): x∈[0,w], y∈[-h,0].
// Collision = frame-1 size minus a few px (centered → looks inside the sprite box).
// Melee = 25% of collision width, same height, left of collision with a small gap.
import { COLL_PAD, MEELE_RATIO, MEELE_GAP } from './state.js';
export function defaultBoxes(w, h){
  const cw = Math.max(1, w - COLL_PAD*2), ch = Math.max(1, h - COLL_PAD*2);
  const col = { x:COLL_PAD, y:-h+COLL_PAD, w:cw, h:ch };
  const mw = Math.max(1, Math.round(cw*MEELE_RATIO)), mh = ch;
  const mee = { on:false, x:col.x+cw+MEELE_GAP, y:col.y, w:mw, h:mh };
  return { col, mee };
}

// single source of truth for "initial layout at an anchor"
// Positions every frame + collision/pivot/melee relative to frame 1. Used by
// initial load, Reset Animation, and the Position buttons so they never drift.
//   mode 'leftbottom' -> each frame's left edge on X axis & bottom on Y axis
//                        (per-frame dims, so all frames align on their corner)
//   mode 'center'     -> each frame centered on the X/Y origin
export function layoutAt(st, imgs, W, H, mode){
  const { col, mee } = defaultBoxes(W, H);
  // shift the initial (origin-anchored) boxes so frame 1 lands on the target
  const dOx = mode==='center' ? -Math.round(W/2) : 0;
  const dOy = mode==='center' ?  Math.round(H/2) : 0;
  st.collision = { x: col.x + dOx, y: col.y + dOy, w: col.w, h: col.h };
  st.pivot = { x: Math.round(st.collision.x + st.collision.w/2), y: Math.round(st.collision.y + st.collision.h/2) };
  for (let i=0;i<st.frames.length;i++){
    const f = st.frames[i], im = imgs[i];
    const fw = im ? im.naturalWidth : W, fh = im ? im.naturalHeight : H;
    f.scale.sx = 1; f.scale.sy = 1;
    if (mode==='center'){
      f.offset.x = 0; f.offset.y = 0;                       // center this frame on origin
    } else {
      f.offset.x = Math.round(fw/2); f.offset.y = -Math.round(fh/2);  // left-bottom by own size
    }
    f.boxes = [];
  }
}

export function defaultState(name, imgs, paths, crops){
  const good = imgs.filter(Boolean);
  const f1 = good[0];
  const W = f1 ? f1.naturalWidth : 1, H = f1 ? f1.naturalHeight : 1;
  const st = {
    key: name, speed: 8, playing: true, frameIdx: 0,
    playback: 'loop',
    collision: null, pivot: null, markers: [],
    rot: { angle: 0, speed: 360, playing: false },   // degrees, deg/s, independent of frame anim
    frames: paths.map((p, i) => ({
      idx: i, name: p.split('/').pop(),
      crop: (() => { const c = (crops&&crops[i])||null; return c ? {x:c[0],y:c[1],w:c[2],h:c[3]} : {x:0,y:0,w:good[i]?good[i].naturalWidth:0,h:good[i]?good[i].naturalHeight:0}; })(),
      offset: { x:0, y:0 }, scale: { sx:1, sy:1 },
      boxes: [], durUnits: 1
    }))
  };
  // initial load = left-bottom anchor (each frame's left/bottom on the axes)
  layoutAt(st, imgs, W, H, 'leftbottom');
  return st;
}

export async function selectEntity(li, ei, opts){
  opts = opts || {};
  const en = app.manifest.labels[li].entities[ei];
  document.querySelectorAll('.ent').forEach(e=>e.classList.remove('on'));
  en._el.classList.add('on');
  app.flatIdx = app.flatList.findIndex(f => f.li===li && f.ei===ei);
  const imgs = await loadFrames(frameUrls(en));
  app.cur = { name: en.name, paths: frameUrls(en), imgs: imgs.filter(Boolean), crops: (en.frames||[]).map(f => f.bbox) };
  // use saved per-entity state if present AND frame count still matches; else fresh defaults
  const saved = app.S.get(app.cur.name);
  if (!saved || !Array.isArray(saved.frames) || saved.frames.length !== en.frames.length){
    app.S.set(app.cur.name, defaultState(app.cur.name, app.cur.imgs, app.cur.paths, app.cur.crops));
  }
  app.cur.st = app.S.get(app.cur.name);
  app.cur.st.playing = app.isPlaying;   // carry global play/pause across animations
  app.acc = 0; app.drag = null; app.hover = null; app._selectedBox = null;
  app.panX = 0; app.panY = 0;
  if (!app.userZoomed){ app.zoom = 1; $('zoomval').textContent = '100%'; }   // start each anim at true size
  resizeCanvas(); syncPanel(); draw();
  syncUndoButtons();   // reflect current undo/redo stack state
  // refresh the filmstrip for this sprite (rebuild cells + refit drawer width)
  if (FILM.on){ drawFilm(); requestAnimationFrame(filmFitWidth); }
  // toolbar was hidden during boot; now that state is settled, reveal it
  const tb = $('toolbar'); if (tb) tb.classList.remove('booting');
  // settle backing store once layout is ready (no re-zoom)
  requestAnimationFrame(()=>{ resizeCanvas(); draw(); });
}
