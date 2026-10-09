// ---------- draft / save (macro editor) ----------
// Same model as the sprite editor, simplified for whole-macro objects:
//   - DRAFT (localStorage): auto-saved on every change. Per-macro key.
//   - DIRTY DOT: shown when a draft exists for that macro (draft != canonical).
//     No separate dirty flag — presence of the draft IS the dirty state.
//   - SAVE: PUT the draft to petal-panic/macros/levels/<id>.json via server.
//     On success, clear the draft + dot.

import { app } from './state.js';
import { $ } from './viewport.js';
import { confirmDialog, promptDialog } from './dialog.js';
import { showToast } from './toast.js';
import { selectMacro, buildSidebar } from './sidebar.js';
import { draw } from './draw.js';
import { assertMacroSchema } from '../../js/world/macroSchema.js';
import { invalidateStaleClearance, hasValidClearance } from './clearance.js';

// v4 invalidates drafts created before formal schema enforcement.
const LS_PREFIX = 'macro-editor-draft-v4-';
export const draftKey = id => LS_PREFIX + id;
// Config key: remembers the last-selected macro so a refresh lands back on it
// (mirrors the sprite editor's `active`). Separate from the per-macro drafts.
const LS_ACTIVE = 'macro-editor-active-v1-';
// Fingerprint of the canonical file as loaded (for external-change detection).
// Keyed by macro id. Compared against disk-at-save-time, NOT against the draft
// (the draft is *supposed* to differ from disk when dirty).
const baseFingerprint = {};   // id -> JSON string of canonical at load

export function hasDraft(id){ try { return !!localStorage.getItem(draftKey(id)); } catch(e){ return false; } }
function storeDraft(id, data){ try { localStorage.setItem(draftKey(id), JSON.stringify(data)); } catch(e){} }
function clearDraft(id){ try { localStorage.removeItem(draftKey(id)); } catch(e){} }

// ---------- last-selected macro (config) ----------
// Persist which macro was open so a refresh/relaunch lands back on it.
export function saveActive(id){ try { if (id) localStorage.setItem(LS_ACTIVE, id); } catch(e){} }
export function readActive(){ try { return localStorage.getItem(LS_ACTIVE); } catch(e){ return null; } }

// Called whenever the current macro's working copy mutates. Writes the draft
// and refreshes the dot + save button. This is the ONLY thing that marks dirty.
export function markChanged(){
  if (!app.cur) return;
  // Any geometry/content mutation invalidates the clearance proof. Undo/redo
  // snapshots include the proof, so restoring the exact cleared state restores
  // the flag automatically; a changed signature strips it.
  invalidateStaleClearance(app.cur.st);
  // Undoing back to the canonical value makes the macro clean again. Strip
  // sidebar-only metadata before comparing with the working copy.
  const { _el, ...canonical } = app.macros[app.cur.id] || {};
  const clean = JSON.stringify(app.cur.st) === JSON.stringify(canonical);
  if (clean) clearDraft(app.cur.id);
  else storeDraft(app.cur.id, app.cur.st);
  app.drafts.set(app.cur.id, app.cur.st);
  updateSaveButton();
  updateDirtyDots();
  const el = $('saveIndicator');
  if (el){ el.style.opacity='1'; clearTimeout(el._t); el._t = setTimeout(()=>el.style.opacity='0', 600); }
}

export function updateSaveButton(){
  const btn = $('saveBtn');
  if (!btn || !app.cur) return;
  const has = hasDraft(app.cur.id);
  btn.disabled = !has;
  btn.classList.toggle('active', has);
}

export function updateDirtyDots(){
  for (const f of app.flatList){
    const m = app.macros[f.id];
    const el = m && m._el;
    if (!el || typeof el.querySelector !== 'function') continue;
    let dot = el.querySelector('.dirty-dot');
    let grp = el.querySelector('.cntgrp');
    if (hasDraft(f.id)){
      if (!dot){
        const cnt = el.querySelector('.cnt');
        if (!grp){
          grp = document.createElement('span');
          grp.className = 'cntgrp';
          cnt.parentNode.insertBefore(grp, cnt);
          grp.appendChild(cnt);
        }
        dot = document.createElement('span'); dot.className='dirty-dot'; dot.textContent='●';
        grp.insertBefore(dot, grp.firstChild);
      }
    } else if (dot){ dot.remove(); }

    let clear = el.querySelector('.clearance-flag');
    const working = app.drafts.get(f.id) || m;
    if (hasValidClearance(working)){
      if (!grp){
        const cnt = el.querySelector('.cnt');
        grp = document.createElement('span');
        grp.className = 'cntgrp';
        cnt.parentNode.insertBefore(grp, cnt);
        grp.appendChild(cnt);
      }
      if (!clear){
        clear = document.createElement('span');
        clear.className = 'clearance-flag';
        clear.textContent = '⚑';
        clear.title = 'Ghost test cleared this exact macro structure';
      }
      const cnt = grp.querySelector('.cnt');
      grp.insertBefore(clear, cnt); // after dirty dot, before unit count
    } else if (clear){ clear.remove(); }
  }
}

