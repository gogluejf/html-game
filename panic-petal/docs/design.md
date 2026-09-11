# Petal Panic — Game Design Document

**Genre:** 2D side-scrolling run-and-gun platformer (Contra feel)
**Engine target:** HTML5 canvas, vanilla JS, no framework
**Scope v1 (demo):** 1 level, ground + a few air platforms, random enemy/powerup/barrel spawn on flat ground ("rogue" layout), Overgrown Elephant boss at the end. Everything else is designed but stubbed for later.

---

## 1. State Machine

```
home (animated bigtop scene)
  -> select (pick Scarlet or Balthazhar)
    -> play
         <-> pause (resume / retry / quit)
         -> gameover (retry / continue x3 / quit)
         -> win (after boss defeated)
```

- **Retry** (from pause or gameover): restarts at `1-1` (or the first checkpoint of the current stage). Checkpoints do NOT persist across a retry.
- **Continue:** 3 available per run. Costs coins (default **1000**, tunable). Restores to last checkpoint with full energy.
- **Win:** boss death triggers win state.

---

## 2. Core Loop & Feel

- Run right through the circus, shooting in 8 directions, jumping over hazards, breaking barrels, grabbing powerups and coins.
- Pacing: steady-with-bursts (Contra). Not twitchy, not slow.
- Health model: **energy bar** (stamina = HP). Enemy contact and projectiles drain energy. At 0 → death.
- Death: hero disappears, skull emoji floats up in a sine wave and fades. Lose a life. Out of lives → gameover.

---

## 3. Sprite Foundation Struct

Base struct everything inherits from (hero, enemy, object, projectile, coin, powerup):

```js
{
  x, y,            // position (top-left of collision box)
  w, h,            // collision box size (NOT necessarily image size)
  vx, vy,          // velocity
  gravity,         // per-entity gravity factor (0 for flyers)
  facing,          // -1 | 1 (horizontal); also stores aim dir for 8-way
  mirrorX,         // bool — flip horizontally (facing left/right)
  mirrorY,         // bool — flip vertically (rare; e.g. flyers diving)
  weight,          // affects knockback / how it pushes others
  anim,            // AnimationController (see §11)
  alive,           // bool
  debugColor       // for debug draw
}
```

Collision boxes differ from sprite size (e.g. crouch shrinks the box). Each entity carries its own box coords relative to origin.

---

## 4. Player

```js
player = {
  hero,             // reference to selected hero def
  energy, maxEnergy,// stamina/HP
  shield,           // extra cyan layer over energy (from shield powerup)
  ammo,             // thorn ammo, start 200
  specialAmmo,      // saw/bomb ammo for current hero
  specialCooldown,  // ticks since last special (vs special_freq)
  coins,
  lives,
  invincible,       // remaining hits (invincibility powerup)
  rapidTimer,       // remaining frames of rapid powerup
  checkpoint,       // {x,y} last touched checkpoint
  stats             // cumulative run telemetry (see §4.1)
}
```

### 4.1 Player Stats / Telemetry

The player accumulates all of these across the run (reset on new game, kept on continue/checkpoint restart):

```js
stats = {
  enemiesKilled: { jester:0, jackolantern:0, vine_hound:0, boris_loon:0, boris_loon_baby:0, violetta_marionetta:0 },
  bossKilled: false,
  powerupsCollected: { ammo:0, invincibility:0, special:0, rapid:0, shield:0, clear:0, energy:0, oneUp:0 },
  projectilesShot: 0,          // thorn shots fired (attempts)
  specialsUsed: 0,             // saw/bomb specials fired (attempts)
  meleeSwings: 0,              // melee attempts
  hitsLanded: { melee:0, projectile:0, special:0 },  // actual connections
  barrelsDestroyed: { barrel:0, coinBarrel:0 },
  hitsTaken: { enemyContact:0, enemyProjectile:0, explosion:0, total:0 },
  damageDealt: {
    byMethod: { melee:0, projectile:0, special:0 },  // total landed damage
    byEnemy:  { jester:0, jackolantern:0, vine_hound:0, boris_loon:0, boris_loon_baby:0, violetta_marionetta:0 }  // per-type toughness signal
  },
  coinsCollected: { bronze:0, silver:0, gold:0, total:0 },
  checkpointsHit: 0,
  distanceTraveled: 0,         // px, for level progress
  timePlayed: 0                // frames/seconds
}
```

