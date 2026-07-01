# EPIC: Super Mario Bros World 1-1 Clone
Why: Build a playable HTML/JS clone of SMB1 World 1-1 in the html-game project alongside Galaga
Outcomes: Playable level 1-1 with Mario physics, enemies, blocks, pipes, flag pole, scoring, and game-over/restart

## MILESTONE: 1 - Engine
Pattern: Game Loop + Component-Based Entity
Objective: Core game loop, canvas rendering, input handling, and entity system
Success: Game loop running at 60fps, input responsive, entities can be spawned and rendered
Diagram: flowchart LR
  A[Game Loop] --> B[Update]
  A --> C[Render]
  B --> D[Input]
  B --> E[Physics]
  B --> F[Collision]
  B --> G[Entities]
  C --> H[Canvas 2D]
  D --> I[Keyboard]
  D --> J[Touch]

### TASK: 1.1 - Canvas setup and game loop
Type: feature
What: Create index.html with canvas and main.js with requestAnimationFrame game loop
Why: Foundation for all rendering and game logic
Files: + smb1/index.html
Files: + smb1/js/main.js
Snippet: const canvas = document.getElementById('game');\nconst ctx = canvas.getContext('2d');\ncanvas.width = 800;\ncanvas.height = 480;\n\nlet lastTime = 0;\nfunction gameLoop(timestamp) {\n    const dt = (timestamp - lastTime) / 1000;\n    lastTime = timestamp;\n    update(dt);\n    render();\n    requestAnimationFrame(gameLoop);\n}\nrequestAnimationFrame(gameLoop);
Acceptance: Canvas renders at 800x480
Acceptance: Game loop runs at 60fps with delta time
Verification: open ~/src/html-game/smb1/index.html

### TASK: 1.2 - Input handling and camera system
Type: feature
What: Add keyboard input manager (Arrow keys + Z/X) and scrolling camera that follows Mario
Why: Player needs controls and the level needs to scroll horizontally
Files: + smb1/js/input.js
Files: + smb1/js/camera.js
Snippet: const keys = {};\nwindow.addEventListener('keydown', e => keys[e.code] = true);\nwindow.addEventListener('keyup', e => keys[e.code] = false);\n\n// Camera follows Mario with clamping\nclass Camera {\n    update(playerX, levelWidth) {\n        this.x = Math.max(0, Math.min(playerX - 300, levelWidth - 800));\n    }\n}
Acceptance: Arrow keys tracked in real-time
Acceptance: Camera follows player and clamps to level bounds
Verification: open ~/src/html-game/smb1/index.html

### TASK: 1.3 - Entity base class and sprite system
Type: feature
What: Create base Entity class with position, velocity, and sprite rendering via pixel art tilemap
Why: All game objects (Mario, enemies, blocks) share common behavior
Files: + smb1/js/entity.js
Files: + smb1/assets/sprites.png
Files: + smb1/js/sprites.js
Snippet: class Entity {\n    constructor(x, y, w, h) {\n        this.x = x; this.y = y;\n        this.w = w; this.h = h;\n        this.vx = 0; this.vy = 0;\n        this.alive = true;\n    }\n    update(dt) {}\n    render(ctx, camera) {\n        ctx.drawImage(spriteSheet, sx, sy, sw, sh,\n            this.x - camera.x, this.y, this.w, this.h);\n    }\n}
Acceptance: Sprite sheet loaded and sub-images can be extracted
Acceptance: Entity can be positioned and rendered relative to camera
Verification: open ~/src/html-game/smb1/index.html

## MILESTONE: 2 - Mario
Pattern: State Machine + Physics Body
Objective: Mario character with movement, jumping, gravity, big/m small states, and death animation
Success: Mario runs, jumps, grows with mushroom, and dies on enemy contact
Diagram: stateDiagram-v2
    [*] --> Small
    Small --> Big: Mushroom
    Big --> Small: Hit
    Small --> Dead: Enemy
    Big --> Dead: Enemy
    Dead --> [*]: Game Over

