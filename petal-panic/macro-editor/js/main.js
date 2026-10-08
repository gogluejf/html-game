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
import { saveToDisk, restoreDrafts, captureBaselines, updateDirtyDots, updateSaveButton, discardDraft, hasDraft, readActive, createNewMacro } from './save.js';
import { initTools, setTool, syncToolButtons } from './tools.js';
import { initPointer, deleteSelection, lastCell, uniqueSlotName, cellInZone } from './pointer.js';
import { toggleRide, killRideIfActive, setClearanceCommitHook, armSpaceToggle, toggleTrace } from './ghost.js';
import { doUndo, doRedo, syncUndoButtons } from './undo.js';
import { pushUndo } from './undo.js';
import { markChanged } from './save.js';
import { previewLayout, reasonFromError } from './validation.js';
import { macroSchemaErrors } from '../../js/world/macroSchema.js';
import { validateLayout } from '../../js/world/macros.js';
import { stampClearance } from './clearance.js';

// ---------- toolbar toggles ----------
function syncToggles(){
  $('tglGrid').classList.toggle('on', app.show.grid);
  $('tglSlots').classList.toggle('on', app.show.slots);
  $('tglLabels').classList.toggle('on', app.show.labels);
  $('tglZone').classList.toggle('on', app.show.zone);
}
function initToolbar(){
  // A successful ride is a normal undoable draft mutation: snapshot the
  // pre-clear state, stamp the proof, persist the draft, refresh sidebar/UI.
  setClearanceCommitHook(()=>{
    if (!app.cur) return;
    pushUndo();
    stampClearance(app.cur.st);
    markChanged();
    draw();
  });
  $('tglGrid').addEventListener('click', ()=>{ app.show.grid=!app.show.grid; syncToggles(); draw(); });
  $('tglSlots').addEventListener('click', ()=>{ app.show.slots=!app.show.slots; syncToggles(); draw(); });
  $('tglLabels').addEventListener('click', ()=>{ app.show.labels=!app.show.labels; syncToggles(); draw(); });
  $('tglZone').addEventListener('click', ()=>{ app.show.zone=!app.show.zone; syncToggles(); draw(); });
  $('newBtn').addEventListener('click', ()=>createNewMacro());
  $('testRideBtn')?.addEventListener('click', toggleRide);
  $('dumpTraceBtn')?.addEventListener('click', toggleTrace);
}

