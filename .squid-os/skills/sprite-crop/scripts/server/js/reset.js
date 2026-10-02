// ---------- reset tools: recenter pivot, position, frame/animation/factory ----------
import { app } from './state.js';
import { $ } from './viewport.js';
import { editingLocked } from './geometry.js';
import { draw } from './draw.js';
import { syncPanel } from './panel.js';
import { pushUndo } from './undo.js';
import { saveState } from './save.js';
import { commit } from './commit.js';
import { confirmDialog } from './dialog.js';
import { layoutAt, defaultBoxes } from './sidebar.js';
import { selectEntity } from './sidebar.js';
import { setBg, paintSatSquareFn } from './tools.js';
import { _bgState } from './state.js';
import { FILM, drawFilm } from './filmstrip.js';
import { syncUndoButtons, clearHistory } from './undo.js';
import { showToast } from './toast.js';
import { clearConfigBlob, clearGameData, hasGameData, updateSaveButton, updateDirtyDots } from './save.js';
import { curFrameIdx } from './geometry.js';

// ---------- RECENTER PIVOT ----------
export function initRecenterPivot(){
  $('recenterPivotBtn').addEventListener('click', ()=>{
    if (!app.cur || !app.cur.st) return;
    commit(() => {
      const c = app.cur.st.collision;
      app.cur.st.pivot.x = Math.round(c.x + c.w/2);
      app.cur.st.pivot.y = Math.round(c.y + c.h/2);
    });
  });
}

// ---------- POSITION: reset sprite placement based on frame 1 ----------
// offset places a frame so its center sits at (offset.x, offset.y).
// Frame 1 dims define the reference size for the whole animation.
function frame1Dims(){
  const f1 = app.cur.imgs[0];
  const W = f1 ? f1.naturalWidth : 1, H = f1 ? f1.naturalHeight : 1;
  return { W, H };
}
function applyPosition(mode){
  if (!app.cur || !app.cur.st) return;
  const st = app.cur.st;
  const { W, H } = frame1Dims();
  // CENTER -> centered on origin; LEFT-BOTTOM -> each frame's left/bottom on axes
  commit(() => {
    layoutAt(st, app.cur.imgs, W, H, mode==='origin' ? 'leftbottom' : 'center');
  });
}
export function initPositionButtons(){
  $('posOriginBtn').addEventListener('click', ()=>applyPosition('origin'));
  $('posCenterBtn').addEventListener('click', ()=>applyPosition('center'));
}

// ---------- RESET tool (frame / animation) ----------
const resetBtn = $('resetBtn'), resetMenu = $('resetMenu');
export function initResetTool(){
  resetBtn.addEventListener('click', e=>{
    e.stopPropagation();
    const open = resetMenu.style.display !== 'none';
    // Reflect whether the CURRENT entity has a draft to discard (grey out when clean).
    const discOpt = resetMenu.querySelector('.reset-opt[data-scope="discard"]');
    if (discOpt && app.cur && app.flatList[app.flatIdx]){
      const en = app.manifest.labels[app.flatList[app.flatIdx].li].entities[app.flatList[app.flatIdx].ei];
      const has = hasGameData(`${en.char}_${en.anim}`);
      discOpt.classList.toggle('disabled', !has);
    }
    resetMenu.style.display = open ? 'none' : 'block';
  });
  document.addEventListener('click', ()=>{ resetMenu.style.display = 'none'; });
  resetMenu.addEventListener('click', e=>{ e.stopPropagation(); });
  resetMenu.querySelectorAll('.reset-opt').forEach(opt => {
    opt.addEventListener('click', ()=>{
      const scope = opt.dataset.scope;
      if (opt.classList.contains('disabled')) return;   // greyed out — ignore
      resetMenu.style.display = 'none';
      if (scope === 'factory'){ factoryReset(); return; }   // destructive — own confirm flow
      if (scope === 'discard'){ discardDraft(); return; }   // flush local draft, reload from disk
      if (!app.cur || !app.cur.st || editingLocked()) return;
      if (scope === 'frame'){
        confirmDialog('Reset current frame (offset, scale, boxes, markers)?', () => {
          commit(resetFrame);
        });
      } else {
        confirmDialog('Reset all frames and animation-level settings for this entity?', () => {
          commit(resetAnimation);
        });
      }
    });
  });
}

