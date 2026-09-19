# Petal Panic — Engine Architecture Layers

The game architecture is divided into nine reusable layers. Each layer owns one specific responsibility and exposes functionality that other layers can compose. Game content should be created primarily by configuring and combining these systems rather than implementing one-off logic for individual enemies, bosses, levels, or heroes.

## 1. Input Engine

Handles all physical player input and maps it to abstract gameplay actions.

Supports keyboard, gamepad, remapping, button states, held inputs, and input buffering. The Input Engine does not implement hero behavior; it communicates player intentions to the Hero Mechanics layer.

## 2. Hero Mechanics

Defines the gameplay rules and abilities of playable heroes.

This includes movement, jumping, air control, crouching, sliding, shooting, melee attacks, special moves, supermoves, recovery states, invincibility, and other hero-specific mechanics.

It consumes abstract actions from the Input Engine rather than dealing directly with physical buttons.

## 3. Collision Engine

Provides the shared physical and gameplay interaction system.

It manages hitboxes, hurtboxes, melee collision, projectile collision, environment collision, radiuses, factions such as friendly and enemy, damage interactions, detection zones, object states, TTL timers, cooldowns, invincibility windows, and related collision data.

It should remain generic enough to support heroes, enemies, bosses, projectiles, destructible objects, and environmental hazards.

## 4. Sprite / Animation Engine

Controls how visual game entities are rendered and animated.

It manages sprite sheets, animation sequences, frame timing, looping and non-looping animations, final-frame behavior, scale, orientation, playback speed, and animation state transitions.

Gameplay logic should request an animation without needing to understand how its individual frames are rendered.

## 5. Effects Engine

Provides a reusable library of visual effects.

Effects are parameterized building blocks such as particles, sparks, explosions, shockwaves, flashes, trails, target indicators, fades, camera shake, sprite shake, glows, and damage feedback.

Effects remain primarily visual. Gameplay consequences such as damage are controlled by gameplay systems and can be synchronized with an effect by an Attack Pattern.

## 6. Attack Engine

Provides reusable Attack Patterns that can be assigned to different enemies and bosses.

An Attack Pattern is effectively a gameplay macro or script that composes existing systems. It can spawn projectiles, create collision volumes, trigger animations, launch effects, wait for timings, create telegraphs, move entities, generate explosions, and sequence multiple actions.

Examples include GroundStomp, MissileRain, HomingMissiles, GroundWave, or a multi-stage boss combo.

Attack Patterns should be reusable rather than implemented directly inside individual enemy code.

## 7. AI / Behavior Engine

Decides what an enemy should do and when.

It handles detection, targeting, movement decisions, aggression, attack selection, attack frequency, state transitions, boss phases, and behavioral rules.

The AI chooses an Attack Pattern; the Attack Engine executes it. This keeps enemy intelligence separate from the implementation of attacks themselves.

## 8. Level Engine

Defines and manages reusable level composition.

It handles platforms, blocks, obstacles, destructible objects, barrels, hazards, spawn locations, environmental entities, foreground/background elements, level boundaries, checkpoints, and other level-specific structures.

Levels should primarily be data-driven compositions of reusable game objects.

## 9. Story / Scripting Engine

Orchestrates events that happen above the normal moment-to-moment gameplay systems.

It manages level introductions, scripted sequences, dialogue, cutscenes, boss entrances, transitions, story events, triggered sequences, level completion events, and other narrative or cinematic behavior.

Story scripts can coordinate the other engines without embedding narrative logic inside them.
