// ---------- timing table (per-frame duration units) ----------
import { app } from './state.js';
import { $ } from './viewport.js';
import { curFrameIdx } from './geometry.js';
import { pushUndo } from './undo.js';
import { saveState } from './save.js';
import { confirmDialog } from './dialog.js';

export function baseUnitMs(){ return 1000 / (app.cur && app.cur.st ? app.cur.st.speed : 8); }

export function buildTimingTable(){
  if (!app.cur || !app.cur.st) return;
  const st = app.cur.st, tbl = $('timingTable');
  tbl.innerHTML = '';
  let totalUnits = 0;
  const curFi = curFrameIdx();
  st.frames.forEach((f, i) => {
    const units = f.durUnits || 1;
    totalUnits += units;
    const row = document.createElement('div');
    row.className = 'trow' + (units > 1 ? ' custom' : '') + (i === curFi ? ' current' : '');
    // thumbnail
    const thumb = document.createElement('div'); thumb.className = 'tthumb';
    const tc = document.createElement('canvas'); tc.width = 28; tc.height = 28;
    const im = app.cur.imgs[i];
    if (im){
      const tctx = tc.getContext('2d');
      tctx.imageSmoothingEnabled = false;
      const scale = Math.min(28/im.naturalWidth, 28/im.naturalHeight);
      const dw = Math.round(im.naturalWidth*scale), dh = Math.round(im.naturalHeight*scale);
      tctx.drawImage(im, (28-dw)/2, (28-dh)/2, dw, dh);
    }
    thumb.appendChild(tc);
    // slider
    const sl = document.createElement('input');
    sl.type = 'range'; sl.className = 'tslider';
    sl.min = '1'; sl.max = '10'; sl.step = '1'; sl.value = String(units);
    let _slUndoPushed = false;
    sl.addEventListener('input', () => {
      if (!_slUndoPushed){ pushUndo(); _slUndoPushed = true; }
      const v = Math.max(1, parseInt(sl.value, 10));
      f.durUnits = v;
      row.classList.toggle('custom', v > 1);
      multEl.textContent = '\u00D7' + v;
      durEl.textContent = Math.round(baseUnitMs() * v) + 'ms';
      updateTimingTotal();
      saveState();
    });
    sl.addEventListener('change', () => { sl.blur(); _slUndoPushed = false; });   // release focus so shortcuts work
    sl.addEventListener('dblclick', () => {
      pushUndo();
      f.durUnits = 1; sl.value = '1';
      row.classList.remove('custom');
      multEl.textContent = '\u00D71';
      durEl.textContent = Math.round(baseUnitMs()) + 'ms';
      updateTimingTotal(); saveState();
    });
    // multiplier + duration labels
    const multEl = document.createElement('span'); multEl.className = 'tmult'; multEl.textContent = '\u00D7' + units;
    const durEl = document.createElement('span'); durEl.className = 'tdur'; durEl.textContent = Math.round(baseUnitMs() * units) + 'ms';
    row.appendChild(thumb); row.appendChild(sl); row.appendChild(multEl); row.appendChild(durEl);
    tbl.appendChild(row);
  });
  updateTimingTotal();
}

export function updateTimingTotal(){
  if (!app.cur || !app.cur.st) return;
  const st = app.cur.st;
  const totalUnits = st.frames.reduce((s, f) => s + (f.durUnits || 1), 0);
  const totalMs = Math.round(totalUnits * baseUnitMs());
  $('timingTotal').textContent = totalMs + 'ms (' + totalUnits + ' units @ ' + st.speed + 'fps)';
}

// playback mode buttons
export function initTimingControls(){
  $('pbLoop').addEventListener('click', () => {
    if (!app.cur || !app.cur.st) return;
    app.cur.st.playback = 'loop'; syncPlaybackButtons(); saveState();
  });
  $('pbOnce').addEventListener('click', () => {
    if (!app.cur || !app.cur.st) return;
    app.cur.st.playback = 'once'; syncPlaybackButtons(); saveState();
  });
  // reset all timing
  $('timingResetBtn').addEventListener('click', () => {
    if (!app.cur || !app.cur.st) return;
    const n = app.cur.st.frames.length;
    confirmDialog('Reset per-frame timing for all ' + n + ' frames?', () => {
      pushUndo();
      app.cur.st.frames.forEach(f => { f.durUnits = 1; });
      buildTimingTable(); saveState();
    });
  });
}

// sync playback buttons in syncPanel
export function syncPlaybackButtons(){
  if (!app.cur || !app.cur.st) return;
  const val = app.cur.st.playback || 'loop';
  $('pbLoop').classList.toggle('on', val === 'loop');
  $('pbOnce').classList.toggle('on', val === 'once');
}
