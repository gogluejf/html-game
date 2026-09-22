# Petal Panic — Level Structure

A **level** is a themed journey. An **area** is one independent playable zone
within it. Areas are not physically connected pieces of one scrolling map.

## 1. Five zones per level

Each level contains:

1. Area -1.
2. Area -2.
3. Area -3.
4. Area -4.
5. A separate boss zone, including its short approach and arena.

For example, Level 1 contains 1-1 through 1-4, then its boss zone.
**Exactly one of the four ordinary areas is vertical.** It can be -2, -3, or -4;
never -1. The other three are horizontal. Whether the vertical slot is selected
by configuration or chosen once per game remains a tuning/design choice; it
must remain unchanged throughout that game.

The boss and enemy roster belong to the level's theme. Difficulty increases
across its numbered areas through macro selection and population, not by
changing the hero's controls.

## 2. Independent zones

Reaching an exit ends the current zone. After the celebration and fade, a new
zone replaces it. A vertical-to-horizontal transition does not require walking
back down or building a physical connecting passage.

- Area -1 starts without an entry checkpoint flag.
- Later areas begin beside a visible entry flag.
- The boss zone begins beside a boss checkpoint flag.
- Each ordinary area ends at its exit flag. There is no scrolling beyond it.
- The exit of -4 uses the boss checkpoint appearance and leads to the boss zone.

Death restarts the current zone, not the area before the flag. Details belong
to [checkpoints](checkpoints.md).

## 3. Horizontal areas

Ordinary horizontal progression runs left to right. The exit is at the far end.
The camera stops at the area boundaries; it cannot reveal the previous or next
zone. Horizontal backward-scroll behavior within the current area is a
design-plan decision.

Do not invent mandatory pits or a particular camera lead distance. Those have
not yet been specified.

## 4. Vertical areas

Vertical progression is an upward climb, Contra-style.

- The starting flag sits on a supporting platform at the bottom.
- There is **no horizontal camera scrolling**. The hero can still move sideways
  and jump between platforms inside the fixed width.
- The camera follows upward progress only. Once raised, it never follows back down.
- The hero may fall within the visible view, but falling into the bottom emptiness
  kills them. Descending cannot recover the earlier part of the climb.
- The exit flag sits on a platform at the top.
- Death resets the ascent to its starting platform and starting camera position.

The initial supporting platform must allow a safe start; the lethal bottom rule
must not kill a hero standing normally at the entry.

## 5. Terrain vocabulary

**Blocks are solid landscape. Platforms are one-way landing surfaces.** They
are not interchangeable, even when their top surfaces share a height.

### Blocks

- Always one width unit per block.
- Height is one, two, or three height units.
- Rise from the ground and block passage from every direction.
- Cannot be jumped through from below or dropped through from above.
- Adjacent blocks can form a wider structure; that does not change their unit width.

### Platforms

- One platform thickness; widths are one, two, or three units.
- Can occupy elevation tier 1, 2, or 3.
- Support the normal jump-through and Down + Jump drop-through rules from
  [hero mechanics](../architecture/hero-mechanics.md).

Successive top-surface elevations are spaced so double jumping can reach the
next tier: ground to tier 1, then tier 1 to tier 2, then tier 2 to tier 3.
Spacing must work for both heroes with a usable margin, not only a perfect jump.

Vertical areas repeat reachable climbing patterns upward; three tiers must not
accidentally become a three-platform cap on the entire ascent. Exact vertical
pattern dimensions remain tuning work.

## 6. Art and length

Use the level-specific background, foreground, block, and platform artwork.
The circus horizontal layers and the balloon-filled vertical sky establish the
two orientations visually. Decorative props painted into an image do not alone
create collision or collectible objects.

Target **roughly twice the current prototype area length**, particularly the
short existing 1-1-style stretches. Record the measured baseline before
implementation; no screen count has been agreed. Vertical climb duration and
boss approach length are tuned separately rather than blindly doubled.
