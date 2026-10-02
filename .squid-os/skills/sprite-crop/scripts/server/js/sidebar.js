// ---------- sidebar: class -> character (alpha) -> animations ----------
import { app } from './state.js';
import { $, tree, resizeCanvas } from './viewport.js';
import { frameUrls } from './loader.js';
import { syncPanel } from './panel.js';
import { draw, boxList } from './draw.js';
import { curFrameIdx } from './geometry.js';
import { FILM, drawFilm, filmFitWidth, applyFilmState } from './filmstrip.js';
import { syncUndoButtons } from './undo.js';
import { saveState, gameDataKey, updateSaveButton, updateDirtyDots } from './save.js';
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

// single source of truth for "anchor the SPRITE to the origin".
// Per-FRAME translation based on EACH frame's own sprite box (offset + scaled size).
//   mode 'center'     -> each frame's sprite-box CENTER lands on origin (0,0)
//   mode 'leftbottom' -> each frame's sprite-box BOTTOM-LEFT corner lands on origin
//                        (y-axis points DOWN here, so bottom = largest y)
// Every frame is repositioned independently (frames have different sizes), and each
// frame's melee boxes + markers follow THAT frame's shift. COLLISION and PIVOT are
// left completely untouched — they are independent of sprite placement.
export function layoutAt(st, imgs, W, H, mode){
  let curDx = 0, curDy = 0;   // shift applied to the current frame (markers follow this)
  // current frame index — fall back to 0 when app.cur.st isn't set yet (e.g. during defaultState)
  const fi = (app.cur && app.cur.st) ? curFrameIdx() : 0;
  for (let i=0;i<st.frames.length;i++){
    const f = st.frames[i], im = imgs[i];
    if (!f || !im) continue;
    const w = im.naturalWidth * f.scale.sx, h = im.naturalHeight * f.scale.sy;
    // current sprite-box center (offset places the frame so its center sits there)
    const ccx = f.offset.x, ccy = f.offset.y;
    // target position of the anchor point
    const tx = mode==='center' ? 0 : w/2;           // center→0 ; leftbottom→left edge at 0 (offset.x = w/2)
    const ty = mode==='center' ? 0 : -h/2;          // center→0 ; leftbottom→bottom at 0 (offset.y = -h/2)
    const dx = tx - ccx, dy = ty - ccy;             // this frame's shift
    if (i === fi){ curDx = dx; curDy = dy; }        // remember the current frame's shift
    f.offset.x += dx; f.offset.y += dy;
    for (const b of f.boxes){ b.x += dx; b.y += dy; }
  }
  // markers (animation-level) follow the CURRENT frame's anchor shift
  for (const m of st.markers || []){ m.x += curDx; m.y += curDy; }
  // NOTE: collision + pivot intentionally NOT moved
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
  // initial load: build default boxes, then anchor left-bottom on origin
  const db = defaultBoxes(W, H);
  st.collision = { ...db.col };
  st.pivot = { x: Math.round(db.col.x + db.col.w/2), y: Math.round(db.col.y + db.col.h/2) };
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
  // Fresh defaults, then merge DISK tuning (sheet JSON), then the per-entity
  // DRAFT (localStorage game-data key) over that. Disk is the committed state;
  // the draft is unsaved work layered on top. Without the disk merge, a refresh
  // with no draft would show factory defaults even though the sheet has data.
  const st = defaultState(app.cur.name, app.cur.imgs, app.cur.paths, app.cur.crops);
  if (en.tuning){
    const t = en.tuning;
    if (t.speed != null) st.speed = t.speed;
    if (t.playback) st.playback = t.playback;
    if (t.collision) st.collision = t.collision;
    if (t.pivot) st.pivot = t.pivot;
    if (Array.isArray(t.markers)) st.markers = t.markers;
    if (Array.isArray(t.frames) && t.frames.length === st.frames.length){
      t.frames.forEach((tf, i) => {
        if (!tf) return;
        if (tf.offset) st.frames[i].offset = tf.offset;
        if (tf.scale) st.frames[i].scale = tf.scale;
        if (Array.isArray(tf.boxes)) st.frames[i].boxes = tf.boxes;
        if (tf.durUnits >= 1) st.frames[i].durUnits = tf.durUnits;
      });
    }
  }
  try{
    const raw = localStorage.getItem(gameDataKey(`${en.char}_${en.anim}`));
    if (raw){
      const gd = JSON.parse(raw);
      if (Array.isArray(gd.frames) && gd.frames.length === st.frames.length){
        Object.assign(st, {
          speed: gd.speed ?? st.speed,
          playback: gd.playback || st.playback,
          collision: gd.collision || st.collision,
          pivot: gd.pivot || st.pivot,
          markers: Array.isArray(gd.markers) ? gd.markers : [],
        });
        gd.frames.forEach((gf, i) => {
          if (!gf) return;
          if (gf.offset) st.frames[i].offset = gf.offset;
          if (gf.scale) st.frames[i].scale = gf.scale;
          if (Array.isArray(gf.boxes)) st.frames[i].boxes = gf.boxes;
          if (gf.durUnits >= 1) st.frames[i].durUnits = gf.durUnits;
        });
      }
    }
  }catch(e){}
  app.S.set(app.cur.name, st);
  app.cur.st = st;
  app.cur.st.playing = app.isPlaying;   // carry global play/pause across animations
  app.acc = 0; app.drag = null; app.hover = null; app._selectedBox = null;
  app.panX = 0; app.panY = 0;
  if (!app.userZoomed){ app.zoom = 1; $('zoomval').textContent = '100%'; }   // start each anim at true size
  resizeCanvas(); syncPanel(); draw();
  syncUndoButtons();   // reflect current undo/redo stack state
  updateSaveButton();  // per-entity: enable iff THIS entity has an unsaved draft
  updateDirtyDots();
  // refresh the filmstrip for this sprite (rebuild cells + refit drawer width)
  if (FILM.on){ drawFilm(); requestAnimationFrame(filmFitWidth); }
  // toolbar was hidden during boot; now that state is settled, reveal it
  const tb = $('toolbar'); if (tb) tb.classList.remove('booting');
  // settle backing store once layout is ready (no re-zoom)
  requestAnimationFrame(()=>{ resizeCanvas(); draw(); });
}
