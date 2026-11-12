// ---------- sidebar (macro editor) ----------
// Lists all macros grouped by difficulty (1/2/3). Click = select + draw.
// Populates app.flatList in display order for keyboard up/down navigation.

import { app } from './state.js';
import { $, tree } from './viewport.js';
import { draw, zoneExtents, contentExtents, setInspectorHook } from './draw.js';
import { setZoom } from './viewport.js';
import { updateDirtyDots, updateSaveButton, saveActive } from './save.js';
import { renameCurrentMacro, deleteCurrentMacro, duplicateCurrentMacro } from './save.js';
import { analyzeMacroWarnings } from './validation.js';
import { killRideIfActive } from './ghost.js';
import { markChanged } from './save.js';
import { pushUndo } from './undo.js';
import { showToast } from './toast.js';
import { validateMacroCandidate } from './validation.js';
import { normalizeUnit, unitGridError } from '../../js/world/squareGrid.js';
import { BARREL_TYPES } from '../../js/objects/object.js';
import { ENEMY_TYPES } from '../../js/world/enemyTypes.js';
import { POWERUP_ROLL_TYPES, POWERUP_DEFS } from '../../js/objects/powerup.js';

// Register the inspector hook so draw() can refresh the selection panel
// without a circular import.
setInspectorHook(syncInspector);

export function buildSidebar(macros){
  tree.innerHTML = '';
  app.flatList.length = 0;
  const byDiff = { 1:[], 2:[], 3:[] };
  for (const [id, m] of Object.entries(macros)){
    (byDiff[m.difficulty] || (byDiff[m.difficulty]=[])).push({ id, m });
  }
  const diffLabel = { 1:'Difficulty 1', 2:'Difficulty 2', 3:'Difficulty 3' };
  for (const d of ['1','2','3']){
    const list = byDiff[d] || [];
    if (!list.length) continue;
    const hd = document.createElement('div');
    hd.className = 'diff-group';
    hd.textContent = `${diffLabel[d]} (${list.length})`;
    tree.appendChild(hd);
    list.sort((a,b)=>a.id.localeCompare(b.id));
    for (const { id, m } of list){
      const row = document.createElement('div');
      row.className = 'ent solo';
      const orient = m.orientation === 'vertical' ? '<span class="orient v">V</span>' : '<span class="orient">H</span>';
      row.innerHTML = `<span class="ent-label">${id}${orient}</span><span class="cnt">${(m.units||[]).length}u</span>`;
      row.addEventListener('click', () => selectMacro(id));
      // Rename: double-click the label, or right-click the row.
      row.querySelector('.ent-label').addEventListener('dblclick', (e) => { e.stopPropagation(); if (app.cur?.id === id) renameCurrentMacro(); else { selectMacro(id); setTimeout(renameCurrentMacro, 0); } });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); if (app.cur?.id !== id) selectMacro(id); showCtxMenu(e.clientX, e.clientY, id); });
      // Delete button (small ✕ on the right).
      const del = document.createElement('button');
      del.className = 'ent-del';
      del.title = `Delete ${id}`;
      del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      del.addEventListener('click', (e) => { e.stopPropagation(); if (app.cur?.id !== id) selectMacro(id); deleteCurrentMacro(); });
      row.appendChild(del);
      m._el = row;
      tree.appendChild(row);
      app.flatList.push({ id });
    }
  }
}

