// ---------- draft/sync persistence ----------
// Two-tier model:
//   1. DRAFT (localStorage): auto-saved on every edit. Draft game data + config
//      (view, active entity, checksums). Protects work across reloads.
//   2. DISK (server PUT): explicit save (Ctrl+S / button). Pushes tuning fields
//      into the sheet JSON with a checksum guard against external edits.

import { app, FILM } from './state.js';
import { $ } from './viewport.js';
import { setPlaying } from './playback.js';
import { syncToggles } from './tools.js';
import { confirmDialog } from './dialog.js';
import { showToast } from './toast.js';

const bgSwatch = document.getElementById('bgSwatch');
const bgHex = document.getElementById('bgHex');

export const LS_KEY = 'sprite-editor-state-v1-' + app.project;
const LS_KEY_OLD = 'sprite-editor-state-v1';   // pre-per-project key (one-time migration)

// ---------- checksum utility ----------
// Canonical JSON: sorted keys, no whitespace → SHA-256 → first 16 hex chars.
// NOTE: shallow sort only — nested objects keep their original key order.
// Deterministic for a given object shape, which is all we need for change detection.
export async function computeEntityChecksum(entityObj){
  const canonical = JSON.stringify(entityObj, Object.keys(entityObj).sort());
  const data = new TextEncoder().encode(canonical);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- game data collection (what goes to the sheet JSON) ----------
// Extract ONLY the tuning/game fields from an entity's editor state.
export function collectGameData(st){
  return {
    speed: st.speed,
    playback: st.playback || 'loop',
    collision: st.collision,
    pivot: st.pivot,
    markers: st.markers || [],
    frames: st.frames.map(f => ({
      offset: f.offset,
      scale: f.scale,
      boxes: f.boxes || [],
      durUnits: f.durUnits || 1
    }))
  };
}

// ---------- config collection (stays in localStorage only) ----------
export function collectConfig(){
  return {
    v: 1,
    view: { show: app.show, isPlaying: app.isPlaying, bgColor: app.bgColor, filmOpen: FILM.on },
    active: app.cur ? app.cur.name : null,
    checksums: app.checksums   // plain object { "char_anim": "hex16" }
  };
}

// ---------- per-entity game data in localStorage ----------
// Game data for an entity lives under its own LS key. The SAVE button is
// enabled iff that key exists. A successful saveToDisk() deletes it.
function gameDataKey(entityKey){ return 'sprite-editor-game-v1-' + app.project + '-' + entityKey; }

function hasGameData(entityKey){
  try { return !!localStorage.getItem(gameDataKey(entityKey)); } catch(e){ return false; }
}

function storeGameData(entityKey, data){
  try { localStorage.setItem(gameDataKey(entityKey), JSON.stringify(data)); } catch(e){}
}

export function clearGameData(entityKey){
  try { localStorage.removeItem(gameDataKey(entityKey)); } catch(e){}
}

// Clear tuning for current entity: local draft + disk. Called by Reset.
export async function clearTuning(){
  if (!app.cur || !app.flatList[app.flatIdx]) return;
  const en = app.manifest.labels[app.flatList[app.flatIdx].li].entities[app.flatList[app.flatIdx].ei];
  const key = `${en.char}_${en.anim}`;
  // Clear local draft
  clearGameData(key);
  // Clear from disk via server (calls record_tuning.py clear)
  try {
    await fetch('/sprite-sheets/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet: en.sheetPath, name: en.char, anim: en.anim, clear: true })
    });
  } catch(e) { /* server might be down — local clear still worked */ }
  updateSaveButton();
  updateDirtyDots();
}

