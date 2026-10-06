// ---------- main (macro editor) ----------
// Boot: load game constants + macros → build sidebar → wire editing/view/save.
// Pass 2: drag creation, selection/move/resize, explicit slots, and erase.

import { app } from './state.js';
import { $, cv, resizeCanvas, setZoom, evPos } from './viewport.js';
import { loadGameConstants, loadMacros } from './loader.js';
import { buildSidebar, selectMacro } from './sidebar.js';
import { draw, setConstants } from './draw.js';
import { initConfirmDialog } from './dialog.js';
import { showToast } from './toast.js';
import { saveToDisk, restoreDrafts, captureBaselines, updateDirtyDots, updateSaveButton, discardDraft, hasDraft, readActive } from './save.js';
import { initTools, setTool, syncToolButtons } from './tools.js';
import { initPointer, deleteSelection, lastCell, uniqueSlotName } from './pointer.js';
import { doUndo, doRedo, syncUndoButtons } from './undo.js';
import { pushUndo } from './undo.js';
import { markChanged } from './save.js';
import { previewLayout, reasonFromError } from './validation.js';
import { macroSchemaErrors } from '../../js/world/macroSchema.js';
import { validateLayout } from '../../js/world/macros.js';

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
  $('newBtn').addEventListener('click', ()=>showToast('New macro: not available yet', 'info'));
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
  // Editing/panning pointer behavior is owned by pointer.js so one explicit
  // state machine controls capture, candidates, and atomic commits.
  new ResizeObserver(()=>{ if (app.cssW !== Math.round(cv.getBoundingClientRect().width) || app.cssH !== Math.round(cv.getBoundingClientRect().height)){ resizeCanvas(); draw(); } }).observe(cv);
}

// ---------- keyboard ----------
const clone = v => JSON.parse(JSON.stringify(v));
let clipboard = null; // { units: [...], placements: [...] }

function copySelection(){
  if (!app.cur) return;
  const items = app.editor.multiSelect.length > 0 ? app.editor.multiSelect : (app.editor.selection ? [{kind:app.editor.selection.kind,index:app.editor.selection.index}] : []);
  if (items.length === 0) return;
  const units = [];
  const placements = [];
  for (const item of items) {
    if (item.kind === 'unit') units.push(clone(app.cur.st.units[item.index]));
    else placements.push(clone(app.cur.st.placements[item.index]));
  }
  clipboard = { units, placements };
}

function pasteAtCursor(){
  if (!clipboard || !app.cur) return;
  // Find cursor cell from last known pointer position
  if (!lastCell) return;
  // Find the bottom-left anchor of the copied group
  let minOrigX = Infinity, minOrigY = Infinity;
  for (const u of clipboard.units) {
    if (u.x < minOrigX) minOrigX = u.x;
    if (u.y < minOrigY) minOrigY = u.y;
  }
  for (const p of clipboard.placements) {
    if (p.x < minOrigX) minOrigX = p.x;
    if (p.y < minOrigY) minOrigY = p.y;
  }
  const dx = lastCell.x - minOrigX;
  const dy = lastCell.y - minOrigY;

  // Build next macro with pasted items
  const next = clone(app.cur.st);
  let maxUnitIdx = next.units.length;
  let maxPlatIdx = next.placements.length;
  for (const u of clipboard.units) {
    next.units.push({ ...clone(u), x: u.x + dx, y: u.y + dy });
    maxUnitIdx++;
  }
  for (const p of clipboard.placements) {
    next.placements.push({ ...clone(p), slot: uniqueSlotName(p.type, next.placements), x: p.x + dx, y: p.y + dy });
    maxPlatIdx++;
  }

  // Validate
  let valid = true, reason = '';
  try {
    const schemaErrors = macroSchemaErrors(next, { expectedId: next.id });
    if (schemaErrors.length) throw new Error(schemaErrors[0]);
    validateLayout(previewLayout(next), { traversal: 'warn' });
  } catch (err) {
    valid = false;
    reason = reasonFromError(err);
  }

  // Show ghost preview
  app.editor.preview = {
    mode: 'paste-preview',
    candidate: null,
    valid,
    severity: valid ? 'valid' : 'error',
    reason,
    pasteUnits: clipboard.units.map(u => ({...u, x: u.x+dx, y: u.y+dy})),
    pastePlacements: clipboard.placements.map(p => ({...p, x: p.x+dx, y: p.y+dy})),
  };

  if (valid) {
    pushUndo();
    app.cur.st = next;
    markChanged();
    app.editor.preview = null;
    draw();
  } else {
    showToast(reason, 'error');
    app.editor.preview = null;
    draw();
  }
}