### TASK: 2.1 - Mario physics and movement
Type: feature
What: Implement Mario with gravity, acceleration, max speed, and variable-height jumping
Why: Mario needs authentic platforming feel — snappy controls with momentum
Files: + smb1/js/mario.js
Snippet: class Mario extends Entity {\n    constructor(x, y) {\n        super(x, y, 16, 16);\n        this.state = 'small';\n        this.speed = 200;\n        this.accel = 1200;\n        this.gravity = 1500;\n        this.jumpVel = -400;\n        this.onGround = false;\n    }\n    update(dt) {\n        if (keys['ArrowRight']) this.vx += this.accel * dt;\n        if (keys['ArrowLeft']) this.vx -= this.accel * dt;\n        this.vy += this.gravity * dt;\n        this.x += this.vx * dt;\n        this.y += this.vy * dt;\n    }\n}
Acceptance: Mario accelerates and decelerates smoothly
Acceptance: Mario falls with gravity when off ground
Acceptance: Speed caps at max (200 px/s)
Verification: open ~/src/html-game/smb1/index.html

### TASK: 2.2 - Mario jumping and states
Type: feature
What: Add variable-height jumping, big/small states, mushroom powerup, and death/invincibility
Why: Iconic SMB mechanics — short tap = short hop, hold = full jump, states affect collision
Files: ~ smb1/js/mario.js
Snippet: jump() {\n    if (!this.onGround) return;\n    this.vy = this.jumpVel;\n    this.onGround = false;\n}\n// Release jump early = cut velocity\nupdate(dt) {\n    if (!keys['ArrowUp'] && this.vy < -100) this.vy = -100;\n}\ngrow() {\n    if (this.state === 'small') {\n        this.state = 'big'; this.h = 32; this.y -= 16;\n    }\n}\nshrink() {\n    if (this.state === 'big') {\n        this.state = 'small'; this.h = 16; this.invulnerable = true;\n        setTimeout(() => this.invulnerable = false, 2000);\n    }\n}
Acceptance: Short tap of jump = small hop
Acceptance: Hold jump = full height
Acceptance: Mushroom grows Mario from 16px to 32px tall
Acceptance: Big Mario shrinks on enemy contact, becomes invulnerable for 2s
Acceptance: Small Mario dies on enemy contact
Verification: open ~/src/html-game/smb1/index.html

## MILESTONE: 3 - Level
Pattern: Tilemap + Chunked Rendering
Objective: World 1-1 layout with ground, pipes, blocks, gaps, and flag pole
Success: Full 1-1 level loads, renders, and is traversable from start to flag
Diagram: flowchart LR
    A[Level Data] --> B[Tilemap Parser]
    B --> C[Ground Tiles]
    B --> D[Pipe Sprites]
    B --> E[Question Blocks]
    B --> F[Brick Blocks]
    B --> G[Gaps / Pits]
    B --> H[Flag Pole]

### TASK: 3.1 - Tilemap parser and ground rendering
Type: feature
What: Create tilemap data structure for 1-1 and render ground, walls, and static tiles
Why: Level layout needs a structured format for collision and rendering
Files: + smb1/js/level.js
Files: + smb1/js/tilemap.js
Snippet: // Tile IDs: 0=air, 1=ground, 2=brick, 3=question, 4=pipe-tl, etc.\nconst TILE = 16;\nclass Level {\n    constructor(layout) {\n        this.width = layout[0].length * TILE;\n        this.height = layout.length * TILE;\n        this.tiles = layout;\n    }\n    getTile(x, y) {\n        const tx = Math.floor(x / TILE);\n        const ty = Math.floor(y / TILE);\n        return this.tiles[ty]?.[tx] || 0;\n    }\n    render(ctx, camera) {\n        // Only render visible tiles\n        const startX = Math.floor(camera.x / TILE);\n        const endX = Math.floor((camera.x + 800) / TILE);\n        for (let ty = 0; ty < this.tiles.length; ty++)\n            for (let tx = startX; tx <= endX; tx++)\n                if (this.tiles[ty][tx]) drawTile(ctx, tx, ty, camera);\n    }\n}
Acceptance: Ground tiles render continuously across the level
Acceptance: Only visible tiles are rendered (culling)
Acceptance: getTile returns correct tile ID for any world position
Verification: open ~/src/html-game/smb1/index.html

