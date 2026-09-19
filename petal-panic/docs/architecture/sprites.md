# Sprite Animation Engine — Runtime Rules

## Purpose

The Sprite Animation Engine is responsible for displaying and advancing sprite animations from exported Animation Studio JSON.

It owns visual playback and animation-defined spatial geometry.

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

## 1. Animation Structure

A sprite animation contains:

- ordered frames
- default animation FPS
- playback mode
- animation-level collision box
- animation-level pivot point
- per-frame sprite data
- per-frame spatial markers

The runtime must reproduce the Animation Studio export exactly.

The Animation Studio JSON is the source of truth.

---

## 2. Animation Playback

Animations play frames sequentially.

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

## 3. Playback Mode

Each animation must define its playback behavior.

Minimum supported modes:

- `loop`
- `once`

`loop`
- After the final frame, return to frame 0.

`once`
- Stop on the final frame when playback completes.

The engine must expose whether a non-looping animation has completed so AI/gameplay code can react to completion.

---

## 4. Sprite Box

Every frame has a Sprite Box.

The Sprite Box defines the visual region into which that frame's PNG is fitted/rendered.

Sprite Box is PER FRAME.

Different frames may have different source PNG dimensions or crop bounds.

The Sprite Box exists to normalize those differences at runtime.

Changing the Sprite Box must NOT implicitly modify gameplay collision geometry.

Visual geometry and gameplay geometry remain separate.

---

## 5. Scale

Sprite rendering supports scale.

Scale is applied to the rendered sprite and all spatial geometry associated with that sprite.

Spatial data must remain aligned after scaling.

Never scale the visual sprite without applying the equivalent transform to its collision boxes, markers, radii, and pivot-relative geometry.

---

## 6. Pivot Point

Each animation has a Pivot Point.

Pivot is PER ANIMATION.

It defines the stable local origin used for:

- positioning
- rotation
- mirroring
- sprite alignment
- spatial marker transforms

The pivot remains consistent across every frame of the animation.

Frame cropping or Sprite Box differences must not cause the character's world position to jump.

---

## 7. Rotation

Sprites may be rotated around their animation Pivot Point.

All animation spatial geometry must follow the same transformation.

This includes:

- collision boxes
- hit/damage boxes
- point markers
- radius markers

Rotation must never visually separate gameplay geometry from the sprite.

---

## 8. Mirroring

Animations support horizontal and vertical mirroring.

Horizontal mirroring is used primarily for left/right facing.

Mirroring occurs around the Pivot Point.

All spatial geometry must mirror with the sprite.

Never maintain separate left-facing and right-facing copies of geometry.

The same animation data must work in both directions.

---

## 9. Main Collision Box

The primary Collision Box belongs to the ANIMATION, not individual frames.

It remains fixed throughout the animation.

Its purpose is the stable physical/body collision representation of the actor.

Animation frame artwork must not cause this collision box to resize automatically.

Visual animation and physical body collision are intentionally separated.

---

## 10. Per-Frame Boxes

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

## 11. Melee / Damage Boxes

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

## 12. Point Markers

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

## 13. Radius Markers

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

## 14. Marker Philosophy

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

## 15. Spatial Collections

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

## 16. Coordinate Transformation

All Animation Studio geometry is stored in sprite-local coordinates.

At runtime the Sprite Engine transforms it into world coordinates using:

1. sprite position
2. pivot
3. scale
4. mirroring
5. rotation

Every geometry primitive must use the SAME transformation pipeline.

This is critical.

The rendered sprite and its spatial metadata must never drift apart.

---

## 17. AI / Attack Interaction

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

## 18. Animation Is Data, Not AI

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

## Core Rule

Animation Studio defines visual timing and spatial geometry.

Sprite Animation Engine reproduces and exposes that data.

Gameplay systems interpret it.

AI decides behavior.

Keep these responsibilities separate.
