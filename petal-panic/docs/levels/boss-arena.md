# Petal Panic — Boss Zone

The boss zone is the fifth, separate zone of a level. It contains a checkpoint,
a short approach, and a fixed arena. **The introduction builds anticipation
before combat begins.**

## 1. Entry and approach

The boss checkpoint at the end of area -4 leads through the normal transition
to the boss zone. The player starts beside its boss checkpoint and travels a
short distance toward a warning region and the arena.

Around one screen of approach is a provisional reference, not a locked distance.
It should be long enough to leave the flag behind and anticipate the encounter,
without becoming a long repeated walk after death.

**Direction detail:** the initial description specified running left toward
the arena. The later clarification confirmed the short approach but did not
change that direction. Keep leftward approach as the recorded proposal; do not
silently assume rightward travel just because ordinary areas progress right.
The boss's own entrance from the right is confirmed independently.

Music will be added later. The visual sequence must communicate tension on its own.

## 2. Boss introduction screen

On reaching the arena, a dedicated full-screen presentation plays before combat:

1. Lock both sides and stop camera scrolling. The fight occupies a fixed view.
2. Keep the boss invisible initially.
3. A huge full-screen graphic — the boss's name and his picture — sweeps rapidly
   **left to right** across the whole screen. Its purpose is pure tension; a
   placeholder image is fine for now.
4. The boss name/title moves **right to left**, opposing the graphic.
5. The introduction graphic disappears.
6. The boss energy bar appears at the top and begins filling.
7. After a portion of the bar has filled, the boss enters the screen **from the right**.
8. Hand over to the fight.

The exact timings, entrance duration, bar-fill threshold, music, and the precise
combat-enable moment are not rules of this document; the design plan will propose
them so the sequence feels thrilling rather than arbitrary. Until then, one only
constraint stands: the presentation must not imply that the boss is attackable
before combat actually starts.

## 3. Fight and retry

The arena remains locked during combat. The player cannot scroll past the boss
or leave through either side.

Losing a life restarts the boss zone at its checkpoint, restoring the encounter
and repeating the approach/introduction. A continue instead returns to area -1
of this level, like defeat in any other area. Random generation choices remain
unchanged in both cases.

This document does not define boss attack patterns or rebalance damage. Those
remain the boss/combat systems' responsibility.

## 4. Level reward screen

The boss zone's second screen, shown after the defeat presentation: a full-screen
level reward summary (boss beaten, level passed):

- Enemies killed.
- Score.
- Coins collected.
- Continues earned.

This replaces the current placeholder post-boss screen in code; it shows this
minimal set for now and can grow later. It follows the shared screen ergonomics
contract from [game rules](game-rules.md).

Count the coin reward and show each qualifying 1000-coin chunk earning another
continue, then visibly credit the global continue counter. The rate is a global
setting, not boss-specific behavior. Conversion is automatic; there is no shop
or mid-play purchase confirmation.

The continue pool, conversion policy, and unresolved coin/score bookkeeping
belong to [game rules](game-rules.md). The screen presents that result once; it
must not credit rewards repeatedly while animating. Its duration, skip behavior,
and celebration effects are design-plan concerns.

## 5. Next level

After the reward screen, start the next level at area -1 and show its shared
entry screen: level name, area, lives. That opening area has no entry flag drawn.

For the **final level**, the reward screen is followed by the minimal end-of-game
screen (congratulations + final score + return home) instead of a next level —
see [lifecycle](lifecycle.md). Its full presentation is owned by the future
story epic; music, reward screen duration, skip behavior, and celebration effects
are design-plan concerns.