export function selectMacro(id){
  const macro = app.macros[id];
  if (!macro) return;
  document.querySelectorAll('.ent').forEach(e=>e.classList.remove('on'));
  if (macro._el) macro._el.classList.add('on');
  app.flatIdx = app.flatList.findIndex(f => f.id === id);

  // Working copy = draft if present, else a deep clone of the canonical macro.
  let st;
  if (app.drafts.has(id)){
    st = app.drafts.get(id);
  } else {
    // Clone canonical data only. `_el` is sidebar UI metadata attached to the
    // in-memory list item and must never enter drafts or saved macro JSON.
    const { _el, ...canonicalData } = macro;
    st = JSON.parse(JSON.stringify(canonicalData));
    app.drafts.set(id, st);
  }
  app.cur = { id, macro, st };
  // Pointer targets are indices into the current macro and cannot survive a
  // macro switch. Any active test ride is killed too.
  killRideIfActive();
  app.editor.hover = null;
  app.editor.selection = null;
  app.editor.interaction = null;
  app.editor.preview = null;
  app.editor.pan = null;
  app.editor.transientTool = null;
  app.editor.warningUnitIndices = analyzeMacroWarnings(st).warningUnitIndices;

  saveActive(id);   // remember this macro so a refresh lands back on it
  syncPanel();
  fitView(st);
  draw();
  updateSaveButton();
  updateDirtyDots();
  const tb = $('toolbar'); if (tb) tb.classList.remove('booting');
}

// Fit the WHOLE AREA (zone box) into view — not just the macro's footprint —
// so the full level size + entry/exit are always visible on first select.
function fitView(st){
  const ux = app.consts.unitPxX, uy = app.consts.unitPxY;
  // Fit to the CONTENT (terrain + entry/exit bands), not the full zone box —
  // a horizontal area is one screen tall but its terrain sits in the bottom
  // few rows, so fitting the full box would center empty air below the ground.
  const { ax0, ax1, ay0, ay1 } = contentExtents(st);
  if (!isFinite(ax1)){ app.panX = 0; app.panY = 0; setZoom(1); return; }
  const minX = ax0*ux, maxX = ax1*ux, minY = ay0*uy, maxY = ay1*uy;
  const pad = 60;
  const bw = (maxX-minX)+pad*2, bh = (maxY-minY)+pad*2;
  const z = Math.min(app.cssW/bw, app.cssH/bh);
  app.zoom = Math.max(.05, Math.min(8, z));
  // Center on the area's midpoint. From s2c: to map world (midX,midY) to canvas
  // center (cssW/2, cssH/2), pan must equal the world midpoint.
  const midX = (minX+maxX)/2, midY = (minY+maxY)/2;
  app.panX = midX;
  app.panY = midY;
  app.userZoomed = true;
  $('zoomval').textContent = Math.round(app.zoom*100)+'%';
}

export function syncPanel(){
  const st = app.cur.st;
  $('p_stitle').textContent = app.cur.id;
  $('p_orient').textContent = st.orientation;
  $('p_diff').textContent = st.difficulty;
  const blocks = (st.units||[]).filter(u=>u.kind==='block').length;
  const plats = (st.units||[]).filter(u=>u.kind==='platform').length;
  $('p_blocks').textContent = blocks;
  $('p_plats').textContent = plats;
  $('p_slots').textContent = (st.placements||[]).length;
  $('p_cellw').textContent = app.consts.unitPxX + ' px';
  $('p_cellh').textContent = app.consts.unitPxY + ' px';
  $('p_plath').textContent = app.consts.platformDrawH + ' px';
  $('finfo').textContent = `${app.cur.id} · ${st.orientation} · diff ${st.difficulty}`;
  syncInspector();
}

// ---------- Inspector (selection properties) ----------
const FAMILY_LABELS = {
  barrel: BARREL_TYPES,
  enemy: ENEMY_TYPES,
  powerup: POWERUP_ROLL_TYPES.map(id => ({ id, label: POWERUP_DEFS[id]?.label ?? id })),
};

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

