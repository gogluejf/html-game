// ---------- melee boxes panel (dynamic list) ----------
import { app } from './state.js';
import { $ } from './viewport.js';
import { curFrameIdx, editingLocked } from './geometry.js';
import { draw } from './draw.js';
import { pushUndo } from './undo.js';
import { saveState } from './save.js';
import { syncToggles } from './tools.js';

export function nextBoxLabel(boxes){
  if (!boxes.length) return 'attack';
  const labels = new Set(boxes.map(b => b.label));
  if (!labels.has('attack')) return 'attack';
  let n = 2;
  while (labels.has('attack_' + n)) n++;
  return 'attack_' + n;
}

export function nextBoxPosition(st, fi){
  const boxes = st.frames[fi].boxes;
  if (boxes.length === 0){
    const c = st.collision;
    const w = Math.max(1, Math.round(c.w * 0.25));
    const h = c.h;
    return { x: c.x + c.w + 3, y: c.y, w, h };
  }
  const last = boxes[boxes.length - 1];
  return { x: last.x + 20, y: last.y - 20, w: last.w, h: last.h };
}

export function addMeleeBox(){
  if (!app.cur || !app.cur.st || editingLocked()) return;
  pushUndo();
  const fi = curFrameIdx();
  const pos = nextBoxPosition(app.cur.st, fi);
  const label = nextBoxLabel(app.cur.st.frames[fi].boxes);
  app.cur.st.frames[fi].boxes.push({ label, ...pos });
  app._selectedBox = 'box_' + (app.cur.st.frames[fi].boxes.length - 1);
  app.show.meleeView = true;
  syncToggles(); buildMeleeBoxList(); draw(); saveState();
}

export function deleteMeleeBox(idx){
  if (!app.cur || !app.cur.st || editingLocked()) return;
  pushUndo();
  app.cur.st.frames[curFrameIdx()].boxes.splice(idx, 1);
  app._panelHighlight = null;
  buildMeleeBoxList(); draw(); saveState();
}

export function buildMeleeBoxList(){
  if (!app.cur || !app.cur.st) return;
  const st = app.cur.st, fi = curFrameIdx();
  const boxes = st.frames[fi].boxes || [];
  const list = $('meleeBoxList');
  list.innerHTML = '';
  boxes.forEach((b, i) => {
    const row = document.createElement('div');
    row.className = 'mb-row';
    row.dataset.idx = i;
    // line 1: label + delete
    const l1 = document.createElement('div'); l1.className = 'mb-row-line1';
    const lbl = document.createElement('input');
    lbl.type = 'text'; lbl.className = 'mb-label'; lbl.value = b.label;
    lbl.addEventListener('focus', () => { app._panelHighlight = 'box_'+i; draw(); });
    lbl.addEventListener('blur', () => {
      app._panelHighlight = null; draw();
      // duplicate check on blur
      const newLabel = lbl.value.trim();
      if (!newLabel){ lbl.value = b.label; return; }
      const dup = boxes.some((ob, oi) => oi !== i && ob.label === newLabel);
      if (dup){ lbl.classList.add('dup'); setTimeout(()=>lbl.classList.remove('dup'), 800); lbl.value = b.label; return; }
      if (newLabel !== b.label){ pushUndo(); b.label = newLabel; draw(); saveState(); }
    });

    const del = document.createElement('button');
    del.className = 'mb-del'; del.textContent = '\u00D7'; del.title = 'delete box';

    del.addEventListener('click', () => deleteMeleeBox(i));
    l1.appendChild(lbl); l1.appendChild(del);
    // line 2: X Y W H
    const l2 = document.createElement('div'); l2.className = 'mb-row-line2';
    ['x','y','w','h'].forEach(axis => {
      const cell = document.createElement('div'); cell.className = 'cell';
      const bb = document.createElement('b'); bb.textContent = axis.toUpperCase();
      const inp = document.createElement('input');
      inp.type = 'number'; inp.value = b[axis];
      inp.addEventListener('focus', () => { app._panelHighlight = 'box_'+i; draw(); });
      inp.addEventListener('blur', () => { app._panelHighlight = null; draw(); });

      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        if (isNaN(v) || !app.cur || !app.cur.st || editingLocked()) return;
        pushUndo();
        b[axis] = (axis==='w'||axis==='h') ? Math.max(1,v) : v;
        draw(); saveState();
      });
      cell.appendChild(bb); cell.appendChild(inp);
      l2.appendChild(cell);
    });
    // whole-row hover highlight
    row.addEventListener('mouseenter', () => { app._panelHighlight = 'box_'+i; draw(); });
    row.addEventListener('mouseleave', () => { if (app._panelHighlight==='box_'+i){ app._panelHighlight = null; draw(); } });
    row.appendChild(l1); row.appendChild(l2);
    list.appendChild(row);
  });
}

export function initMeleeControls(){
  $('addBoxBtn').addEventListener('click', addMeleeBox);
}
