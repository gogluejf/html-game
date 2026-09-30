// ---------- main: boot, orchestration, global event wiring ----------
import { app, FILM, ROT_TAP_MS } from './state.js';
import { $, cv, resizeCanvas, setZoom, evPos } from './viewport.js';
import { loadProject, getProjectName } from './loader.js';
import { buildSidebar, selectEntity } from './sidebar.js';
import { draw } from './draw.js';
import { startPlayback, setPlaying, stepFrame, setSpeed } from './playback.js';
import { initPanelSpinners, initPanelBindings } from './panel.js';
import { syncPanel } from './panel.js';
import { initTimingControls } from './timing.js';
import { initMeleeControls } from './meleeBoxes.js';
import { addMeleeBox } from './meleeBoxes.js';
import { initMarkerControls, addMarker } from './markers.js';
import { initToolbar, syncToggles, setBg } from './tools.js';
import { initPointer } from './pointer.js';
import { initFilmstrip, applyFilmState, drawFilm } from './filmstrip.js';
import { initConfirmDialog } from './dialog.js';
import { doUndo, doRedo, syncUndoButtons } from './undo.js';
import { saveState, loadState, applySavedView, LS_KEY } from './save.js';
import { initRecenterPivot, initPositionButtons, initResetTool } from './reset.js';
import { curFrameIdx, editingLocked, targetFrames } from './geometry.js';
import { pushUndo } from './undo.js';
import { shiftElement } from './rigidbody.js';
import { buildMeleeBoxList } from './meleeBoxes.js';
import { buildMarkerList } from './markers.js';

// ---------- play/pause toggle (wraps setPlaying with flip semantics) ----------
function togglePlay(){
  if (!app.cur || !app.cur.st) return;
  setPlaying(!app.cur.st.playing);
}

// ---------- rotation controls (hold-to-spin) ----------
function setRotPlaying(p){
  if (!app.cur || !app.cur.st) return;
  app.cur.st.rot.playing = !!p;
  $('rotIco').innerHTML = app.cur.st.rot.playing ? '&#10074;&#10074;' : '&#9654;';
}
function stepRot(deg){
  if (!app.cur || !app.cur.st) return;
  pushUndo();
  app.cur.st.rot.angle = ((app.cur.st.rot.angle + deg) % 360 + 360) % 360;
  $('rotAngle').textContent = Math.round(app.cur.st.rot.angle)+'\u00B0';
  draw();
}
// hold-to-rotate: tap (<200ms) = 15° step, hold = continuous spin with accel/decel
function startRotHold(dir){
  if (!app.cur || !app.cur.st) return;
  app.rotHold = { dir, vel: 0, t: 0 };
}
function stopRotHold(){
  if (!app.rotHold) return;
  const held = app.rotHold.t * 1000;   // ms held
  const dir = app.rotHold.dir;
  const vel = app.rotHold.vel;
  app.rotHold = null;
  if (held < ROT_TAP_MS && vel < 20){
    // was a tap: snap to a clean 15° step instead of coasting
    stepRot(dir * 15);
  } else {
    // was a hold: coast to a stop
    app.lastRotVel = vel;
    app.lastRotDir = dir;
  }
}
// auto-repeat helper: tap = one step, hold = repeat every `ms` after initial delay
function autoRepeat(btn, fn, ms=120, delay=350){
  let timer=null, iv=null;
  btn.addEventListener('pointerdown', e=>{
    e.preventDefault();
    fn();
    timer = setTimeout(()=>{ iv = setInterval(fn, ms); }, delay);
  });
  const stop = ()=>{ clearTimeout(timer); clearInterval(iv); timer=iv=null; };
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('pointercancel', stop);
}

