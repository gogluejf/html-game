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
//
// Inheritance is TRANSITIVE: a macro's invokes may name other macros, and
// each of THOSE is resolved recursively (cycle-safe via a visited set), so
// burstShot → projectile surfaces the primitive's effects
// without any macro re-declaring them. `via` names the DIRECT source the row
// came through.

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
  // Macros inherit the effects of everything they invoke — dynamically and
  // transitively (a macro invoking a macro sees the whole chain), never
  // copied. Cycle-safe: visiting is tracked per resolution pass.
  // Per-invoke overrides (from the attacks array) can suppress or modify
  // inherited effect rows.
  const visit = (attackId, via, visited) => {
    if (visited.has(attackId)) return;
    visited.add(attackId);
    const invDef = getPrimitive(attackId) ?? getMacro(attackId);
    if (!invDef?.meta) return;
    for (const fx of invDef.meta.effects ?? []) push(fx, via);
    for (const nextId of invDef.meta.invokes ?? []) visit(nextId, via, visited);
  };
  const visited = new Set([id]);
  for (const invId of def.meta.invokes ?? []) {
    const invDef = getPrimitive(invId) ?? getMacro(invId);
    visit(invId, invDef?.meta?.name ?? invId, visited);
  }
  // Apply per-invoke overrides from the attacks array: remove suppressed types.
  if (def.attacks) {
    for (const atk of def.attacks) {
      if (!atk.overrides) continue;
      for (const [key, val] of Object.entries(atk.overrides)) {
        if (val === false) {
          // Find and remove the matching effect row (by type or key match).
          const idx = rows.findIndex((r) => r.type === key || r.type.includes(key));
          if (idx !== -1) rows.splice(idx, 1);
        }
      }
    }
  }
  return rows;
}

/**
 * Resolve the FULL composition of an attack: direct AND inherited invokes,
 * transitive like resolveEffects (cycle-safe). Each row names the DIRECT
 * source it came through in `via` — so a macro that invokes a macro shows
 * both its own calls and the child's calls, clearly labeled:
 *
 *   radialShot → [ Spread Shot (own), Projectile (via Spread Shot) ]
 *
 * Primitives always return [] (they must not invoke — the enforceable
 * primitive/macro boundary). Single source of truth for the Theater's
 * INVOKES panel; hosts never read raw meta.invokes.
 * @param {string} id registry id (primitive or macro)
 * @returns {Array<{id:string, name:string, via?:string}>}
 */
export function resolveInvokes(id) {
  const def = getMacro(id); // primitives cannot declare invokes
  if (!def?.meta?.invokes) return [];
  const rows = [];
  const seen = new Set();
  const push = (invId, via) => {
    if (seen.has(invId)) return;
    seen.add(invId);
    const invDef = getPrimitive(invId) ?? getMacro(invId);
    rows.push({ id: invId, name: invDef?.meta?.name ?? invId, via });
  };
  const visited = new Set([id]);
  const visit = (attackId, via) => {
    if (visited.has(attackId)) return;
    visited.add(attackId);
    const d = getPrimitive(attackId) ?? getMacro(attackId);
    for (const nextId of d?.meta?.invokes ?? []) {
      push(nextId, via);
      visit(nextId, via);
    }
  };
  for (const invId of def.meta.invokes) {
    push(invId); // direct calls have no `via`
    visit(invId, getPrimitive(invId)?.meta?.name ?? getMacro(invId)?.meta?.name ?? invId);
  }
  return rows;
}
