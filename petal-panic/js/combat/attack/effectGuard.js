// Attack Engine — effect declaration guard.
//
// Enforces the single-source-of-truth rule: an attack may only fire effects it
// DECLARED in meta.effects. This is what makes "I forgot to declare the effect
// but I can still call it" impossible — the fire path checks the declared set
// before spawning anything.
//
// Behavior:
//   - debug (Debug.enabled): undeclared type → THROW. You find it while testing.
//   - prod:                  undeclared type → console.warn + skip. Never crash
//     gameplay over a missing declaration (matches the engine's existing
//     "surface config bugs without crashing" policy).
//
// Wiring: installEffectGuard() is called once from the attack engine at load.
// It installs a checker into the effect engine (wireEffectGuard) that reads the
// caller's declared effect-type set. The checker is pure data comparison — no
// import cycle with the effect engine (we push the function in; they never
// import us back).

import { wireEffectGuard } from '../../effects/index.js';
import { Debug } from '../../debug/debug.js';

/**
 * Build the guard checker.
 * @param {(type:string, declared:Array<string>|null)=>boolean}
 */
export function makeEffectGuard() {
  return (type, declared) => {
    // No declared set supplied → nothing to check against (gameplay one-shots,
    // theater, tests). Always allowed; the guard only bites when a caller
    // passes its declared effect types.
    if (!declared || !Array.isArray(declared)) return true;
    if (declared.includes(type)) return true;
    const msg = `[attack] fired undeclared effect "${type}" — add it to meta.effects (declared: [${declared.join(', ')}])`;
    if (Debug.enabled) throw new Error(msg);
    console.warn(msg);
    return false;
  };
}

/** Install the guard into the effect engine. Idempotent. */
export function installEffectGuard() {
  wireEffectGuard(makeEffectGuard());
}
