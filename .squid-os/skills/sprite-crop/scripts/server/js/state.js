// ---------- global app state (shared, mutable) ----------
// Single source of truth for cross-cutting state. Other modules import this
// object and mutate it directly to avoid circular dependencies.
//
// NOTE: The per-entity editor state map (`S`) and the entity-position index
// (`entityPos`) live here too so undo/redo + save can reach them from any module.

export const COL_COLL = '#3ef0ff';
export const COL_MELEE = '#ff9d2e';
export const COL_SCALE = '#b47bff';
export const COL_MARKER = '#ff5a5a';
export const HANDLE_R = 6;

// hex (#rrggbb) + alpha (0-1) -> rgba() string, for translucent fills
export function hexA(hex, a){
  const h = hex.replace('#','');
  const r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16), b=parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

// camera / viewport
let zoom = 1;            // sprite-px per screen-px (1 = true size)
let panX = 0, panY = 0;  // sprite-space offset of the view center from origin (0,0)
let userZoomed = false;  // once the user zooms/pans, stop auto-fitting on select

// canvas backing-store CSS size (layout math uses these, not cv.width which is device px)
let cssW = 1, cssH = 1;

// flat navigation list + current index (keyboard up/down across entities)
const flatList = [];
let flatIdx = -1;

// entity name -> {li, ei} (for cross-animation undo restore)
const entityPos = new Map();

// current entity: {name, paths, imgs, st} | null
let cur = null;

// per-entity editor state (preserved across switches): name -> st
const S = new Map();

// undo / redo (global: crosses frames AND animations)
const undoStack = [];
const redoStack = [];

// display toggles
const show = { collision:true, meleeView:false, axes:true, spriteView:true, pivot:true, label:true, allFrames:false, grid:true, markerView:false };

let bgColor = '#000000';   // canvas background fill
let isPlaying = true;      // global play/pause, carried across animations

// localStorage persistence
let _loadingState = false;   // guard: suppress saves while restoring from localStorage

// pointer interaction
let drag = null;         // active pointer drag
let hover = null;        // {box:'collision'|'melee'|'scale', handle:id} or {box, body:true}
let _panelHighlight = null;  // box key highlighted from panel hover/focus
let _selectedBox = null;     // {key:'box_2', idx:2} — clicked/selected on canvas
let boxZOrder = ['sprite','collision','melee'];   // front-to-back; last-touched moves to front

// playback accumulators
let lastT = 0, acc = 0;
let rotAcc = 0;

// rotation hold-to-spin state
let rotHold = null;        // {dir:1|-1, vel:0, t:0} while holding ◀/▶
let lastRotVel = 0;        // coasting velocity after release
let lastRotDir = 1;        // coasting direction
export const ROT_MAX_VEL = 180;   // deg/s at full hold
export const ROT_ACCEL = 400;     // deg/s² while held
export const ROT_DECEL = 300;     // deg/s² after release (coast to stop)
export const ROT_TAP_MS = 200;    // hold longer than this = continuous, shorter = tap step

// filmstrip
export const FILM = { on:false, pad:8 };
let filmCells = [];   // [{el, canvas}] built per entity

// project (set by loader)
let project = 'petal-panic';
let manifest = { labels: [] };

// default box geometry constants
export const COLL_PAD = 4;   // px trimmed off each side of the sprite box
export const MEELE_RATIO = 0.25, MEELE_GAP = 3;

// background color picker HSL working state
export const _bgState = { h:0, s:100, l:0 };

// reusable confirm dialog resolver
let _cdResolve = null;

export const app = {
  get zoom(){ return zoom; }, set zoom(v){ zoom = v; },
  get panX(){ return panX; }, set panX(v){ panX = v; },
  get panY(){ return panY; }, set panY(v){ panY = v; },
  get userZoomed(){ return userZoomed; }, set userZoomed(v){ userZoomed = v; },
  get cssW(){ return cssW; }, set cssW(v){ cssW = v; },
  get cssH(){ return cssH; }, set cssH(v){ cssH = v; },
  flatList,
  get flatIdx(){ return flatIdx; }, set flatIdx(v){ flatIdx = v; },
  entityPos,
  get cur(){ return cur; }, set cur(v){ cur = v; },
  S,
  undoStack,
  redoStack,
  show,
  get bgColor(){ return bgColor; }, set bgColor(v){ bgColor = v; },
  get isPlaying(){ return isPlaying; }, set isPlaying(v){ isPlaying = v; },
  get _loadingState(){ return _loadingState; }, set _loadingState(v){ _loadingState = v; },
  get drag(){ return drag; }, set drag(v){ drag = v; },
  get hover(){ return hover; }, set hover(v){ hover = v; },
  get _panelHighlight(){ return _panelHighlight; }, set _panelHighlight(v){ _panelHighlight = v; },
  get _selectedBox(){ return _selectedBox; }, set _selectedBox(v){ _selectedBox = v; },
  get boxZOrder(){ return boxZOrder; }, set boxZOrder(v){ boxZOrder = v; },
  get lastT(){ return lastT; }, set lastT(v){ lastT = v; },
  get acc(){ return acc; }, set acc(v){ acc = v; },
  get rotAcc(){ return rotAcc; }, set rotAcc(v){ rotAcc = v; },
  get rotHold(){ return rotHold; }, set rotHold(v){ rotHold = v; },
  get lastRotVel(){ return lastRotVel; }, set lastRotVel(v){ lastRotVel = v; },
  get lastRotDir(){ return lastRotDir; }, set lastRotDir(v){ lastRotDir = v; },
  get filmCells(){ return filmCells; }, set filmCells(v){ filmCells = v; },
  get project(){ return project; }, set project(v){ project = v; },
  get manifest(){ return manifest; }, set manifest(v){ manifest = v; },
  get _cdResolve(){ return _cdResolve; }, set _cdResolve(v){ _cdResolve = v; },
};
