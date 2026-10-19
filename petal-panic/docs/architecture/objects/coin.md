# Coins

Collectible pickups that drop from destroyed barrels and certain enemies.

## What they are

Small physical objects with gravity and bounce. They sit on the ground or arc
through the air after being spawned. The hero collects them by touching them.

## Behavior

- Have weight: fall, bounce off ground/platforms, settle.
- Magnet: when the hero is close, coins are pulled toward them and collected.
- On collect: disappear, add to the player's coin count (score/currency).
- Have a lifetime: if not collected within a few seconds they fade out.
- Do not block movement. No damage. No interaction besides collection.

## Spawning

- Coin Barrels burst into a cluster of coins on death.
- Certain enemies drop 1–2 coins on death.
- Never spawned by level design directly (always a reward for action).
