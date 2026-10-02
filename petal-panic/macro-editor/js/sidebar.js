// ---------- sidebar (macro editor) ----------
// Lists all macros grouped by difficulty (1/2/3). Click = select + draw.
// Populates app.flatList in display order for keyboard up/down navigation.

import { app } from './state.js';
import { $, tree } from './viewport.js';
import { draw } from './draw.js';
import { setZoom } from './viewport.js';
import { updateDirtyDots, updateSaveButton } from './save.js';

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
      row.innerHTML = `<span>${id}${orient}</span><span class="cnt">${(m.units||[]).length}u</span>`;
      row.addEventListener('click', () => selectMacro(id));
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
    st = JSON.parse(JSON.stringify(macro));
    app.drafts.set(id, st);
  }
  app.cur = { id, macro, st };

  syncPanel();
  fitView(st);
  draw();
  updateSaveButton();
  updateDirtyDots();
  const tb = $('toolbar'); if (tb) tb.classList.remove('booting');
}

// Fit the macro's bounding box into view (respects anisotropic units).
function fitView(st){
  const ux = app.consts.unitPxX, uy = app.consts.unitPxY;
  const units = st.units || [];
  if (!units.length){ app.panX = 0; app.panY = 0; setZoom(1); return; }
  let minX=Infinity,maxX=-Infinity,minY=0,maxY=-Infinity;
  for (const u of units){
    const x = u.x ?? 0;
    const y = u.y ?? 0;
    const w = u.kind==='block' ? 1 : (u.width ?? 1);
    const h = u.kind==='block' ? (u.height ?? 1) : 1;
    minX = Math.min(minX, x*ux);
    maxX = Math.max(maxX, (x+w)*ux);
    maxY = Math.max(maxY, (y+h)*uy);
  }
  const pad = 60;
  const bw = (maxX-minX)+pad*2, bh = (maxY-minY)+pad*2;
  const z = Math.min(app.cssW/bw, app.cssH/bh);
  app.zoom = Math.max(.05, Math.min(8, z));
  // Center on bbox midpoint. From s2c: to map world (midX,midY) to canvas
  // center (cssW/2, cssH/2), pan must equal the world midpoint.
  const midX = (minX+maxX)/2, midY = (minY+maxY)/2;
  app.panX = midX;
  app.panY = midY;
  app.userZoomed = true;
  $('zoomval').textContent = Math.round(app.zoom*100)+'%';
}

function syncPanel(){
  const st = app.cur.st;
  $('p_stitle').textContent = app.cur.id;
  $('p_orient').textContent = st.orientation;
  $('p_diff').textContent = st.difficulty;
  const blocks = (st.units||[]).filter(u=>u.kind==='block').length;
  const plats = (st.units||[]).filter(u=>u.kind==='platform').length;
  $('p_blocks').textContent = blocks;
  $('p_plats').textContent = plats;
  $('p_slots').textContent = (st.placements||[]).length;
  $('p_entry').textContent = st.entryClear ?? '—';
  $('p_exit').textContent = st.exitClear ?? '—';
  $('p_cellw').textContent = app.consts.unitPxX + ' px';
  $('p_cellh').textContent = app.consts.unitPxY + ' px';
  $('p_plath').textContent = app.consts.platformDrawH + ' px';
  $('finfo').textContent = `${app.cur.id} · ${st.orientation} · diff ${st.difficulty}`;
}