export function syncInspector(force = false){
  const body = $('inspectorBody');
  const title = $('inspectorTitle');
  const swatch = $('inspectorSwatch');
  const sel = app.editor.selection;
  // Don't rebuild the DOM while the user is actively editing an input—
  // it would steal focus and destroy their cursor/selection mid-typing.
  // `force=true` bypasses this (used after a committed edit).
  if (!force){
    const activeEl = document.activeElement;
    if (activeEl && body.contains(activeEl) && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT')){
      return;
    }
  }
  if (!sel || !app.cur){
    title.textContent = 'Selection';
    swatch.style.background = 'var(--acc)';
    body.className = 'inspector-empty';
    body.innerHTML = 'Select a block, platform, or object to edit its properties.';
    return;
  }
  const st = app.cur.st;
  let html = '';
  if (sel.kind === 'unit'){
    const u = st.units[sel.index];
    if (!u) return;
    const isBlock = u.kind === 'block';
    title.textContent = isBlock ? 'Block' : 'Platform';
    swatch.style.background = isBlock ? 'var(--grn)' : 'var(--acc)';
    html += `<div class="inspector-grid">`;
    html += `<label>ID</label><span class="ro-display">#${sel.index}</span>`;
    html += `<label>Kind</label><select data-insp="kind"><option value="block" ${u.kind==='block'?'selected':''}>block</option><option value="platform" ${u.kind==='platform'?'selected':''}>platform</option></select>`;
    html += `<label>Position</label><div class="inspector-pair"><div><b>X</b><input type="number" data-insp="x" value="${u.x}"></div><div><b>Y</b><input type="number" data-insp="y" value="${u.y}"></div></div>`;
    html += `<label>Size</label><div class="inspector-pair"><div><b>W</b><input type="number" data-insp="width" value="${u.width}" min="1"></div>${isBlock ? `<div><b>H</b><input type="number" data-insp="height" value="${u.height}" min="1"></div>` : ''}</div>`;
    html += `</div>`;
  } else if (sel.kind === 'slot'){
    const p = st.placements[sel.index];
    if (!p) return;
    title.textContent = 'Object Slot';
    swatch.style.background = 'var(--yel)';
    const families = ['enemy','barrel','powerup'];
    const famOpts = families.map(f => `<option value="${f}" ${f===p.type?'selected':''}>${f}</option>`).join('');
    const subList = FAMILY_LABELS[p.type] || [];
    const curVal = p.value ?? 'random';
    const subOpts = `<option value="random" ${curVal==='random'||!subList.find(t=>t.id===curVal)?'selected':''}>random</option>` +
      subList.map(t => `<option value="${esc(t.id)}" ${t.id===curVal?'selected':''}>${esc(t.label)}</option>`).join('');
    html += `<div class="inspector-grid">`;
    const objId = `#${p.type}-${sel.index}`;
    html += `<label>ID</label><span class="ro-display">${esc(objId)}</span>`;
    html += `<label>Type</label><select data-insp="type">${famOpts}</select>`;
    html += `<label>Subtype</label><select data-insp="value" data-type="${esc(p.type)}">${subOpts}</select>`;
    html += `<label>Position</label><div class="inspector-pair"><div><b>X</b><input type="number" data-insp="x" value="${p.x}"></div><div><b>Y</b><input type="number" data-insp="y" value="${p.y ?? 0}"></div></div>`;
    html += `</div>`;
  }
  body.className = '';
  body.innerHTML = html;
  // Wire up change handlers
  body.querySelectorAll('[data-insp]').forEach(el => {
    el.addEventListener('change', () => onInspectorChange(sel, el));
  });
  initInspectorSpinners();
}

// Wrap inspector number inputs with the same custom spinner arrows used by
// the sprite editor (native spinners are hidden via CSS). Arrow keys still
// work natively inside the input — only the visual arrows are replaced.
export function initInspectorSpinners(){
  const body = $('inspectorBody');
  body.querySelectorAll('input[type=number]').forEach(inp=>{
    if (inp.closest('.numwrap')) return;   // already wrapped
    const wrap = document.createElement('span');
    wrap.className = 'numwrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    const arr = document.createElement('span');
    arr.className = 'arr';
    arr.innerHTML = '<span class="up"></span><span class="dn"></span>';
    wrap.appendChild(arr);
    const step = () => parseFloat(inp.step) || 1;
    arr.querySelector('.up').addEventListener('click', ()=>{ inp.value=(parseFloat(inp.value)||0)+step(); inp.dispatchEvent(new Event('change')); });
    arr.querySelector('.dn').addEventListener('click', ()=>{ inp.value=(parseFloat(inp.value)||0)-step(); inp.dispatchEvent(new Event('change')); });
  });
}

