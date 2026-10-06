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
  const { targetKind = null, targetIndex = -1, placementCandidates = [] } = edit;
  if (targetKind === 'unit') next.units[targetIndex] = clone(candidate);
  else if (targetKind === 'slot') next.placements[targetIndex] = clone(candidate);
  else if (candidate.kind === 'block' || candidate.kind === 'platform') next.units.push(clone(candidate));
  else next.placements.push(clone(candidate));
  for (const { index, candidate:placement } of placementCandidates) {
    if (next.placements[index]) next.placements[index] = clone(placement);
  }
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
  if (/blocks need ≥ 2 empty rows/.test(msg)) return 'Blocks need ≥ 2 empty rows above another unit';
  if (/clearance from the ground/.test(msg)) return 'Too close to the ground — blocks need ≥ 2 rows';
  if (/duplicate slot position/.test(msg)) return 'A slot already occupies this cell';
  if (/elevation step/.test(msg)) return 'Creates an unreachable elevation step';
  return msg.replace(/^validateLayout:\s*/, '').split('\n')[0];
}

export function analyzeMacroWarnings(macro){
  try {
    const { warnings=[] }=validateLayout(previewLayout(macro),{traversal:'warn'});
    return {
      warnings,
      warningUnitIndices:[...new Set(warnings.flatMap(w=>w.unitIndices||[]))],
    };
  } catch (_){
    return {warnings:[],warningUnitIndices:[]};
  }
}

function candidateWarningState(next,candidate,edit,warningUnitIndices){
  if (candidate.kind==='block'||candidate.kind==='platform') {
    const index=edit.targetKind==='unit' ? edit.targetIndex : next.units.length-1;
    return warningUnitIndices.includes(index);
  }
  const supportIndex=next.units.findIndex(unit=>{
    if (candidate.x<unit.x||candidate.x>=unit.x+unit.width) return false;
    const top=unit.kind==='block'?unit.y+unit.height:unit.y+1;
    return candidate.y===top;
  });
  return supportIndex>=0&&warningUnitIndices.includes(supportIndex);
}

export function validateMacroCandidate(macro, candidate, edit = {}){
  try {
    const next = macroWithCandidate(macro, candidate, edit);
    const schemaErrors = macroSchemaErrors(next, { expectedId: next.id });
    if (schemaErrors.length) throw new Error(schemaErrors[0]);
    const support = slotSupportError(next, macro);
    if (support) return { valid:false, reason:support, macro:next };
    const { warnings=[] }=validateLayout(previewLayout(next),{traversal:'warn'});
    const warningUnitIndices=[...new Set(warnings.flatMap(w=>w.unitIndices||[]))];
    const candidateWarning=candidateWarningState(next,candidate,edit,warningUnitIndices);
    return {
      valid:true,
      severity:candidateWarning ? 'warning' : 'valid',
      reason:candidateWarning ? 'Warning: optional geometry is not reachable from the main route' : '',
      warnings,
      warningUnitIndices,
      macro:next,
    };
  } catch (error){
    return { valid:false, severity:'error', reason:reasonFromError(error) };
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
    const {warnings=[]}=validateLayout(previewLayout(next),{traversal:'warn'});
    return {
      valid:true,
      macro:next,
      warnings,
      warningUnitIndices:[...new Set(warnings.flatMap(w=>w.unitIndices||[]))],
    };
  } catch (error){
    return { valid:false, reason:reasonFromError(error) };
  }
}
