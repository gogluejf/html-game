// Petal Panic — Shared square-grid contract (plans/petal-panic-square-grid-migration.md)
//
// Single source of truth for the 48×48 base grid's OBJECT rules: how
// block/platform solids snap, size, and decompose into sprite-tile variants.
// Consumed by the live terrain pipeline (world/terrainTiles.js), the runtime
// macro validator (world/macroSchema.js), and the macro editor
// (macro-editor/js/pointer.js). Pure math — no runtime imports.
//
// Variant semantics (agreed rules table):
//   - BLOCKS describe HEIGHT, never width. A block column is exactly 2 cells
//     wide; tall columns decompose into height variants single/double/triple
//     (1/2/3 cells tall). Wide walls repeat 2-cell columns. Horizontal
//     placement/movement snaps to the 2-cell lattice; widths are positive
//     multiples of 2. Vertical position/height use whole cells, min 1.
//   - PLATFORMS describe WIDTH, never height. Platform height stays 1 cell;
//     long platforms decompose into width variants single/double/triple
//     (1/2/3 cells wide). Positions and lengths use whole cells, min width 1.
//
// MIGRATION STATUS: the square-grid cutover has LANDED. The live base grid is
// UNIT_PX_X = UNIT_PX_Y = 48 (consts.js), authored macro data carries
// schemaVersion "square-grid-v1", and the runtime rejects any legacy
// (un-migrated) macro at load — there is no legacy fallback path.

// --- Object footprint rules -------------------------------------------------------
// Blocks: fixed WIDTH 2 cells; variant HEIGHTS 1/2/3 cells.
// Platforms: fixed HEIGHT 1 cell; variant WIDTHS 1/2/3 cells.

export const BLOCK_FOOTPRINT = Object.freeze({
  widthCells: 2,          // every block column is exactly 2 cells wide
  snapStepX: 2,           // horizontal placement/movement snaps to 2-cell steps
  minWidthCells: 2,       // widths are positive multiples of 2
  widthVariants: Object.freeze([2]),
  heightVariants: Object.freeze([1, 2, 3]), // single / double / triple (taller, never wider)
  minHeightCells: 1,
});

export const PLATFORM_FOOTPRINT = Object.freeze({
  widthCells: null,       // no fixed width; variants below
  snapStepX: 1,           // positions and lengths use whole cells
  minWidthCells: 1,       // odd widths allowed
  widthVariants: Object.freeze([1, 2, 3]), // single / double / triple (wider, never taller)
  heightVariants: Object.freeze([1]),      // platform height stays 1 cell
  minHeightCells: 1,
});

const FOOTPRINTS = { block: BLOCK_FOOTPRINT, platform: PLATFORM_FOOTPRINT };

/** @param {'block'|'platform'} kind */
export function getFootprint(kind) {
  const fp = FOOTPRINTS[kind];
  if (!fp) throw new Error(`squareGrid: unknown kind "${kind}" (expected 'block' or 'platform')`);
  return fp;
}

// --- Placement / dimension snapping ----------------------------------------------

/**
 * Snap a horizontal cell coordinate to the object's X lattice (blocks: even).
 * FLOORS toward the origin rather than rounding to nearest: pointer editing
 * reports whole cells via Math.floor (eventCell), so snapping must be
 * monotonic with the drag direction — dragging right from an odd cell grows
 * the unit, it never shrinks it back. Round-to-nearest would make a block
 * created at x=5 snap to 4 on release while its ghost showed 6, and would
 * oscillate on alternating drags. Floor is the behavior every consumer
 * (pointer.js create/move/resize paths) and the test suite assume.
 */
export function snapCellX(kind, x) {
  const step = getFootprint(kind).snapStepX;
  return Math.max(0, Math.floor(x / step) * step);
}

/** Clamp a candidate width to legal values: int ≥ min, on the kind's lattice. */
export function clampWidth(kind, width) {
  const fp = getFootprint(kind);
  let w = Math.max(fp.minWidthCells, Math.round(width));
  if (w % fp.snapStepX !== 0) w += fp.snapStepX - (w % fp.snapStepX);
  return w;
}

/**
 * Normalize a unit's geometry to the square-grid contract WITHOUT changing its
 * meaning where it already conforms:
 *   - blocks: x snapped to the 2-cell lattice, width snapped UP to the next
 *     multiple of 2 (min 2), y/height floored to integers (min height 1);
 *   - platforms: x/y floored to ints (y ≥ 1), width floored to int (min 1).
 * Used by the editor so every mutation path (paint, drag, resize, paste,
 * keyboard) lands on legal geometry before validation sees it.
 */
