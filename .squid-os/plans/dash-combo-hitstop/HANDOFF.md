# Handoff — Dash Combo (§13) + Hit-Stop

Status: **READY TO CODE.** Design is locked (see references below). This doc is
the execution brief: what to build, in what order, with which acceptance checks.
Boxes-first (placeholder rectangles) — sprites are NOT in the engine yet; the
`frame` field is a label the renderer maps later.

---

## Part A — Dash Combo macro (`charge`)

**Spec of record:** `petal-panic/docs/architecture/attack-macros.md` §13
(commit a757615 + follow-ups). Do NOT re-litigate design; implement the spec.

### The model (one paragraph)

A timeline of N segments. Each segment = **MOVE phase** (hold one sprite frame,
travel at `speed` for `duration`, afterimage trails, body SHOVES overlapping
victims at `shove × speed` — physics only, no damage) → **FREEZE phase**
(attacker stops on the same frame for `freezeFrames`; the segment's Melee
Hitbox is live ONLY here — this is the hit). Segments run back-to-back, no gaps.
ONE recovery window at the very end. Last segment's freeze carries the real
knockback launch; all earlier freezes are `knockback: null`.

### Registration

- id: `charge` (doc name "Charge / Dash"; registry id stays `charge` so the
  existing theater preset/sandbox entry keeps working)
- file: `petal-panic/js/combat/attack/macros/charge.js`
- barrel: add to `macros/index.js`
- `meta.invokes`: `['movement', 'meleeHitbox']`
- `meta.effects` (native, fired by this macro):
  - `{ type: 'afterimage', desc: 'trail during each segment move phase' }`
  - `{ type: 'sprite-shake', desc: 'victim shake on connected freeze hits' }`
  - `{ type: 'hit-sparkle', desc: 'hit juice on connected freeze hits' }`
- handle shape:
  - `h.step(dt, targets)` → true when done
  - `state.phase` — `'startup' | 'move' | 'freeze' | 'recovery' | 'done'`
  - `state.segmentIndex`, `state.shoveBox` (current move-phase AABB, for tests)
  - events: `hit { target, dealt, segmentIndex }`, `complete { broken?: boolean, connections: number }`

### Params (macro-level)

```js
{
  segments: [ ... ],        // REQUIRED — see per-segment fields
  direction: 0,             // radians; horizontal only (clamp to 0 or π)
  startup: 0.2,             // s before first segment moves (commitment tell)
  recovery: 0.4,            // ONE window after last freeze (punish zone)
  afterimage: null,         // effect override (count/fadeRate/lifetime/color)
  shakeStyle: null,         // victim sprite-shake override
}
```

Per-segment fields:

```js
{
  frame: 'a',               // sprite label (boxes-first: just an id)
  speed: 420,               // px/s move phase
  duration: 0.18,           // s move phase (or distance cap)
  distance: null,           // optional travel cap
  freezeFrames: 0.12,       // s the stop lasts; hitbox live here
  hitbox: { w: 48, h: 40, offset: { x: 30, y: 0 }, activeFrames: null },
  damage: 10,
  knockback: null,          // LAST segment only: { base, scaleBySpeed, hitstun, pop?, dirMode }
  shove: 0.6,               // fraction of speed pushed into overlapping victims (0 = off)
}
```

### Behavior rules (acceptance checklist)

1. **Move phase:** attacker translates along `direction`; NO hitbox; afterimage
   instance fed attacker origin each frame; any target whose AABB overlaps the
   attacker body gets `vx += sign(direction) * speed * shove` (per-frame,
   scaled by dt — apply as velocity SET toward shove speed while overlapping,
   not an impulse, so it reads as continuous shoving). No damage, no hitstun.
2. **Freeze phase:** attacker stationary; meleeHitbox primitive active for
   `freezeFrames`; on connect → `takeDamage` pipeline + `hit-sparkle` +
   `sprite-shake` on the VICTIM (amount scales with segmentIndex) + emit `hit`.
   Knockback applied ONLY if the segment carries a setting (last segment).
3. **Breaker:** if the ATTACKER takes a MELEE hit while phase ∈ {move, freeze}:
   abort timeline immediately, drop pending segments/hitboxes, emit
   `complete { broken: true }`. Attacker takes the hit normally (NO extra
   stun/stagger — normal damage rules). Afterimage instances terminate on
   their own clock (B2 recency — do not manually clear).
4. **Projectiles do NOT break:** ranged contact on the attacker = damage only,
   timeline continues. Gate: hit method/type is melee vs projectile.
5. **Recovery:** after last freeze, `recovery` seconds where the attacker
   cannot act (host-readable via state.phase); any hit then is a free punish
   (no special code — the combo is already complete).
6. **Victim death mid-combo:** dead targets simply stop connecting; combo
   completes with fewer connections. No crash paths.
7. **Cancel safety:** `h.cancel()` mid-timeline leaves no ghost hitboxes, no
   orphan afterimages beyond their natural fade.