// ---------- help dialog (same pattern as sprite editor) ----------
const helpDialog = $('helpDialog');
function initHelpDialog(){
  if (!helpDialog || !$('helpBtn')) return;
  $('helpBtn').addEventListener('click', ()=>helpDialog.showModal());
  helpDialog.addEventListener('click', ()=>helpDialog.close());
  helpDialog.addEventListener('close', ()=>$('helpBtn').focus());
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
// Clipboard lives in localStorage, NOT in the undo stack: cut+paste must be
// a memory operation that undo/redo never touches. Undo restores macro state
// only; the buffer persists across undo, macro switches, and page reloads.
const CLIP_KEY = 'pp_macro_clipboard';
let clipboard = null; // { units: [...], placements: [...] }

function loadClipboard(){
  try{
    const raw = localStorage.getItem(CLIP_KEY);
    if (raw) clipboard = JSON.parse(raw);
  }catch(e){}
}
function storeClipboard(){
  try{
    if (clipboard) localStorage.setItem(CLIP_KEY, JSON.stringify(clipboard));
    else localStorage.removeItem(CLIP_KEY);
  }catch(e){}
}
loadClipboard();

function copySelection(cut=false){
  if (!app.cur) return;
  const items = app.editor.multiSelect.length > 0 ? app.editor.multiSelect : (app.editor.selection ? [{kind:app.editor.selection.kind,index:app.editor.selection.index}] : []);
  if (items.length === 0) { showToast('Nothing selected','error'); return; }
  const units = [];
  const placements = [];
  for (const item of items) {
    if (item.kind === 'unit') units.push(clone(app.cur.st.units[item.index]));
    else placements.push(clone(app.cur.st.placements[item.index]));
  }
  clipboard = { units, placements };
  storeClipboard();
  if (cut) {
    // Remove from macro (highest index first to avoid shifting)
    const sortedUnits = [...items].filter(i=>i.kind==='unit').sort((a,b)=>b.index-a.index);
    const sortedPlats = [...items].filter(i=>i.kind==='slot').sort((a,b)=>b.index-a.index);
    pushUndo();
    for (const i of sortedUnits) app.cur.st.units.splice(i.index, 1);
    for (const i of sortedPlats) app.cur.st.placements.splice(i.index, 1);
    app.editor.selection = null;
    app.editor.multiSelect = [];
    markChanged();
    draw();
    showToast(`Cut ${units.length} unit(s), ${placements.length} slot(s)`,'success');
  } else {
    showToast(`Copied ${units.length} unit(s), ${placements.length} slot(s)`,'success');
  }
}

function pasteAtCursor(){
  if (!clipboard || !app.cur) return;
  // Find cursor cell from last known pointer position. If the cursor is OUT
  // of the zone (stale hover, mouse over the sidebar, cross-macro switch),
  // fall back to the FIRST selected item's position — "paste over what I
  // have selected". Last resort: zone origin.
  let anchor;
  if (lastCell && cellInZone(lastCell)) {
    anchor = lastCell;
  } else {
    const selItems0 = app.editor.multiSelect?.length > 0
      ? app.editor.multiSelect
      : (app.editor.selection ? [app.editor.selection] : []);
    anchor = null;
    for (const item of selItems0) {
      const obj = item.kind === 'unit'
        ? app.cur.st.units[item.index]
        : app.cur.st.placements[item.index];
      if (obj) { anchor = { x: obj.x, y: obj.y }; break; }
    }
    if (!anchor) anchor = { x: 0, y: 0 };
  }
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
  const dx = anchor.x - minOrigX;
  const dy = anchor.y - minOrigY;

  // Pasting over the CURRENT selection REPLACES it: selected units/placements
  // whose cells fall inside the pasted group's footprint are removed (the
  // paste wins). Nothing else is touched — unselected items still collide as
  // before.
  const selItems = app.editor.multiSelect?.length > 0
    ? app.editor.multiSelect
    : (app.editor.selection ? [app.editor.selection] : []);
  // Footprint of the pasted group (unit space, after offset).
  let px0 = Infinity, py0 = Infinity, px1 = -Infinity, py1 = -Infinity;
  for (const u of clipboard.units) {
    px0 = Math.min(px0, u.x + dx); py0 = Math.min(py0, u.y + dy);
    px1 = Math.max(px1, u.x + dx + u.width); py1 = Math.max(py1, u.y + dy + (u.height ?? 1));
  }
  for (const p of clipboard.placements) {
    px0 = Math.min(px0, p.x + dx); py0 = Math.min(py0, p.y + dy);
    px1 = Math.max(px1, p.x + dx + 1); py1 = Math.max(py1, p.y + dy + 1);
  }
  const removeUnitIdx = new Set(), removePlatIdx = new Set();
  if (selItems.length && px0 !== Infinity){
    for (const item of selItems) {
      if (item.kind === 'unit') {
        const u = app.cur.st.units[item.index];
        if (!u) continue;
        const ux1 = u.x + u.width, uy1 = u.y + (u.height ?? 1);
        if (u.x < px1 && ux1 > px0 && u.y < py1 && uy1 > py0) removeUnitIdx.add(item.index);
      } else {
        const p = app.cur.st.placements[item.index];
        if (!p) continue;
        if (p.x < px1 && p.x + 1 > px0 && p.y < py1 && p.y + 1 > py0) removePlatIdx.add(item.index);
      }
    }
  }

  // Build next macro with pasted items (minus replaced selections)
  const next = clone(app.cur.st);
  if (removeUnitIdx.size) next.units = next.units.filter((_, i) => !removeUnitIdx.has(i));
  if (removePlatIdx.size) next.placements = next.placements.filter((_, i) => !removePlatIdx.has(i));
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
    if ((e.ctrlKey||e.metaKey) && (e.code==='KeyC'||e.key==='c')){ e.preventDefault(); copySelection(false); return; }
    if ((e.ctrlKey||e.metaKey) && (e.code==='KeyX'||e.key==='x')){ e.preventDefault(); copySelection(true); return; }
    if ((e.ctrlKey||e.metaKey) && (e.code==='KeyV'||e.key==='v')){ e.preventDefault(); pasteAtCursor(); return; }
    // Ctrl+A: select ALL units + placements in the current macro.
    if ((e.ctrlKey||e.metaKey) && (e.code==='KeyA'||e.key==='a')){
      e.preventDefault();
      if (!app.cur) return;
      app.editor.multiSelect = [
        ...app.cur.st.units.map((_, i) => ({ kind:'unit', index:i })),
        ...app.cur.st.placements.map((_, i) => ({ kind:'slot', index:i })),
      ];
      app.editor.selection = null;
      draw();
      return;
    }
    if ((e.ctrlKey||e.metaKey) && (e.code==='Digit0'||e.code==='Numpad0')){ e.preventDefault(); if (app.cur) selectMacro(app.cur.id); return; }
    if (tag==='input'||tag==='textarea') return;
    // If a <dialog> is open (confirm / prompt), let it own the keyboard —
    // especially Escape, which the dialog uses to cancel. Do NOT intercept.
    if (document.querySelector('dialog[open]')) return;
    // Trace recording: T starts/stops the ride; use the TRACE button (or X)
    // to record frames. Recording is explicit, not tied to Ctrl, so it can't
    // be lost to key-repeat / focus quirks.
    if (e.code==='KeyX' && !e.repeat){ e.preventDefault(); toggleTrace(); return; }
    if (!e.ctrlKey && !e.metaKey && !e.altKey){
      if (e.code==='KeyG'){ e.preventDefault(); $('tglGrid').click(); return; }
      if (e.code==='KeyS'){ e.preventDefault(); $('tglSlots').click(); return; }
      if (e.code==='KeyL'){ e.preventDefault(); $('tglLabels').click(); return; }
      if (e.code==='KeyZ'){ e.preventDefault(); $('tglZone').click(); return; }
      if (e.code==='KeyV'){ e.preventDefault(); setTool('none'); return; }
      if (e.code==='KeyB'){ e.preventDefault(); setTool('block'); return; }
      if (e.code==='KeyP'){ e.preventDefault(); setTool('platform'); return; }
      if (e.code==='KeyE'){ e.preventDefault(); setTool('erase'); return; }
      if (e.code==='Space' && !e.repeat){ e.preventDefault(); armSpaceToggle(toggleRide); return; }
    if (e.code==='KeyT'){ e.preventDefault(); toggleRide(); return; }
      if (e.code==='Digit1'){ e.preventDefault(); setTool('slot-enemy'); return; }
      if (e.code==='Digit2'){ e.preventDefault(); setTool('slot-barrel'); return; }
      if (e.code==='Digit3'){ e.preventDefault(); setTool('slot-powerup'); return; }
      if (e.code==='Delete'||e.code==='Backspace'){ if (deleteSelection()) e.preventDefault(); return; }
      if (e.code==='Escape'){ e.preventDefault(); app.editor.interaction=null; app.editor.selection=null; app.editor.transientTool=null; syncToolButtons(); draw(); return; }
      if (e.code==='ArrowUp' && app.flatIdx>0){ e.preventDefault(); selectMacro(app.flatList[app.flatIdx-1].id); return; }
      if (e.code==='ArrowDown' && app.flatIdx<app.flatList.length-1){ e.preventDefault(); selectMacro(app.flatList[app.flatIdx+1].id); return; }
    }
  });
  window.addEventListener('keyup', e=>{
    // (Ctrl-release dump removed — recording is now explicit via X / TRACE button.)
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
  initHelpDialog();
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
