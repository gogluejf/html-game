# Petal Panic — Hero Mechanics

> **Single source of truth for how the hero controls and feels.**
>
> This document supersedes the previous Hero Engine Polish scope, Hero Mechanics document, and subsequent revision manifest.
>
> If hero code and this document disagree, this document wins unless the design is intentionally changed.
>
> Requirements describe **gameplay behavior and invariants**, not a mandatory internal implementation architecture.

---

# 1. Design Goals

The hero controller should feel:

* Immediate and responsive.
* Fast without becoming difficult to control precisely.
* Forgiving around human input timing.
* Predictable: the same input/state combination produces the same behavior.
* Committed during meaningful attack frames without making movement feel sticky.
* Capable of combining movement, aiming, shooting, melee, and platforming naturally.
* Character-specific where doing so creates meaningful gameplay differences.

Avoid unnecessary animation/state lockouts.

Player intent should regain control as soon as the current action reaches a legitimate cancellation point.

---

# 2. Default Controls

| Action         | Default       |
| -------------- | ------------- |
| Move / Aim     | WASD / Arrows |
| Jump           | Space         |
| Crouch / Slide | S / Down      |
| Melee          | H             |
| Shoot          | J             |
| Supermove      | K             |
| Switch Weapon  | N             |
| Lock Direction | I             |
| Lock Movement  | O             |
| Pause          | Esc / P       |

Gamepad mirrors these through the remapping system.

The d-pad/left stick controls movement and aim.

**The right stick is not bound to anything.**

All bindings are remappable.

---

# 3. Direction, Facing & Aim

## One Directional Input

There is no independent aim device.

The same 8-way directional input normally controls:

1. locomotion, and
2. aim.

Example:

* Right → move right + aim right.
* Up-right → movement intent right + aim up-right.
* Left → move left + aim left.

Aim must have exactly one directional-input source.

---

## Facing

The hero maintains a horizontal facing direction.

Normal horizontal movement updates facing.

When facing changes:

* the hero sprite mirrors appropriately;
* attacks and neutral shooting use the new facing direction.

When there is no directional input, facing remains at its previous horizontal direction.

---

## Neutral Shooting

If Shoot is pressed with **no directional input**:

* fire horizontally in the direction the hero is facing.

The player never needs to re-enter a direction merely to shoot forward.

---

# 4. Contextual Down / Downward Aim

Down has context-sensitive behavior.

## Grounded Normally

While grounded without Movement Lock:

**Down = crouch/slide.**

It does **not** mean downward shooting.

While crouched:

* shooting fires horizontally;
* direction is the hero's current facing direction.

This is intentionally Contra-style behavior.

There is no normal grounded crouch + straight-down shooting state.

---

## Airborne

While airborne:

**Down = downward aim.**

Shoot while holding Down:

* fires straight downward.

---

## Movement Locked

While Lock Movement is active:

* Down no longer needs to initiate crouch;
* directional input remains available for aiming.

Therefore:

**Lock Movement + Down = aim/shoot straight downward.**

---

# 5. Lock Direction

Default: **I**

Lock Direction freezes the **currently resolved aim direction** when engaged.

Once locked:

* movement may change freely;
* shooting continues toward the frozen aim;
* changing movement direction does not change aim.

Example:

1. Aim right.
2. Hold Lock Direction.
3. Walk left.
4. Shots continue traveling right.

Release Lock Direction:

* aim immediately returns to following normal directional-input rules.

---

## Locking Downward Aim

Downward aim is a valid lock direction.

Examples:

**Airborne + Down → Lock Direction**

The hero may subsequently move/release Down while continuing to shoot downward.

Likewise:

**Movement Lock + Down → Lock Direction**

captures straight-down aim.

Lock Direction always captures the **resolved aim**, not merely the raw directional key.

---

# 6. Lock Movement

Default: **O**

Lock Movement disables player-driven locomotion.

It does **not** disable physics.

While active:

* player locomotion is zeroed;
* gravity continues;
* knockback continues;
* platform interactions continue;
* aim continues following directional input.

This allows the player to remain planted while freely changing aim.

Release Lock Movement:

* normal locomotion resumes.

---

## Lock Composition

Lock Direction and Lock Movement must compose predictably.

Both may be active simultaneously.

Movement remains locked while aim follows the applicable Lock Direction semantics.

Neither lock should accidentally disable gravity, knockback, collision, or other world physics.

---

# 7. Ground Movement

## Run

Pressing a horizontal movement direction produces normal run speed immediately.

There is no slow ground acceleration ramp.

Ground movement should feel arcade-responsive.

---

## Release / Friction

Releasing horizontal movement produces a short friction tail before rest.

The tail should be noticeable enough to avoid robotic stopping but short enough to preserve precision.

---

## Opposite Direction

Pressing the opposite horizontal direction cancels existing momentum immediately.

The hero must not coast significantly against explicit opposite-direction player intent.

Direction reversal should feel immediate.

---

# 8. Air Control

Ground and airborne horizontal control intentionally behave differently.

## Existing Momentum

If the hero jumps while already moving:

* legitimate horizontal momentum is preserved.

A normal running jump should therefore continue naturally.

---

## Starting Horizontal Movement in Air

If the hero enters the air with little or no horizontal velocity and then presses a horizontal direction:

* do **not** instantly assign full run speed;
* accelerate toward normal horizontal speed over a short period.

The ramp should remain quick and responsive.

This is not intended to create floaty or sluggish air control.

---

## Solid-Obstacle Case

Example:

1. Hero runs against a barrel.
2. Barrel correctly blocks movement.
3. Player continues holding toward the barrel.
4. Hero jumps.
5. Once high enough to clear the barrel, horizontal movement becomes possible.

The hero should accelerate into horizontal movement rather than instantly snapping from approximately zero velocity to full run speed.

This makes it possible to:

* jump onto the barrel precisely;
* clear it naturally;
* avoid the feeling of suddenly "running at full speed in mid-air."

This is a **general air-control rule**, not a special barrel/block velocity cap.

The previous concept of a dedicated **jump-off-solid speed cap is superseded** by this behavior.

---

# 9. Jump

## Jump Count

The hero has:

1. one ground jump;
2. one air jump.

---

## Variable Jump Height

Holding Jump produces the full jump.

Releasing Jump early cuts upward movement and produces a shorter jump.

Therefore:

* tap = hop;
* hold = full-height jump.

---

## Jump Buffer

Jump input is buffered shortly before landing.

Target window:

**~0.12 seconds**

If Jump is pressed shortly before ground contact:

* remember the input;
* trigger the ground jump when landing occurs.

This prevents slightly early jump inputs from being lost.

---

## Coyote Time

Walking/running/falling off a platform does not immediately remove access to the ground jump.

For a short period after leaving the platform:

* pressing Jump still initiates the normal ground jump.

After coyote time expires:

* normal airborne jump rules apply.

Coyote time should be short enough to feel invisible during normal play.

Its purpose is timing forgiveness.

Jump buffer and coyote time are complementary:

* **Jump buffer:** forgiveness before landing.
* **Coyote time:** forgiveness after leaving ground.

---

# 10. Crouch & Slide

Down while normally grounded controls both crouch and slide.

**Up never crouches.**

---

## Crouch

Down while approximately stationary:

* enters crouch;
* feet remain planted;
* hero hitbox shrinks appropriately;
* horizontal locomotion is locked.

Shooting while crouched remains horizontal toward facing.

---

## Slide

Down while running:

* enters slide;
* preserves initial movement momentum;
* automatically skids forward;
* horizontal velocity decelerates linearly.

Target slide distance:

**~65 px**

The intended feel is an ice-skid momentum bleed, not an instant stop.

The player does not need to continue pressing Forward to maintain the slide trajectory.

---

# 11. Crouch / Slide Cancellation

Crouch and slide must never leave the hero trapped in stale state.

