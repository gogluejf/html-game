// Petal Panic — Boss Rush pure model.
//
// Turns LEVEL_CONFIGS + the progress section (progressStore shape) into the
// stable data the Boss Rush screen renders: one card per level's boss, with a
// locked/unlocked/defeated status and a right-side tooltip.
//
// Pure: no DOM, no localStorage, no state module — the screen passes in the
// progress object it already holds. Unlock rule (plan §3.3): a boss is
// revealed only after its level is PASSED (every area 1..4 + the boss zone
// completed), matching the 'completed' status buildLevelMap uses for levels.
// Defeated bosses (progress.defeatedBosses contains the boss id) keep their
// card but are presented as defeated.
//
// I1 parity with levelSelectModel.js: a boss whose level has no LEVELS
// world-content definition yet is ALWAYS 'locked' — confirming it would
// install Level 1 geometry (update.js builds the world once from LEVELS[0]
// and never rebinds to hero.currentLevel). Full multi-level rebinding is
// deferred work; this gate keeps the screen honest in the meantime. Today
// only Level 1 ('Big Top') exists, so at most one boss is ever unlocked.

import { LEVEL_CONFIGS } from '../world/levelConfigs.js';
import { AREA_BOSS, hasLevelContent } from './levelSelectModel.js';

const ORDINARY_AREAS = [1, 2, 3, 4];

/** Normalize a progress-like input to { completedAreas, defeatedBosses }. */
function normalizeProgress(progress) {
  const p = progress && typeof progress === 'object' ? progress : {};
  const completedAreas = (p.completedAreas && typeof p.completedAreas === 'object' && !Array.isArray(p.completedAreas))
    ? p.completedAreas : {};
  const defeatedBosses = Array.isArray(p.defeatedBosses)
    ? p.defeatedBosses.filter(b => typeof b === 'string') : [];
  return { completedAreas, defeatedBosses };
}

/** True when every area of the level (1..4 + B) is recorded completed. */
function isLevelPassed(completedAreas, level) {
  return [...ORDINARY_AREAS, AREA_BOSS].every(
    a => completedAreas[`${level}-${a >= AREA_BOSS ? 'B' : a}`] === true);
}

/** Title-case a boss id: 'tusko_wobble' → 'Tusko Wobble'. */
export function bossDisplayName(bossId) {
  return String(bossId ?? '').split('_').map(
    w => (w ? w[0].toUpperCase() + w.slice(1) : '')).join(' ');
}

/**
 * Build the boss-rush cards, one per LEVEL_CONFIGS entry.
 *
 * Each card carries exactly: index, bossId, name, status, tooltip, start —
 * never image paths or screen layout (the screen owns presentation). Status:
 *   - 'defeated' — the level is passed AND the boss id is in
 *                  progress.defeatedBosses;
 *   - 'unlocked' — the level is passed (boss not yet recorded defeated);
 *   - 'locked'   — the level is not passed, or the level has no world
 *                  content yet (I1 gate).
 *
 * @param {object} progress the store.progress section (or null).
 * @returns {Array<{index:number,bossId:string,name:string,status:'locked'|'unlocked'|'defeated',tooltip:string|null,start:{level:number,area:number}}>}
 */
export function buildBossRushCards(progress) {
  const { completedAreas, defeatedBosses } = normalizeProgress(progress);
  return LEVEL_CONFIGS.map(cfg => {
    const level = cfg.index;
    const bossId = cfg.boss;
    const passed = isLevelPassed(completedAreas, level);
    // TEMP (test only): force every boss UNLOCKED so the card art / B&W-color
    // selection look can be tested without real progress. REMOVE THIS BLOCK —
    // restore the original status logic below when done testing.
    let status = 'unlocked';
    /*
    if (!passed || !hasLevelContent(level)) {
      status = 'locked';
    } else if (defeatedBosses.includes(bossId)) {
      status = 'defeated';
    } else {
      status = 'unlocked';
    }
    */
    return {
      index: level,
      bossId,
      name: bossDisplayName(bossId),
      status,
      // Locked cards hide the boss identity entirely (plan §3.3: "hide locked
      // bosses completely") — the tooltip names only the required level.
      tooltip: status === 'locked'
        ? `Pass Level ${level} to unlock this boss`
        : null,
      start: { level, area: AREA_BOSS },
    };
  });
}
