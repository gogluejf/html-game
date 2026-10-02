// ---------- draft / save (macro editor) ----------
// Same model as the sprite editor, simplified for whole-macro objects:
//   - DRAFT (localStorage): auto-saved on every change. Per-macro key.
//   - DIRTY DOT: shown when a draft exists for that macro (draft != canonical).
//     No separate dirty flag — presence of the draft IS the dirty state.
//   - SAVE: PUT the draft to petal-panic/macros/levels/<id>.json via server.
//     On success, clear the draft + dot.

import { app } from './state.js';
import { $ } from './viewport.js';
import { confirmDialog } from './dialog.js';
import { showToast } from './toast.js';

const LS_PREFIX = 'macro-editor-draft-v1-';
export const draftKey = id => LS_PREFIX + id;
// Fingerprint of the canonical file as loaded (for external-change detection).
// Keyed by macro id. Compared against disk-at-save-time, NOT against the draft
// (the draft is *supposed* to differ from disk when dirty).
const baseFingerprint = {};   // id -> JSON string of canonical at load

function hasDraft(id){ try { return !!localStorage.getItem(draftKey(id)); } catch(e){ return false; } }
function storeDraft(id, data){ try { localStorage.setItem(draftKey(id), JSON.stringify(data)); } catch(e){} }
function clearDraft(id){ try { localStorage.removeItem(draftKey(id)); } catch(e){} }

// Called whenever the current macro's working copy mutates. Writes the draft
// and refreshes the dot + save button. This is the ONLY thing that marks dirty.
export function markChanged(){
  if (!app.cur) return;
  storeDraft(app.cur.id, app.cur.st);
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
    if (hasDraft(f.id)){
      if (!dot){ dot = document.createElement('span'); dot.className='dirty-dot'; dot.textContent='●'; el.insertBefore(dot, el.querySelector('.cnt')); }
    } else if (dot){ dot.remove(); }
  }
}

// Explicit save: push the current draft to disk.
export async function saveToDisk(){
  if (!app.cur) return;
  const id = app.cur.id;
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