Valid locomotion transitions cancel crouch/slide cleanly.

Examples:

* Release Down + move → stand/run.
* Jump → immediately cancel crouch/slide into jump.
* Returning to normal locomotion → restore the appropriate standing/running hitbox and animation.

When crouch/slide ends:

* state,
* movement restrictions,
* hitbox,
* animation

must transition together.

No crouch hitbox or animation may remain after the hero is back on their feet.

---

# 12. Jump From Crouch

Jump is always allowed from crouch when normal jump rules permit it.

Jump:

* cancels crouch;
* restores the appropriate airborne hitbox/state;
* immediately initiates the jump.

Crouching must never force the player to stand first before jumping.

---

# 13. One-Way Platforms

One-way platforms behave directionally.

## Jumping Up Through

While moving upward from underneath:

* the hero passes through the platform.

The underside does not block the jump.

Once the hero clears the platform top and begins falling:

* the platform becomes landable normally.

---

## Landing

Approaching the platform from above while falling:

* the platform behaves as ground.

---

## Drop Through

**Down + Jump** while standing on a one-way platform:

* intentionally drops the hero through the platform;
* temporarily ignores that platform long enough for the hero to clear it;
* does not consume the input as a normal upward jump.

Solid terrain is unaffected.

---

# 14. Normal Melee

Default: **H**

Normal melee is intentionally fast and snappy.

Conceptual phases:

`windup → ACTIVE → recovery`

Target animation:

`3 frames → 1 active frame → 1 recovery frame`

The exact animation timing may be tuned, but the attack should remain fast.

Total perceived swing should be approximately **0.4 seconds or less**, depending on animation playback/tuning.

---

## Melee Hitbox

Only designated active frame(s) deal damage.

The attack hitbox must be generated from the current melee animation/state data.

The hitbox should appear at the visual impact point rather than existing throughout the entire animation.

Damage routes through the central damage system and respects:

* teams;
* hero stats;
* attack properties;
* target damage rules.

---

# 15. Special Melee

**Down + Melee = Special Melee**

Special melee is a hero-specific physical attack containing built-in horizontal movement.

The player does **not** need to press Forward.

The attack supplies its own trajectory.

Like normal melee:

`windup → ACTIVE → recovery`

It uses:

* animation-synchronized hitboxes;
* central damage routing;
* normal attack commitment rules;
* shared melee buffering;
* recovery cancellation.

---

## Balthazar — Advancing Sweep

Balthazar performs a low forward sweep.

On activation:

* travel automatically toward his facing direction;
* slide/advance through the attack;
* apply damage during designated active frames.

Primary tactical purpose:

**aggressive advancing attack.**

The player does not need to hold Forward.

The attack trajectory cannot be manually reversed while committed.

---

## Scarlet — Retreating Cartwheel

Scarlet performs an attacking backward cartwheel.

On activation:

* travel opposite her facing direction;
* remain oriented toward the direction she was facing;
* apply damage during designated active frames.

Primary tactical purpose:

**evasive repositioning while attacking.**

It is not merely a dodge.

The cartwheel does **not automatically imply full i-frames**.

Any:

* temporary hurtbox reduction;
* brief invulnerability;
* special evasive property

must be explicitly configured/tuned rather than assumed.

The trajectory cannot be manually reversed while committed.

---

## Character Contrast

The same input deliberately has different tactical meaning:

**Balthazar:** attacks *into* space.

**Scarlet:** attacks while *leaving* space.

---

# 16. Melee Commitment & Cancellation

Normal melee and special melee share the same high-level rules.

## Windup

Committed.

Normal movement/jump cannot abort the attack.

## Active

Committed.

The attack cannot be cancelled during its damaging frames.

## Recovery

Cancellable.

Once recovery begins:

* Jump may immediately cancel recovery.
* Run/movement may immediately cancel recovery.
* Valid normal locomotion transitions may interrupt the remaining recovery.

Therefore:

**Windup + Active = committed.**

**Recovery = player locomotion can regain control immediately.**