export function normalizeUnit(unit) {
  if (unit.kind === 'block') {
    return {
      ...unit,
      x: snapCellX('block', unit.x),
      y: Math.max(0, Math.floor(unit.y)),
      width: clampWidth('block', unit.width),
      height: Math.max(BLOCK_FOOTPRINT.minHeightCells, Math.floor(unit.height)),
    };
  }
  return {
    ...unit,
    x: Math.max(0, Math.floor(unit.x)),
    y: Math.max(PLATFORM_FOOTPRINT.minHeightCells, Math.floor(unit.y)),
    width: Math.max(PLATFORM_FOOTPRINT.minWidthCells, Math.floor(unit.width)),
  };
}

/** Human-readable error when a unit violates the square-grid contract. */
export function unitGridError(unit) {
  if (!unit || typeof unit !== 'object') return null;
  if (unit.kind === 'block') {
    if (!Number.isInteger(unit.x) || unit.x < 0) return `block x=${unit.x} must be a non-negative integer`;
    if (unit.x % BLOCK_FOOTPRINT.snapStepX !== 0) return `block x=${unit.x} breaks the ${BLOCK_FOOTPRINT.snapStepX}-cell lattice (must be even)`;
    if (!Number.isInteger(unit.y) || unit.y < 0) return `block y=${unit.y} must be a non-negative integer`;
    if (!Number.isInteger(unit.width)) return `block width=${unit.width} must be an integer`;
    if (unit.width < BLOCK_FOOTPRINT.minWidthCells) return `block width=${unit.width} must be at least ${BLOCK_FOOTPRINT.minWidthCells} cells`;
    if (unit.width % BLOCK_FOOTPRINT.snapStepX !== 0) return `block width=${unit.width} must be a multiple of ${BLOCK_FOOTPRINT.snapStepX}`;
    if (!Number.isInteger(unit.height) || unit.height < BLOCK_FOOTPRINT.minHeightCells) return `block height=${unit.height} must be an integer ≥ ${BLOCK_FOOTPRINT.minHeightCells}`;
    return null;
  }
  if (unit.kind === 'platform') {
    if (!Number.isInteger(unit.x) || unit.x < 0) return `platform x=${unit.x} must be a non-negative integer`;
    if (!Number.isInteger(unit.y) || unit.y < PLATFORM_FOOTPRINT.minHeightCells) return `platform y=${unit.y} must be an integer ≥ ${PLATFORM_FOOTPRINT.minHeightCells}`;
    if (!Number.isInteger(unit.width) || unit.width < PLATFORM_FOOTPRINT.minWidthCells) return `platform width=${unit.width} must be an integer ≥ ${PLATFORM_FOOTPRINT.minWidthCells}`;
    return null;
  }
  return null;
}

// --- Variant decomposition ------------------------------------------------------------

/**
 * Longest-first decomposition of a length into the variant sizes for a kind,
 * per the agreed rules table:
 *   - blocks  → height variants [3,2,1] (tallest first; bottom-up stacking
 *     order is the caller's concern)
 *   - platforms → width variants [3,2,1] (widest first, left-to-right)
 *
 * This is the single shared decomposition used by the terrain pipeline.
 * @param {'block'|'platform'} kind
 * @param {number} cells positive integer total length in cells
 * @returns {number[]} variant sizes summing to `cells`
 */
export function decomposeVariant(kind, cells) {
  const fp = getFootprint(kind);
  const variants = kind === 'block' ? fp.heightVariants : fp.widthVariants;
  if (!Number.isInteger(cells) || cells < 1) {
    throw new Error(`decomposeVariant(${kind}): need positive int, got ${cells}`);
  }
  const ordered = [...variants].sort((a, b) => b - a); // longest first
  const out = [];
  let r = cells;
  while (r > 0) {
    const v = ordered.find((c) => c <= r);
    if (!v) throw new Error(`decomposeVariant(${kind}): cannot cover remainder ${r} with variants [${variants}]`);
    out.push(v);
    r -= v;
  }
  return out;
}

/**
 * Decompose a block's full cell width into its fixed 2-cell columns.
 * A 6-cell-wide wall → three 2-cell columns (each then decomposed vertically
 * by decomposeVariant('block', h)).
 * @returns {number[]} list of column widths (all equal to 2)
 */
export function blockColumns(widthCells) {
  if (!Number.isInteger(widthCells) || widthCells < 2 || widthCells % BLOCK_FOOTPRINT.snapStepX !== 0) {
    throw new Error(`blockColumns: width must be a positive multiple of ${BLOCK_FOOTPRINT.snapStepX}, got ${widthCells}`);
  }
  return Array.from({ length: widthCells / BLOCK_FOOTPRINT.widthCells }, () => BLOCK_FOOTPRINT.widthCells);
}