function initRotationControls(){
  $('rotPlay').addEventListener('click', ()=>{ if(app&&app.cur&&app.cur.st) setRotPlaying(!app.cur.st.rot.playing); });
  $('rotPrev').addEventListener('pointerdown', e=>{ e.preventDefault(); startRotHold(-1); });
  $('rotNext').addEventListener('pointerdown', e=>{ e.preventDefault(); startRotHold(1); });
  window.addEventListener('pointerup', stopRotHold);
  window.addEventListener('pointercancel', stopRotHold);
  autoRepeat($('rotSlower'), ()=>{ if(app.cur&&app.cur.st) app.cur.st.rot.speed=Math.max(1,app.cur.st.rot.speed-5), $('rotSpeedVal').textContent=app.cur.st.rot.speed+'\u00B0/s'; });
  autoRepeat($('rotFaster'), ()=>{ if(app.cur&&app.cur.st) app.cur.st.rot.speed=Math.min(360,app.cur.st.rot.speed+5), $('rotSpeedVal').textContent=app.cur.st.rot.speed+'\u00B0/s'; });
  // click canvas → if rotation is active (spinning or at non-zero angle), pause + reset to 0°
  cv.addEventListener('pointerdown', e=>{
    if (app.cur && app.cur.st && app.cur.st.rot && (app.cur.st.rot.playing || Math.abs(app.cur.st.rot.angle) > 0.5)){
      app.cur.st.rot.playing = false;
      app.cur.st.rot.angle = 0;
      app.lastRotVel = 0;   // kill any coasting
      app.rotHold = null;   // cancel any hold
      $('rotIco').innerHTML = '&#9654;';
      $('rotAngle').textContent = '0\u00B0';
      draw();
    }
  }, true);   // capture phase: runs before the main pointerdown handler
}

function initTransportAndZoom(){
  $('playBtn').addEventListener('click', togglePlay);
  $('prevF').addEventListener('click', ()=>stepFrame(-1));
  $('nextF').addEventListener('click', ()=>stepFrame(1));
  $('slower').addEventListener('click', ()=>{ if(app.cur&&app.cur.st) setSpeed(app.cur.st.speed-1); });
  $('faster').addEventListener('click', ()=>{ if(app.cur&&app.cur.st) setSpeed(app.cur.st.speed+1); });
  // zoom controls
  $('zoomIn').addEventListener('click',  ()=>setZoom(app.zoom*1.25));
  $('zoomOut').addEventListener('click', ()=>setZoom(app.zoom/1.25));
  // wheel zoom about cursor
  cv.addEventListener('wheel', e=>{
    e.preventDefault();
    const [cx, cy] = evPos(e);
    const factor = e.deltaY < 0 ? 1.1 : 1/1.1;
    setZoom(app.zoom*factor, cx, cy);      // zoom about the cursor
  }, { passive:false });
  // keep canvas backing store in sync with its CSS size (full-bleed stage); don't re-fit
  new ResizeObserver(()=>{ if (app.cssW !== Math.round(cv.getBoundingClientRect().width) || app.cssH !== Math.round(cv.getBoundingClientRect().height)){ resizeCanvas(); draw(); } }).observe(cv);
  // undo / redo controls
  $('undoBtn').addEventListener('click', doUndo);
  $('redoBtn').addEventListener('click', doRedo);
}

// ---------- help dialog ----------
const helpDialog = $('helpDialog');
function initHelpDialog(){
  $('helpBtn').addEventListener('click', ()=>helpDialog.showModal());
  helpDialog.addEventListener('click', ()=>helpDialog.close());
  helpDialog.addEventListener('close', ()=>$('helpBtn').focus());
}

