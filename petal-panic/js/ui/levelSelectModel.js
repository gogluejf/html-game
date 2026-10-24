// Petal Panic — Level Select pure model.
//
// Turns LEVEL_CONFIGS + the progress section (progressStore shape) into the
// stable data the Level Select screen renders: 8 level markers for the world
// map, and 5 sub-area choices (X-1..X-4, X-B) under the selected level.
//
// Pure: no DOM, no localStorage, no state module — the screen passes in the
// progress object it already holds. Area ids follow formatAreaId's convention
// ('X-N' ordinary areas, 'X-B' boss zone), matching what lifecycle writes to
// progress.completedAreas.

import { LEVEL_CONFIGS } from '../world/levelConfigs.js';
// I1 (review round 1): world-content availability gate. level.js's LEVELS is
// the single source of truth for levels that actually HAVE playable world
// content (buildLevelZones/buildAllZoneTerrain are handed a LEVELS entry).
// Today only Level 1 ('Big Top') exists — levels 2..8 have LEVEL_CONFIGS
// entries but no LEVELS definition, so their stages must NOT be startable:
// update.js builds the world once from LEVELS[0] and never rebinds it to
// hero.currentLevel, so confirming e.g. 2-1 would silently play Level 1
// geometry. Full multi-level world rebinding is deferred work; this gate keeps
// the screen honest in the meantime.
import { LEVELS } from '../world/level.js';

export const AREA_BOSS = 5; // matches lifecycle's zone-model boss index

/** Levels with an actual LEVELS world-content definition (playable today). */
const CONTENT_LEVELS = new Set(LEVELS.map((l) => l.index));

/** True when the level has world content installed (a LEVELS entry). */
export function hasLevelContent(level) {
  return CONTENT_LEVELS.has(level);
}

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

/** True when the area id is recorded as completed in progress. */
function isCompleted(completedAreas, areaId) {
  return completedAreas[areaId] === true;
}

/**
 * Build the 8 level markers for the world map.
 *
 * Each marker carries exactly: level, name, status, selected — never zone
 * nodes (sub-areas come from buildSubAreasForLevel). Status:
 *   - 'completed'   — every area of the level (1..4 + B) is completed;
 *   - 'available'   — not completed but selectable (level 1 always; any
 *                     later level once its predecessor is completed);
 *   - 'locked'      — predecessor level not completed.
 *
 * I1 (review round 1): a level whose world content does not exist yet (no
 * LEVELS entry in level.js) is ALWAYS 'locked', even when its predecessor is
 * completed — the model owns availability, so the screen never has to second-
 * guess it. Deferred multi-level work adds LEVELS entries and this gate opens
 * automatically.
 *
 * @param {object} progress the store.progress section (or null).
 * @returns {Array<{level:number,name:string,status:'locked'|'available'|'completed',selected:boolean}>}
 */
export function buildLevelMap(progress) {
  const { completedAreas } = normalizeProgress(progress);
  return LEVEL_CONFIGS.map((cfg, i) => {
    const level = cfg.index;
    const allDone = [...ORDINARY_AREAS, AREA_BOSS].every(
      a => isCompleted(completedAreas, `${level}-${a >= AREA_BOSS ? 'B' : a}`));
    let status;
    if (allDone) status = 'completed';
    else if (!hasLevelContent(level)) {
      // No world content yet — locked regardless of progress (I1).
      status = 'locked';
    } else if (i === 0 || LEVEL_CONFIGS[i - 1] && [...ORDINARY_AREAS, AREA_BOSS].every(
      a => isCompleted(completedAreas, `${LEVEL_CONFIGS[i - 1].index}-${a >= AREA_BOSS ? 'B' : a}`))) {
      status = 'available';
    } else status = 'locked';
    return { level, name: cfg.name, status, selected: false };
  });
}

/**
 * Build the 5 sub-area choices for one level: X-1, X-2, X-3, X-4, X-B.
 *
 * A sub-area is unlocked when its previous sub-area is completed (the first
 * sub-area of level 1 is unlocked by default; the first sub-area of any other
 * level unlocks when the previous level's boss area is completed). Locked
 * entries carry a tooltip naming the gate; unlocked/completed ones do not.
 *
 * @param {number} level the level index (1..8).
 * @param {object} progress the store.progress section (or null).
 * @returns {Array<{level:number,zone:string,label:string,boss:boolean,status:'locked'|'unlocked'|'completed',tooltip:string|null,start:{level:number,area:number}}>}
 */
export function buildSubAreasForLevel(level, progress) {
  const { completedAreas } = normalizeProgress(progress);
  const zones = [...ORDINARY_AREAS, AREA_BOSS];
  return zones.map((area, i) => {
    const zone = String(area >= AREA_BOSS ? 'B' : area);
    const label = `${level}-${zone}`;
    const prevLabel = i > 0
      ? `${level}-${zones[i - 1] >= AREA_BOSS ? 'B' : zones[i - 1]}`
      : (level > 1 ? `${level - 1}-B` : null);
    const completed = isCompleted(completedAreas, label);
    // I1 (review round 1): a sub-area is playable only when its level has
    // world content (a LEVELS entry). Levels beyond the content frontier are
    // shown but locked with an explicit 'no content yet' reason — confirming
    // them would otherwise install Level 1's geometry (update.js builds the
    // world once from LEVELS[0] and never rebinds to hero.currentLevel; full
    // multi-level rebinding is deferred work).
    const noContent = !hasLevelContent(level);
    const unlocked = !noContent && (prevLabel === null || isCompleted(completedAreas, prevLabel));
    let status;
    if (completed) status = 'completed';
    else if (unlocked) status = 'unlocked';
    else status = 'locked';
    return {
      level,
      zone,
      label,
      boss: area === AREA_BOSS,
      status,
      tooltip: noContent
        ? 'No content yet — coming soon'
        : (status === 'locked' ? `Pass ${prevLabel} to unlock` : null),
      start: { level, area },
    };
  });
}