These feed score, HUD (later), and end-of-run summary. All counters are cheap increments in the collision/effect handlers.

### Actions (run-and-gun)
- **Projectile (thorn)** — 8 directions like Contra. Consumes `ammo`. Fire rate = `projectile_freq` (×2 during rapid).
- **Melee attack** — plays the hero's `attack` animation; active hitbox on the max frame of the sequence (e.g. frame 3 of 5). Breaks barrels, damages enemies. Cooldown between swings.
- **Special** — hero weapon (saw / bomb). Consumes `specialAmmo`, gated by `special_freq` cooldown.
- **Jump** — impulse from hero `jump` stat. Jump animation must rotate in sync from takeoff→landing and **must not loop**.
- **Crouch / slide** — crouch shrinks collision box; slide = fast low movement while crouching. Crouch stops horizontal momentum.

---

## 5. Heroes

Two selectable heroes. Same base struct, different stats + special.

| Stat | Scarlet Vale | Balthazhar |
|------|-------------|------------|
| speed | high | low |
| jump | higher | lower |
| melee attack | weak | strong |
| max energy | high | low |
| damage taken on hit | more | less |
| special | petal **saw** (fast) | **bomb** (slow freq, big AoE) |

```js
hero = {
  id, name,
  stats: {
    weight, speed, attack, defense, stamina, jump,
    projectile_freq,   // frames between thorn shots
    special_freq,      // frames between specials
    special            // 'saw' | 'bomb'
  },
  anims: { idle, run, jump, attack }  // from cropped sheets
}
```

Weapon distinction is currently just a projectile swap (same `attack` anim). Distinct weapon animations come later.

---

## 6. Enemies

```js
enemy = {
  ...spriteBase,
  type,                 // jester, jackolantern, vine_hound, boris_loon, boris_loon_baby, violetta_marionetta
  stats: {
    weight, speed, attack, defense, stamina, mjump,
    melee,              // y/n
    projectile,         // y/n
    projectile_freq,
    special_freq,
    special,            // 'saw' | 'bomb' | 'none'
    fly                 // y/n (boris loon family)
  },
  coinDrop: { range:[min,max], chance:0..1 },  // coins dropped on death
  ai                   // per-type behavior (see §7)
}
```

Capabilities: move, jump (optional), melee attack, projectile attack, fly (property). Energy/speed/stamina/attack/defense as above. Drop coins on death with % chance.

### Idle handling
Enemies without an `idle` sheet use their **first run/walk frame** as a static fake idle.

---

## 7. Enemy AI

Each enemy type gets its own small state machine, coded one at a time. Demo behaviors are simple (run, occasionally jump, shoot, melee). Later: richer patterns.

Common states: `idle / walk / chase / attack / flee / dead`. Aggressiveness = detection radius before switching to chase/attack.

Proposed sequences (v1):

- **Jester** (ground, whip melee): walks toward player within aggro radius; when close, plays `whip` (melee). No projectile.
- **Vine Hound** (ground, melee): faster chaser; lunges (`attack`) when adjacent. No projectile.
- **Violetta Marionetta** (ground, melee+projectile): paces back and forth; fires a projectile at intervals when player in line of sight; melee if very close.
- **Jack-O-Lantern** (rolling bomb): rolls toward player (`roll`); on proximity or timer, `launch` then `explode` (AoE damage). Destructible by shot/melee before it detonates.
- **Boris Loon** (flyer): hovers in sine-wave flight (`fly`); dives/attacks when player below; can fire. Baby variants: smaller, faster, swarms in groups of 2–3.
- **Overgrown Elephant** (boss): see §9.