function onInspectorChange(sel, el){
  const st = app.cur.st;
  const key = el.dataset.insp;
  if (sel.kind === 'unit'){
    const u = st.units[sel.index];
    if (!u) return;
    // Build a candidate with the proposed change, normalize it through the
    // SAME shared function the canvas drag/resize uses.
    let proposed = { ...u };
    if (key === 'kind'){
      const newKind = el.value;
      if (newKind === 'platform') delete proposed.height;
      else proposed.height = proposed.height ?? 1;
      proposed.kind = newKind;
    }
    else if (key === 'x') proposed.x = parseInt(el.value, 10) || 0;
    else if (key === 'y') proposed.y = parseInt(el.value, 10) || 0;
    else if (key === 'width') proposed.width = parseInt(el.value, 10) || 1;
    else if (key === 'height') proposed.height = parseInt(el.value, 10) || 1;
    // Normalize through the shared grid contract (snap block x, clamp dims).
    const normalized = normalizeUnit(proposed);
    // Validate against the full macro (schema + layout + support).
    const result = validateMacroCandidate(st, normalized, { targetKind: 'unit', targetIndex: sel.index });
    if (!result.valid){
      showToast(result.reason, 'error');
      // Revert the DISPLAYED value only — never rebuild the DOM. A full
      // syncInspector(true) would destroy focus mid-edit (next arrow key
      // then hits the macro-list navigation instead of the input).
      el.value = String(u[key] ?? '');
      return;
    }
    pushUndo();
    Object.assign(u, normalized);
    markChanged();
    draw();
    // no rebuild needed — input already shows the new value

  } else if (sel.kind === 'slot'){
    const p = st.placements[sel.index];
    if (!p) return;
    let proposed = { ...p };
    if (key === 'type'){
      proposed.type = el.value;
      proposed.value = 'random';
    } else if (key === 'value'){
      proposed.value = el.value;
    } else if (key === 'x') proposed.x = parseInt(el.value, 10) || 0;
    else if (key === 'y') proposed.y = parseInt(el.value, 10) || 0;
    const result = validateMacroCandidate(st, proposed, { targetKind: 'slot', targetIndex: sel.index });
    if (!result.valid){
      showToast(result.reason, 'error');
      // Revert the DISPLAYED value only — never rebuild the DOM (focus).
      el.value = key === 'type' ? p.type : (key === 'value' ? String(p.value ?? 'random') : String(p[key] ?? ''));
      return;
    }
    pushUndo();
    Object.assign(p, proposed);
    markChanged();
    draw();
    // no rebuild needed — input already shows the new value

  }
}

// ---------- context menu (right-click sidebar row) ----------
let _ctxEl = null;

function showCtxMenu(x, y, macroId){
  hideCtxMenu();
  _ctxEl = document.createElement('div');
  _ctxEl.className = 'ctx-menu';
  _ctxEl.innerHTML = `
    <button data-action="duplicate">Duplicate</button>
    <button data-action="rename">Rename</button>
    <button data-action="delete" class="danger">Delete</button>`;
  document.body.appendChild(_ctxEl);
  // Position: clamp to viewport
  const rect = _ctxEl.getBoundingClientRect();
  _ctxEl.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
  _ctxEl.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
  _ctxEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    hideCtxMenu();
    if (btn.dataset.action === 'rename') renameCurrentMacro();
    else if (btn.dataset.action === 'duplicate') duplicateCurrentMacro();
    else if (btn.dataset.action === 'delete') deleteCurrentMacro();
  });
  // Dismiss on outside click or Escape
  setTimeout(() => {
    document.addEventListener('click', hideCtxMenu, { once: true });
    document.addEventListener('keydown', escHandler, { once: true });
  }, 0);
}

function escHandler(e){ if (e.key === 'Escape') hideCtxMenu(); }

function hideCtxMenu(){
  if (_ctxEl){ _ctxEl.remove(); _ctxEl = null; }
}