// ---------- factory reset: wipe ALL saved state + app state back to defaults ----------
function factoryReset(){
  confirmDialog('Restore factory defaults for ALL entities? This permanently deletes all saved editor state and cannot be undone.', () => {
    app._loadingState = true;                       // suppress saves during the wipe
    clearConfigBlob();                              // nuke the config blob (full wipe)
    // nuke every entity's draft game-data key (the dirty-dot / SAVE-button source)
    for (const {li, ei} of app.flatList){
      const en = app.manifest.labels[li].entities[ei];
      clearGameData(en.char + '_' + en.anim);
    }
    app.S.clear();                                  // drop all per-entity editor state
    app.undoStack.length = 0; app.redoStack.length = 0; // clear history
    Object.assign(app.show, { collision:true, meleeView:false, axes:true, spriteView:true, pivot:true, label:true, allFrames:false, grid:true, markerView:false });
    app.isPlaying = true;
    app.bgColor = '#000000';
    document.documentElement.style.setProperty('--film-bg', app.bgColor);
    _bgState.h = 0; _bgState.s = 100; _bgState.l = 0;
    app.userZoomed = false; app.zoom = 1; app.panX = 0; app.panY = 0;
    $('zoomval').textContent = '100%';
    $('bgval').textContent = app.bgColor; bgSwatchRef.style.background = app.bgColor; bgHexRef.value = app.bgColor;
    $('bgHue').value = 0; $('bgLight').value = 0; paintSatSquareFn();
    syncUndoButtons();
    // reload the first entity fresh from defaults and re-enable saving
    selectEntity(0, 0).then(()=>{
      app._loadingState = false;
      if (FILM.on) drawFilm();
      updateSaveButton();   // reflect the wiped drafts (no dot, button off)
      updateDirtyDots();
    });
  });
}
// ---------- discard draft: flush the CURRENT entity's local draft, reload from disk ----------
// Does NOT touch saved data on disk and does NOT change RESET behavior. It only
// removes this entity's unsaved localStorage draft (the dirty-dot / SAVE-button
// source), then re-selects the entity so its state is rebuilt fresh from
// defaults + disk tuning. The checksum is left alone — it still guards against
// external edits of the committed sheet.
function discardDraft(){
  if (!app.cur || !app.flatList[app.flatIdx]) return;
  const q = app.flatList[app.flatIdx];
  const en = app.manifest.labels[q.li].entities[q.ei];
  const key = `${en.char}_${en.anim}`;
  if (!hasGameData(key)){
    showToast('No draft to discard for ' + en.char + '/' + en.anim, 'info');
    return;
  }
  confirmDialog(`Discard unsaved draft for ${en.char}/${en.anim}? Saved data on disk is kept; the editor reloads from the file.`, () => {
    app._loadingState = true;                       // suppress saves during the wipe
    clearGameData(key);                             // drop the per-entity draft key
    selectEntity(q.li, q.ei).then(()=>{             // rebuild state from defaults + disk tuning
      app._loadingState = false;
      if (FILM.on) drawFilm();
      updateSaveButton();   // draft gone → button off, dot cleared
      updateDirtyDots();
      showToast(`Draft discarded — ${en.char}/${en.anim} reloaded from file`, 'success');
    });
  });
}

const bgSwatchRef = document.getElementById('bgSwatch');
const bgHexRef = document.getElementById('bgHex');

function resetAnimation(){
  const st = app.cur.st;
  // recompute defaults from frame 1's natural dims (same geometry as initial load)
  const good = app.cur.imgs.filter(Boolean);
  const f1 = good[0];
  const W = f1 ? f1.naturalWidth : 1, H = f1 ? f1.naturalHeight : 1;
  st.rot = { angle: 0, speed: 360, playing: false };
  // reset EVERY frame (offset, scale, boxes) + clear markers
  for (let i=0;i<st.frames.length;i++){
    const f = st.frames[i], im = app.cur.imgs[i];
    f.scale.sx = 1; f.scale.sy = 1;
    if (im){ f.offset.x = Math.round(im.naturalWidth/2); f.offset.y = -Math.round(im.naturalHeight/2); }
    else { f.offset.x = 0; f.offset.y = 0; }
    f.boxes = [];
  }
  st.markers = [];
  // reset the shared collision box to its default (frame-1 size minus pad)
  const db = defaultBoxes(W, H);
  st.collision = { ...db.col };
  // reset the pivot to the center of the collision box
  st.pivot = { x: Math.round(db.col.x + db.col.w/2), y: Math.round(db.col.y + db.col.h/2) };
  layoutAt(st, app.cur.imgs, W, H, 'leftbottom');   // anchor left-bottom like initial load
}

// Reset the current frame's per-frame fields back to defaults.
function resetFrame(){
  const st = app.cur.st, fi = curFrameIdx(), f = st.frames[fi];
  const im = app.cur.imgs[fi];
  f.scale.sx = 1; f.scale.sy = 1;
  if (im){ f.offset.x = Math.round(im.naturalWidth/2); f.offset.y = -Math.round(im.naturalHeight/2); }
  else { f.offset.x = 0; f.offset.y = 0; }
  f.boxes = [];
  // markers are animation-level — clear them too so a frame reset is clean
  st.markers = [];
}
