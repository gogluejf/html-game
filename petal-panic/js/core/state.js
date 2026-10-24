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
  REWARD: 8,  // level reward screen (boss-arena.md §4)
  END_OF_GAME: 9, // minimal end-of-game screen (lifecycle.md §5)
  MENU: 10,       // main menu hub (menu-hub plan §2)
  OPTIONS: 11,    // shared options screen (reached from MENU or PAUSE)
  LEVEL_SELECT: 12, // level select screen
  BOSS_RUSH: 13,    // boss rush select screen
  MEDIA: 14,        // media / gallery screen
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
  [S.REWARD]: 'REWARD',
  [S.END_OF_GAME]: 'END_OF_GAME',
  [S.MENU]:       'MENU',
  [S.OPTIONS]:    'OPTIONS',
  [S.LEVEL_SELECT]: 'LEVEL_SELECT',
  [S.BOSS_RUSH]:  'BOSS_RUSH',
  [S.MEDIA]:      'MEDIA',
};

let cur = S.HOME;

export function getState() { return cur; }

export function setState(s) {
  cur = s;
}

// Transition map: which states can go where (design §1 graph).
const TRANSITIONS = {
  [S.HOME]:   [S.MENU, S.SELECT, S.PLAY, S.REMAP],
  [S.SELECT]: [S.PLAY, S.HOME],
  [S.PLAY]:   [S.PAUSE, S.OVER, S.WIN, S.AREA_ENTRY, S.REWARD],
  // PAUSE → MENU covers Save & Quit routing back to the hub.
  [S.PAUSE]:  [S.PLAY, S.HOME, S.MENU, S.REMAP, S.OPTIONS, S.AREA_ENTRY],
  [S.OVER]:   [S.PLAY, S.HOME, S.AREA_ENTRY],   // retry/continue show the entry screen first
  [S.AREA_ENTRY]: [S.PLAY, S.PAUSE, S.OVER],    // confirm starts the attempt; back opens pause
  [S.REWARD]: [S.AREA_ENTRY, S.END_OF_GAME, S.HOME, S.BOSS_RUSH], // confirm → next level's entry / end-of-game; back → home; BOSS_RUSH = boss-rush return (plan §3.3)
  [S.END_OF_GAME]: [S.HOME],                          // return home (lifecycle.md §5)
  [S.WIN]:    [S.SELECT, S.HOME, S.PLAY], // play again or quit; PLAY = debug shortcut
  [S.REMAP]:  [S.PAUSE, S.HOME, S.MENU],  // return to wherever we came from
  // Main menu hub (menu-hub plan §2): every top-level destination is reachable
  // from MENU; submenus route back through MENU (OPTIONS also returns to
  // PAUSE when opened from the pause menu).
  //   - MENU → HOME serves the documented Back action (plan §2.2: "back from
  //     MENU returns HOME").
  //   - MENU → AREA_ENTRY serves the §2.3 Continue flow (resuming a saved run
  //     routes through the shared area-entry screen before PLAY).
  [S.MENU]:       [S.HOME, S.AREA_ENTRY, S.SELECT, S.PLAY, S.LEVEL_SELECT, S.BOSS_RUSH, S.MEDIA, S.REMAP, S.OPTIONS],
  [S.OPTIONS]:    [S.MENU, S.PAUSE],
  [S.LEVEL_SELECT]: [S.MENU, S.PLAY, S.AREA_ENTRY],
  [S.BOSS_RUSH]:  [S.MENU, S.PLAY, S.AREA_ENTRY],
  [S.MEDIA]:      [S.MENU],
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