This intentionally keeps attacks meaningful without making movement feel sticky.

---

# 17. Shared Melee Input Buffer

Normal melee and special melee share **one pending melee-action slot**.

Capacity:

**exactly one action.**

Possible values:

* Normal Melee
* Special Melee
* Empty

---

## Buffering

If the player requests either melee action while the current melee action has not completed:

* remember the requested melee action.

If the slot is empty:

* store it.

If the slot already contains another melee action:

* replace it with the newest valid melee input.

Therefore:

**latest valid melee input wins.**

There is never a multi-action queue.

Repeated button mashing cannot schedule several future attacks.

---

## Example

Player performs:

`Melee → Special Melee input → Melee input`

before the first attack finishes.

Pending state:

`Special Melee`

then becomes:

`Melee`

Only the final `Melee` remains buffered.

---

# 18. Buffering Does Not Cancel Recovery

A buffered attack **never shortens recovery**.

It waits for the current attack to complete:

`windup → ACTIVE → full natural recovery`

Only after recovery naturally finishes:

* execute the buffered melee action.

Therefore:

**Buffer = "do this attack when the current attack completely finishes."**

Buffering is not cancellation.

---

# 19. Cancellation Always Beats Buffering

Cancellation and buffering are separate systems.

If:

1. a melee action is buffered;
2. current attack enters recovery;
3. player performs a valid recovery-cancel action;

then:

* cancel recovery immediately;
* perform the requested locomotion action;
* clear the pending melee buffer.

Example:

`Melee → buffer Special Melee → recovery → Jump`

Result:

`Jump`

The Special Melee is discarded.

Likewise:

`Special Melee → buffer Melee → recovery → Run`

Result:

`Run`

The buffered Melee is discarded.

Final invariant:

**Buffered melee waits. Cancellation interrupts. Cancellation always wins and clears the buffer.**

---

# 20. Shooting

Default: **J**

Default weapon:

**Thorn**

Shots originate near the hero's center with a small offset toward the resolved aim direction so the projectile begins outside the body.

---

## Auto-Fire

Holding Shoot:

* continuously attempts to fire;
* actual shots are gated by weapon fire-rate cooldown.

Fire rate derives from hero/weapon stats.

---

## Ammo

Each successful shot consumes the appropriate ammo.

No ammo:

* no projectile is created.

---

## Friendly Fire

Hero-owned/friendly projectiles cannot damage the hero.

Friendly-fire prevention should exist by construction in the damage/team system.

---

# 21. Weapon Switching

Default: **N**

Switch Weapon toggles Shoot between:

1. Thorn
2. Special

The selected weapon persists until toggled again.

Each weapon has:

* its own ammo pool;
* its own cooldown;
* its own projectile behavior.

---

## Thorn

Default workhorse weapon.

Characteristics:

* fast;
* straight;
* inexpensive/common ammunition.

---

## Scarlet Special

Scarlet throws a fast saw blade.

Characteristics:

* fast;
* no gravity;
* short range.

---

## Balthazar Special

Balthazar throws/lobs a bomb.

Characteristics:

* gravity;
* fuse;
* area-of-effect explosion.

The Special weapon must route through the same weapon-selection system rather than existing as an unrelated hidden firing path.

---

# 22. Supermove

Default: **K**

Supermove uses a meter.

Target full-charge time:

**~5 seconds**

K does nothing until the meter is full.

---

## Activation

When activated:

* consume/reset the full meter;
* enter Supermove state;
* hero becomes intangible for the dash;
* attack movement takes control.

Works while:

* grounded;
* airborne.

---

## Dash Profile

Conceptually:

### First ~60%

* high horizontal burst speed;
* no gravity;
* airborne sliding/dashing behavior.

### Last ~40%

* gravity resumes;
* horizontal speed decays;
* hero begins returning naturally toward the ground.

At completion:

* retain a small residual forward nudge;
* do not stop unnaturally dead in mid-air.

---

## Supermove Damage

The hero damages enemies passed through during the dash.

