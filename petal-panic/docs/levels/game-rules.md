# Petal Panic — Game Rules

> Global settings own starting lives, starting continues, and the coin threshold
> for earning continues. Individual levels do not redefine these rules.

## 1. Lives and continues are different resources

A new game starts with **3 lives and 3 continues**. These are configurable global
defaults, not numbers scattered across level behavior.

- An ordinary death consumes one life.
- With lives remaining, restart the **same area** from its beginning.
- At zero lives, show the existing Game Over screen.
- Using Continue consumes one continue, restores the configured starting lives
  (currently 3), and restarts **area -1 of the current level**.
- Continue does not charge coins or check the coin balance.
- With no continues remaining, Continue cannot be activated; Quit remains available.

Example: dying in 2-3 with lives remaining repeats 2-3. Running out of lives in
2-3 and continuing starts 2-1. Neither event starts a new game or rerolls its areas.

The continue pool is shared across the game. It is a remaining balance, not a
fixed maximum number of continue uses: additional continues can be earned.

Whether completing a level replenishes lives or preserves the remaining count is
a design-plan decision. Do not confuse entering a new area with receiving extra
lives.

## 2. Earning continues

Coin rewards and spending a continue are separate events.

After a boss is defeated, the level reward screen counts coins collected and
awards **one continue per full 1000 coins**, automatically. The threshold is a
global tuning value and may be reviewed later.

The presentation counts the reward, then visibly credits the continue pool.
For multiple qualifying chunks, each contributes another continue. Ordinary
pickups and area-clear flags do not trigger this conversion during play.

A reward must be credited once, not again because the screen redraws or its
animation repeats.

**Design-plan decisions (not rules of this document):**

- Are converted coins deducted from a spendable balance or only marked rewarded?
- Does a remainder below 1000 carry to the next level?
- Do coins collected on failed area attempts count toward the reward?
- What happens to the current level's coin tally after using Continue?

The previous draft's assertion that coins are always kept was not an agreed
rule. The design plan must settle these before reward accounting is implemented.

## 3. Screen responsibilities

- **Area-entry screen:** level name, area identifier, remaining lives. **No score.**
  It appears on normal area entry and after losing a life or continuing.
- **Game Over screen:** the already-coded score/stat presentation and two-option
  Continue / Quit menu. It is existing and must not be reworked; only its
  navigation follows the shared rules below. Keep its opaque dark background.
- **Level reward screen:** enemies killed, score, coins collected, continues earned
  and their credit to the global pool. This replaces the current placeholder
  post-boss screen in code.

**All screens share one ergonomics contract:** the same list layout, focus pill,
and button-instruction/keycap bar as the pause menu (navigate, confirm, quit).
A new screen reuses this pattern instead of inventing its own controls.

These are full-screen presentations, not small floating panels. Losing an
ordinary life does not require a separate score screen.

## 4. Score and replay accounting

Score appears at Game Over and on the level reward screen, not on the area-entry
screen. This design does not redefine the scoring formula.

**Design-plan decision:** score and kill/coin accounting across failed attempts
and continues. Restoring enemies, barrels, and pickups is confirmed; whether
their rewards accumulate repeatedly or roll back to the area's entry totals is
not.

This distinction matters: repeatable pickups, especially extra lives, can create
farming loops. Do not solve this silently by removing their confirmed respawn
behavior. The design plan must choose the accounting policy explicitly.

## 5. Other persistence decisions

Full-world restoration does not automatically specify the hero's inventory.
Ammo, selected weapon, energy, temporary powerups, and super meter persistence
across death, continue, and area advance are design-plan decisions. Respawn
protection must remain consistent with [hero mechanics](../architecture/hero-mechanics.md).

See [lifecycle](lifecycle.md) for the four distinct start events and the lifetime
of the generated world.