### TASK: 3.2 - World 1-1 layout data
Type: feature
What: Encode the actual 1-1 level layout: ground, pipes, blocks, gaps, staircase, flag
Why: The defining content — needs to match the original level layout closely
Files: + smb1/js/level-data.js
Snippet: // Simplified 1-1 layout encoded as rows of tile IDs\n// Key sections: start run, ? block row, pipe x5,\n// brick/? arrangements, underground gap, staircase, flag\nconst LEVEL_1_1 = [\n    // Each sub-array = one row (y axis), top to bottom\n    // 0=air, 1=ground, 2=brick, 3=question, 4=pipe-tl, 5=pipe-tr, 6=pipe-bl, 7=pipe-br\n    // ... rows defining the level ...\n];
Acceptance: Level has ground from start to flag with 3 pits
Acceptance: 5 pipes placed at correct positions
Acceptance: Question blocks with mushrooms and coins placed
Acceptance: Staircase section before flag pole
Acceptance: Flag pole at end of level
Verification: open ~/src/html-game/smb1/index.html

### TASK: 3.3 - Tile collision system
Type: feature
What: AABB collision between Mario and solid tiles (ground, bricks, pipes, blocks)
Why: Mario needs to stand on ground, hit blocks from below, and clip against pipes
Files: ~ smb1/js/level.js
Files: + smb1/js/collision.js
Snippet: function resolveTileCollision(entity, level) {\n    // Check all tiles overlapping entity bounds\n    const left = Math.floor(entity.x / TILE);\n    const right = Math.floor((entity.x + entity.w) / TILE);\n    const top = Math.floor(entity.y / TILE);\n    const bottom = Math.floor((entity.y + entity.h) / TILE);\n    \n    for (let ty = top; ty <= bottom; ty++)\n        for (let tx = left; tx <= right; tx++) {\n            const tile = level.getTile(tx, ty);\n            if (isSolid(tile)) {\n                resolveAABB(entity, tx*TILE, ty*TILE, TILE, TILE);\n            }\n        }\n}
Acceptance: Mario stands on ground without falling through
Acceptance: Mario stops when walking into a pipe
Acceptance: Mario head bounces off brick from below
Acceptance: Mario falls through pits (no ground tile)
Verification: open ~/src/html-game/smb1/index.html

## MILESTONE: 4 - Enemies
Pattern: Simple AI + State Machine
Objective: Goombas and Koopas with walking AI, stomp-to-kill, and contact-damage
Success: Enemies spawn, walk, get stomped, and hurt Mario on side contact
Diagram: flowchart LR
    A[Enemy Spawn] --> B[Walk Left]
    B --> C{Collision}
    C --> D[Mario Stomps]
    C --> E[Mario Touches Side]
    C --> F[Hits Wall / Pipe]
    D --> G[Flattened / Shell]
    E --> H[Mario Takes Damage]
    F --> I[Reverse Direction]

### TASK: 4.1 - Goomba enemy
Type: feature
What: Implement Goomba: walks left at constant speed, dies when stomped, kills Mario on side contact
Why: Classic first enemy — teaches stomp mechanic
Files: + smb1/js/goomba.js
Snippet: class Goomba extends Entity {\n    constructor(x, y) {\n        super(x, y, 16, 16);\n        this.vx = -50;\n        this.alive = true;\n        this.stomped = false;\n    }\n    update(dt) {\n        if (this.stomped) {\n            this.deathTimer -= dt;\n            if (this.deathTimer <= 0) this.alive = false;\n            return;\n        }\n        this.x += this.vx * dt;\n        this.vy += GRAVITY * dt;\n        this.y += this.vy * dt;\n        // Reverse on wall/pipe collision\n        // Fall off edges\n    }\n    stomp(marioY) {\n        this.stomped = true;\n        this.deathTimer = 0.5;\n        score += 100;\n    }\n}
Acceptance: Goomba walks left continuously
Acceptance: Stomped goomba flattens and disappears after 0.5s
Acceptance: Side contact with living goomba damages Mario
Acceptance: Stomping awards 100 points
Verification: open ~/src/html-game/smb1/index.html

### TASK: 4.2 - Koopa enemy
Type: feature
What: Implement Koopa Troopa: walks, retreats into shell when stomped, shell slides when kicked
Why: Adds shell mechanic — kicked shells kill other enemies
Files: + smb1/js/koopa.js
Snippet: class Koopa extends Entity {\n    constructor(x, y) {\n        super(x, y, 16, 32);\n        this.state = 'walking'; // walking, shell, shell-moving\n        this.vx = -50;\n    }\n    update(dt) {\n        if (this.state === 'walking') { /* walk + gravity */ }\n        if (this.state === 'shell') { /* idle */ }\n        if (this.state === 'shell-moving') {\n            this.x += this.vx * dt;\n            // Kill other enemies on contact\n        }\n    }\n    stomp() { this.state = 'shell'; this.h = 16; }\n    kick() { this.state = 'shell-moving'; this.vx = 300; }\n}
Acceptance: Koopa walks left at constant speed
Acceptance: Stomp turns Koopa into idle shell
Acceptance: Touching idle shell kicks it across screen
Acceptance: Moving shell kills other enemies on contact
Verification: open ~/src/html-game/smb1/index.html

## MILESTONE: 5 - Gameplay
Pattern: Event-Driven Interactions + Score System
Objective: Question blocks, bricks, mushrooms, coins, HUD, and game-over/level-complete flow
Success: Full gameplay loop: play, score, die, restart, reach flag for level complete
Diagram: flowchart LR
    A[Mario Head-Bumps Block] --> B[Question Block]
    A --> C[Brick Block]
    B --> D[Mushroom / Coin]
    C --> E[Breaks if Big]
    C --> F[Shakes if Small]
    D --> G[Mario Grows / Score Up]
    H[Mario Reaches Flag] --> I[Slide Down Pole]
    I --> J[Level Complete Screen]
    K[Mario Dies] --> L[Game Over]
    L --> M[Restart]

### TASK: 5.1 - Block interaction and powerups
Type: feature
What: Question blocks spawn mushrooms/coins when hit from below; bricks break or shake
Why: Core SMB interaction — blocks give powerups and score
Files: + smb1/js/block.js
Files: + smb1/js/mushroom.js
Files: + smb1/js/coin.js
Snippet: class QuestionBlock extends Entity {\n    constructor(x, y, content) {\n        super(x, y, 16, 16);\n        this.content = content; // 'mushroom' | 'coin'\n        this.used = false;\n        this.bobTimer = 0;\n    }\n    hitFromBelow() {\n        if (this.used) return;\n        this.used = true;\n        this.bobTimer = 0.2;\n        if (this.content === 'mushroom') {\n            new Mushroom(this.x, this.y - 16);\n        } else {\n            score += 200;\n            coins++;\n        }\n    }\n}
Acceptance: Head-bumping question block bounces it up
Acceptance: Mushroom question block spawns moving mushroom
Acceptance: Coin question block awards 200 points
Acceptance: Used block stays used (no respawn)
Acceptance: Big Mario breaks brick blocks
Acceptance: Small Mario only shakes brick blocks
Verification: open ~/src/html-game/smb1/index.html

### TASK: 5.2 - HUD, scoring, and game states
Type: feature
What: Add HUD (score, coins, time, lives) and game states: playing, game-over, level-complete
Why: Player needs feedback and the game needs win/lose conditions
Files: + smb1/js/game.js
Snippet: // Game state\nconst State = { PLAYING: 0, GAME_OVER: 1, LEVEL_COMPLETE: 2 };\nlet state = State.PLAYING;\nlet score = 0, coins = 0, lives = 3, time = 400;\n\nfunction renderHUD(ctx) {\n    ctx.fillText('MARIO', 60, 20);\n    ctx.fillText(score.toString().padStart(6,'0'), 60, 36);\n    ctx.fillText('x ' + coins.toString().padStart(2,'0'), 220, 36);\n    ctx.fillText('TIME', 620, 20);\n    ctx.fillText(time.toString().padStart(3,'0'), 620, 36);\n}\n\n// Timer counts down each second\n// Lives decrement on death, game over at 0
Acceptance: HUD shows score, coins, time, lives at top of screen
Acceptance: Timer counts down from 400
Acceptance: Mario death decrements lives
Acceptance: Game over at 0 lives shows restart screen
Acceptance: Reaching flag pole triggers level complete with score based on height
Verification: open ~/src/html-game/smb1/index.html

## MILESTONE: 6 - Polish
Pattern: Pixel Art Assets + Sound Effects
Objective: Authentic look and feel with pixel art sprites, background, clouds, hills, bushes, and sound effects
Success: Game looks and sounds like classic SMB with proper 16px pixel art
Diagram: flowchart LR
    A[Sprite Sheet] --> B[Mario Frames]
    A --> C[Enemy Frames]
    A --> D[Block Tiles]
    A --> E[Background]
    F[Sound Effects] --> G[Jump]
    F --> H[Coin]
    F --> I[Powerup]
    F --> J[Bump]
    F --> K[Death]

### TASK: 6.1 - Sprite sheet and pixel art assets
Type: feature
What: Create 16px pixel art sprite sheet with Mario (walk, jump, big), Goomba, Koopa, blocks, pipes, background
Why: Game needs visual assets — can use public domain pixel art or generate programmatically
Files: + smb1/assets/sprites.png
Files: + smb1/assets/bg.png
Snippet: // Sprite sheet layout (16px tiles):\n// Row 0: Mario idle, walk1, walk2, jump (x2 for big)\n// Row 1: Goomba frame1, frame2, stomped\n// Row 2: Koopa frame1, frame2, shell\n// Row 3: Ground, brick, question-empty, question-full, used\n// Row 4: Pipe-TL, TR, BL, BR\n// Row 5: Coin, mushroom, flag-pole, flag-top\n// Row 6: Cloud, hill, bush, background-tile
Acceptance: Sprite sheet loads without errors
Acceptance: All entity sprites render at correct 16px scale
Acceptance: Background renders parallax clouds, hills, bushes
Verification: open ~/src/html-game/smb1/index.html

### TASK: 6.2 - Sound effects
Type: feature
What: Add jump, coin, powerup, bump, stomp, death, and kick sounds using Web Audio API
Why: Audio completes the authentic SMB experience
Files: + smb1/js/sfx.js
Files: + smb1/assets/sfx/*
Snippet: const sfx = {};\nfunction loadSFX(files) {\n    const audioCtx = new AudioContext();\n    files.forEach(f => {\n        fetch(f).then(r => r.arrayBuffer())\n            .then(buf => audioCtx.decodeAudioData(buf))\n            .then(decoded => sfx[f.name] = decoded);\n    });\n}\nfunction play(name) {\n    if (!sfx[name]) return;\n    const src = audioCtx.createBufferSource();\n    src.buffer = sfx[name];\n    src.connect(audioCtx.destination);\n    src.start();\n}
Acceptance: Jump sound plays on jump input
Acceptance: Coin sound plays on coin collection
Acceptance: Bump sound plays on block head-hit
Acceptance: Death sound plays on Mario death
Verification: open ~/src/html-game/smb1/index.html
