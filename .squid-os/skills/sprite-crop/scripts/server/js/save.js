// ---------- localStorage persistence ----------
import { app, FILM } from './state.js';
import { $ } from './viewport.js';
import { setPlaying } from './playback.js';
import { syncToggles } from './tools.js';

const bgSwatch = document.getElementById('bgSwatch');
const bgHex = document.getElementById('bgHex');

export const LS_KEY = 'sprite-editor-state-v1-' + app.project;
const LS_KEY_OLD = 'sprite-editor-state-v1';   // pre-per-project key (one-time migration)

// Serialize everything worth persisting: per-entity editor state + global view.
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
  return { v:1, entities, view:{ show:app.show, isPlaying:app.isPlaying, bgColor:app.bgColor, filmOpen: FILM.on }, active: app.cur ? app.cur.name : null };
}

export function saveState(){
  if (app._loadingState) return;   // don't overwrite saved data mid-restore
  try{
    const state = collectState();
    // Never write an empty blob over existing saved data — that clobbers real state.
    if (Object.keys(state.entities).length === 0) return;
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    const el = document.getElementById('saveIndicator');
    if (el){ el.textContent='✓'; el.style.opacity='1'; setTimeout(()=>el.style.opacity='0', 500); }
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
  // NOTE: do NOT reset _loadingState here — the init sequence owns that flag
  // and keeps it on until selectEntity()'s async load fully completes.
}

// apply restored view to the UI (called once at init)
export function applySavedView(){
  $('bgval').textContent = app.bgColor; bgSwatch.style.background = app.bgColor; bgHex.value = app.bgColor;
  setPlaying(app.isPlaying);
  syncToggles();
}
