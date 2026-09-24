# Petal Panic — Boss Zone

The boss zone is the fifth, separate zone of a level. It contains one boss
checkpoint and a fixed battle room. **The introduction builds anticipation
before combat begins.**

## 1. Entry and run phase

The boss checkpoint at the end of area 4 leads through the normal transition
to the boss zone. The player enters the boss zone from the left, exactly like
any other area start: a boss checkpoint flag stands at the left entry (labeled
like any other level's entry flag — it is purely visual and never triggers
anything), and the player walks right with the normal camera following.

A little before the far right end of the zone there is an invisible trigger
line. The moment the player crosses it, the screen goes black instantly and
the boss card plays on the black. No delay, no teleport.

**Direction detail:** the player enters from the left and walks right (like a
regular area). The boss's own entrance is from the right, independently
confirmed.

Music will be added later. The visual sequence must communicate tension on its own.

## 2. Boss introduction screen

As soon as the card graphic disappears (the sweep is done — before the
energy bar even appears), the battle room is put in place under the black:
a real room exactly one screen wide (its left edge is screen pixel 0, its
right edge is screen pixel 960), the camera locked to it (no scrolling), and
the player standing at the left side of that view, in the same spot as any
level start. Only then does the energy bar appear and begin filling, and the
boss slide in from the right — revealed as the black lifts. The presentation
sequence:

1. Lock both sides and stop camera scrolling. The fight occupies a fixed view.
2. Keep the boss invisible initially.
3. A huge full-screen graphic — the boss's name and his picture — sweeps rapidly
   **left to right** across the whole screen. Its purpose is pure tension; a
   placeholder image is fine for now.
4. The boss name/title moves **right to left**, opposing the graphic.
5. The introduction graphic disappears.
6. The boss energy bar appears at the top and begins filling.
7. After a portion of the bar has filled, the boss enters the screen **from the right**
   and settles on the right side of the view (about three quarters across), so
   both combatants are visible during the fight.
8. Hand over to the fight.

The exact timings, entrance duration, bar-fill threshold, music, and the precise
combat-enable moment are not rules of this document; the design plan will propose
them so the sequence feels thrilling rather than arbitrary. Until then, one only
constraint stands: the presentation must not imply that the boss is attackable
before combat actually starts.

## 3. Fight and retry

The battle room remains locked during combat. The player cannot scroll past the
boss or leave through either side.

Losing a life restarts the WHOLE boss zone: the player stands at the left
entry again, and the walk + introduction repeat. A
continue instead returns to area 1 of this level, like defeat in any other
area. Random generation choices remain unchanged in both cases.

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

The reward screen has **no menu**: it shows a single instruction line and the
regular navigation bar. Confirm advances (next level, or end-of-game on the
final level); back does the SAME — it never quits to home.

Count the coin reward and show each qualifying 1000-coin chunk earning another
continue, then visibly credit the global continue counter. The rate is a global
setting, not boss-specific behavior. Conversion is automatic; there is no shop
or mid-play purchase confirmation.

The continue pool, conversion policy, and unresolved coin/score bookkeeping
belong to [game rules](game-rules.md). The screen presents that result once; it
must not credit rewards repeatedly while animating. Its duration, skip behavior,
and celebration effects are design-plan concerns.

## 5. Next level

After the reward screen, start the next level at area 1 and show its shared
entry screen: level name, area, lives. That opening area has no entry flag drawn.

For the **final level**, the reward screen is followed by the minimal end-of-game
screen (congratulations + final score + return home) instead of a next level —
see [lifecycle](lifecycle.md). Its full presentation is owned by the future
story epic; music, reward screen duration, skip behavior, and celebration effects
are design-plan concerns.
