# Petal Panic — Levels

> **Design contract for level mechanics.** These documents describe intended
> behavior, not a claim that the current prototype already implements it.
> Like hero-mechanics, knockback, and effects, they define concepts, rules,
> examples, and boundaries without prescribing code architecture.

A game travels through themed levels. Each level contains four numbered areas
and a separate boss zone. Areas are assembled from authored patterns, with
random choices fixed for the entire game. Death repeats an area; a continue
repeats the current level from its first area.

## Documents and ownership

| Document | Owns |
| --- | --- |
| [Game rules](game-rules.md) | Global lives, continue pool, reward conversion, score presentation. |
| [Structure](structure.md) | Level/area vocabulary, orientations, terrain units, camera boundaries. |
| [Lifecycle](lifecycle.md) | Game start, game continue, area start, life start; what repeats and what survives. |
| [Generation](generation.md) | Terrain macros, reachability, difficulty progression, repeatable randomness. |
| [Population](populate.md) | Enemy budgets, powerup matrix, barrel patterns and placement. |
| [Checkpoints and screens](checkpoints.md) | Flags, area-clear celebration, entry screen, death transitions. |
| [Boss zone](boss-arena.md) | Approach, introduction, arena lock, defeat and reward sequence. |

Read structure and game rules first, then lifecycle. The remaining documents
expand individual parts of that contract. Shared rules have one owner; links
point to it rather than introducing competing definitions.

The existing [level story](../story/levels.md) describes the four settings,
bosses, and enemy rosters. It is separate from these mechanics. References:
[hero mechanics](../architecture/hero-mechanics.md),
[knockback](../architecture/knockback.md), and
[effects](../architecture/effects.md).

## Confirmed rules versus design-plan decisions

Confirmed behavior is written directly. Anything not yet decided is explicitly
marked as a **design-plan decision**; agents must not silently turn it into a
rule. In particular, exact score accounting, coin carryover/conversion
bookkeeping, inventory persistence, and transition timings will be proposed by
the design plan generated from these documents. These do not prevent documenting
the agreed level flow.

Music is deferred. The design plan will propose music and timing parameters so
the game feels thrilling; these documents only require that feedback exists. No
implementation plan or code change is implied by completing this design.