// Explicit save: push the current draft to disk.
export async function saveToDisk(){
  if (!app.cur) return;
  const id = app.cur.id;
  // Defense in depth: never persist a proof whose signature no longer matches,
  // even if a nonstandard mutation path forgot to call markChanged().
  if (invalidateStaleClearance(app.cur.st)) {
    storeDraft(id, app.cur.st);
    app.drafts.set(id, app.cur.st);
    updateDirtyDots();
  }
  if (!hasDraft(id)){ showToast('Nothing to save', 'info'); return; }

  // External-change guard: did the file on disk change since we loaded it?
  // Compare disk-now against the fingerprint captured at load (NOT the draft —
  // the draft is expected to differ from disk while dirty).
  let external = false;
  try{
    const res = await fetch(`../macros/levels/${id}.json`);
    if (res.ok){
      const onDiskText = await res.text();
      if (baseFingerprint[id] !== undefined && onDiskText !== baseFingerprint[id]){
        external = true;
      }
    }
  }catch(e){}
  if (external){
    const ok = await confirmDialog('This macro was modified outside the editor. Overwrite?', () => {}, { title:'⚠ External Change', yesLabel:'Overwrite' });
    if (!ok) return;
  }

  const data = app.drafts.get(id);
  try {
    assertMacroSchema(data, { expectedId: id });
  } catch (e) {
    confirmDialog('Save blocked — macro JSON is invalid:\n' + e.message, null);
    showToast('Save blocked: invalid macro JSON', 'error');
    return;
  }
  let putRes;
  try{
    putRes = await fetch('/petal-panic/macro-editor/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: id, data }),
    });
  }catch(e){
    confirmDialog('Save failed: ' + e.message, null);
    showToast('Save failed: ' + e.message, 'error');
    return;
  }
  if (!putRes.ok){
    let msg = putRes.status + ' ' + putRes.statusText;
    try { const b = await putRes.json(); if (b.error) msg = b.error; } catch(_){}
    confirmDialog('Save failed: ' + msg, null);
    showToast('Save failed: ' + msg, 'error');
    return;
  }

  // Success: canonical now matches draft → drop the draft + dot.
  clearDraft(id);
  // Refresh the canonical in-memory copy + its fingerprint so future
  // comparisons are against the just-saved state. Preserve the sidebar row ref.
  const prevEl = app.macros[id]._el;
  app.macros[id] = JSON.parse(JSON.stringify(data));
  if (prevEl) app.macros[id]._el = prevEl;
  baseFingerprint[id] = JSON.stringify(data, null, 2) + '\n';   // matches server write format
  updateSaveButton();
  updateDirtyDots();

  const btn = $('saveBtn');
  if (btn){ btn.classList.add('saved-flash'); setTimeout(()=>btn.classList.remove('saved-flash'), 1000); }
  showToast(`Saved ${id} → macros/levels/${id}.json`, 'success');
}

// ---------- discard draft: flush the CURRENT macro's local draft, reload from file ----------
// Does NOT touch saved data on disk. Removes this macro's unsaved localStorage
// draft (the dirty-dot / SAVE-button source) + its in-memory working copy, then
// re-selects the macro so state rebuilds fresh from the canonical file.
export function discardDraft(){
  if (!app.cur) return;
  const id = app.cur.id;
  if (!hasDraft(id)){
    showToast('No draft to discard for ' + id, 'info');
    return;
  }
  confirmDialog(`Discard unsaved draft for ${id}? Saved data on disk is kept; the macro reloads from the file.`, () => {
    clearDraft(id);                 // drop the per-macro draft key
    app.drafts.delete(id);          // drop the in-memory working copy
    selectMacro(id);                // rebuild st from the canonical macro
    updateSaveButton();             // draft gone → button off, dot cleared
    updateDirtyDots();
    showToast(`Draft discarded — ${id} reloaded from file`, 'success');
  });
}

// Capture the canonical fingerprint for every macro at boot (called after
// app.macros is populated). This is the baseline the external-change guard uses.
export function captureBaselines(){
  for (const id of Object.keys(app.macros || {})){
    baseFingerprint[id] = JSON.stringify(app.macros[id], null, 2) + '\n';
  }
}

