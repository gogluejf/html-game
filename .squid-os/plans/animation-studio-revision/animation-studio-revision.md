# Animation Studio — Revision Instructions

## Goal

Extend the existing Animation Studio without turning it into a gameplay or attack editor.

The Studio remains responsible for:

- sprite animation
- timing
- visual alignment
- collision geometry
- spatial markers
- JSON export

Gameplay behavior remains in code.

Do not redesign working Studio functionality unnecessarily.

---

## 1. Per-Frame Duration

Current behavior:

Animations use one constant FPS value.

Add:

Each frame may optionally override its duration.

UI requirements:

- Keep animation FPS as the default.
- Allow selecting a frame and assigning a custom duration.
- Provide an easy way to restore the frame to default FPS timing.
- Visually indicate frames with custom timing.

Export the timing information in JSON.

A frame without an override uses the animation FPS.

---

## 2. Playback Mode

Add an animation playback mode.

Minimum:

- Loop
- Once

Loop repeats normally.

Once stops on its final frame.

Export playback mode with the animation.

---

## 3. Multi-Box Support

Replace the current single per-frame melee box with a COLLECTION of boxes.

Each frame may contain:

    0..N boxes

The user must be able to:

- add a box
- select a box
- move it
- resize it
- delete it
- assign/change its type or label

Existing melee boxes should migrate naturally into this collection.

Do not restrict frames to one box.

---

## 4. Box Types

Every box has a type/label.

Examples:

- melee
- sword
- bite
- vulnerable
- weak-point
- custom

Keep this generic.

Do not create gameplay logic for every possible type.

The Studio stores and visualizes the type.

Runtime/gameplay code interprets it.

---

## 5. Point Markers

Add Point Markers.

A Point Marker contains:

- type/label
- X
- Y

Markers are PER FRAME.

Each frame supports:

    0..N point markers

The user can click/place a point directly over the sprite.

The point should be draggable.

The user can:

- add
- select
- move
- rename/retype
- delete

Examples:

- projectile-origin
- beam-origin
- ground-impact
- weapon-tip
- weak-point

Do not attach gameplay parameters to these markers.

For example, `beam-origin` does NOT configure beam width, damage, duration, color, etc.

It only defines a named spatial point.

---

## 6. Radius Markers

Add Radius Markers.

A Radius Marker contains:

- type/label
- X
- Y
- radius

Radius markers are PER FRAME.

Each frame supports:

    0..N radius markers

Render them as circles over the animation preview.

The user can:

- add
- select
- move center
- resize radius
- rename/retype
- delete

Examples:

- ai-detection
- explosion
- proximity
- healing
- danger-zone

Again, the Studio defines geometry only.

An `explosion` radius does NOT define damage.

An `ai-detection` radius does NOT implement AI.

---

## 7. Marker Types / Labels

Points, radii, and boxes must support a type/label.

The UI should make common labels fast to reuse while still allowing arbitrary custom labels.

Do NOT hard-code the system around a fixed list.

The project will evolve and new marker types must not require changing the Animation Studio.

---

## 8. Collections

Conceptually, each frame should now support:

    boxes[]
    points[]
    radii[]

Each collection supports zero or more elements.

Do not impose an arbitrary one-element limit.

---

## 9. Existing Animation-Level Data

Preserve the existing animation-level concepts:

- animation FPS
- collision box
- pivot point
- playback configuration

Collision Box remains PER ANIMATION.

Pivot Point remains PER ANIMATION.

Do not accidentally convert these to per-frame values.

---

## 10. Existing Per-Frame Data

Preserve:

- Sprite Box
- sprite crop/alignment information
- existing frame data

Sprite Box remains PER FRAME.

New per-frame data becomes:

- optional duration override
- boxes[]
- points[]
- radii[]

---

## 11. Transform Preview

When previewing:

- scale
- horizontal mirror
- vertical mirror
- rotation

all boxes, points, and radius markers must visually remain attached to the sprite.

The editor preview should represent the same transformation behavior expected at runtime.

---

## 12. JSON Export

Extend the existing JSON format rather than replacing it.

The export must preserve all current data and add the new fields.

Conceptually:

    animation
        fps
        playback
        pivot
        collision_box

        frames[]
            sprite_box
            duration_override

            boxes[]
                type
                x
                y
                width
                height
                damage...

            points[]
                type
                x
                y

            radii[]
                type
                x
                y
                radius

Exact field names should follow the existing project's naming conventions.

Do not break backward compatibility unnecessarily.

---

## 13. Studio Boundary

IMPORTANT:

Do NOT add:

- beam configuration
- projectile configuration
- attack-pattern configuration
- shockwave configuration
- AI behavior
- attack sequencing
- boss scripting

The Studio is not a gameplay editor.

It provides animation timing and spatial metadata that code can consume.

---

## Final Model

PER ANIMATION:

    FPS
    Playback Mode
    Pivot
    Main Collision Box

PER FRAME:

    Sprite Box
    Optional Duration
    0..N Typed Boxes
    0..N Typed Point Markers
    0..N Typed Radius Markers

This is the target revision.
