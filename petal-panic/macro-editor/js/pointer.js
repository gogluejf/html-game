// ---------- pointer editing controller ----------
// All pointer movement edits app.editor.interaction.candidate only. The macro
// draft changes once, on a valid release, through markChanged().

import { app } from './state.js';
import { cv, c2s, evPos } from './viewport.js';
import { draw, zoneExtents } from './draw.js';
import { markChanged } from './save.js';
import { validateMacroCandidate, validateDeletion } from './validation.js';
import { showToast } from './toast.js';
import { pushUndo } from './undo.js';
import { syncToolButtons } from './tools.js';

const clone = value => JSON.parse(JSON.stringify(value));
const HANDLE_PX = 9;
let lastCell = null;

function bodyOffset(){
  if (!app.cur) return 0;
  return app.cur.st.orientation === 'vertical' ? app.consts.vEntryClear : app.consts.hEntryClear;
}

export function eventCell(e){
  const [sx, sy] = evPos(e);
  const [wx, wy] = c2s(sx, sy);
  return {
    x: Math.floor(wx / app.consts.unitPxX) - bodyOffset(),
    y: Math.floor(wy / app.consts.unitPxY),
    sx, sy,
  };
}

function unitRect(u){ return { x:u.x, y:u.y, width:u.width, height:u.kind === 'block' ? u.height : 1 }; }
function contains(rect, cell){
  return cell.x >= rect.x && cell.x < rect.x + rect.width && cell.y >= rect.y && cell.y < rect.y + rect.height;
}

export function hitTest(cell){
  if (!app.cur) return null;
  const placements = app.cur.st.placements || [];
  for (let i = placements.length - 1; i >= 0; i--){
    if (placements[i].x === cell.x && placements[i].y === cell.y) return { kind:'slot', index:i };
  }
  const units = app.cur.st.units || [];
  for (let i = units.length - 1; i >= 0; i--){
    if (contains(unitRect(units[i]), cell)) return { kind:'unit', index:i };
  }
  return null;
}

function handlePoints(u){
  const r = unitRect(u), x0=r.x, x1=r.x+r.width, y0=r.y, y1=r.y+r.height;
  if (u.kind === 'platform') return [{name:'w',x:x0,y:y1},{name:'e',x:x1,y:y1}];
  return [
    {name:'sw',x:x0,y:y0},{name:'s',x:(x0+x1)/2,y:y0},{name:'se',x:x1,y:y0},
    {name:'w',x:x0,y:(y0+y1)/2},{name:'e',x:x1,y:(y0+y1)/2},
    {name:'nw',x:x0,y:y1},{name:'n',x:(x0+x1)/2,y:y1},{name:'ne',x:x1,y:y1},
  ];
}

export function hitHandle(screenX, screenY){
  const selection = app.editor.selection;
  if (!selection || selection.kind !== 'unit' || !app.cur) return null;
  const u = app.cur.st.units?.[selection.index];
  if (!u) return null;
  const ux=app.consts.unitPxX, uy=app.consts.unitPxY, off=bodyOffset();
  for (const h of handlePoints(u)){
    const wx=(h.x+off)*ux, wy=h.y*uy;
    const cx=app.cssW/2+(wx-app.panX)*app.zoom;
    const cy=app.cssH/2+(app.panY-wy)*app.zoom;
    if (Math.hypot(screenX-cx, screenY-cy) <= HANDLE_PX+3) return h.name;
  }
  return null;
}

