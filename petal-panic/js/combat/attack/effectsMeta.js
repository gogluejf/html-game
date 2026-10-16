// Attack Engine — effect metadata resolution (single source of truth).
//
// Every attack registration declares the VFX it fires in meta.effects:
//   effects: [{ type: 'explosion', desc: '...' }, ...]
// where `type` is an Effect Engine catalog type name. This module resolves
// that declaration into display rows for hosts (the Theater's EFFECTS panel)
// WITHOUT any host-side knowledge of what an attack does:
//
//   - MACROS: list their own native effects, then DYNAMICALLY append the
//     effects of every invoked attack (meta.invokes), so a macro's panel
//     always reflects its composition — change a primitive's VFX and every
//     macro that invokes it updates for free. No hardcoded duplication.
//   - PRIMITIVES: list their own declared effects as-is.
//
// Rows are deduped by type (first description wins — the attacker's own
// declaration beats inherited ones).

import { getPrimitive, getMacro } from './registry.js';

/**
 * Resolve the effective effect rows for an attack id.
 * @param {string} id registry id (primitive or macro)
 * @returns {Array<{type:string, desc?:string, via?:string}>} display rows;
 *   `via` names the attack the row was inherited from (macro compositions).
 */
export function resolveEffects(id) {
  const def = getPrimitive(id) ?? getMacro(id);
  if (!def?.meta) return [];
  const rows = [];
  const seen = new Set();
  const push = (fx, via) => {
    if (!fx?.type || seen.has(fx.type)) return;
    seen.add(fx.type);
    rows.push({ type: fx.type, desc: fx.desc, via });
  };
  // Own declaration first (wins dedup ties).
  for (const fx of def.meta.effects ?? []) push(fx);
  // Macros inherit the effects of everything they invoke — dynamic, not copied.
  for (const invId of def.meta.invokes ?? []) {
    const invDef = getPrimitive(invId) ?? getMacro(invId);
    for (const fx of invDef?.meta?.effects ?? []) push(fx, invDef.meta.name ?? invId);
  }
  return rows;
}
