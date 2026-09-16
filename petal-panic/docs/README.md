# Petal Panic — Design Docs

Human-readable spec of all entities, systems, and tunables.
When code changes, update the corresponding YAML here.

## Structure

```
docs/
├── engine/       # Shared engine concepts (reusable across games)
│   ├── entity.yaml      # Base class fields (position, velocity, transform, collision)
│   └── hitbox.yaml      # Unified attack hitbox system (team routing, processing)
│
├── base/         # Class structures (what fields exist, what they mean)
│   ├── hero.yaml        # Hero structure (movement, melee, super move, resources)
│   ├── enemy.yaml       # Enemy base structure (stats, AI state, death pipeline)
│   ├── game_obj.yaml    # Destructible solid structure (HP, explosive, coinDrop)
│   ├── checkpoint.yaml  # Checkpoint structure
│   ├── projectile.yaml  # Thorn projectile structure
│   ├── special.yaml     # Saw/bomb special structure
│   ├── coin.yaml        # Coin structure + type definitions
│   └── powerup.yaml     # Powerup structure + effect definitions
│
└── entities/     # Concrete implementations (actual values per character/type)
    ├── scarlet.yaml         # Scarlet Vale stats
    ├── balthazar.yaml       # Balthazhar stats
    ├── jester.yaml          # Jester AI + whip values
    ├── vine_hound.yaml      # Vine Hound lunge values
    ├── boris_loon.yaml      # Boris Loon flight + dive values (adult + baby)
    ├── violetta.yaml        # Violetta pacing + jab + projectile values
    ├── jack_o_lantern.yaml  # Jack-O-Lantern fuse + explosion values
    ├── elephant.yaml        # Boss phases, weak point, arena
    └── barrels.yaml         # Wood/explosive/coin barrel defs
```

## Rules

- **base/** describes the *structure* (field names, types, defaults, semantics)
- **entities/** describes the *implementation* (actual numbers for each specific thing)
- **engine/** describes shared systems that any game could reuse
- Values here must match the JS source. If you change a constant in code, update the YAML.