// ---------- game data change (explicit) ----------
// Called ONLY from code paths that mutate actual game data (collision, hit boxes,
// markers, offset, scale, speed, playback mode, durUnits, pivot). This is what
// enables the SAVE button and lights the dirty dots — NOT saveState(), which is
// config-only (view/active/checksums). Keeps view toggles / play-pause / bg color
// from falsely flagging an entity as "has unsaved game data".
export function markGameDataChanged(){
  if (!app.cur || !app.cur.st || !app.flatList[app.flatIdx]) return;
  const en = app.manifest.labels[app.flatList[app.flatIdx].li].entities[app.flatList[app.flatIdx].ei];
  const key = `${en.char}_${en.anim}`;
  storeGameData(key, collectGameData(app.cur.st));
  updateSaveButton();
  updateDirtyDots();
  // Flash the subtle draft indicator ("✓" = your draft is safe in localStorage)
  const el = document.getElementById('saveIndicator');
  if (el){ el.style.opacity='1'; clearTimeout(el._t); el._t = setTimeout(()=>el.style.opacity='0', 600); }
}

// Enable/disable the SAVE button based on whether the CURRENT entity has
// unsaved game data in localStorage. Called after every entity selection and
// after draft saves / disk saves so the button always reflects reality.
export function updateSaveButton(){
  const btn = document.getElementById('saveBtn');
  if (!btn || !app.cur || !app.flatList[app.flatIdx]) return;
  const en = app.manifest.labels[app.flatList[app.flatIdx].li].entities[app.flatList[app.flatIdx].ei];
  const key = `${en.char}_${en.anim}`;
  const has = hasGameData(key);
  btn.disabled = !has;
  btn.classList.toggle('active', has);
}

// Show/hide the .dirty-dot indicator on each sidebar row.
export function updateDirtyDots(){
  app.flatList.forEach(({li, ei}) => {
    const en = app.manifest.labels[li].entities[ei];
    const key = `${en.char}_${en.anim}`;
    const el = en._el;
    if (!el) return;
    let dot = el.querySelector('.dirty-dot');
    if (hasGameData(key)) {
      if (!dot) { dot = document.createElement('span'); dot.className='dirty-dot'; dot.textContent='●'; el.insertBefore(dot, el.querySelector('.cnt')); }
    } else {
      if (dot) dot.remove();
    }
  });
}

// ---------- save to disk (explicit: Ctrl+S / button) ----------
export async function saveToDisk(){
  if (!app.cur || !app.cur.st) return;
  const q = app.flatList[app.flatIdx];
  if (!q) return;
  const en = app.manifest.labels[q.li].entities[q.ei];
  const entityKey = `${en.char}_${en.anim}`;
  if (!en.sheetPath){
    confirmDialog('This entity has no sheet file path — cannot save to disk.', null);
    return;
  }

  // 1. Fetch current sheet JSON from server (needed for checksum comparison).
  let sheetData;
  try{
    const res = await fetch('/' + en.sheetPath);
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    sheetData = await res.json();
  }catch(e){
    confirmDialog('Failed to fetch sheet for validation: ' + e.message, null);
    showToast('Save failed: could not fetch sheet', 'error');
    return;
  }

  // 2. Find the entity in the fresh JSON.
  const freshEntity = (sheetData.entities || []).find(e => e.name === en.char && e.anim === en.anim);
  if (!freshEntity){
    confirmDialog('Entity not found in sheet file.', null);
    return;
  }

  // 3. Checksum guard: was the sheet edited outside the editor?
  const freshChecksum = await computeEntityChecksum(freshEntity);
  const storedChecksum = app.checksums[entityKey];
  if (storedChecksum && freshChecksum !== storedChecksum){
    const ok = await confirmDialog('Sprite was modified outside the editor. Overwrite?', () => {}, { title: '⚠ External Change', yesLabel: 'Overwrite' });
    if (!ok) return;
  }

  // 4. PUT a small targeted payload — the server delegates to record_tuning.py.
  const gameData = collectGameData(app.cur.st);
  let putRes;
  try{
    putRes = await fetch('/sprite-sheets/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet: en.sheetPath, name: en.char, anim: en.anim, data: gameData })
    });
  }catch(e){
    confirmDialog('Save failed: ' + e.message, null);
    showToast('Save failed: ' + e.message, 'error');
    return;
  }
  if (!putRes.ok){
    let errMsg = putRes.status + ' ' + putRes.statusText;
    try{
      const errBody = await putRes.json();
      if (errBody.error) errMsg = errBody.error;
    }catch(_){}
    confirmDialog('Save failed: ' + errMsg, null);
    showToast('Save failed: ' + errMsg, 'error');
    return;
  }

  // 5. Recompute checksum post-save, clear local game data, persist config.
  app.checksums[entityKey] = await computeEntityChecksum(freshEntity);
  clearGameData(entityKey);   // disk now matches editor — drop the draft
  saveConfig();
  updateSaveButton();
  updateDirtyDots();

  // Brief visual confirmation on the SAVE button itself (green flash ~1s).
  const btn = document.getElementById('saveBtn');
  if (btn){
    btn.classList.add('saved-flash');
    setTimeout(() => btn.classList.remove('saved-flash'), 1000);
  }
  showToast(`Saved ${en.char}/${en.anim} → ${en.sheetPath.split('/').pop()}`, 'success');
}