export function uniqueSlotName(type, placements, preserve=''){
  if (preserve && !placements.some(p => p.slot === preserve)) return preserve;
  const used = new Set(placements.map(p=>p.slot));
  let n=1;
  while (used.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}

function surfaceY(unit){ return unit.kind==='block' ? unit.y+unit.height : unit.y+1; }

function attachedPlacements(unit){
  if (!app.cur || !unit) return [];
  const top=surfaceY(unit);
  return (app.cur.st.placements||[])
    .map((placement,index)=>({placement,index}))
    .filter(({placement})=>placement.y===top&&placement.x>=unit.x&&placement.x<unit.x+unit.width)
    .map(({placement,index})=>({index,original:clone(placement),candidate:clone(placement)}));
}

function moveAttachedPlacements(interaction){
  if (!interaction.attachedPlacements?.length) return;
  const moving=interaction.mode==='moving-object';
  const dx=moving ? interaction.candidate.x-interaction.original.x : 0;
  const dy=surfaceY(interaction.candidate)-surfaceY(interaction.original);
  interaction.attachedPlacements=interaction.attachedPlacements.map(item=>({
    ...item,
    candidate:{...item.original,x:item.original.x+dx,y:item.original.y+dy},
  }));
}

function candidateForCreate(mode, anchor, current){
  if (mode === 'creating-block'){
    const x=Math.min(anchor.x,current.x), y=Math.min(anchor.y,current.y);
    return { kind:'block', x, y, width:Math.abs(current.x-anchor.x)+1, height:Math.abs(current.y-anchor.y)+1 };
  }
  const x=Math.min(anchor.x,current.x);
  return { kind:'platform', x, y:anchor.y, width:Math.abs(current.x-anchor.x)+1 };
}

function resizedCandidate(original, handle, cell){
  if (original.kind === 'platform'){
    const right=original.x+original.width;
    if (handle === 'w') return { ...original, x:Math.min(cell.x,right-1), width:Math.max(1,right-cell.x) };
    return { ...original, width:Math.max(1,cell.x-original.x) };
  }
  let left=original.x, right=original.x+original.width;
  let bottom=original.y, top=original.y+original.height;
  if (handle.includes('w')) left=Math.min(cell.x,right-1);
  if (handle.includes('e')) right=Math.max(cell.x,left+1);
  if (handle.includes('s')) bottom=Math.min(cell.y,top-1);
  if (handle.includes('n')) top=Math.max(cell.y,bottom+1);
  return { ...original, x:left, y:bottom, width:right-left, height:top-bottom };
}

function movedCandidate(original, anchor, current, seed=original){
  return { ...seed, x:original.x+current.x-anchor.x, y:original.y+current.y-anchor.y };
}

export function hoverCandidateForTool(tool,cell,placements=[]){
  if (tool==='block') return {kind:'block',x:cell.x,y:cell.y,width:1,height:1};
  if (tool==='platform') return {kind:'platform',x:cell.x,y:cell.y,width:1};
  if (tool.startsWith('slot-')) {
    const type=tool.slice(5);
    return {slot:uniqueSlotName(type,placements),type,x:cell.x,y:cell.y};
  }
  return null;
}

function hoverCandidate(cell){
  return hoverCandidateForTool(app.editor.tool,cell,app.cur.st.placements||[]);
}

function cellInZone(cell){
  if (!app.cur) return false;
  const z = zoneExtents(app.cur.st);
  return cell.x >= z.ax0 && cell.x < z.ax1 && cell.y >= z.ay0 && cell.y < z.ay1;
}

function updateHoverPreview(cell,hit){
  app.editor.preview=null;
  if (!app.cur||hit||app.editor.interaction||app.editor.pan) return;
  if (!cellInZone(cell)) return;
  const candidate=hoverCandidate(cell);
  if (!candidate) return;
  const result=validateMacroCandidate(app.cur.st,candidate);
  app.editor.preview={
    mode:'hover-preview',candidate,
    valid:result.valid,
    severity:result.severity||(result.valid?'valid':'error'),
    reason:result.reason||'',
  };
}

function validateInteraction(interaction){
  const edit = interaction.targetKind
    ? {
        targetKind:interaction.targetKind,
        targetIndex:interaction.targetIndex,
        placementCandidates:(interaction.attachedPlacements||[]).map(({index,candidate})=>({index,candidate})),
      }
    : {};
  const result = validateMacroCandidate(app.cur.st, interaction.candidate, edit);
  interaction.valid=result.valid;
  interaction.severity=result.severity || (result.valid?'valid':'error');
  interaction.reason=result.reason;
  interaction.warnings=result.warnings||[];
  interaction.warningUnitIndices=result.warningUnitIndices||[];
  interaction.nextMacro=result.macro;
}

function startRollback(interaction){
  interaction.mode='rollback';
  interaction.rollbackStarted=performance.now();
  interaction.rollbackDuration=160;
  app.editor.interaction=interaction;
  const tick=()=>{
    if (app.editor.interaction !== interaction) return;
    if (performance.now()-interaction.rollbackStarted >= interaction.rollbackDuration){
      app.editor.interaction=null; endTransientSelect(); draw(); return;
    }
    draw(); requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function commit(interaction){
  const next=interaction.nextMacro;
  if (!next) return;
  const unchanged=JSON.stringify(interaction.original)===JSON.stringify(interaction.candidate);
  if (interaction.targetKind && unchanged){
    app.editor.selection={kind:interaction.targetKind,index:interaction.targetIndex};
    return;
  }
  pushUndo();
  app.cur.st.units=next.units;
  app.cur.st.placements=next.placements;
  app.editor.warningUnitIndices=interaction.warningUnitIndices||[];
  markChanged();
  if (interaction.targetKind) app.editor.selection={kind:interaction.targetKind,index:interaction.targetIndex};
  else if (interaction.candidate.kind) app.editor.selection={kind:'unit',index:next.units.length-1};
  else app.editor.selection={kind:'slot',index:next.placements.length-1};
}

export function deleteSelection(){
  const s=app.editor.selection;
  if (!s || !app.cur) return false;
  const list=s.kind==='unit' ? app.cur.st.units : app.cur.st.placements;
  if (!list?.[s.index]) return false;
  const result=validateDeletion(app.cur.st,s.kind,s.index);
  if (!result.valid){ showToast(result.reason,'error'); return false; }
  pushUndo();
  app.cur.st.units=result.macro.units;
  app.cur.st.placements=result.macro.placements;
  app.editor.warningUnitIndices=result.warningUnitIndices||[];
  app.editor.selection=null;
  app.editor.hover=null;
  markChanged(); draw();
  return true;
}

function eraseAt(hit){
  if (!hit) return;
  app.editor.selection=hit;
  deleteSelection();
}

function beginTransientSelect(){
  if (app.editor.tool==='none'||app.editor.tool==='erase') return;
  app.editor.transientTool='none';
  syncToolButtons();
}

function endTransientSelect(){
  if (app.editor.transientTool===null) return;
  app.editor.transientTool=null;
  syncToolButtons();
}

function onPointerDown(e){
  if (e.button !== 0 || !app.cur) return;
  const cell=eventCell(e), tool=app.editor.tool;
  lastCell=cell;
  const handle=hitHandle(cell.sx,cell.sy);
  const hit=hitTest(cell);
  app.editor.preview=null;
  if (tool === 'erase'){ eraseAt(hit); return; }
  if (handle){
    beginTransientSelect();
    const original=clone(app.cur.st.units[app.editor.selection.index]);
    const interaction={ mode:original.kind==='block'?'resizing-block':'resizing-platform', targetKind:'unit', targetIndex:app.editor.selection.index, handle, anchorCell:cell, currentCell:cell, original, candidate:clone(original), attachedPlacements:attachedPlacements(original), valid:true, reason:'' };
    validateInteraction(interaction); app.editor.interaction=interaction;
  } else if (hit){
    beginTransientSelect();
    app.editor.selection=hit;
    const original=clone(hit.kind==='unit' ? app.cur.st.units[hit.index] : app.cur.st.placements[hit.index]);
    // A slot subtype tool may change an existing slot's type while still using
    // the normal temporary Select/move interaction.
    const candidate=hit.kind==='slot'&&tool.startsWith('slot-')
      ? {...original,type:tool.slice(5)}
      : clone(original);
    const interaction={mode:hit.kind==='slot'?'moving-slot':'moving-object',targetKind:hit.kind,targetIndex:hit.index,anchorCell:cell,currentCell:cell,original,candidate,attachedPlacements:hit.kind==='unit'?attachedPlacements(original):[],valid:true,reason:''};
    validateInteraction(interaction);app.editor.interaction=interaction;
  } else if (tool === 'block' || tool === 'platform'){
    const mode=tool==='block'?'creating-block':'creating-platform';
    const interaction={ mode, targetKind:null, targetIndex:-1, handle:null, anchorCell:cell, currentCell:cell, original:null, candidate:candidateForCreate(mode,cell,cell), valid:false, reason:'' };
    validateInteraction(interaction); app.editor.interaction=interaction;
  } else if (tool.startsWith('slot-')){
    const type=tool.slice(5);
    const candidate={ slot:uniqueSlotName(type,app.cur.st.placements||[]), type, x:cell.x, y:cell.y };
    const interaction={mode:'moving-slot',targetKind:null,targetIndex:-1,anchorCell:cell,currentCell:cell,original:null,candidate,valid:false,reason:''};
    validateInteraction(interaction); app.editor.interaction=interaction;
  } else {
    app.editor.selection=null;
    app.editor.pan={x:e.clientX,y:e.clientY,panX:app.panX,panY:app.panY};
  }
  cv.setPointerCapture(e.pointerId);
  updateCursor();
  draw();
}

function onPointerMove(e){
  if (!app.cur) return;
  const cell=eventCell(e);
  lastCell=cell;
  if (app.editor.pan){
    app.editor.preview=null;
    const p=app.editor.pan;
    app.panX=p.panX-(e.clientX-p.x)/app.zoom;
    app.panY=p.panY+(e.clientY-p.y)/app.zoom;
    updateCursor();
    draw(); return;
  }
  const i=app.editor.interaction;
  if (!i){
    app.editor.hover=hitTest(cell);
    updateHoverPreview(cell,app.editor.hover);
    updateCursor();
    draw();return;
  }
  if (i.mode === 'rollback') return;
  i.currentCell=cell;
  if (i.mode.startsWith('creating-')) i.candidate=candidateForCreate(i.mode,i.anchorCell,cell);
  else if (i.mode.startsWith('resizing-')) i.candidate=resizedCandidate(i.original,i.handle,cell);
  else i.candidate=movedCandidate(i.original,i.anchorCell,cell,i.candidate);
  if (i.targetKind==='unit') moveAttachedPlacements(i);
  validateInteraction(i); draw();
}

function finishPointer(e, cancelled=false){
  app.editor.pan=null;
  const i=app.editor.interaction;
  if (!i || i.mode==='rollback') return;
  if (!cancelled && i.valid){ commit(i); app.editor.interaction=null; endTransientSelect(); updateCursor(); draw(); }
  else {
    if (i.reason) showToast(i.reason,'error');
    startRollback(i);
  }
  try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
}

// ---------- cursor management ----------
export function updateCursor(){
  const tool = app.editor.transientTool ?? app.editor.tool;
  if (app.editor.pan || app.editor.interaction){
    cv.style.cursor = 'grabbing';
    return;
  }
  // Outside the level zone: always pan mode
  if (!cellInZone(lastCell)){
    cv.style.cursor = 'grab';
    return;
  }
  // Hovering an element always shows pointer (clicking selects/moves it)
  if (app.editor.hover){
    cv.style.cursor = 'pointer';
    return;
  }
  if (tool === 'none'){
    cv.style.cursor = 'grab';
  } else {
    cv.style.cursor = 'crosshair';
  }
}

export function initPointer(){
  cv.addEventListener('pointerdown',onPointerDown);
  cv.addEventListener('pointermove',onPointerMove);
  cv.addEventListener('pointerup',e=>finishPointer(e,false));
  cv.addEventListener('pointercancel',e=>finishPointer(e,true));
  cv.addEventListener('pointerleave',()=>{ if (!app.editor.interaction){ app.editor.hover=null; app.editor.preview=null; lastCell=null; draw(); } });
}
