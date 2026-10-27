# Sprite Animation Engine — Runtime Rules

## Purpose

The Sprite Animation Engine is responsible for displaying and advancing sprite animations from exported Animation Studio JSON.

It owns visual playback and animation-defined spatial geometry, plus the uniform scaling that maps source-resolution art into intended in-game sizes.

It does NOT decide:
- which attack an enemy performs
- when AI chooses an action
- attack-pattern behavior
- projectile behavior
- beam behavior
- boss decision-making

Those decisions belong to their respective gameplay systems.

The Sprite Animation Engine provides the visual and spatial data those systems can use.

---

## 1. Logical Units and Placement

- Default logical grid unit: **72 × 48 pixels** (anisotropic — X units are wider than Y; R6 convention).
- Positions and dimensions may use fractional units (e.g., 0.5, 1.5, 3, 4.5).
- Units standardize macro-editor block, platform, and slot placement; snapping increments are configurable.
- A platform's source art may occupy 1.5, 3, or 4.5 logical units without changing the grid definition.
- Heights expressed in units are measured in **Y-units (48px)**. The grid's X/Y anisotropy affects world placement only — sprite scaling itself is always uniform.

---

## 2. Animation Structure

A sprite animation contains:

- ordered frames
- default animation FPS
- playback mode
- playback direction
- timing mode (`fps` or `relative`)
- per-animation target collision-box height (logical Y-units)
- animation-level collision box
- animation-level pivot point
- per-frame sprite data
- per-frame spatial markers

The runtime must reproduce the Animation Studio export exactly.

The Animation Studio JSON is the source of truth.

Frame count always comes from JSON. There is **no global eight-frame assumption**.

---

## 3. Entity Design and Physical Anchors

Designers or AI select entity sizes **at character/enemy design time**; there are no mandated hero, enemy, or boss heights.

Each entity has **one consistent physical anchor**, shared across all its animations.

- The physical anchor **is** the entity's world position. It is the stable reference everything else hangs off of: collision boxes, sprite artwork, and marker offsets are all resolved relative to it.
- Anchor choices include bottom-center (grounded), top-center (ceiling-attached), or center (flying), plus extensible alternatives.
- **Default: bottom-center.** Most entities are grounded and the engine already places them on floor surfaces by their bottom edge. Ceiling-attached or flying entities opt out explicitly.
- Every animation's collision box is positioned relative to the entity's physical anchor, not independently snapped to the editor's visual origin.
- On animation changes, keep the entity's physical anchor fixed and update the collision geometry around it. See §19 (Transition Safety) for overlap resolution.

### Relationship to the Pivot

The pivot (§11) and the physical anchor do different jobs:

- **Physical anchor**: one per *entity*, fixed in world space. It is what physics and collision integrate. It never moves on animation switch.
- **Pivot**: one per *animation*, a local transform origin used for rotation, mirroring, and marker transforms within that animation.

The chain is: editor geometry → uniform scale (§5) → translate into anchor space → anchor fixed in world → boxes/sprite/marker offsets resolved around it. The editor's visual origin (center, bottom-left, etc.) is an authoring convenience and is **not** automatically either the pivot or the physical anchor.

---

## 4. Per-Animation Target Height and Uniform Scaling

Each animation has a configurable **target collision-box height in logical Y-units** in the game configuration. This may vary across animations (idle, crouch, roll, jump, attack) to reflect different physical poses.

For an animation:

```text
target_height_px = target_height_units * unit_height_px   // 48px per Y unit
scale = target_height_px / source_collision_box_height_px
scaled_width_px = source_collision_box_width_px * scale
scaled_height_px = source_collision_box_height_px * scale
```

Apply the **same scalar** to sprite frame geometry, collision-box width/height, hitbox coordinates and dimensions, marker offsets, pivots, radii, and other spatial values relative to the source reference. This preserves the source aspect ratio and geometry. Do not independently force width to a unit count.

**Important:** Translate coordinates into the entity's physical-anchor space after uniform scaling. The collision box can change with animation, but the world-space anchor remains stable. All frames of an animation use its configured scale; never rescale frame-by-frame based on artwork bounds.

Validate nonzero source collision-box height. Geometry must use a consistent source coordinate space; avoid double-scaling values already expressed in world units.

No manual width calculations or individual frame resizing should be required. An AI or designer provides only the semantic configuration — target collision heights, entity physical anchor, and relevant gameplay/state mappings — and the engine handles the rest.

---

## 5. Animation Playback