// ---------- localStorage draft: full state (game data + config) ----------
// Auto-saved on every edit. Never touches the server.
export function collectState(){
  const entities = {};
  for (const [name, st] of app.S){
    entities[name] = {
      speed: st.speed, playing: st.playing, frameIdx: st.frameIdx,
      playback: st.playback || 'loop',
      collision: st.collision, pivot: st.pivot, markers: st.markers||[], rot: st.rot,
      frames: st.frames.map(f => ({ idx:f.idx, name:f.name, crop:f.crop, offset:f.offset, scale:f.scale, boxes:f.boxes||[], durUnits:f.durUnits||1 }))
    };
  }
  return { v:1, entities, ...collectConfig() };
}

export function saveState(){
  if (app._loadingState) return;   // don't overwrite saved data mid-restore
  try{
    const state = collectState();
    // Never write an empty blob over existing saved data — that clobbers real state.
    if (Object.keys(state.entities).length === 0) return;
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    // NOTE: this is CONFIG-only (view/active/checksums + full draft snapshot for
    // reload recovery). It deliberately does NOT touch per-entity game data or the
    // SAVE button / dirty dots — those are driven by markGameDataChanged() so that
    // view toggles, play/pause, bg color, frame stepping, etc. don't flag a false
    // "unsaved changes" state.
  }catch(e){ /* quota / private mode */ }
}