// ---------- keyboard ----------
function initKeyboard(){
  window.addEventListener('keydown', e=>{
    if (helpDialog.open){
      if (e.key==='Escape'){ e.preventDefault(); helpDialog.close(); }
      return;
    }
    if (!app.cur || !app.cur.st) return;
    // undo / redo (works even when a box is focused, but not while typing in inputs)
    const tag = (e.target.tagName||'').toLowerCase();
    if ((e.ctrlKey||e.metaKey) && e.code==='KeyZ'){
      e.preventDefault();
      if (e.shiftKey) doRedo(); else doUndo();
      return;
    }
    if ((e.ctrlKey||e.metaKey) && e.code==='KeyY'){
      e.preventDefault();
      doRedo();
      return;
    }
    // ctrl+0 -> reset zoom to 100% (centered on origin)
    if ((e.ctrlKey||e.metaKey) && (e.code==='Digit0' || e.code==='Numpad0')){
      e.preventDefault();
      app.panX = 0; app.panY = 0;
      setZoom(1);
      return;
    }
    // ctrl+H -> hide ALL display overlays (collision, melee view, axes, sprite box, pivot).
    // LABEL is intentionally left untouched. Pressing again restores each toggle to the
    // exact state it had before it was hidden.
    if ((e.ctrlKey||e.metaKey) && e.code==='KeyH'){
      e.preventDefault();
      const HIDDEN_KEYS = ['collision','meleeView','axes','spriteView','pivot','grid','markerView'];
      if (!window._hideSnapshot){
        window._hideSnapshot = {};
        for (const k of HIDDEN_KEYS){ window._hideSnapshot[k] = app.show[k]; app.show[k] = false; }
      } else {
        for (const k of HIDDEN_KEYS){ app.show[k] = window._hideSnapshot[k]; }
        window._hideSnapshot = null;
      }
      syncToggles(); draw();
      // Do NOT persist the transient hidden state — otherwise a reload restores
      // axes/grid/etc. as off (the hide leaks into localStorage). The real display
      // preference was already saved before hide mode began.
      return;
    }
    if (tag==='input' || tag==='textarea' || tag==='select' || e.target.isContentEditable) return;
    // Route shortcuts through the buttons to preserve guards and hide-mode behavior.
    if (!e.ctrlKey && !e.metaKey && !e.altKey){
      if (e.code === 'KeyS'){
        e.preventDefault();
        app._selectedBox = (app._selectedBox === 'sprite') ? null : 'sprite';
        draw(); return;
      }
      if (e.code === 'KeyC'){
        e.preventDefault();
        app._selectedBox = (app._selectedBox === 'collision') ? null : 'collision';
        draw(); return;
      }
      if (e.code === 'KeyH'){
        e.preventDefault();
        const boxes = app.cur.st.frames[curFrameIdx()].boxes || [];
        if (boxes.length === 0){ addMeleeBox(); app._selectedBox = 'box_0'; draw(); }
        else {
          // cycle: find current selected box index, go to next
          let curIdx = -1;
          if (app._selectedBox && app._selectedBox.startsWith('box_')) curIdx = parseInt(app._selectedBox.slice(4), 10);
          const nextIdx = (curIdx + 1) % boxes.length;
          app._selectedBox = (curIdx === boxes.length - 1 && nextIdx === 0) ? 'box_0' : 'box_'+nextIdx;
          // if we were not selecting a box before, start at 0
          if (curIdx === -1) app._selectedBox = 'box_0';
          draw();
        }
        return;
      }
      if (e.code === 'KeyM'){
        e.preventDefault();
        const markers = app.cur.st.markers || [];
        if (markers.length === 0){ addMarker(); app._selectedBox = 'marker_0'; draw(); }
        else {
          let curIdx = -1;
          if (app._selectedBox && app._selectedBox.startsWith('marker_')) curIdx = parseInt(app._selectedBox.slice(7), 10);
          if (curIdx === -1) app._selectedBox = 'marker_0';
          else {
            const nextIdx = (curIdx + 1) % markers.length;
            app._selectedBox = 'marker_'+nextIdx;
          }
          draw();
        }
        return;
      }
      // Other view toggles: F/A/G/P/L + R (recenter pivot)
      const otherToggles = { KeyF:'tglAllFrames', KeyA:'tglAxes', KeyG:'tglGrid', KeyP:'tglPivot', KeyL:'tglLabel' };
      const buttonId = otherToggles[e.code] || (e.code==='KeyR' ? 'recenterPivotBtn' : null);
      if (buttonId){
        e.preventDefault();
        if (!e.repeat) $(buttonId).click();
        return;
      }
    }
    const st = app.cur.st, fi = curFrameIdx(), f = st.frames[fi];
    const off = e.ctrlKey ? 10 : 1;
    // 1-9 / 0 -> jump directly to that frame index of the current animation
    // (1->frame1 ... 9->frame9, 0->frame10). Works for any anim length; clamps to last frame.
    if (!e.ctrlKey && !e.altKey && !e.shiftKey){
      let direct = null;
      if (e.code.startsWith('Digit') && e.code !== 'Digit0'){ direct = parseInt(e.code.slice(5), 10) - 1; }
      else if (e.code === 'Digit0' || e.code === 'Numpad0'){ direct = 9; }
      else if (e.code.startsWith('Numpad') && e.code !== 'Numpad0'){ direct = parseInt(e.code.slice(6), 10) - 1; }
      if (direct !== null && direct >= 0){
        e.preventDefault();
        const max = st.frames.length - 1;
        st.frameIdx = Math.min(direct, max); app.acc=0; app._selectedBox=null;
        syncPanel(); draw();
        return;
      }
    }
    // selected element (box_N, sprite, collision, marker_N): nudge, delete, escape
    if (app._selectedBox){
      if (e.code === 'Escape'){
        e.preventDefault();
        app._selectedBox = null; draw();
        return;
      }
      if ((app._selectedBox.startsWith('box_') || app._selectedBox.startsWith('marker_')) && (e.code === 'Delete' || e.code === 'Backspace')){
        e.preventDefault();
        if (!editingLocked()){
          if (app._selectedBox.startsWith('box_')){
            const selIdx = parseInt(app._selectedBox.slice(4), 10);
            pushUndo(); st.frames[fi].boxes.splice(selIdx, 1);
            app._selectedBox = null; buildMeleeBoxList(); draw(); saveState();
          } else {
            const selIdx = parseInt(app._selectedBox.slice(7), 10);
            pushUndo(); st.markers.splice(selIdx, 1);
            app._selectedBox = null; buildMarkerList(); draw(); saveState();
          }
        }
        return;
      }
      if (!editingLocked() && !e.ctrlKey && !e.shiftKey && !e.altKey){
        const nudge = 1;
        let dx = 0, dy = 0;
        if (e.code === 'ArrowRight') dx = nudge;
        else if (e.code === 'ArrowLeft') dx = -nudge;
        else if (e.code === 'ArrowUp') dy = -nudge;
        else if (e.code === 'ArrowDown') dy = nudge;
        else return;
        e.preventDefault();
        pushUndo();
        if (app._selectedBox.startsWith('box_')){
          shiftElement('box', parseInt(app._selectedBox.slice(4), 10), dx, dy);
        } else if (app._selectedBox === 'sprite'){
          shiftElement('sprite', -1, dx, dy);
        } else if (app._selectedBox === 'collision'){
          shiftElement('collision', -1, dx, dy);
        } else if (app._selectedBox.startsWith('marker_')){
          const mi = parseInt(app._selectedBox.slice(7), 10);
          const m = st.markers[mi];
          if (m){ m.x += dx; m.y += dy; }
        }
        syncPanel(); draw(); saveState();
        return;
      }
    }
    switch (e.code){
      case 'Space': e.preventDefault(); togglePlay(); break;
      case 'ArrowRight': e.preventDefault(); if (e.shiftKey && !e.ctrlKey && !editingLocked()){ pushUndo(); targetFrames(fi).forEach(fr=>fr.offset.x+=off); syncPanel(); draw(); } else stepFrame(1); break;
      case 'ArrowLeft': e.preventDefault(); if (e.shiftKey && !e.ctrlKey && !editingLocked()){ pushUndo(); targetFrames(fi).forEach(fr=>fr.offset.x-=off); syncPanel(); draw(); } else stepFrame(-1); break;
      case 'ArrowUp': e.preventDefault();
        if (e.shiftKey && !e.ctrlKey && !editingLocked()){ pushUndo(); targetFrames(fi).forEach(fr=>fr.offset.y-=off); syncPanel(); draw(); }
        else if (app.flatIdx>0){ app.flatIdx--; const q=app.flatList[app.flatIdx]; selectEntity(q.li,q.ei); }
        break;
      case 'ArrowDown': e.preventDefault();
        if (e.shiftKey && !e.ctrlKey && !editingLocked()){ pushUndo(); targetFrames(fi).forEach(fr=>fr.offset.y+=off); syncPanel(); draw(); }
        else if (app.flatIdx<app.flatList.length-1){ app.flatIdx++; const q=app.flatList[app.flatIdx]; selectEntity(q.li,q.ei); }
        break;
      case 'Minus': case 'NumpadSubtract': e.preventDefault(); if (e.ctrlKey){ setZoom(app.zoom/1.25); } else setSpeed(st.speed-1); break;
      case 'Equal': case 'NumpadAdd': e.preventDefault(); if (e.ctrlKey){ setZoom(app.zoom*1.25); } else setSpeed(st.speed+1); break;
    }
  });
}