Animations traverse their ordered frames according to their playback direction.

An animation has a default FPS.

Each frame may optionally define its own duration.

If a frame has no explicit duration:

    duration = 1 / animation_fps

If a frame has an explicit duration, that duration overrides the default FPS timing for that frame.

This allows:

- normal constant-speed animation
- anticipation frames
- impact holds
- recovery holds
- very fast transition frames
- irregular animation timing

Do not duplicate frames simply to create timing differences.

---

## 6. Playback Mode and Direction

Playback mode and playback direction are independent settings:

- `mode` controls whether the sequence repeats.
- `direction` controls the order in which frames are visited.

### Playback Mode

Each animation must define its playback mode:

- `loop` — repeat the sequence continuously.
- `once` — play one complete sequence, then hold its ending frame.

The ending frame depends on direction; it is not necessarily the final frame in the stored frame list.

The engine must expose whether a non-looping animation has completed so AI/gameplay code can react to completion. Completion occurs after the ending frame's duration has elapsed.

### Playback Direction

Supported directions:

| Direction | One complete sequence (five frames, labeled 1–5) |
|---|---|
| `forward` | 1 → 2 → 3 → 4 → 5 |
| `reverse` | 5 → 4 → 3 → 2 → 1 |
| `ping_pong` | 1 → 2 → 3 → 4 → 5 → 4 → 3 → 2 → 1 |
| `ping_pong_reverse` | 5 → 4 → 3 → 2 → 1 → 2 → 3 → 4 → 5 |

If `direction` is omitted, default to `forward` to preserve existing playback behavior.

`ping_pong` starts at the first frame, reaches the last frame, and returns to the first frame. `ping_pong_reverse` starts at the last frame, reaches the first frame, and returns to the last frame.

With `once`, the entire round trip plays before completion:

- `forward` and `ping_pong_reverse` finish on the last stored frame.
- `reverse` and `ping_pong` finish on the first stored frame.

With `loop`, ping-pong playback continues without duplicating endpoints, including at the sequence boundary:

    ping_pong:         1 → 2 → 3 → 4 → 5 → 4 → 3 → 2 → 1 → 2 → 3 → …
    ping_pong_reverse: 5 → 4 → 3 → 2 → 1 → 2 → 3 → 4 → 5 → 4 → 3 → …

Never introduce an extra endpoint hold by playing `…4 → 5 → 5 → 4…` or `…2 → 1 → 1 → 2…`. Explicit per-frame duration is the mechanism for intentional holds.

Per-frame durations apply on every visit, in either direction. A single-frame animation stays on that frame in every direction; `once` completes after its duration, while `loop` remains active.

Example:

```json
{
  "mode": "loop",
  "direction": "ping_pong"
}
```

---

## 7. Timing Modes

Keep the following properties conceptually independent:

| Property | Values | Meaning |
|---|---|---|
| Repeat | `loop`, `once` | Repeat or stop at the terminal playback frame. |
| Direction | `forward`, `reverse`, `ping_pong`, `ping_pong_reverse` | Frame traversal order. |
| Timing | `fps`, `relative` | Fixed-rate playback or game-driven progress. |

### FPS

- The sprite editor exports the animation's configured frame rate.
- The engine advances through the traversal at that rate.
- Per-frame duration overrides still apply: a frame with an explicit duration uses it instead of `1 / fps`.
- `once` stops and holds its terminal frame; `loop` repeats.

### Relative

- The gameplay system supplies normalized progress in `[0, 1]` (0–100%).
- The animation player maps progress to the configured frame traversal.
- Relative progress is controlled by the gameplay action or state, not guessed from an FPS setting.
- Per-frame durations do **not** apply in relative mode — the supplying system drives progress, not the clock.
- `once` clamps at its terminal frame when progress reaches 1; looping behavior is only used where the supplying state makes sense.

---

## 8. Jump Example: Relative Timing

- A jump can remain **one animation** with its actual frame count defined by JSON.
- Map its progression to **takeoff/ascent**, **apex**, and **descent** phases.
- The movement system determines the phase using jump state and vertical velocity; do not predict total airtime.
- Phase boundaries and frame allocation should be configurable, not hard-coded to a specific frame count.
- For an unusually long fall, hold a suitable descending frame until landing or transition to a dedicated fall animation if available.
- Keep gameplay movement smooth and independent from how many art frames exist.
- Physics, jump height, air control, and landing remain authoritative; animation never dictates collision movement unless explicitly designed to do so.

---

