// ---------- candidate validation adapter ----------
// Converts macro-local descriptors to the shared game's validateLayout shape.
// No bounds/clearance formulas are reimplemented here.

import { app } from './state.js';
import { macroSchemaErrors } from '../../js/world/macroSchema.js';
import { validateLayout } from '../../js/world/macros.js';

const clone = value => JSON.parse(JSON.stringify(value));

export function macroWithCandidate(macro, candidate, edit = {}){
  const next = clone(macro);
  next.units ||= [];
  next.placements ||= [];
  const { targetKind = null, targetIndex = -1 } = edit;
  if (targetKind === 'unit') next.units[targetIndex] = clone(candidate);
  else if (targetKind === 'slot') next.placements[targetIndex] = clone(candidate);
  else if (candidate.kind === 'block' || candidate.kind === 'platform') next.units.push(clone(candidate));
  else next.placements.push(clone(candidate));
  return next;
}

export function previewLayout(macro){
  const c = app.consts;
  const vertical = macro.orientation === 'vertical';
  const offsetX = vertical ? 0 : c.hEntryClear;
  const units = (macro.units || []).map((u, index) => ({
    ...clone(u),
    x: u.x + offsetX,
    height: u.kind === 'block' ? u.height : undefined,
    tier: u.kind === 'platform' ? u.y : undefined,
    placementId: 0,
    solid: u.kind === 'block',
    oneWay: u.kind === 'platform',
    aabb: { x:u.x + offsetX, y:u.y, w:u.width, h:u.kind === 'block' ? u.height : 1 },
    _editorIndex:index,
  }));
  return {
    orientation: macro.orientation,
    stage: macro.difficulty,
    budget: vertical ? c.vBudgetUnits : c.hBudgetUnits,
    entryClear: vertical ? c.vEntryClear : c.hEntryClear,
    exitClear: vertical ? c.vExitClear : c.hExitClear,
    macros: [macro.id],
    units,
    gaps: [],
    totalWidth: vertical ? c.vZoneWidthUnits : c.hBudgetUnits,
    // Isolated vertical macro validation should enforce fixed bounds and local
    // geometry, but not require this fragment to reach a whole zone's exit.
    totalHeight: vertical ? undefined : c.hZoneHeightUnits,
    placements: (macro.placements || []).map(p => ({ ...clone(p), x:p.x + offsetX, placementId:0 })),
  };
}

function unsupportedSlots(macro){
  const invalid = new Set();
  const slots = macro.placements || [];
  const units = macro.units || [];
  slots.forEach((p) => {
    // Every newly authored opportunity sits exactly one row above terrain.
    // Existing canonical anomalies are grandfathered by slotSupportError.
    const supported = units.some(u => {
      if (p.x < u.x || p.x >= u.x + u.width) return false;
      const surface = u.kind === 'block' ? u.y + u.height : u.y + 1;
      return p.y === surface;
    });
    if (!supported) invalid.add(`${p.slot}\u0000${p.x}\u0000${p.y}`);
  });
  return invalid;
}

function slotSupportError(macro, baseline){
  const before = unsupportedSlots(baseline);
  const after = unsupportedSlots(macro);
  for (const key of after){
    // Do not make unrelated geometry edits impossible because a canonical
    // legacy file already contains an unsupported slot; reject new debt only.
    if (!before.has(key)){
      const [,x,y] = key.split('\u0000');
      return `Slot at (${x}, ${y}) requires a supporting surface`;
    }
  }
  return '';
}

export function reasonFromError(error){
  const msg = String(error?.message || error || 'Invalid placement');
  if (/entry zone|exit zone/.test(msg)) return 'Intrudes into entry/exit clearance';
  if (/fixed zone width|non-negative|integer x\/y/.test(msg)) return 'Outside playable bounds';
  if (/horizontal surfaces|top clearance/.test(msg)) return 'Surface must preserve 2 rows of top clearance';
  if (/may not sit at row 0|platform row must be integer >= 1/.test(msg)) return 'Platform cannot be placed at row 0';
  if (/platforms need/.test(msg)) return 'Platform requires an empty row below';
  if (/overlap|intersect|buried/.test(msg)) return 'Overlaps another block/platform';
  if (/floats exactly 1 row/.test(msg)) return 'Requires 2 empty rows of block clearance';
  if (/duplicate slot position/.test(msg)) return 'A slot already occupies this cell';
  if (/elevation step/.test(msg)) return 'Creates an unreachable elevation step';
  return msg.replace(/^validateLayout:\s*/, '').split('\n')[0];
}

export function validateMacroCandidate(macro, candidate, edit = {}){
  try {
    const next = macroWithCandidate(macro, candidate, edit);
    const schemaErrors = macroSchemaErrors(next, { expectedId: next.id });
    if (schemaErrors.length) throw new Error(schemaErrors[0]);
    const support = slotSupportError(next, macro);
    if (support) return { valid:false, reason:support, macro:next };
    validateLayout(previewLayout(next));
    return { valid:true, reason:'', macro:next };
  } catch (error){
    return { valid:false, reason:reasonFromError(error) };
  }
}

export function validateDeletion(macro, targetKind, targetIndex){
  const next = clone(macro);
  if (targetKind === 'unit') next.units.splice(targetIndex, 1);
  else next.placements.splice(targetIndex, 1);
  try {
    const errors = macroSchemaErrors(next, { expectedId:next.id });
    if (errors.length) throw new Error(errors[0]);
    const support = slotSupportError(next, macro);
    if (support) throw new Error(support);
    validateLayout(previewLayout(next));
    return { valid:true, macro:next };
  } catch (error){
    return { valid:false, reason:reasonFromError(error) };
  }
}