AI details are finalized per-enemy during implementation; this is the behavioral contract.

---

## 8. Collision System

Axis-aligned bounding boxes (AABB). Boxes may be smaller than sprites (crouch, etc.). Per-frame checks:

- Projectile ↔ enemy → damage (friendly flag prevents self-hit; only enemy projectiles hit the player).
- Hero melee hitbox ↔ enemy → damage.
- Hero ↔ barrel → blocked (can't pass).
- Enemy ↔ barrel → blocked.
- Melee ↔ barrel → breaks barrel.
- Projectile ↔ barrel/object → blocked/absorbed.
- Barrel explosion → large-radius AoE damaging both enemies and hero.
- Enemy body ↔ hero → drains hero energy.
- Enemy projectile ↔ hero → damage.
- Hero ↔ powerup → collect.
- Hero ↔ coin → collect.
- Hero ↔ checkpoint → set checkpoint.
- Coin falling → bounces off ground/platforms (per-coin weight).

---

## 9. Boss — Overgrown Elephant

- Locks the camera to the boss arena.
- HP-based. Animations: `charge`, `stomp`, `trunk_blast`, `death`.
- Proposed phase loop:
  1. **Charge** — runs across arena (dodge by jumping or moving aside).
  2. **Stomp** — telegraphed shake, then ground shockwave (jump over).
  3. **Trunk blast** — ranged projectile spread (duck/crouch or strafe).
  4. Repeat, escalating speed/frequency as HP drops.
- Weak point: head/trunk (higher damage when trunk_blast recovery window).
- Contact damage from body.
- On death: `death` anim → win state.
- More bosses added later (target: 8 levels / 8 bosses).

---

## 10. Projectiles, Powerups, Objects

### Projectile
```js
{ ...spriteBase, speed, damage, friendly /* true=hero, false=enemy */ }
```
Bomb special uses an **extended collision box during explosion** (AoE). Thorn is the standard 8-way shot. Lifetime/off-screen cull applies. Max active projectiles capped (general perf param).

### Powerup (wooden signboards)
```js
{ type, value, duration }
```
- **1up** — adapted to proper hero (scarlet_1up / balthazar_1up).
- **Ammo** — +20 / 50 / 100 / 200 thorn ammo.
- **Invincibility** — X duration of no-damage (propose: ~5 s). Distinct from shield.
- **Special** — saw (Scarlet) / bomb (Balthazhar) box of 20/50/100/200; number displays on pickup.
- **Rapid** — doubles melee + projectile fire frequency for X frames (propose: ~6s).
- **Shield** — adds X cyan layer over energy (propose: +50).
- **Clear (panic_clear)** — kills all on-screen enemies.
- **Energy** — recovers X energy (propose: +30).

Spawn rules: fixed spots in authored levels; random drops in demo rogue mode.

### Object
```js
{ type, hp, explosive }
```
- **Barrel** — solid; explodes (big AoE) when hit by bomb/projectile.
- **Coin barrel** — bursts into several mixed coins that bounce to ground.
- **Checkpoint** — sets restart position (position only, nothing else saved).
- Coins have different weights per type (bronze < silver < gold) affecting bounce.

---

## 11. Animation Engine

Small clean controller per sprite:

```js
anim = {
  frames[],        // image refs
  frameSpeed,      // ms per frame
  rotation,        // radians
  scale,           // default 1
  mirrorX,         // bool — horizontal flip (driven by facing)
  mirrorY,         // bool — vertical flip
  autoRotate,      // bool
  loop,            // bool (jump = false)
  pickFrame(n)     // specific frame override
}
```

**Facing/mirror rule:** `mirrorX` is normally derived from `facing` (`facing === -1 → mirrorX = true`) so sprites auto-flip when the hero/enemy turns. `mirrorY` stays manual for special cases (e.g. a flyer banking downward). Mirroring applies at render time via canvas scale(-1,1), independent of the collision box (box is never mirrored — it's symmetric AABB).

Rules:
- Jump animation rotates in sync with the arc (takeoff→landing) and does **not loop**.
- Enemies lacking idle reuse first run/walk frame statically.
- Death: play death anim, then fade out fast while sparkle effect (sized to sprite) plays for a fluid transition.

---

## 12. Effects

- **Hero damaged:** red vignette around screen edges (CoD-style) + brief flash.
- **Enemy damaged:** fast shake + white flash.
- **Hero death:** hero vanishes; skull emoji floats up in sine wave and fades.
- **Enemy death:** death anim → fast fade + sparkle burst (sprite-sized) + coin drop.
- **Barrel break:** particle burst.
- **Coin barrel break:** pop explosion of petal coins.
- **Barrel explosion:** multiple random bomb-explosion frames scaled to the collision-box area.
- **Checkpoint touch:** flash then disappear.
- **Bomb special:** explosion sequence.
- **Projectile hit on enemy:** small red sparkle (blood-like).
- **Powerup pickup:** pop/sparkle + floating value text (for numbered pickups).
- **Invincibility active:** hero sprite flashes fast (blink) for the duration.

Audio hooks: leave `// SFX: shooting`, `// SFX: explosion`, `// SFX: coin`, `// SFX: powerup`, `// SFX: death` comments so music/SFX plugs in cleanly later. Music jukebox already exists — wire via a thin audio manager.

---

## 13. Level

```js
level = {
  name, index, boss,
  length,                       // world width in px
  checkpoints: [{id:'1-1',x}, ...],
  enemies: { jester:N, jackolantern:N, ... },  // counts per type
  platforms: [...],             // ground + air platforms
  objects: [...], powerups: [...]
}
```

- **v1:** 1 level, ground + a few air platforms, checkpoints `1-1 … 1-4`, random enemy/powerup/barrel placement on flat ground, elephant boss at end.
- **Later:** 8 levels / 8 bosses / 8 stages.
- Camera follows hero horizontally, clamped to `[0, level.length]`, with look-ahead in facing direction. Boss locks camera to arena.
- HUD (later): hero icon traced on a level line with checkpoint markers showing progress.

---

## 14. Coins

- Values by type: bronze < silver < gold (score + weight differ).
- Score only for now (no shop).
- **1up every X coins** (propose: 100 coins = +1 life).
- Continue cost: 1000 coins.

---

## 15. Input

Single-player first; two-player supported optionally.

- **P1:** WASD (move/jump/crouch) + G (thorn) H (special) J (melee) — *confirm mapping*
- **P2:** Arrows (move) + `,` (thorn) `.` (jump/special) `/` (melee) — *confirm mapping*

Final keymap locked during implementation. Pause: Esc/P.

---

## 16. Debug Overlay

Toggle (F3 or similar) draws semi-transparent boxes:
- Orange — level platforms
- Green — hero collision boxes
- Red — enemy collision boxes
- Blue — objects / powerups
- Pink — projectiles / explosions

---

## 17. Performance / Limits

- General params (tunable constants): max enemies on screen, max active projectiles, max particles.
- Enemies-per-level defined on the level struct.
- Object pooling for projectiles, coins, particles.

---

## 18. Open / Proposed Defaults (to confirm)

| Item | Proposed value |
|------|----------------|
| Invincibility powerup | ~5 s no-damage (hero flashes) |
| Rapid duration | ~6 s (fire rate ×2) |
| Shield value | +50 energy (cyan) |
| Energy powerup | +30 energy |
| 1up coin threshold | 100 coins |
| Continue cost | 1000 coins |
| Ammo start | 200 |
| Lives start | 3 |

These are placeholders — adjust freely.