## 9. Sprite Box

Every frame has a Sprite Box.

The Sprite Box defines the visual region into which that frame's PNG is fitted/rendered.

Sprite Box is PER FRAME.

Different frames may have different source PNG dimensions or crop bounds.

The Sprite Box exists to normalize those differences at runtime.

Changing the Sprite Box must NOT implicitly modify gameplay collision geometry.

Visual geometry and gameplay geometry remain separate.

---

## 10. Scale

Sprite rendering supports scale.

Scale is applied to the rendered sprite and all spatial geometry associated with that sprite.

Spatial data must remain aligned after scaling.

Never scale the visual sprite without applying the equivalent transform to its collision boxes, markers, radii, and pivot-relative geometry.

The per-animation uniform scale computed in §4 is the authoritative scale for that animation; do not stack additional ad-hoc scales on top of it.

---

## 11. Pivot Point

Each animation has a Pivot Point.

Pivot is PER ANIMATION.

It defines the stable local origin used for:

- positioning
- rotation
- mirroring
- sprite alignment
- spatial marker transforms

The pivot remains consistent across every frame of the animation.

Frame cropping or Sprite Box differences must not cause the character's world position to jump. World position is owned by the entity's physical anchor (§3); the pivot operates in the local space the anchor establishes.

### Repositioning (editor CENTER / LEFT-BOTTOM)

Repositioning moves the whole per-animation geometry set coherently:

- frame offsets + per-frame hit boxes → shifted per frame (each frame anchors to the chosen point)
- markers, collision box, pivot → shifted by the current frame's anchor delta

Collision and pivot are PER ANIMATION (single objects), so they reposition as one unit — there is no per-frame divergence, hence no jump. The "no jump" rule forbids *per-frame* drift of gameplay geometry; a deliberate, user-triggered reposition of the whole anim is expected behavior. The engine integrates the entity in world space from its collision box and draws the sprite relative to it, so after any reposition the sprite/collision/pivot relationship is exactly what was authored in the editor.

---

## 12. Rotation

Sprites may be rotated around their animation Pivot Point.

All animation spatial geometry must follow the same transformation.

This includes:

- collision boxes
- hit/damage boxes
- point markers
- radius markers

Rotation must never visually separate gameplay geometry from the sprite.

---

## 13. Mirroring

Animations support horizontal and vertical mirroring.

Horizontal mirroring is used primarily for left/right facing.

Mirroring occurs around the Pivot Point.

All spatial geometry must mirror with the sprite.

Never maintain separate left-facing and right-facing copies of geometry.

The same animation data must work in both directions.

---

## 14. Main Collision Box

The primary Collision Box belongs to the ANIMATION, not individual frames.

It remains fixed throughout the animation.

Its purpose is the stable physical/body collision representation of the actor.

Animation frame artwork must not cause this collision box to resize automatically.

Visual animation and physical body collision are intentionally separated.

On animation switch, the new animation brings its own collision box; the entity's physical anchor stays fixed and the box is re-resolved around it (§3, §19).

---

## 15. Per-Frame Boxes

Each frame may contain a COLLECTION of boxes.

A frame may contain:

- zero boxes
- one box
- multiple boxes

Boxes are not limited to one melee box.

Each box contains at minimum:

- type/label
- position
- width
- height

Damage-capable boxes may additionally contain damage information when appropriate.

Examples:

- melee
- sword
- claw
- bite
- vulnerable
- weak-point
- custom gameplay box

The engine must not hard-code a maximum number of boxes per frame.

---

## 16. Melee / Damage Boxes

Melee damage remains frame-defined.

This is how direct physical attacks synchronize naturally with animation.

Example:

    frame 0 -> no damage box
    frame 1 -> no damage box
    frame 2 -> punch damage box
    frame 3 -> punch damage box
    frame 4 -> no damage box

No separate animation event is required for ordinary melee contact.

The active damage geometry already defines when the attack can hit.

---

## 17. Point Markers

Each frame may contain a COLLECTION of Point Markers.

A Point Marker contains:

- type/label
- local X
- local Y

A Point Marker represents a spatial attachment/reference point.

It does NOT contain gameplay implementation.

Possible uses include:

- projectile origin
- beam origin
- ground-impact location
- weapon tip
- muzzle
- hand position
- weak point
- effect origin
- attachment point
- custom scripted location

Example:

    type: "beam-origin"
    x: 114
    y: 42

Gameplay code may use that point to spawn a configured beam.

The Animation Engine does not know what the beam does.