Use an attack hitbox approximately:

* body-height;
* relatively thin;
* positioned toward the direction of travel.

Damage must use the central damage system.

---

## Supermove Intangibility

For the intended dash window:

* enemy attacks/hitboxes pass through the hero;
* incoming damage is ignored.

Supermove intangibility uses the same underlying damage immunity semantics as other intangible states.

---

# 23. Supermove Jump Cancellation

The active burst portion is committed.

Jump **cannot** cancel the active dash frames.

Once the supermove enters its recovery/deceleration portion:

* Jump may cancel out of the remaining recovery.

Therefore:

**Active dash = committed.**

**Recovery/deceleration = jump-cancellable.**

The cancellation must not allow the player to prematurely abort the damaging high-speed burst.

---

# 24. Getting Hit

When valid incoming damage reaches the hero:

1. apply damage;
2. calculate contextual knockback;
3. enter brief hit-stun;
4. apply i-frames/intangibility;
5. provide appropriate visual feedback.

During hit-stun:

* normal player input is temporarily locked;
* physics and knockback continue.

---

# 25. Contextual Knockback

Hero knockback must not use one universal recoil value.

Knockback depends on the impact source.

At minimum distinguish:

* enemy body/contact;
* enemy melee;
* ordinary projectile;
* heavy projectile;
* explosion/bomb;
* explicitly configured special attacks.

Resulting knockback should consider:

* attack/source knockback strength;
* impact direction;
* relevant source/projectile velocity;
* attack-specific modifiers;
* hero knockback resistance/modifiers where applicable.

---

## Examples

Enemy contact:

* relatively small separation recoil.

Ordinary projectile:

* directional impact appropriate to projectile movement.

Heavy melee:

* stronger launch.

Bomb/explosion:

* strong radial knockback away from explosion origin.

Damage and knockback are independent properties.

Two attacks may:

* deal equal damage;
* produce very different recoil.

---

# 26. Knockback Decay

Initial knockback velocity decays over time.

During the decay:

* hit-stun temporarily prevents normal control as configured;
* physics remain active.

Once control returns:

* normal movement rules resume cleanly rather than leaving residual state locks.

---

# 27. I-Frames & Intangibility

Taking damage grants a brief invulnerability window.

During i-frames:

* subsequent incoming damage is ignored;
* overlapping enemy attacks cannot repeatedly damage the hero.

Respawning also grants i-frames.

Supermove and powerups may independently grant intangibility.

All such states should resolve through common damage-immunity semantics.

---

## I-Frame Visual Feedback

The hero should visibly communicate temporary invulnerability.

Use an i-frame flash/flicker or equivalent readable visual effect.

The visual effect must correspond to the actual immunity window rather than drifting independently from gameplay state.

---

# 28. Status Timers

Temporary effects use labeled timers visible in the debug overlay.

| Timer        | Effect                                        |
| ------------ | --------------------------------------------- |
| `intangible` | Damage immunity: i-frames, supermove, powerup |
| `rapid`      | Increased/doubled fire rate                   |
| `special`    | Special-weapon cooldown                       |

Timers should represent actual gameplay state and remain synchronized with their corresponding effects.

---

# 29. Animation State Synchronization

Animation must reflect authoritative gameplay/physics state.

At minimum synchronize:

* idle;
* run;
* jump/fall;
* crouch;
* slide;
* normal melee;
* special melee;
* shooting where applicable;
* supermove;
* hit/hit-stun;
* death.

Animation state must not drift away from physics/combat state.

Examples:

* Hero cannot visually remain crouched after jumping.
* Slide animation cannot continue after normal running resumes.
* Melee active hitbox cannot occur on an unrelated visual frame.
* I-frame flashing cannot continue after immunity expires.
* Supermove visuals cannot continue after the gameplay state has ended.

Gameplay state is authoritative.

Animation represents it.

---

# 30. Per-Frame Attack Hitboxes

Attack hitboxes should be driven by the current attack/animation phase.

