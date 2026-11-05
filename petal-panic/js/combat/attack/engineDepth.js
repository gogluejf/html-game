// Step-depth guard for the self-contained attack lifecycle.
//
// Non-zero while inside an AttackHandle.step callback (driven by
// AttackLifecycle.stepAll). engine.invoke() uses this to suppress auto-
// registration of handles materialized DURING a step (deferred payloads:
// skyMissile launching its child mid-step, clusterBomb's onDetonate firing
// spawnSplit) — those children are stepped by their parent macro and must not
// be driven twice by the registry.
//
// Lives in its own module to avoid an engine.js <-> lifecycle.js import cycle
// (engine imports lifecycle for register; lifecycle needs the step flag).

/** Non-zero while inside an AttackHandle.step callback. */
export const _step = { depth: 0 };
