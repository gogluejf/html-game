# EPIC: Galaga 3.8 — High-Fidelity Arcade
Why: Create a brand-new, self-contained Galaga clone with high-fidelity synthesized audio, rich canvas graphics, and faithful arcade gameplay.
Outcomes: Single HTML file playable in any browser; Web Audio API synthesized SFX and music; procedural sprite rendering with animation; multi-wave enemy formations, boss battles, power-ups, score/lives system

## MILESTONE: 1 - Audio Engine
Pattern: Web Audio API Synthesis
Objective: Procedural sound effects and background music via Web Audio API oscillators, filters, and envelopes
Success: All SFX (shoot, explode, enemy dive, power-up, wave start, game over) and looping BGM audible with no external assets
Diagram: graph TD
    A[Game Event] --> B{SFX or Music}
    B -->|SFX| C[Oscillator + Envelope]
    B -->|Music| D[Pattern Sequencer]
    C --> E[Filter Chain]
    D --> E
    E --> F[Master Gain]
    F --> G[Speaker]

### TASK: 1.1 - SFX Synthesizer
Type: feature
What: Implement Web Audio API SFX engine with oscillator-based sound effects for all game events (shoot, explosion, enemy dive, power-up, wave intro, game over).
Why: Provides high-fidelity procedural audio without external files.
Files: + galaga-38/index.html
Snippet: class SfxEngine {\n  constructor(ctx) // AudioContext\n  shoot()        // short square-wave blip w/ pitch drop\n  explode(size)  // noise burst + low sine thump\n  enemyDive()    // descending sawtooth sweep\n  powerUp()      // ascending arpeggio\n  waveIntro()    // dramatic chord hit\n  gameOver()     // long descending tone\n}
Acceptance: Each SFX method produces distinct audible sound via Web Audio API
Acceptance: No external audio files required
Verification: open in browser, trigger each event, confirm audio plays

### TASK: 1.2 - Music Sequencer
Type: feature
What: Implement looping background music sequencer with tempo-based pattern playback, intensity scaling per wave, and mute toggle.
Why: Immersive arcade atmosphere that escalates with difficulty.
Files: + galaga-38/index.html
Snippet: class MusicSequencer {\n  constructor(sfx) // references SfxEngine\n  start(wave)      // begin loop at wave-appropriate tempo\n  stop()\n  setIntensity(n)  // 1-5, affects note density & filter cutoff\n  // internal: setInterval-driven step sequencer\n  // bass line + lead melody + hi-hat noise ticks\n}
Acceptance: Music loops seamlessly without gaps
Acceptance: Tempo/intensity increases with wave number
Acceptance: Mute/unmute via M key
Verification: play game through 2+ waves, confirm music evolves

## MILESTONE: 2 - Graphics & Sprites
Pattern: Procedural Canvas Rendering
Objective: High-fidelity sprite rendering, particle effects, and visual polish using Canvas 2D with procedural pixel-art sprites
Success: All entities rendered as animated multi-frame sprites; explosions use particle systems; background has parallax starfield; no external image assets
Diagram: graph TD
    A[Game Loop] --> B[Render Pipeline]
    B --> C[Starfield Layer]
    B --> D[Entity Sprites]
    B --> E[Particle System]
    B --> F[UI / HUD]
    D --> G[Sprite Atlas - procedural]
    G --> H[Frame Animation]

### TASK: 2.1 - Sprite System & Starfield
Type: feature
What: Implement procedural pixel-art sprite atlas (player, 3 enemy types, boss, power-ups) with multi-frame animation, plus parallax starfield background.
Why: All visual identity without external assets; animated sprites give arcade feel.
Files: + galaga-38/index.html
Snippet: const SPRITES = {\n  player:   { frames: [2], w: 24, h: 20 },\n  bee:      { frames: [2], w: 20, h: 16 },\n  butterfly:{ frames: [2], w: 24, h: 20 },\n  fighter:  { frames: [2], w: 28, h: 24 },\n  boss:     { frames: [2], w: 48, h: 40 },\n}\n// Each frame = array of color-indexed rows\n// drawSprite(ctx, name, frame, x, y, scale)\n\nclass Starfield {\n  layers: [{speed, density, size}] // 3 parallax layers\n  update(dt); render(ctx)\n}
Acceptance: Player and all 3 enemy types render as distinct animated sprites
Acceptance: Boss renders at 2x scale with unique design
Acceptance: 3-layer parallax starfield scrolls continuously
Verification: open in browser, confirm all sprites visible and animating

### TASK: 2.2 - Particle & VFX System
Type: feature
What: Implement particle-based explosion effects, screen shake, muzzle flash, and entity death animations.
Why: Juice and feedback that makes hits feel impactful.
Files: + galaga-38/index.html
Snippet: class ParticleSystem {\n  particles: [] // {x,y,vx,vy,life,color,size}\n  explode(x, y, color, count)\n  update(dt); render(ctx)\n}\n\n// ScreenShake: intensity decays over time\n// MuzzleFlash: brief bright sprite at player cannon tip\n// DeathAnim: entity flashes white then bursts into particles
Acceptance: Explosions produce 20+ colored particles with gravity and fade
Acceptance: Screen shakes on player hit (intensity ~8px, decay 300ms)
Acceptance: Muzzle flash visible for 1 frame on shoot
Verification: shoot enemies, confirm particle burst + shake on player hit

## MILESTONE: 3 - Core Gameplay
Pattern: Entity Component (lightweight)
Objective: Player ship, enemy AI with dive patterns, collision detection, scoring, lives, and game state machine
Success: Full playable loop: start → waves → boss → power-ups → game over → restart; all collisions correct; score/lives tracked
Diagram: stateDiagram-v2
    [*] --> Title
    Title --> WaveIntro : Enter
    WaveIntro --> Playing : animation done
    Playing --> BossFight : wave 4+
    BossFight --> Playing : boss defeated
    Playing --> GameOver : lives = 0
    GameOver --> Title : Enter
    Playing --> Paused : P
    Paused --> Playing : P

### TASK: 3.1 - Player Ship & Input
Type: feature
What: Implement player ship with keyboard/touch controls (left/right/up/down), shooting with cooldown, invincibility frames after hit, and 3 lives.
Why: Core player interaction; must feel responsive at 60fps.
Files: + galaga-38/index.html
Snippet: class Player {\n  x, y, w, h\n  speed: 280        // px/s horizontal\n  shootCooldown: 0.15\n  invincible: 0     // seconds remaining\n  lives: 3\n\n  update(dt, input)\n  shoot() // returns bullet entity\n  hit()   // decrement lives, set invincible=2s\n}
Acceptance: Arrow keys / WASD move ship smoothly at 60fps
Acceptance: Space fires bullets with 150ms cooldown
Acceptance: After being hit, ship blinks for 2s (invincible)
Acceptance: Lives display in HUD; game over at 0
Verification: play 30s, confirm movement is smooth, shooting works, hit reduces life

### TASK: 3.2 - Enemy AI & Formations
Type: feature
What: Implement 3 enemy types (bee, butterfly, fighter) with formation entry animation, idle bobbing, and dive attacks; boss appears every 4 waves.
Why: Faithful Galaga enemy behavior: coordinated dives, different point values, escalating difficulty.
Files: + galaga-38/index.html
Snippet: // Formation: grid of slots, enemies enter via spiral path\nclass Enemy {\n  type: 'bee'|'butterfly'|'fighter'\n  state: 'entering'|'idle'|'diving'|'returning'\n  points: 100|200|400\n\n  update(dt, player, wave)\n  // entering: follow bezier to slot\n  // idle: bob in place, periodic dive decision\n  // diving: chase player with sine-wave path\n  // returning: fly back to slot or exit screen\n}\n\n// Boss: large entity, fires spread shots, 10 HP\nclass Boss {\n  hp: 10\n  fireRate: 0.8 // seconds between spread volleys\n}
Acceptance: Enemies enter formation via animated spiral path
Acceptance: Bee=100pts, Butterfly=200pts, Fighter=400pts
Acceptance: Dive frequency increases with wave number
Acceptance: Boss spawns on waves 4, 8, 12... with unique sprite
Verification: play through wave 4, confirm boss appears and can be defeated

### TASK: 3.3 - Collision, Scoring & Power-ups
Type: feature
What: Implement AABB collision detection (bullets vs enemies, enemies vs player, enemy bullets vs player), score tracking with high-score persistence, and 4 power-up types.
Why: Game loop completion: hits register, score accumulates, power-ups add depth.
Files: + galaga-38/index.html
Snippet: // Collision: circle-based for fairness\nfunction hitTest(a, b) // returns bool\n\n// Score: combo multiplier for rapid kills (x1→x2→x3)\n// HighScore: localStorage 'galaga38_high'\n\n// Power-ups (drop from destroyed fighters):\n//   SHIELD - 5s invincibility bubble\n//   TRIPLE - 3-way spread shot for 8s\n//   SLOW   - enemies move 50% slower for 6s\n//   BOMB   - clear all enemies on screen (1 use)\nclass PowerUp {\n  type: 'shield'|'triple'|'slow'|'bomb'\n  update(dt); render(ctx)\n}
Acceptance: Bullet-enemy collision destroys enemy, awards points
Acceptance: Enemy-player collision costs a life
Acceptance: Combo multiplier resets after 2s without kill
Acceptance: High score persists across page reloads via localStorage
Acceptance: All 4 power-ups spawn and have correct effects
Verification: play 2 min, confirm scoring, combo, power-up pickup, high-score save

## MILESTONE: 4 - Game Shell & Polish
Pattern: Single-File HTML5 App
Objective: Title screen, HUD, pause, game-over screen, responsive canvas sizing, and final polish pass
Success: Complete game shell: title → play → pause → game over flow; HUD shows score/lives/wave/power-up timer; canvas scales to viewport; 60fps stable
Diagram: flowchart LR
    A[Canvas] --> B[HUD Layer]
    A --> C[Entity Layer]
    A --> D[VFX Layer]
    E[Input] --> F[State Machine]
    F --> G[Title / Play / Pause / Over]

### TASK: 4.1 - Game Shell & HUD
Type: feature
What: Implement title screen, pause overlay, game-over screen with stats, HUD (score, high-score, lives icons, wave number, active power-up timer), and responsive canvas scaling.
Why: Complete game presentation; player needs clear state feedback.
Files: + galaga-38/index.html
Snippet: // Title: logo text + 'PRESS ENTER' + high score\n// Pause: dimmed overlay + 'PAUSED'\n// GameOver: final score, high score, 'NEW HIGH!' if applicable\n\nclass HUD {\n  render(ctx) // top bar: SCORE | WAVE | LIVES | POWER-UP TIMER\n}\n\n// Canvas: fixed internal res 480x640, CSS-scaled to fit viewport\n// Input: Enter=start/resume, P=pause, M=mute
Acceptance: Title screen shows game name, high score, and start prompt
Acceptance: Pause freezes all entities and music
Acceptance: Game over shows final score and restarts on Enter
Acceptance: Canvas maintains aspect ratio at any window size
Verification: full play session: title→play→pause→resume→game over→restart
