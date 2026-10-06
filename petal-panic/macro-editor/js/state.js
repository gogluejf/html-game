// ---------- global app state (macro editor) ----------
// Lean version of the sprite-editor state: camera, current macro, draft map,
// display toggles. No rotation / filmstrip / playback — those are sprite-only.

// Game unit convention (petal-panic): ANISOTROPIC cell.
// Source of truth: petal-panic/js/world/macros.js (UNIT_PX_X / UNIT_PX_Y).
// Fallback values match the game; loader.js overwrites from the real module.
export const UNIT_PX_X = 72;   // horizontal cell width (px)
export const UNIT_PX_Y = 48;   // vertical cell height (px)
export const PLATFORM_DRAW_H = 6; // thin platform draw height (px)

// Slot type colors (UI only — not persisted gameplay semantics).
export const SLOT_COLORS = { powerup:'#3498db', enemy:'#ff5a5a', barrel:'#ff9d2e' };
export const COL_BLOCK = '#5aff8a';    // block fill
export const COL_PLATFORM = '#3ef0ff'; // platform surface
export const COL_GRID = 'rgba(120,140,180,.18)';
export const COL_GRID_MAJOR = 'rgba(120,140,180,.34)';

let zoom = 1;
let panX = 0, panY = 0;
let userZoomed = false;
let cssW = 1, cssH = 1;

const flatList = [];   // [{mi}] navigation order (grouped by difficulty)
let flatIdx = -1;

let cur = null;        // {id, macro, st} | null

// per-macro draft (in-memory working copy): id -> macro object
const drafts = new Map();

// undo / redo history is global, matching Sprite Editor: edits may cross
// macros and restore the exact macro that was active for the operation.
const undoStack = [];
const redoStack = [];

const show = { grid:true, slots:true, labels:true, zone:true };

// Pass 2 interaction state. Temporary candidates never enter `cur.st` until a
// valid pointer release commits them atomically.
const editor = {
  tool:'none',
  transientTool:null,
  hover:null,
  selection:null,
  multiSelect:[],
  interaction:null,
  preview:null,
  pan:null,
  warningUnitIndices:[],
};

let _loadingState = false;

export const app = {
  get zoom(){ return zoom; }, set zoom(v){ zoom = v; },
  get panX(){ return panX; }, set panX(v){ panX = v; },
  get panY(){ return panY; }, set panY(v){ panY = v; },
  get userZoomed(){ return userZoomed; }, set userZoomed(v){ userZoomed = v; },
  get cssW(){ return cssW; }, set cssW(v){ cssW = v; },
  get cssH(){ return cssH; }, set cssH(v){ cssH = v; },
  flatList,
  get flatIdx(){ return flatIdx; }, set flatIdx(v){ flatIdx = v; },
  get cur(){ return cur; }, set cur(v){ cur = v; },
  drafts,
  undoStack,
  redoStack,
  show,
  editor,
  get _loadingState(){ return _loadingState; }, set _loadingState(v){ _loadingState = v; },
};