function initKeyboard(){
  window.addEventListener('keydown', e=>{
    const tag = (e.target.tagName||'').toLowerCase();
    if ((e.ctrlKey||e.metaKey) && e.code==='KeyZ'){
      e.preventDefault();
      if (e.shiftKey) doRedo(); else doUndo();
      return;
    }
    if ((e.ctrlKey||e.metaKey) && e.code==='KeyY'){ e.preventDefault(); doRedo(); return; }
    if ((e.ctrlKey||e.metaKey) && e.code==='KeyS'){ e.preventDefault(); saveToDisk(); return; }
    if ((e.ctrlKey||e.metaKey) && (e.code==='KeyC'||e.code==='KeyX')){ e.preventDefault(); copySelection(); return; }
    if ((e.ctrlKey||e.metaKey) && e.code==='KeyV'){ e.preventDefault(); pasteAtCursor(); return; }
    if ((e.ctrlKey||e.metaKey) && (e.code==='Digit0'||e.code==='Numpad0')){ e.preventDefault(); if (app.cur) selectMacro(app.cur.id); return; }
    if (tag==='input'||tag==='textarea') return;
    if (!e.ctrlKey && !e.metaKey && !e.altKey){
      if (e.code==='KeyG'){ e.preventDefault(); $('tglGrid').click(); return; }
      if (e.code==='KeyS'){ e.preventDefault(); $('tglSlots').click(); return; }
      if (e.code==='KeyL'){ e.preventDefault(); $('tglLabels').click(); return; }
      if (e.code==='KeyZ'){ e.preventDefault(); $('tglZone').click(); return; }
      if (e.code==='KeyV'){ e.preventDefault(); setTool('none'); return; }
      if (e.code==='KeyB'){ e.preventDefault(); setTool('block'); return; }
      if (e.code==='KeyP'){ e.preventDefault(); setTool('platform'); return; }
      if (e.code==='KeyE'){ e.preventDefault(); setTool('erase'); return; }
      if (e.code==='Digit1'){ e.preventDefault(); setTool('slot-enemy'); return; }
      if (e.code==='Digit2'){ e.preventDefault(); setTool('slot-barrel'); return; }
      if (e.code==='Digit3'){ e.preventDefault(); setTool('slot-powerup'); return; }
      if (e.code==='Delete'||e.code==='Backspace'){ if (deleteSelection()) e.preventDefault(); return; }
      if (e.code==='Escape'){ e.preventDefault(); app.editor.interaction=null; app.editor.selection=null; app.editor.transientTool=null; syncToolButtons(); draw(); return; }
      if (e.code==='ArrowUp' && app.flatIdx>0){ e.preventDefault(); selectMacro(app.flatList[app.flatIdx-1].id); return; }
      if (e.code==='ArrowDown' && app.flatIdx<app.flatList.length-1){ e.preventDefault(); selectMacro(app.flatList[app.flatIdx+1].id); return; }
    }
  });
}

// ---------- boot ----------
const APP_VERSION = 'v9-physics-reach';   // bump to bust module cache; shown in console + title
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
  initTools();
  initView();
  initPointer();
  initKeyboard();
  syncToggles();
  syncUndoButtons();
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

  $('undoBtn').addEventListener('click', doUndo);
  $('redoBtn').addEventListener('click', doRedo);
  $('saveBtn').addEventListener('click', saveToDisk);

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
