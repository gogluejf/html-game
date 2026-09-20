// Petal Panic — sprite-flash effect (effects.md §12, catalog #12).
// Temporarily flashes or tints a sprite: damage feedback, invincibility,
// power-ups, attack charging, state changes.
//
// The instance owns its own clock and drives an on/off cycle over the carrier's
// sprite box: `flashes` full cycles of on→off, each half lasting
// `duration / (2 * flashes)` seconds. While ON it tints the sprite box with
// `color` at alpha `opacity`; while OFF it draws nothing. Total lifetime is
// exactly `duration` — done-detection uses the 1e-9 epsilon convention so a
// fixed-dt accumulator that lands ~1e-16 past the boundary still completes.
//
// World-space effect: render() draws in world coordinates (the engine's single
// drawEffects pass runs after the camera restore, so callers needing a
// world-space tint invoke it inside the camera transform; screen-space effects
// are unaffected because this one never reads the viewport).
//
// params: { color?, duration?, flashFrequency?, flashes?, opacity?, blendIntensity? }
//   color          — CSS tint color (default '#ffffff')
//   duration       — TOTAL lifetime in seconds (default 0.4)
//   flashFrequency — Hz, how many on/off CYCLES per second (default 8);
//                    when omitted/absent, `flashes` derives from it as
//                    max(1, round(flashFrequency * duration))
//   flashes        — explicit number of on/off cycles (default 3); wins over
//                    flashFrequency when both are given
//   opacity        — tint strength 0..1 while ON (default 0.7)
//   blendIntensity — additional alpha multiplier applied to the tint while ON
//                    (default 1.0 = no change; effective alpha =
//                    opacity * blendIntensity). Lets a caller dial down how
//                    strongly the tint blends over the sprite without touching
//                    the base opacity contract.
//   box            — UNDOCUMENTED fallback geometry { x, y, w, h } in WORLD
//                    coordinates, captured at factory time. Used only when the
//                    carrier exposes neither worldBox() nor origin()+size()
//                    (tests, theater demos with a null carrier). No default:
//                    absent or non-positive w/h → render() is a no-op.
//
// carrier: entity whose sprite box to tint. Geometry is read at DRAW time via
// carrier.worldBox() ({ x, y, w, h }) when available, falling back to
// carrier.origin()/size() (carrier contract), then to factory-time
// params.box { x, y, w, h } for carriers without geometry accessors (tests,
// theater demos). A null carrier falls back to params.box only.

/**
 * @param {{color?:string, duration?:number, flashFrequency?:number,
 *         flashes?:number, opacity?:number, blendIntensity?:number,
 *         box?:{x:number,y:number,w:number,h:number}}} params
 * @param {object} [carrier] entity with worldBox()/origin()+size(), or null
 * @returns {{on:boolean, update:Function, render:Function, complete:Function, done:boolean}}
 */
export function spriteFlash(params = {}, carrier = null) {
  const duration = Math.max(0, params.duration ?? 0.4);
  // Clamp opacity to [0,1]: a negative value collapses to 0 so render() is a
  // no-op (same policy as screenFlash/screenOverlay).
  const opacity = Math.min(1, Math.max(0, params.opacity ?? 0.7));
  // Blend intensity: extra alpha multiplier on top of opacity while ON.
  // Default 1.0 preserves the pre-existing behavior exactly; values are
  // clamped to [0,1] like opacity (negative → invisible tint, >1 → full).
  const blendIntensity = Math.min(1, Math.max(0, params.blendIntensity ?? 1));
  // Cycle count: explicit `flashes` wins; otherwise derive from the declared
  // frequency so the two params stay interchangeable (doc lists both).
  const flashes = Math.max(1, Math.round(params.flashes ?? (params.flashFrequency ?? 8) * duration));
  // Each half-cycle (one ON stretch OR one OFF stretch) lasts this long.
  const half = duration / (2 * flashes);

  return {
    on: true, // first frame is ON: the flash kicks in immediately on fire
    elapsed: 0,
    /** Advance the clock; toggle ON/OFF at each half-cycle boundary. */
    update(dt) {
      this.elapsed += dt;
      if (this.elapsed >= duration - 1e-9) {
        // Epsilon done-detection (project convention): fixed-dt accumulation
        // lands at ~1e-16 past the exact boundary, so a strict comparison
        // would never mark done.
        this.done = true;
        this.on = false;
        return;
      }
      // Phase index into the half-cycles; parity decides ON vs OFF. The same
      // epsilon guards the phase boundary so a frame landing exactly on it
      // flips state instead of lingering in the previous half.
      const phase = Math.floor((this.elapsed + 1e-9) / half);
      this.on = phase % 2 === 0;
    },
    /** Tint the carrier's sprite box while ON; no-op while OFF or done. */
    render(c2d) {
      if (this.done || !this.on) return;
      const box = resolveBox(carrier, params.box);
      if (!box) return;
      c2d.save();
      c2d.globalAlpha = opacity * blendIntensity;
      c2d.fillStyle = params.color ?? '#ffffff';
      c2d.fillRect(box.x, box.y, box.w, box.h);
      c2d.restore();
    },
    complete() {
      this.done = true;
      this.on = false;
    },
    done: false,
  };
}

/**
 * Resolve the sprite box to tint at draw time. Preference order:
 * carrier.worldBox() → carrier.origin()+size() → factory-time params.box.
 * Read at draw time (not fire time) so the tint tracks a moving sprite.
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
function resolveBox(carrier, fallbackBox) {
  if (carrier && typeof carrier.worldBox === 'function') {
    const b = carrier.worldBox();
    if (b && b.w > 0 && b.h > 0) return b;
  }
  if (carrier && typeof carrier.origin === 'function' && typeof carrier.size === 'function') {
    const o = carrier.origin();
    const s = carrier.size();
    if (o && s && s.w > 0 && s.h > 0) {
      return { x: o.x - s.w / 2, y: o.y - s.h / 2, w: s.w, h: s.h };
    }
  }
  if (fallbackBox && fallbackBox.w > 0 && fallbackBox.h > 0) return fallbackBox;
  return null;
}
