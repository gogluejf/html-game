// ---------- main (macro editor) ----------
// Boot: load game constants + macros → build sidebar → wire view/zoom/save/dump.
// Pass 1: display only. The DUMP BLOCK button is the cheat that mutates state
// to exercise draft → dirty dot → save without real editing tools.

import { app } from './state.js';
import { $, cv, resizeCanvas, setZoom, evPos } from './viewport.js';
import { loadGameConstants, loadMacros } from './loader.js';
import { buildSidebar, selectMacro } from './sidebar.js';
import { draw, setConstants } from './draw.js';
import { initConfirmDialog } from './dialog.js';
import { showToast } from './toast.js';
import { markChanged, saveToDisk, restoreDrafts, captureBaselines, updateDirtyDots, updateSaveButton, discardDraft, hasDraft, readActive } from './save.js';

// ---------- toolbar toggles ----------
function syncToggles(){
  $('tglGrid').classList.toggle('on', app.show.grid);
  $('tglSlots').classList.toggle('on', app.show.slots);
  $('tglLabels').classList.toggle('on', app.show.labels);
  $('tglZone').classList.toggle('on', app.show.zone);
}
function initToolbar(){
  $('tglGrid').addEventListener('click', ()=>{ app.show.grid=!app.show.grid; syncToggles(); draw(); });
  $('tglSlots').addEventListener('click', ()=>{ app.show.slots=!app.show.slots; syncToggles(); draw(); });
  $('tglLabels').addEventListener('click', ()=>{ app.show.labels=!app.show.labels; syncToggles(); draw(); });
  $('tglZone').addEventListener('click', ()=>{ app.show.zone=!app.show.zone; syncToggles(); draw(); });
  $('newBtn').addEventListener('click', ()=>showToast('New macro: not wired in Pass 1', 'info'));
}