8. **Determinism:** same params + same target positions → identical timeline
   (test with fixed dt steps).

### Theater

- preset: 3 segments (speeds ~380/460/0-planted, escalating damage 8/10/18,
  last with knockback `{ base: 260, hitstun: 0.3, dirMode: 'fromAttacker' }`)
- tweakables: startup, recovery, per-segment damage (first segment enough to
  prove tuning), direction
- staging: boxes — attacker box + target box; draw the current segment's
  hitbox outline during freeze (debug aid), shove indicated by target sliding
- step routing: `h.step(DT, [target, ...vics])` like stomp family

### Tests (`js/test/attack/charge.test.js`, pure node)

- segment sequencing: phases visit startup→(move→freeze)×N→recovery→done,
  correct durations
- move phase deals NO damage; freeze phase DOES (dummy target takeDamage)
- shove: overlapping dummy gains vx toward dash direction during move phase,
  zero change during freeze
- knockback only on last freeze (dummy vx unchanged after seg1/seg2 freezes,
  launched after segN)
- breaker: melee hit on attacker during move AND during freeze both abort with
  `broken: true`; projectile hit does NOT abort
- afterimage instances exist during move, absent/cleared-of-new-points during
  freeze (check via effect engine active set or instance count)
- victim death mid-combo completes cleanly
- determinism: two runs, identical outputs

---

## Part B — Hit-Stop (time-layer hook)

**Spec of record:** `.squid-os/plans/knockback-system/hitstop-proposal.md`
(deferred proposal — this handoff ACTIVATES it, scoped per its decision rule).

### What it is

A global simulation pause of N fixed frames on a connect frame. NOT an effect
(presentation vs truth rule — see effects.md Core Rule). Lives in the
gameplay/time layer, next door to the Effects Engine, one-way boundary.

### Implementation

New module `petal-panic/js/core/hitstop.js` (~15 lines):

```js
let remaining = 0;
export function hitstop(frames = 5) { remaining = Math.max(remaining, frames); }
export function consumeHitstop() { return remaining > 0 ? --remaining : 0; }
export function hitstopActive() { return remaining > 0; }
```

Game-loop integration (fixed-timestep step, wherever `update(DT)` is driven —
check `systems/update.js`): at the TOP of the fixed step, `if (consumeHitstop())
return;` — skip the ENTIRE step (entities, pools, effects updateAll, particles,
camera decay). Render still runs every rAF (frozen frame redrawn = the pose).
The fixed-step accumulator must NOT advance during frozen steps (no drift).

Rules:
- 4–6 frames max (default 5 ≈ 83ms). Longer = lag feel.
- `Math.max` semantics: overlapping requests don't stack past the larger.
- Debug-only gate optional: `Debug.enabled ? frames : 0` if playtest says it's
  too much — but ship enabled; it's the whole point.

### Scoped call sites (ONLY these — scarcity is the design)

| Call site | Frames | Trigger |
|-----------|--------|---------|
| Special melee (sweep/cartwheel) | 5 | the single connect frame (hero.js specialMelee active→hit) |
| Dash combo FINISHER (§13 last freeze) | 5 | that freeze's connect frame only — NOT per segment |
| Supermove | 5 | its connect frame (wire when supermove lands; leave a TODO marker) |

Explicitly NOT: basic melee, projectiles, bombs, stomps, explosions (they have
their own juice channels; stacking = noise). If per-segment dash stops ever get
wanted, cap at 2–3 frames and finisher-only-by-default.

### Tests (`js/test/hitstop.test.js`)

- `hitstop(n)` then n consecutive `consumeHitstop()` calls return frozen=true,
  then false
- overlapping calls use max, not sum
- integration-style: a stub loop that skips steps on consumeHitstop produces
  exactly n skipped updates and resumes cleanly (no accumulated dt drift)

### Playtest gate

After wiring: F4/theater or a quick enemy using `charge` — verify the finisher
freeze reads as weight, not stutter. If it reads as lag: drop to 4 frames or
gate behind Debug. Record the verdict in this file's Notes.

---

## Build order

1. `core/hitstop.js` + loop integration + unit tests (small, unblocks B)
2. `charge.js` macro: sequencing + hitboxes + damage (no effects yet)
3. charge: shove + afterimage + victim shake/sparkle
4. charge: breaker rules + cancel safety
5. Wire hitstop into special melee connect + charge finisher connect
6. Theater preset/staging/tweakables for charge
7. Full test suite green + playtest note

## Open questions (decide at build time, don't block on)

- Shove application: velocity-set vs impulse-per-frame — start with
  velocity-set at `shove × speed`, tune by feel
- Does the attacker's own body deal Body Contact damage during the dash?
  Spec says NO (hitboxes only) — confirm against hero.js melee exclusions
- Sprite frame source later: which enemy/hero anim provides the segment
  frames (animation-studio revision will feed this; `frame` labels are the seam)

## Notes

(add playtest verdicts + tuning values here as they happen)
