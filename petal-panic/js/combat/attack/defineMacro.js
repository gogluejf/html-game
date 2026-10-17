// Attack Engine — Macro definition helper (unified contract).
//
// Every macro declares its composition as an `attacks` array — the SINGLE
// source of truth for what it invokes. meta.invokes is DERIVED from this
// array (never hand-written), so it can never drift from the actual invokes.
//
// Contract:
//   attacks: [{ id, role?, params? }]
//     id     — registry id of the invoked attack (primitive or macro)
//     role   — optional label ('carrier', 'payload', 'split', etc.)
//     params — optional static param overrides merged at invoke time
//
// The impl receives `ctx.attacks` (the same array) and iterates it to invoke.
// No duplication, no divergence.

import { registerMacro } from './registry.js';

/**
 * Define and register a macro with the unified attacks-array contract.
 *
 * @param {string} id           registry id
 * @param {object} def
 * @param {Array}  def.attacks  [{ id, role?, params? }] — what this macro composes
 * @param {object} def.params   default params
 * @param {object} [def.meta]   extra meta (name, desc, effects, params list)
 * @param {Function} def.impl   (params, ctx) → handle
 */
export function defineMacro(id, def) {
  const { attacks, params, meta = {}, impl } = def;

  if (!Array.isArray(attacks) || attacks.length === 0) {
    throw new Error(`attack/${id}: 'attacks' array is required`);
  }

  // Derive invokes from the attacks array — single source of truth.
  const invokes = attacks.map((a) => a.id);

  registerMacro(id, {
    params: { ...params },
    meta: {
      name: meta.name ?? id,
      desc: meta.desc ?? '',
      effects: meta.effects ?? [],
      invokes, // ← derived, never hand-written
      params: meta.params ?? [],
    },
    impl(params, ctx) {
      // Expose the attacks array on ctx so impl can iterate it.
      ctx.attacks = attacks;
      return impl(params, ctx);
    },
  });
}