Normal melee, special melee, and supermove must expose damage only on their intended active frames/windows.

Hitbox data should be capable of varying by:

* hero;
* attack;
* animation frame/phase;
* facing;
* attack-specific offset and size.

Mirroring the hero must also correctly mirror attack hitboxes.

Visual impact and gameplay impact should coincide.

---

# 31. State Interaction Principles

The hero should not be implemented conceptually as one mutually exclusive mega-state where every property excludes every other property.

Several domains can legitimately coexist.

Example:

A hero may simultaneously be:

* airborne;
* facing right;
* direction-locked downward;
* temporarily intangible.

Likewise, physics, combat, damage, aiming, and temporary effects may overlap.

State interactions must therefore remain explicit and predictable.

---

# 32. Input Resolution Principles

When multiple systems inspect the same directional input, resolve it according to gameplay context rather than raw keys alone.

Important examples:

### Grounded + Down

→ crouch/slide.

### Grounded + Down + Shoot

→ crouch + horizontal shot toward facing.

### Movement Lock + Down + Shoot

→ stationary + downward shot.

### Airborne + Down + Shoot

→ downward shot.

### Down + Melee

→ Special Melee.

### Down + Jump on one-way platform

→ drop through.

Context-specific actions take precedence over generic interpretation of the raw Down input.

---

# 33. Responsiveness Invariants

These rules are particularly important to the intended feel:

* Opposite ground direction immediately defeats existing ground momentum.
* Crouch never traps the player.
* Jump can cancel crouch.
* Jump buffer forgives slightly early input.
* Coyote time forgives slightly late input.
* Airborne movement from rest accelerates instead of snapping instantly to full speed.
* Existing legitimate jump momentum is preserved.
* One-way platforms never block upward traversal.
* Down + Jump intentionally drops through one-way platforms.
* Melee windup/active frames remain committed.
* Melee recovery is movement/jump cancellable.
* Buffered melee never shortens recovery.
* Cancellation always beats and clears buffered melee.
* Melee buffer stores at most one action.
* Latest valid melee input replaces the previous pending melee.
* Supermove active dash cannot be jump-cancelled.
* Supermove recovery/deceleration can be jump-cancelled.
* Hitboxes exist only during intended attack windows.
* Animation, hitbox, physics, and gameplay state remain synchronized.

---

# 34. Character-Specific Hero Feel

Shared mechanics should provide a common control language.

Character-specific actions may deliberately produce different tactical behavior.

Current important distinction:

### Balthazar

Down + Melee:

**forward advancing sweep**

Aggressive / closes distance.

### Scarlet

Down + Melee:

**backward attacking cartwheel**

Evasive / creates distance.

The goal is not to give each hero unrelated controls.

The goal is:

**same controls, different character expression.**

---

# 35. Tuning Values

Values such as these are tuning targets rather than architectural invariants:

* ~0.12s jump buffer;
* coyote-time duration;
* ~65px slide distance;
* air acceleration rate;
* jump velocity;
* early-release jump cut;
* run speed;
* friction-tail duration;
* melee frame timing;
* recovery duration;
* special-melee travel distance;
* knockback strength/decay;
* hit-stun duration;
* i-frame duration;
* supermove speed/profile;
* ~5s super meter charge;
* weapon fire rates.

Tune through playtesting.

Changing these values should not require changing the underlying mechanic.

---

# 36. Final Gameplay Contract

The hero should feel like a fast arcade character whose controls remain available whenever doing so does not undermine the meaningful committed portion of an action.

Movement should be:

**immediate on the ground, controlled in the air, forgiving around platform edges.**

Combat should be:

**fast, buffered against lost inputs, committed through impact, cancellable during recovery.**

Aiming should be:

**simple by default, contextual when Down is involved, and expressive through Direction Lock and Movement Lock.**

Character differences should come from:

**how shared inputs behave tactically, not from unnecessary additional controls.**

Above all:

**player intent, gameplay state, animation, physics, and hitboxes must agree.**
