// Petal Panic — Media pure model.
//
// Turns LEVEL_CONFIGS + the progress section (progressStore shape) into the
// stable data the Media screen renders: one card per media item — intro, one
// clip per level (8), and the ending — with a locked/unlocked status and a
// right-side tooltip naming what unlocks it.
//
// Pure: no DOM, no localStorage, no state module — the screen passes in the
// progress object it already holds. Unlock rule (plan §5.1 / M5 diagram):
// each card is unlocked when its id ('intro', 'level-N', 'ending') appears in
// progress.mediaUnlocked; the store's markMediaUnlocked(id) is the writer
// side, driven by gameplay milestones (task 5.3). The model only READS that
// list — it never derives unlock state from completedAreas/defeatedBosses, so
// media rewards stay decoupled from playability gates (a boss can be defeated
// in Boss Rush before its level is passed; the clip still unlocks on defeat).
//
// Asset policy (plan §5.1: "sprite-loop or video placeholders"): every card
// carries kind 'sprite-loop'. Level clip cards carry their per-level
// background path (levelBgPath) for ALL eight levels — bg_f1.png exists on
// disk for every level, so the path is built from the config rather than
// gated on playable world content (N1). The intro/ending are placeholder
// cards with asset null until real clips land. Levels beyond the content
// frontier keep their cards visible but locked, matching the sibling
// models' honesty about missing content.

import { LEVEL_CONFIGS } from '../world/levelConfigs.js';

// N2 (review round 1): hoisted magic string — single source of truth for the
// per-level background asset path shape.
const LEVEL_BG_TEMPLATE = '../../assets/levels/level{index}/bg_f1.png';

/** Build the per-level background asset path for a level index. */
export function levelBgPath(levelIndex) {
  return LEVEL_BG_TEMPLATE.replace('{index}', String(levelIndex));
}

/** Media ids owned by this catalog (single source of truth for valid ids). */
export const MEDIA_IDS = ['intro', ...LEVEL_CONFIGS.map(c => `level-${c.index}`), 'ending'];

/** True when the id names a card in this catalog. */
export function isKnownMediaId(id) {
  return typeof id === 'string' && MEDIA_IDS.includes(id);
}

// N3 (review round 1): tooltip copy consolidated here — single source of truth
// for the unlock hints, so intro/level/ending cards and tests all agree.
const TOOLTIP_NEW_GAME = 'Start a new game to unlock';

/** Tooltip for a locked level clip naming its boss. */
export function beatBossTooltip(bossId) {
  return `Beat ${bossId.replace(/_/g, ' ')} to unlock`;
}

/** Normalize a progress-like input to { mediaUnlocked }. */
function normalizeProgress(progress) {
  const p = progress && typeof progress === 'object' ? progress : {};
  const mediaUnlocked = Array.isArray(p.mediaUnlocked)
    ? p.mediaUnlocked.filter(m => typeof m === 'string') : [];
  return { mediaUnlocked };
}

/**
 * Build the media cards: intro, eight level clips, ending (10 total).
 *
 * Each card carries exactly: id, title, kind, level, status, tooltip, asset —
 * never layout or focus state (the screen owns presentation). Status:
 *   - 'unlocked' — the card's id is in progress.mediaUnlocked;
 *   - 'locked'   — anything else (fresh progress locks every card).
 *
 * Tooltip: locked cards name the milestone that unlocks them; unlocked cards
 * carry null (nothing left to earn).
 *
 * @param {object} progress the store.progress section (or null).
 * @returns {Array<{id:string,title:string,kind:'sprite-loop'|'video',level:number|null,status:'locked'|'unlocked',tooltip:string|null,asset:string|null}>}
 */
export function buildMediaCards(progress) {
  const { mediaUnlocked } = normalizeProgress(progress);
  const unlocked = new Set(mediaUnlocked);

  const cards = [];

  // Intro card: unlocked after any New Game start (milestone written by 5.3).
  cards.push({
    id: 'intro',
    title: 'Intro',
    kind: 'sprite-loop',
    level: null,
    status: unlocked.has('intro') ? 'unlocked' : 'locked',
    tooltip: unlocked.has('intro') ? null : TOOLTIP_NEW_GAME,
    // No intro clip asset exists yet — placeholder playback (screen-owned).
    asset: null,
  });

  // One clip card per level, in LEVEL_CONFIGS order.
  for (const cfg of LEVEL_CONFIGS) {
    const id = `level-${cfg.index}`;
    const isOpen = unlocked.has(id);
    // N1 (review round 1): the asset path is built for EVERY level from the
    // config — bg_f1.png exists on disk for all 8 levels, so gating on
    // hasLevelContent (which tests playable WORLD content: LEVELS defines
    // only index 1) would under-report real art. The model can't do fs checks
    // headlessly, so it trusts the well-formed path from the config; the
    // screen owns any fallback rendering if a file is ever missing.
    const asset = levelBgPath(cfg.index);
    cards.push({
      id,
      title: `${cfg.name} Clip`,
      kind: 'sprite-loop',
      level: cfg.index,
      status: isOpen ? 'unlocked' : 'locked',
      tooltip: isOpen ? null : beatBossTooltip(cfg.boss),
      asset,
    });
  }

  // Ending card: unlocked after the final boss is defeated (milestone 5.3).
  const last = LEVEL_CONFIGS[LEVEL_CONFIGS.length - 1];
  cards.push({
    id: 'ending',
    title: 'Ending',
    kind: 'sprite-loop',
    level: null,
    status: unlocked.has('ending') ? 'unlocked' : 'locked',
    tooltip: unlocked.has('ending') ? null : beatBossTooltip(last.boss),
    asset: null,
  });

  return cards;
}