export function loadState(){
  // one-time migration: if no per-project key exists but old shared key does, adopt it
  try{
    if (!localStorage.getItem(LS_KEY)){
      const old = localStorage.getItem(LS_KEY_OLD);
      if (old){
        localStorage.setItem(LS_KEY, old);
        localStorage.removeItem(LS_KEY_OLD);
      }
    }
  }catch(e){}
  let raw; try{ raw = localStorage.getItem(LS_KEY); }catch(e){ return; }
  if (!raw) return;
  let data; try{ data = JSON.parse(raw); }catch(e){ return; }
  if (!data || data.v !== 1) return;
  app._loadingState = true;   // suppress saves while restoring

  // --- Migrate renamed entity keys ---
  // When an entity is renamed in state.json (e.g. special → supermove), the old
  // localStorage key won't match the new manifest name. We detect stale keys by
  // checking if any manifest entity's frames match the saved frames after a
  // simple rename substitution. If matched, adopt under the new key.
  const manifestNames = new Set();
  app.manifest.labels.forEach(lbl => lbl.entities.forEach(en => manifestNames.add(en.name)));

  const migrated = {};
  for (const [name, saved] of Object.entries(data.entities||{})){
    if (manifestNames.has(name)) {
      migrated[name] = saved;
    } else if (saved && Array.isArray(saved.frames) && saved.frames.length > 0) {
      // Stale key — try to find which manifest entity this belongs to by
      // substituting known renames in the frame filenames and checking if
      // any resulting name exists in the manifest's frame lists.
      const RENAME_MAP = [['_special_', '_supermove_']];
      let adopted = false;
      outer: for (const lbl of app.manifest.labels){
        for (const en of lbl.entities){
          if (migrated[en.name]) continue;
          const manifestFiles = new Set((en.frames||[]).map(f => f.file.split('/').pop()));
          for (const f of saved.frames){
            const base = (f.name||'').split('/').pop();
            for (const [from, to] of RENAME_MAP){
              const renamed = base.replace(from, to);
              if (manifestFiles.has(renamed)){
                // Adopt: store under the new manifest name, rename frames
                const copy = JSON.parse(JSON.stringify(saved));
                copy.frames.forEach(fr => {
                  if (fr.name) fr.name = fr.name.replace(from, to);
                  if (fr.crop && fr.crop.file) fr.crop.file = fr.crop.file.replace(from, to);
                });
                migrated[en.name] = copy;
                console.log(`[migration] "${name}" → "${en.name}"`);
                adopted = true;
                break outer;
              }
            }
          }
        }
      }
      if (!adopted) migrated[name] = saved; // truly orphaned — keep as-is
    } else {
      migrated[name] = saved;
    }
  }
  data.entities = migrated;
  if (data.active && !manifestNames.has(data.active)){
    // Fix active pointer with same rename logic
    for (const [from, to] of [['_special', '_supermove']]){
      if (data.active.includes(from)) { data.active = data.active.replace(from, to); break; }
    }
  }
  localStorage.setItem(LS_KEY, JSON.stringify(data));

  // restore per-entity state
  for (const [name, saved] of Object.entries(data.entities)){
    if (saved && Array.isArray(saved.frames)) app.S.set(name, saved);
  }
  // migrate new fields: playback + durUnits + boxes (additive, backward-compatible)
  for (const [, st] of app.S){
    if (!st.playback) st.playback = 'loop';
    if (!st.markers) st.markers = [];
    for (const f of st.frames){
      if (f.durUnits === undefined || f.durUnits < 1) f.durUnits = 1;
      // melee → boxes migration
      if (f.melee && !f.boxes){
        f.boxes = f.melee.on
          ? [{ label: "attack", x: f.melee.x, y: f.melee.y, w: f.melee.w, h: f.melee.h }]
          : [];
        delete f.melee;
      }
      if (!f.boxes) f.boxes = [];
    }
  }
  // restore global view
  if (data.view){
    if (data.view.show) Object.assign(app.show, data.view.show);
    if (typeof data.view.isPlaying === 'boolean') app.isPlaying = data.view.isPlaying;
    if (typeof data.view.bgColor === 'string') app.bgColor = data.view.bgColor;
    if (typeof data.view.filmOpen === 'boolean') FILM.on = data.view.filmOpen;
  }
  // normalize allFrames: it must be a real boolean (a stale/corrupt save could
  // leave it undefined or non-bool, which breaks the ghost view + button state).
  app.show.allFrames = !!app.show.allFrames;
  document.documentElement.style.setProperty('--film-bg', app.bgColor);
  // restore checksums (plain object)
  if (data.checksums && typeof data.checksums === 'object'){
    app.checksums = data.checksums;
  }
  // Reflect what's in localStorage: which entities have unsaved game data.
  updateDirtyDots();
  updateSaveButton();
  // NOTE: do NOT reset _loadingState here — the init sequence owns that flag
  // and keeps it on until selectEntity()'s async load fully completes.
}

// Save just the config portion (view, checksums, active) to localStorage.
// Called after a successful saveToDisk() so the fresh checksum persists.
export function saveConfig(){
  if (app._loadingState) return;
  try{
    let data;
    try{ data = JSON.parse(localStorage.getItem(LS_KEY)); }catch(e){ data = null; }
    if (!data || data.v !== 1) return;
    const cfg = collectConfig();
    data.view = cfg.view;
    data.active = cfg.active;
    data.checksums = cfg.checksums;
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }catch(e){ /* quota / private mode */ }
}

// apply restored view to the UI (called once at init)
export function applySavedView(){
  $('bgval').textContent = app.bgColor; bgSwatch.style.background = app.bgColor; bgHex.value = app.bgColor;
  setPlaying(app.isPlaying);
  syncToggles();
}
