// ---------- markers panel (dynamic list) ----------
import { app, COL_MARKER } from './state.js';
import { $ } from './viewport.js';
import { editingLocked } from './geometry.js';
import { draw } from './draw.js';
import { commit } from './commit.js';
import { saveState } from './save.js';
import { syncToggles } from './tools.js';

export function nextMarkerLabel(markers){
  if (!markers.length) return 'AI Trigger';
  const labels = new Set(markers.map(m => m.label));
  if (!labels.has('AI Trigger')) return 'AI Trigger';
  let n = 2;
  while (labels.has('AI Trigger_' + n)) n++;
  return 'AI Trigger_' + n;
}

export function nextMarkerPosition(st){
  const markers = st.markers;
  if (markers.length === 0){
    return { x: st.pivot.x, y: st.pivot.y };
  }
  const last = markers[markers.length - 1];
  return { x: last.x + 20, y: last.y - 20 };
}

export function addMarker(){
  if (!app.cur || !app.cur.st || editingLocked()) return;
  const pos = nextMarkerPosition(app.cur.st);
  const label = nextMarkerLabel(app.cur.st.markers);
  // inherit radius settings from last marker (or default 400/on for first)
  const markers = app.cur.st.markers;
  const last = markers.length > 0 ? markers[markers.length - 1] : null;
  const radiusOn = last ? last.radiusOn : true;
  const radius = (last && last.radius > 0) ? last.radius : 400;
  commit(() => {
    app.cur.st.markers.push({ label, x:pos.x, y:pos.y, radiusOn, radius });
  });
  app._selectedBox = 'marker_' + (app.cur.st.markers.length - 1);
  app.show.markerView = true;
  syncToggles(); buildMarkerList(); draw();
}

export function deleteMarker(idx){
  if (!app.cur || !app.cur.st || editingLocked()) return;
  commit(() => {
    app.cur.st.markers.splice(idx, 1);
  });
  app._panelHighlight = null;
  buildMarkerList(); draw();
}

export function buildMarkerList(){
  if (!app.cur || !app.cur.st) return;
  const st = app.cur.st;
  const markers = st.markers || [];
  const list = $('markerList');
  list.innerHTML = '';
  markers.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'mb-row';
    row.dataset.idx = i;
    // line 1: dot + label + radius toggle + delete
    const l1 = document.createElement('div'); l1.className = 'mb-row-line1';
    const dot = document.createElement('span');
    dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:'+COL_MARKER+';flex:none;display:inline-block;margin-right:4px;';
    const lbl = document.createElement('input');
    lbl.type = 'text'; lbl.className = 'mb-label'; lbl.value = m.label;
    lbl.addEventListener('focus', () => { app._panelHighlight = 'marker_'+i; draw(); });
    lbl.addEventListener('blur', () => {
      app._panelHighlight = null; draw();
      const newLabel = lbl.value.trim();
      if (!newLabel){ lbl.value = m.label; return; }
      const dup = markers.some((om, oi) => oi !== i && om.label === newLabel);
      if (dup){ lbl.classList.add('dup'); setTimeout(()=>lbl.classList.remove('dup'), 800); lbl.value = m.label; return; }
      if (newLabel !== m.label){ commit(() => { m.label = newLabel; }); }
    });
    const radBtn = document.createElement('button');
    radBtn.className = 'tbtn tsm'; radBtn.style.padding='2px 6px'; radBtn.style.fontSize='10px';
    radBtn.textContent = m.radiusOn ? '\u25CF R' : '\u25CB R';
    radBtn.title = 'toggle radius';
    radBtn.addEventListener('click', () => {
      commit(() => {
        m.radiusOn = !m.radiusOn;
        if (m.radiusOn && m.radius === 0) m.radius = 30;
      });
      buildMarkerList(); draw();
    });
    const del = document.createElement('button');
    del.className = 'mb-del'; del.textContent = '\u00D7'; del.title = 'delete marker';
    del.addEventListener('click', () => deleteMarker(i));
    l1.appendChild(dot); l1.appendChild(lbl); l1.appendChild(radBtn); l1.appendChild(del);
    // line 2: X Y R
    const l2 = document.createElement('div'); l2.className = 'mb-row-line2';
    ['x','y'].forEach(axis => {
      const cell = document.createElement('div'); cell.className = 'cell';
      const bb = document.createElement('b'); bb.textContent = axis.toUpperCase();
      const inp = document.createElement('input');
      inp.type = 'number'; inp.value = m[axis];
      inp.addEventListener('focus', () => { app._panelHighlight = 'marker_'+i; draw(); });
      inp.addEventListener('blur', () => { app._panelHighlight = null; draw(); });
      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        if (isNaN(v) || !app.cur || !app.cur.st || editingLocked()) return;
        commit(() => { m[axis] = v; });
      });
      cell.appendChild(bb); cell.appendChild(inp);
      l2.appendChild(cell);
    });
    // R input
    const rCell = document.createElement('div'); rCell.className = 'cell';
    const rb = document.createElement('b'); rb.textContent = 'R';
    const rInp = document.createElement('input');
    rInp.type = 'number'; rInp.value = m.radius; rInp.min = '1';
    rInp.disabled = !m.radiusOn;
    if (!m.radiusOn) rInp.classList.add('disabled-dim');
    rInp.addEventListener('focus', () => { app._panelHighlight = 'marker_'+i; draw(); });
    rInp.addEventListener('blur', () => { app._panelHighlight = null; draw(); });
    rInp.addEventListener('change', () => {
      const v = parseFloat(rInp.value);
      if (isNaN(v) || !app.cur || !app.cur.st || editingLocked()) return;
      commit(() => { m.radius = Math.max(1, v); });
    });
    rCell.appendChild(rb); rCell.appendChild(rInp);
    l2.appendChild(rCell);
    // whole-row hover
    row.addEventListener('mouseenter', () => { app._panelHighlight = 'marker_'+i; draw(); });
    row.addEventListener('mouseleave', () => { if (app._panelHighlight==='marker_'+i){ app._panelHighlight = null; draw(); } });
    row.appendChild(l1); row.appendChild(l2);
    list.appendChild(row);
  });
}

export function initMarkerControls(){
  $('addMarkerBtn').addEventListener('click', addMarker);
  $('addMarkerToolbar').addEventListener('click', addMarker);
  $('tglMarkerView').addEventListener('click', ()=>{
    app.show.markerView = !app.show.markerView; cancelHideMode(); syncToggles(); draw(); saveState();
  });
}

// If the user manually toggles any overlay while ctrl+H "hide mode" is active,
// cancel hide mode: drop the snapshot so a later ctrl+H starts fresh from the
// current (manually-adjusted) states instead of restoring the old pre-hide ones.
// The clicked button's own input is still applied normally.
export function cancelHideMode(){ if (window._hideSnapshot){ window._hideSnapshot = null; } }