// Restore any drafts into memory at boot (so dots show before first select).
export function restoreDrafts(){
  for (const id of Object.keys(app.macros || {})){
    try{
      const raw = localStorage.getItem(draftKey(id));
      if (raw) app.drafts.set(id, JSON.parse(raw));
    }catch(e){}
  }
}

// ===========================================================================
// New / Rename / Delete macros
// ===========================================================================

const ID_RE = /^[A-Za-z0-9_]+$/;

/** All known ids: canonical files + any unsaved (draft-only) new macros. */
function allKnownIds(){
  const set = new Set(Object.keys(app.macros || {}));
  for (const id of app.drafts.keys()) set.add(id);
  return set;
}

/** Next free id for a base name: base, base_2, base_3, ... */
function nextFreeId(base){
  const known = allKnownIds();
  if (!known.has(base)) return base;
  let n = 2;
  while (known.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** A minimal valid macro object (schema requires >=1 unit). */
function blankMacro(id){
  return {
    id,
    name: id,
    orientation: 'horizontal',
    difficulty: 1,
    units: [ { kind:'block', x:4, y:0, width:5, height:1 } ],
    placements: [],
    variations: [],
    follows: [],
    followedBy: [],
  };
}

/**
 * Create a NEW macro in draft mode. Prompts for a name (defaults to
 * newMacro, newMacro_2, ...). It appears immediately in the sidebar and
 * lives in localStorage until explicitly saved to disk.
 */
export async function createNewMacro(){
  const defaultId = nextFreeId('newMacro');
  const value = await promptDialog('New Macro', 'Name your macro. Use letters, numbers, underscores.', defaultId, { okLabel:'Create' });
  if (value === null) return;                 // cancelled
  const id = value;
  if (!ID_RE.test(id)){
    confirmDialog('Invalid id — use only letters, numbers, and underscores.', null, { title:'Invalid Name' });
    return;
  }
  if (allKnownIds().has(id)){
    confirmDialog(`A macro named "${id}" already exists. Pick a different name.`, null, { title:'Name Conflict' });
    return;
  }
  const data = blankMacro(id);
  storeDraft(id, data);
  app.macros[id] = JSON.parse(JSON.stringify(data));
  app.drafts.set(id, JSON.parse(JSON.stringify(data)));
  buildSidebar(app.macros);
  updateDirtyDots();
  selectMacro(id);
  saveActive(id);
  showToast(`New macro "${id}" created (draft — not saved to disk yet)`, 'success');
}

/**
 * Rename the current macro. Renames the in-memory id, the localStorage draft
 * key (so nothing is lost), and — on success — the file on disk. Blocks if the
 * new id collides with an existing macro.
 */
export async function renameCurrentMacro(){
  if (!app.cur) return;
  const oldId = app.cur.id;
  const value = await promptDialog('Rename Macro', `Rename "${oldId}". Use letters, numbers, underscores.`, oldId, { okLabel:'Rename' });
  if (value === null) return;                 // cancelled
  const newId = value;
  if (!ID_RE.test(newId)){
    confirmDialog('Invalid id — use only letters, numbers, and underscores.', null, { title:'Invalid Name' });
    return;
  }
  if (newId === oldId) return;                // no-op
  if (allKnownIds().has(newId)){
    confirmDialog(`A macro named "${newId}" already exists. Pick a different name.`, null, { title:'Name Conflict' });
    return;
  }

  // 1. Move the in-memory working copy + canonical entry under the new id.
  const st = app.cur.st;
  st.id = newId;
  st.name = newId;
  invalidateStaleClearance(st);
  const prevEl = app.macros[oldId]._el;
  delete app.macros[oldId];
  app.macros[newId] = JSON.parse(JSON.stringify(st));
  if (prevEl) app.macros[newId]._el = prevEl;

  // 2. Move the localStorage draft (if any) so unsaved work is preserved.
  const hadDraft = hasDraft(oldId);
  if (hadDraft){
    try{
      const raw = localStorage.getItem(draftKey(oldId));
      localStorage.removeItem(draftKey(oldId));
      if (raw) localStorage.setItem(draftKey(newId), raw);
    }catch(e){}
    app.drafts.delete(oldId);
    if (hadDraft) app.drafts.set(newId, st);
  }

  // 3. Update the fingerprint baseline under the new id.
  baseFingerprint[newId] = baseFingerprint[oldId];
  delete baseFingerprint[oldId];

  // 4. Rebuild the sidebar (row now shows the new id) and re-select.
  buildSidebar(app.macros);
  updateDirtyDots();
  selectMacro(newId);
  saveActive(newId);

  // 5. If the old macro existed on disk, rename the file too.
  const wasOnDisk = baseFingerprint[newId] !== undefined;
  if (wasOnDisk){
    let res;
    try{
      res = await fetch('/petal-panic/macro-editor/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old: oldId, new: newId }),
      });
    }catch(e){
      confirmDialog('Rename on disk failed: ' + e.message + '\n(The in-editor name changed; the file keeps its old name until you Save.)', null, { title:'⚠ Partial Rename' });
      showToast('Disk rename failed', 'error');
      return;
    }
    if (!res.ok){
      let msg = res.status + ' ' + res.statusText;
      try{ const b = await res.json(); if (b.error) msg = b.error; }catch(_){}
      confirmDialog('Rename on disk failed: ' + msg, null, { title:'⚠ Rename Failed' });
      showToast('Disk rename failed', 'error');
      return;
    }
    // Refresh the fingerprint to the server's write format.
    baseFingerprint[newId] = JSON.stringify({ ...st }, null, 2) + '\n';
    showToast(`Renamed ${oldId} → ${newId} (file renamed on disk)`, 'success');
  } else {
    showToast(`Renamed ${oldId} → ${newId}`, 'success');
  }
}

/**
 * Duplicate the current macro: clone its working copy under a new id
 * (base_2, base_3, ...), keep both on disk if the original was saved.
 * Selects the copy so the user can immediately rename/edit it.
 */
export async function duplicateCurrentMacro(){
  if (!app.cur) return;
  const src = app.cur;
  const newId = nextFreeId(src.id);
  const st = JSON.parse(JSON.stringify(src.st));
  st.id = newId;
  st.name = newId;
  invalidateStaleClearance(st);

  // In-memory canonical entry + draft (so unsaved edits of the source carry over).
  app.macros[newId] = JSON.parse(JSON.stringify(st));
  app.drafts.set(newId, st);
  baseFingerprint[newId] = baseFingerprint[src.id]; // same baseline → not dirty

  buildSidebar(app.macros);
  updateDirtyDots();
  selectMacro(newId);

  // If the source is on disk, write the copy there too (same PUT contract as saveToDisk).
  if (baseFingerprint[src.id] !== undefined){
    try{
      const res = await fetch('/petal-panic/macro-editor/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newId, data: st }),
      });
      if (!res.ok){
        let msg = res.status + ' ' + res.statusText;
        try{ const b = await res.json(); if (b.error) msg = b.error; }catch(_){}
        showToast(`Duplicated in editor; disk save failed (${msg}) — press Ctrl+S`, 'error');
        return;
      }
      baseFingerprint[newId] = JSON.stringify({ ...st }, null, 2) + '\n';
      showToast(`Duplicated ${src.id} → ${newId}`, 'success');
    }catch(e){
      showToast(`Duplicated in editor; disk save failed — press Ctrl+S`, 'error');
    }
  } else {
    showToast(`Duplicated ${src.id} → ${newId} (unsaved — Ctrl+S to write)`, 'success');
  }
}

