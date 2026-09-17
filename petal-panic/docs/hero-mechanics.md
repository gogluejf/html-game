# Petal Panic — Hero Mechanics

> **Source of truth for how the hero feels.** Read this before touching hero code.
> Every behavior below is either ✅ *implemented* or 📋 *documented, not yet built*.
> If code and this doc disagree, the doc wins — fix the code (or update the doc on purpose).

---

## Controls at a glance

| Action | Key | What it does |
|---|---|---|
| Move / aim | **WASD** or arrows | One input does both (see [Direction & Aim](#direction--aim)) |
| Jump | **Space** | Ground jump + one air jump; variable height |
| Crouch / slide | **S** (down) | Always down. Never up. |
| Melee | **H** | Fast swing with windup → hit → recovery |
| Shoot | **J** | Fires thorns (default weapon) in your aim direction |
| Supermove | **K** | Full-meter dash: intangible burst that plows through enemies |
| Switch weapon | **N** | 📋 Toggles between Thorn (default) and Special |
| Lock direction | **I** | Freezes aim angle while you keep moving/shooting |
| Lock movement | **O** | Stops locomotion, aim stays free |
| Pause | **Esc / P** | Pause menu |

Gamepad mirrors these (dpad/left stick = move+aim, face buttons per the remap screen).
The right stick is **not bound to anything**.

All bindings are remappable (Pause → Remap). This table shows the defaults.

---

## Direction & Aim

**One control does both.** There is no separate "aim device" and no hidden second source.

- Push any direction (WASD, dpad, or left stick) and the hero **moves that way AND aims that way**. The same 8-way direction drives locomotion and where shots fly.
- Stand still and shoot → fires where the hero **faces** (facing updates from your last movement).
- The right stick does nothing. Aim has exactly one source: your direction input.

### Lock Direction (I)

Freezes the aim angle at the moment you press it.

- You can now **walk away** in any direction and every shot still flies toward the frozen angle.
- Release I → aim snaps back to following your direction.
- Classic use: strafe behind cover while keeping fire on target.

### Lock Movement (O)

Zeroes locomotion only.

- Gravity, knockback, and platforming still apply — you don't float.
- **Aim keeps following your direction input**, so you can stand planted and sweep your aim freely.
- Release O → movement resumes.

The two locks compose: hold both and you're a stationary turret that can rotate its aim but never leaves the spot.

---

## Movement

### Run & stop
- Press a direction → instant run speed (no acceleration ramp).
- Release → short friction tail, then rest. Opposite direction cancels momentum immediately (no coasting through walls of intent).

### Jump
- **Two jumps**: ground jump + one air jump.
- **Variable height**: release Space early to cut the jump short (tap = hop, hold = full).
- **Jump buffer**: pressing Space slightly before landing still triggers the jump on contact (~0.12s window) — no more "I pressed it too early!" deaths.

### Crouch & Slide (always Down)
- **Down while standing** → crouch. Hitbox shrinks (feet stay planted).
- **Down while running** → **slide**: you keep your momentum and skid to a stop over ~65px with linear deceleration — an ice-skid feel, not an instant halt.
- Crouching locks horizontal control; the slide *is* the momentum bleed-off.
- **Jump out of crouch** works (crouch → jump cancels cleanly).
- Up never crouches. Ever.

### Drop-through platforms 📋
Down + Jump on a one-way platform drops through. *(Not yet implemented.)*

### Jump-off-solid speed cap 📋
Jumping off a barrel/block clamps carried horizontal speed so you don't rocket across gaps. *(Not yet implemented.)*

---

## Melee (H)

A snappy swing built from three phases:

```
windup (3 frames) → ACTIVE (1 frame) → recovery (1 frame)
```

- Only the **active frame** deals damage — the hitbox exists exactly at the peak of the arc.
- Total swing ≈ 0.4s. While a swing is active (or in its cooldown tail), further presses are ignored — no spam-stacking.
- Supports rapid successive attacks: press again the instant recovery ends for a fast combo cadence.
- Damage routes through the central damage system (team-aware, stats-scaled).

---

## Shooting (J)

- Fires **thorns** (the default weapon) from the hero's center, offset slightly toward the aim so the projectile starts outside the body.
- **Hold to auto-fire**, gated by a fire-rate cooldown (shots/second from hero stats).
- Consumes ammo per shot; no ammo → no fire.
- Friendly projectiles can never hurt the hero (friendly-fire is off by construction).

### Switch Weapon (N) 📋
Toggles the shoot button between the two weapons:

| Weapon | Behavior |
|---|---|
| **Thorn** (default) | Fast, straight, cheap — the workhorse |
| **Special** | Hero-unique: Scarlet throws a fast saw blade (no gravity, short range); Balthazar lobbs a bomb (gravity, fuse, AoE explosion) |

Toggle state persists until toggled again; each weapon has its own ammo pool and cooldown.
*(Documented as the intended mechanic — toggle wiring not yet implemented; the Special currently fires on its own path.)*

---

## Supermove (K)

A charged, all-or-nothing dash.

- **Meter** charges over time (~5s to full). K does nothing until it's full.
- On trigger: the hero becomes **intangible** for the whole dash — enemy hitboxes pass through you.
- **Dash profile:**
  - First ~60%: horizontal burst at high speed, **no gravity** — an airborne slide.
  - Last ~40%: gravity kicks in and speed decays — you drop back to earth.
  - Ends with a small residual forward nudge (you don't stop dead mid-air).
- **Deals damage** to anything plowed through during the dash (thin hitbox in front, body-height).
- Meter resets to zero after each dash.
- Works grounded or airborne.

---

## Getting hit

- Taking a hit applies **knockback** with decay and brief **hit-stun** (input lock while the knockback bleeds off).
- Grants **i-frames** (intangible window) so one attack chain can't multi-hit you.
- Respawn also grants i-frames.
- Intangibility (from supermove, i-frames, or powerups) absorbs all damage — the hero simply passes through.

---

## Status effects (timers)

Labeled timers drive temporary states and show in the debug overlay:

| Timer | Effect |
|---|---|
| `intangible` | No damage taken (supermove, i-frames, powerup) |
| `rapid` | Fire rate doubled (powerup) |
| `special` | Special-weapon cooldown |

---

## Not yet implemented (hero polish backlog)

These are planned behaviors from the engine build order — **do not assume they exist in code**:

- 📋 Drop-through platform (Down + Jump on one-way)
- 📋 Jump-off-solid speed cap
- 📋 Switch-weapon toggle on N (thorn ↔ special)
- 📋 Attack cancel into movement after active frames
- 📋 Jump-cancel out of supermove recovery (only after the decel phase starts)