---

## 18. Radius Markers

Each frame may contain a COLLECTION of Radius Markers.

A Radius Marker contains:

- type/label
- local X
- local Y
- radius

It represents a circular spatial region.

Possible uses include:

- AI detection
- explosion radius
- proximity trigger
- healing zone
- danger zone
- area attack
- interaction radius
- custom gameplay region

Example:

    type: "ai-detection"
    x: 0
    y: 0
    radius: 300

The Sprite Engine exposes this geometry.

The AI system decides what "ai-detection" means.

Likewise, an `explosion` radius defines geometry; explosion damage, force, timing, and effects belong to gameplay code.

---

## 19. Animation Transitions and Collision Safety

- Switching animations preserves the entity's physical anchor in world space.
- Collision boxes can vary in width and height for different poses.
- Before accepting a geometry expansion (e.g., standing after crouching), check for overlap with ceilings, walls, enemies, and other solid geometry.
- **Resolution rule (clamp-first):**
  1. If the new box overlaps solids, clamp the anchor along the smallest axis until clear.
  2. If no clamp direction is free (e.g., ceiling above AND wall beside), keep the old box and retry each frame until space opens.
- Preserve existing no-tunneling collision behavior.
- Visual origins and sprite frame dimensions do not control the physical position of the entity.

---

## 20. Marker Philosophy

Markers describe:

    WHERE

and optionally identify:

    WHAT REFERENCE IS THIS?

They do NOT define:

    WHAT GAMEPLAY LOGIC SHOULD EXECUTE?

For example:

    beam-origin

provides a transformed world position.

The attack-pattern system can then create:

    Beam(
      origin = marker("beam-origin"),
      ...
    )

Beam configuration remains in gameplay/attack code.

Do not turn animation JSON into an attack scripting language.

---

## 21. Spatial Collections

The engine should treat animation spatial information as collections.

Conceptually:

    frame.boxes[]
    frame.points[]
    frame.radii[]

All collections may contain zero or more entries.

Every entry has a type/label.

Gameplay systems can query them by type.

Examples:

    getBoxes("melee")
    getPoint("beam-origin")
    getRadii("explosion")

Do not assume labels are unique unless explicitly required by the caller.

---

## 22. Coordinate Transformation

All Animation Studio geometry is stored in sprite-local coordinates.

At runtime the Sprite Engine transforms it into world coordinates using:

1. uniform scale (§4)
2. sprite position (physical anchor, §3)
3. pivot
4. mirroring
5. rotation

Every geometry primitive must use the SAME transformation pipeline.

This is critical.

The rendered sprite and its spatial metadata must never drift apart.

---

## 23. AI / Attack Interaction

AI owns ACTION SELECTION.

Example:

    AI decides -> STOMP

The AI/gameplay layer may then:

- switch animation to `stomp`
- start the Stomp attack pattern

The Sprite Engine does not make that decision.

Animation geometry can then provide the locations required by the pattern.

Example:

    stomp animation
        -> current frame
        -> point marker "ground-impact"

    StompPattern
        -> reads ground-impact world position
        -> creates shockwave

This preserves separation between presentation and gameplay.

---

## 24. Animation Is Data, Not AI

The Sprite Animation Engine answers questions such as:

- What frame is active?
- Where should the sprite render?
- What boxes are active?
- Where is marker X?
- What radius regions exist?
- Has the animation completed?

It does NOT answer:

- Should the boss attack?
- Which attack should happen?
- Should a projectile spawn?
- How much damage should a beam cause?
- What attack comes next?

Those belong to AI and gameplay systems.

---

## Acceptance Tests

- Same entity with differently sized idle/jump/attack source sprites displays at coherent in-game sizes.
- Crouch/roll animations change collision dimensions without teleporting the entity anchor.
- Ceiling-attached and flying entities retain their chosen anchors.
- Scaled hitboxes, markers, and radii stay aligned with their sprites.
- Loop, once, reverse, and both ping-pong traversals terminate/repeat correctly.
- Relative jump animation handles short jumps, normal jumps, and long falls.
- Standing up under a low ceiling does not force collision penetration (clamp-first rule, §19).
- Frame count comes from JSON; there is **no global eight-frame assumption**.

---

## Core Rule

Animation Studio defines visual timing and spatial geometry.

Sprite Animation Engine reproduces and exposes that data, scaled uniformly and anchored consistently.

Gameplay systems interpret it.

AI decides behavior.

Keep these responsibilities separate.