// ---------- zoom / pan ----------
function initView(){
  $('zoomIn').addEventListener('click', ()=>setZoom(app.zoom*1.25));
  $('zoomOut').addEventListener('click', ()=>setZoom(app.zoom/1.25));
  $('fitBtn').addEventListener('click', ()=>{ if (app.cur) selectMacro(app.cur.id); });
  cv.addEventListener('wheel', e=>{
    e.preventDefault();
    const [cx, cy] = evPos(e);
    setZoom(app.zoom * (e.deltaY < 0 ? 1.1 : 1/1.1), cx, cy);
  }, { passive:false });
  // pan by dragging empty canvas
  let panning = null;
  cv.addEventListener('pointerdown', e=>{
    if (e.button !== 0) return;
    panning = { x:e.clientX, y:e.clientY, panX:app.panX, panY:app.panY };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e=>{
    if (!panning) return;
    // Grab-and-drag: the grabbed world point stays under the cursor.
    //   screen-x = cssW/2 + (wx - panX)*zoom  →  panX -= dx/zoom
    //   screen-y = cssH/2 + (panY - wy)*zoom  →  panY += dy/zoom
    // (opposite signs because world-y is flipped: row 0 at bottom, up = +y)
    app.panX = panning.panX - (e.clientX - panning.x)/app.zoom;
    app.panY = panning.panY + (e.clientY - panning.y)/app.zoom;
    draw();
  });
  const endPan = ()=>{ panning = null; };
  cv.addEventListener('pointerup', endPan);
  cv.addEventListener('pointercancel', endPan);
  new ResizeObserver(()=>{ if (app.cssW !== Math.round(cv.getBoundingClientRect().width) || app.cssH !== Math.round(cv.getBoundingClientRect().height)){ resizeCanvas(); draw(); } }).observe(cv);
}

// ---------- the cheat: dump a test block ----------
// Toggles a marker block at col 0, row 0. This is the ONLY mutation in Pass 1;
// it exists to prove the draft → dirty dot → save pipeline end to end.
let _dumped = false;
function dumpBlock(){
  if (!app.cur){ showToast('Select a macro first', 'info'); return; }
  const st = app.cur.st;
  st.units = st.units || [];
  const tag = '__dump_test__';
  const existing = st.units.findIndex(u => u._tag === tag);
  if (existing >= 0){
    st.units.splice(existing, 1);
    _dumped = false;
    showToast(`Removed test block from ${app.cur.id}`, 'info');
  } else {
    st.units.push({ kind:'block', height:1, y:0, x:0, _tag:tag });
    _dumped = true;
    showToast(`Added test block (x 0, y 0) to ${app.cur.id}`, 'success');
  }
  markChanged();   // → writes draft, lights dirty dot, enables SAVE
  draw();
}

// ---------- keyboard ----------
function initKeyboard(){
  window.addEventListener('keydown', e=>{
    const tag = (e.target.tagName||'').toLowerCase();
    if ((e.ctrlKey||e.metaKey) && e.code==='KeyS'){ e.preventDefault(); saveToDisk(); return; }
    if ((e.ctrlKey||e.metaKey) && (e.code==='Digit0'||e.code==='Numpad0')){ e.preventDefault(); if (app.cur) selectMacro(app.cur.id); return; }
    if (tag==='input'||tag==='textarea') return;
    if (!e.ctrlKey && !e.metaKey && !e.altKey){
      if (e.code==='KeyG'){ e.preventDefault(); $('tglGrid').click(); return; }
      if (e.code==='KeyS'){ e.preventDefault(); $('tglSlots').click(); return; }
      if (e.code==='KeyL'){ e.preventDefault(); $('tglLabels').click(); return; }
      if (e.code==='KeyZ'){ e.preventDefault(); $('tglZone').click(); return; }
      if (e.code==='ArrowUp' && app.flatIdx>0){ e.preventDefault(); selectMacro(app.flatList[app.flatIdx-1].id); return; }
      if (e.code==='ArrowDown' && app.flatIdx<app.flatList.length-1){ e.preventDefault(); selectMacro(app.flatList[app.flatIdx+1].id); return; }
    }
  });
}

// ---------- boot ----------
const APP_VERSION = 'v3-zone-fit';   // bump to bust module cache; shown in console + title
async function boot(){
  document.title = `MACRO EDITOR — petal-panic [${APP_VERSION}]`;
  $('projectLabel').textContent = 'petal-panic · macros/levels';
  console.info(`[macro-editor] ${APP_VERSION} boot`);

  app.consts = await loadGameConstants();
  setConstants(app.consts);

  app.macros = await loadMacros();
  console.info(`[macro-editor] loaded ${Object.keys(app.macros).length} macros`);
  // Debug: log each macro's orientation + unit count so a stale-cache mismatch is obvious.
  for (const [id, m] of Object.entries(app.macros)){
    const plats = (m.units||[]).filter(u=>u.kind==='platform').length;
    const blocks = (m.units||[]).filter(u=>u.kind==='block').length;
    console.info(`  ${id}: ${m.orientation} · ${blocks}B ${plats}P · ${(m.placements||[]).length} slots`);
  }

  captureBaselines();   // fingerprint canonical files for external-change guard
  restoreDrafts();
  buildSidebar(app.macros);
  initConfirmDialog();
  initToolbar();
  initView();
  initKeyboard();
  syncToggles();
  resizeCanvas();
  updateDirtyDots();

  // select the last-opened macro if we have one saved; otherwise the first.
  const lastId = readActive();
  const startId = (lastId && app.macros[lastId]) ? lastId : (app.flatList.length ? app.flatList[0].id : null);
  if (startId){
    selectMacro(startId);
  } else {
    draw();
    const tb = $('toolbar'); if (tb) tb.classList.remove('booting');
  }

  $('saveBtn').addEventListener('click', saveToDisk);
  $('dumpBtn').addEventListener('click', dumpBlock);

  // RESET menu: Discard Draft (flush local draft, reload from file)
  const resetBtn = $('resetBtn'), resetMenu = $('resetMenu');
  if (resetBtn && resetMenu){
    resetBtn.addEventListener('click', e=>{
      e.stopPropagation();
      const open = resetMenu.style.display !== 'none';
      // Grey out Discard Draft when the current macro has no draft to discard.
      const discOpt = resetMenu.querySelector('.reset-opt[data-scope="discard"]');
      if (discOpt && app.cur){
        const has = hasDraft(app.cur.id);
        discOpt.classList.toggle('disabled', !has);
      }
      resetMenu.style.display = open ? 'none' : 'block';
    });
    document.addEventListener('click', ()=>{ resetMenu.style.display = 'none'; });
    resetMenu.addEventListener('click', e=>{ e.stopPropagation(); });
    resetMenu.querySelectorAll('.reset-opt').forEach(opt => {
      opt.addEventListener('click', ()=>{
        if (opt.classList.contains('disabled')) return;   // greyed out — ignore
        resetMenu.style.display = 'none';
        if (opt.dataset.scope === 'discard') discardDraft();
      });
    });
  }
}

boot().catch(err => {
  console.error('[macro-editor] boot failed:', err);
  $('projectLabel').textContent = 'failed to load: ' + err.message;
});
