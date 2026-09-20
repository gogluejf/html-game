// Petal Panic — sprite-shake effect (migrated from the pre-refactor monolith,
// js/effects.js `Effects.beginEnemyShake` + `getShakeOffset`; reference:
// .squid-os/plans/effect-engine/effect-reference.txt). Fast ±3px jitter on an
// entity while its hitFlash runs (design §12 "Enemy damaged: fast shake").
//
// The instance rides on the carrier's existing `hitFlash` timer (0.1s) so no
// second clock is needed: firing bumps hitFlash up to at least 0.1s (keeping
// any longer existing value), and getOffset() returns a fresh random offset
// within [-3, +3] px per axis while hitFlash > 0, else {0, 0}. Callers add the
// offset to the entity's draw position.
//
// update() marks done once the carrier's hitFlash has fully decayed (the same
// expiry the monolith tracked by zeroing getShakeOffset when hitFlash ended).
// Without this the engine would keep an inert instance active forever, since
// the carrier — not the effect — owns the hitFlash countdown. complete() also
// force-completes via the reset path.
//
// params: { amount? } — max offset per axis in px (default 3).
// carrier: entity with a `hitFlash` timer.

const SHAKE_AMT = 3; // ±3px (design §12 "fast shake")

/**
 * @param {{amount?:number}} params
 * @param {object} e entity with a hitFlash timer
 * @returns {{getOffset:Function, update:Function, render:Function, done:boolean, complete:Function}}
 */
export function spriteShake(params = {}, e) {
  const amt = params.amount ?? SHAKE_AMT;
  if (e) e.hitFlash = Math.max(e.hitFlash ?? 0, 0.1); // beginEnemyShake parity
  return {
    /** Per-frame random offset; {0,0} once the carrier's hitFlash has ended. */
    getOffset() {
      if (!e || !(e.hitFlash > 0)) return { x: 0, y: 0 };
      return {
        x: (Math.random() * 2 - 1) * amt,
        y: (Math.random() * 2 - 1) * amt,
      };
    },
    update() {
      // The carrier owns the hitFlash countdown; once it has fully decayed the
      // shake is inert, so report done and let the engine prune this instance.
      if (!e || !(e.hitFlash > 0)) this.done = true;
    },
    render() {},
    done: false,
    complete() { this.done = true; },
  };
}