// ---------- boot ----------
async function boot(){
  const project = getProjectName();
  app.project = project;
  document.title = 'SPRITE EDITOR — ' + project;
  const lbl = document.getElementById('projectLabel');
  if (lbl) lbl.textContent = project;

  // Load the project tree from the server (replaces baked-in MANIFEST).
  app.manifest = await loadProject(project);

  // Build sidebar + populate flatList/entityPos.
  buildSidebar();

  // Wire up all subsystems.
  initConfirmDialog();
  initPanelSpinners();
  initPanelBindings();
  initTimingControls();
  initMeleeControls();
  initMarkerControls();
  initToolbar();
  initRecenterPivot();
  initPositionButtons();
  initResetTool();
  initFilmstrip();
  initTransportAndZoom();
  initRotationControls();
  initHelpDialog();
  initPointer();
  initKeyboard();

  // ---------- init sequence ----------
  app._loadingState = true;   // suppress saves during the entire init/restore sequence
  $('zoomval').textContent = Math.round(app.zoom*100)+'%';

  loadState();          // restore per-entity state + view from localStorage (keeps guard ON)
  if (!localStorage.getItem(LS_KEY)) setBg('#000000');   // default bg only if truly no save exists
  applySavedView();     // apply restored view (bg, play, toggles) to the UI — no save (guard on)
  syncToggles();   // set toolbar lit states from `show` BEFORE first paint (no flash)
  syncUndoButtons();   // disable undo/redo while stacks are empty

  // Restore the last-edited entity if we have one saved; otherwise start at the first.
  let startLi = 0, startEi = 0;
  try{
    const _raw = localStorage.getItem(LS_KEY);
    if (_raw){
      const _d = JSON.parse(_raw);
      if (_d && _d.active){
        const hit = app.flatList.findIndex(f => app.manifest.labels[f.li].entities[f.ei].name === _d.active);
        if (hit >= 0){ startLi = app.flatList[hit].li; startEi = app.flatList[hit].ei; }
      }
    }
  }catch(e){}
  if (app.manifest.labels.length){
    selectEntity(startLi, startEi).then(()=>{ app._loadingState = false; applyFilmState(); });  // re-enable auto-save ONLY after async load done
  } else {
    app._loadingState = false;
  }

  // Start the render loop.
  startPlayback();
}

boot().catch(err => {
  console.error('[sprite-editor] boot failed:', err);
  const el = document.getElementById('projectLabel');
  if (el) el.textContent = 'failed to load: ' + err.message;
});
