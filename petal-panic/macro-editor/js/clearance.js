// Macro clearance proof — persisted evidence that the exact saved/draft macro
// state was completed by the ghost test ride. Any content change invalidates
// the proof; undo restores it because undo snapshots include the proof object.

/** Deterministic content snapshot excluding the proof itself and UI metadata. */
function proofPayload(macro){
  return {
    id: macro.id,
    name: macro.name,
    orientation: macro.orientation,
    difficulty: macro.difficulty,
    units: macro.units || [],
    placements: macro.placements || [],
    variations: macro.variations || [],
    follows: macro.follows || [],
    followedBy: macro.followedBy || [],
  };
}

/** Small deterministic FNV-1a checksum; sufficient for draft identity. */
export function macroContentSignature(macro){
  const text = JSON.stringify(proofPayload(macro));
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++){
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function hasValidClearance(macro){
  return !!macro?.clearance &&
    macro.clearance.status === 'cleared' &&
    macro.clearance.contentSignature === macroContentSignature(macro);
}

export function stampClearance(macro){
  macro.clearance = {
    status: 'cleared',
    contentSignature: macroContentSignature(macro),
  };
}

/** Remove a stale proof after any mutation; returns true when removed. */
export function invalidateStaleClearance(macro){
  if (!macro?.clearance || hasValidClearance(macro)) return false;
  delete macro.clearance;
  return true;
}

/** Macro-local endpoint in authored unit space. */
export function macroEndpoint(macro){
  const units = macro?.units || [];
  if (!units.length) return { orientation: macro?.orientation || 'horizontal', value: 0 };
  if (macro.orientation === 'vertical'){
    return {
      orientation: 'vertical',
      value: Math.max(...units.map(u => (u.y || 0) + (u.kind === 'block' ? (u.height || 1) : 1))),
    };
  }
  return {
    orientation: 'horizontal',
    value: Math.max(...units.map(u => (u.x || 0) + (u.width || 1))),
  };
}
