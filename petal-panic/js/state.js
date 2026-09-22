// Petal Panic — top-level state machine (design §1).
// Thin skeleton: enum + centralized transition map + dispatcher.
// Zero dependency on rendering; Screens & HUD () plug in later by
// reading getState() / subscribing to transitions and drawing per-state screens.

export const S = {
  HOME: 0,
  SELECT: 1,
  PLAY: 2,
  PAUSE: 3,
  OVER: 4,    // game over
  WIN: 5,
  REMAP: 6,   // controls/remap screen
  AREA_ENTRY: 7, // shared area-entry screen (checkpoints.md §3)
};

// Human-readable names for logging / overlays / future screen dispatch.
export const STATE_NAMES = {
  [S.HOME]:   'HOME',
  [S.SELECT]: 'SELECT',
  [S.PLAY]:   'PLAY',
  [S.PAUSE]:  'PAUSE',
  [S.OVER]:   'OVER',
  [S.WIN]:    'WIN',
  [S.REMAP]:  'REMAP',
  [S.AREA_ENTRY]: 'AREA_ENTRY',
};

let cur = S.HOME;

export function getState() { return cur; }

export function setState(s) {
  cur = s;
}

// Transition map: which states can go where (design §1 graph).
const TRANSITIONS = {
  [S.HOME]:   [S.SELECT, S.PLAY, S.REMAP],
  [S.SELECT]: [S.PLAY, S.HOME],
  [S.PLAY]:   [S.PAUSE, S.OVER, S.WIN, S.AREA_ENTRY],
  [S.PAUSE]:  [S.PLAY, S.HOME, S.REMAP, S.AREA_ENTRY],
  [S.OVER]:   [S.PLAY, S.HOME, S.AREA_ENTRY],   // retry/continue show the entry screen first
  [S.AREA_ENTRY]: [S.PLAY, S.PAUSE, S.OVER],    // confirm starts the attempt; back opens pause
  [S.WIN]:    [S.SELECT, S.HOME, S.PLAY], // play again or quit; PLAY = debug shortcut
  [S.REMAP]:  [S.PAUSE, S.HOME],      // return to wherever we came from
};

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

// Subscribers receive (from, to) after a successful transition. // hooks its screen reset/teardown here; the skeleton itself stays render-free.
const listeners = new Set();
export function onTransition(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function tryTransition(to) {
  if (canTransition(cur, to)) {
    const from = cur;
    cur = to;
    for (const fn of listeners) fn(from, to);
    return true;
  }
  return false;
}