/**
 * Delete the current macro: remove its localStorage draft AND its file on disk
 * (after confirmation). Then select a remaining macro.
 */
export async function deleteCurrentMacro(){
  if (!app.cur) return;
  const id = app.cur.id;
  const ok = await confirmDialog(
    `Delete macro "${id}"? This removes its unsaved draft and its file on disk. This cannot be undone.`,
    null, { title:'🗑 Delete Macro', yesLabel:'Delete' });
  if (!ok) return;

  // Remove local draft + in-memory entries.
  clearDraft(id);
  app.drafts.delete(id);
  delete app.macros[id];
  delete baseFingerprint[id];

  // Remove the file on disk (no-op client-side if it was never saved).
  let res;
  try{
    res = await fetch('/petal-panic/macro-editor/', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: id }),
    });
  }catch(e){
    // Network error: still drop it from the editor session.
  }
  if (res && !res.ok && res.status !== 404){
    let msg = res.status + ' ' + res.statusText;
    try{ const b = await res.json(); if (b.error) msg = b.error; }catch(_){}
    confirmDialog(`Removed "${id}" from the editor, but deleting the file on disk failed: ${msg}`, null, { title:'⚠ Partial Delete' });
  }

  buildSidebar(app.macros);
  updateDirtyDots();
  // Select a remaining macro (first available) so the canvas isn't empty.
  const nextId = app.flatList.length ? app.flatList[0].id : null;
  if (nextId) selectMacro(nextId);
  else { app.cur = null; draw(); }
  showToast(`Deleted ${id}`, 'success');
}
