# EPIC: Petal Panic v1 — Run-and-Gun Demo
Why: Build a playable, tuned v1 demo of the Petal Panic side-scrolling run-and-gun: one level, two heroes, six enemies, powerups, and the Overgrown Elephant boss, on a solid collision/physics foundation.
Outcomes: Playable HTML5 canvas game with correct feel; strong AABB collision + entity architecture; debug/test harness for fast tuning; stats telemetry for balance.

## MILESTONE: 1 - Engine Foundation
Pattern: Fixed-timestep loop, Entity base class, layer/mask collision
Objective: Core render+update loop, Entity base struct, AABB collision with layer masks, and camera — the load-bearing foundation.
Success: A colored box moves on screen under fixed 60Hz physics, collides with a solid platform, and the camera follows it; debug overlay draws boxes.
Diagram: graph TD
  A[Input] --> B[Integrate physics]
  B --> C[CollisionWorld.update]
  C --> D[Resolve solids + hit callbacks]
  D --> E[Camera follow]
  E --> F[Render + debug overlay]

### TASK: 1.1 - Game loop + canvas scaffold
Type: feature
What: Create project scaffold (index.html, main.js, module layout) with a fixed 60Hz accumulator loop and canvas render.
Why: Deterministic physics independent of refresh rate; clean module structure for all later systems.
Files: + panic-petal/index.html
Files: + panic-petal/js/main.js
Snippet: // main.js\nconst FIXED_DT = 1/60; let acc=0,last=0;\nfunction frame(t){ acc+=t-last; last=t; while(acc>=FIXED_DT){ update(FIXED_DT); acc-=FIXED_DT; } render(); requestAnimationFrame(frame); }
Acceptance: Canvas renders at stable 60Hz physics steps
Acceptance: Module files exist and load without errors
Verification: open panic-petal/index.html

### TASK: 1.2 - Entity base + transform
Type: feature
What: Implement Entity base class with full transform (x,y,w,h,facing,mirrorX/Y,rotation,scale,vx,vy,gravity), anim ref, layer mask, alive.
Why: Single source of truth for position+look; every other entity inherits this.
Files: + panic-petal/js/entity.js
Snippet: // entity.js\nclass Entity { constructor(o){ Object.assign(this,{facing:1,mirrorX:false,mirrorY:false,rotation:0,scale:1,alive:true},o); }\n worldBox(){ return {x:this.x+this.box.ox, y:this.y+this.box.oy, w:this.box.bw, h:this.box.bh}; } }
Acceptance: Entity exposes worldBox() from offset box
Acceptance: mirrorX derives from facing when set
Verification: node -e "require('./panic-petal/js/entity.js')" 2>/dev/null || echo browser-only

### TASK: 1.3 - AABB collision + layer masks
Type: feature
What: Build CollisionWorld with spatial-hash broadphase, aabbOverlap, resolve() for solids, and declarative layer/mask pair testing.
Why: Scales to 6 enemies + boss + projectiles without if-chain spaghetti; new interaction = one mask line.
Files: + panic-petal/js/collision.js
Snippet: // collision.js\nconst L={HERO:1,ENEMY:2,SOLID:4,PICKUP:8,PROJ_ALLY:16,PROJ_FOE:32,COIN:64,CHECKPOINT:128};\nfunction aabbOverlap(a,b){...}\nclass CollisionWorld{ update(){ /* broadphase -> narrowphase -> callbacks */ } }
Acceptance: aabbOverlap correct incl. edge/touch cases
Acceptance: resolve() prevents pass-through of SOLID
Acceptance: Adding a new pair requires only a mask entry
Verification: grep -n 'L\.' panic-petal/js/collision.js

### TASK: 1.4 - Camera + debug overlay
Type: feature
What: Add hero-following camera clamped to level bounds with facing look-ahead, and the F3 debug overlay (colored boxes).
Why: Side-scroll framing is core feel; debug boxes are needed before any tuning.
Files: + panic-petal/js/camera.js
Files: ~ panic-petal/js/main.js
Snippet: // camera.js\nfunction updateCam(cam,hero,len){ cam.x=clamp(hero.x-cam.w/2+hero.facing*80, 0, len-cam.w); }
Acceptance: Camera clamps to [0,length]
Acceptance: Debug overlay draws orange/green/red/blue/pink boxes
Verification: open panic-petal/index.html

## MILESTONE: 2 - Hero Movement
Pattern: Animation controller, input intent -> physics
Objective: One hero runs, jumps (non-looping synced rotation), crouches/slides, and mirrors on facing — the feel-critical slice.
Success: Selected hero moves fluidly: run/jump/crouch/slide feel good, jump anim rotates takeoff->landing without looping, sprite flips on direction change.
Diagram: stateDiagram-v2
  Idle --> Run : move input
  Run --> Jump : jump
  Jump --> Run : land
  Run --> Crouch : down
  Crouch --> Slide : move while crouch
  Crouch --> Run : release down

### TASK: 2.1 - Animation engine
Type: feature
What: Implement the anim controller (frames, frameSpeed, loop, pickFrame) with transform read from Entity; support non-looping one-shot anims.
Why: Clean animation is required for jump sync, melee active-frame, death fade, invincibility blink.
Files: + panic-petal/js/anim.js
Snippet: // anim.js\nclass Anim{ constructor(frames,{speed=100,loop=true}={}){...}\n tick(dt){ if(this.loop||!this.done) this.i=(this.i+dt/this.speed)%this.frames.length; }\n draw(ctx,e){ /* apply e.rotation,scale,mirrorX/Y then frames[this.i] */ } }
Acceptance: Looping anim cycles; non-looping stops at last frame
Acceptance: pickFrame(n) overrides current frame
Verification: open panic-petal/index.html

### TASK: 2.2 - Hero class + movement
Type: feature
What: Implement Hero (wraps a hero def) with run/jump/crouch/slide, gravity, ground friction, facing+mirrorX, and crouch box shrink.
Why: Core playable character; crouch box shrink validates the offset-box collision model.
Files: + panic-petal/js/hero.js
Files: ~ panic-petal/js/main.js
Snippet: // hero.js\nclass Hero extends Entity{ update(input,world){ /* integrate vx/vy, gravity, friction; set facing/mirrorX; swap crouch box */ } }
Acceptance: Jump impulse matches hero.jump stat; lands on SOLID
Acceptance: Crouch shrinks collision box (verified in debug overlay)
Acceptance: Sprite mirrors when facing left
Verification: open panic-petal/index.html

### TASK: 2.3 - State machine skeleton
Type: feature
What: Implement the top-level state enum + transition dispatcher (home/select/play/pause/gameover/win) as a thin skeleton; actual screen rendering is built in the Screens & HUD milestone.
Why: Gives every system a single place to read/write game state and route input, without coupling to screen visuals.
Files: + panic-petal/js/state.js
Files: ~ panic-petal/js/main.js
Snippet: // state.js\nconst S={HOME:0,SELECT:1,PLAY:2,PAUSE:3,OVER:4,WIN:5}; let cur=S.HOME;\nfunction set(s){ cur=s; } // dispatch handled in main loop
Acceptance: S
Acceptance: t
Acceptance: a
Acceptance: t
Acceptance: e
Acceptance:  
Acceptance: t
Acceptance: r
Acceptance: a
Acceptance: n
Acceptance: s
Acceptance: i
Acceptance: t
Acceptance: i
Acceptance: o
Acceptance: n
Acceptance: s
Acceptance:  
Acceptance: a
Acceptance: r
Acceptance: e
Acceptance:  
Acceptance: c
Acceptance: e
Acceptance: n
Acceptance: t
Acceptance: r
Acceptance: a
Acceptance: l
Acceptance:  
Acceptance: a
Acceptance: n
Acceptance: d
Acceptance:  
Acceptance: t
Acceptance: e
Acceptance: s
Acceptance: t
Acceptance: a
Acceptance: b
Acceptance: l
Acceptance: e
Acceptance: ;
Acceptance:  
Acceptance: s
Acceptance: c
Acceptance: r
Acceptance: e
Acceptance: e
Acceptance: n
Acceptance: s
Acceptance:  
Acceptance: p
Acceptance: l
Acceptance: u
Acceptance: g
Acceptance:  
Acceptance: i
Acceptance: n
Acceptance:  
Acceptance: l
Acceptance: a
Acceptance: t
Acceptance: e
Acceptance: r
Verification: open panic-petal/index.html

## MILESTONE: 3 - Combat Core
Pattern: Projectile pool, melee hitbox window, damage routing
Objective: Hero shoots 8-way thorns, swings melee with an active-frame hitbox, and a jester enemy takes damage and dies — combat loop proven end to end.
Success: Hero can kill a jester with projectiles and melee; friendly-fire off; enemy projectile hits hero; death anim + sparkle + coin drop play.
Diagram: graph LR
  A[Hero fire] --> B[Projectile spawn 8-dir]
  B --> C{hit ENEMY?}
  C -->|yes| D[damage -> stats -> effect]
  D --> E{alive?}
  E -->|no| F[death anim + sparkle + coins]

### TASK: 3.1 - Projectiles + 8-way shooting
Type: feature
What: Implement Projectile (pooled) with 8-direction aim from facing, ammo cost, projectile_freq cooldown, lifetime cull, friendly flag.
Why: Contra-style shooting is the core verb; pooling keeps perf safe under caps.
Files: + panic-petal/js/projectile.js
Snippet: // projectile.js\nclass Projectile extends Entity{ constructor(x,y,dir,friendly){...} }\nconst pool=new Pool(Projectile, MAX_PROJECTILES);
Acceptance: Shots fire in 8 directions toward aim
Acceptance: Ammo decrements; no fire at 0
Acceptance: Friendly projectiles never hit hero
Verification: open panic-petal/index.html

### TASK: 3.2 - Melee attack + damage routing
Type: feature
What: Add hero melee swing with active hitbox on the max attack frame, swing cooldown, and a central damage() that routes through defense into stats+effects.
Why: Melee breaks barrels and kills close enemies; central damage() avoids scattered HP math.
Files: ~ panic-petal/js/hero.js
Files: + panic-petal/js/damage.js
Snippet: // damage.js\nfunction damage(src,tgt,amt,method){ const real=Math.max(1,amt-tgt.stats.defense); tgt.energy-=real; src.stats.damageDealt.byMethod[method]+=real; /* effect */ }
Acceptance: Melee only deals damage during active frame
Acceptance: damage() respects target defense and updates telemetry
Verification: open panic-petal/index.html

### TASK: 3.3 - Jester enemy + death pipeline
Type: feature
What: Implement Enemy base + Jester AI (walk/chase/whip), contact damage to hero, and the death pipeline (death anim -> fade -> sparkle -> coin drop).
Why: First full enemy proves the AI contract, contact damage, and death VFX path others reuse.
Files: + panic-petal/js/enemy.js
Files: + panic-petal/js/jester.js
Snippet: // jester.js\nclass Jester extends Enemy{ ai(dt){ /* idle/walk/chase/attack states; aggro radius */ } }
Acceptance: Jester chases within aggro radius and whips when close
Acceptance: Contact drains hero energy
Acceptance: Death plays anim then sparkle + coin drop
Verification: open panic-petal/index.html

## MILESTONE: 4 - World Objects
Pattern: Solid objects, breakable barrels, pickups, coins with bounce physics
Objective: Barrels block and break (explosion AoE), coin barrels burst into bouncing coins, powerups apply effects, checkpoints set restart — the level is interactive.
Success: Hero can't pass barrels; melee/bomb breaks them with AoE damage; coins bounce to ground and are collected; powerups apply their documented effects; checkpoint enables restart.
Diagram: graph TD
  A[Hero touches barrel] --> B{melee or bomb?}
  B -->|yes| C[break -> explosion AoE]
  C --> D[damage enemies + hero in radius]
  B -->|no| E[blocked]
  F[coin barrel break] --> G[spawn mixed coins]
  G --> H[coins fall + bounce on ground]

### TASK: 4.1 - Objects: barrels + explosions
Type: feature
What: Implement Object base with destructible-solid barrel (blocks hero+enemy, has HP). Melee/projectile/bomb deal damage to barrel HP; it does NOT break on touch or per-hit. When HP hits 0 it explodes: AoE damage within explodeRadius to enemies and hero.
Why: Barrels are core cover/hazard; AoE self-damage adds risk/reward.
Files: + panic-petal/js/object.js
Snippet: // object.js\nclass Barrel extends Entity{ constructor(){ this.hp=this.maxHp; } hit(dmg){ this.hp-=dmg; if(this.hp<=0) this.explode(); }\n explode(){ /* AoE damage() to all entities in explodeRadius incl. hero */ } }
Acceptance: Hero and enemy cannot pass a barrel (solid)
Acceptance: Melee/projectile/bomb chip barrel HP; no explosion until HP=0
Acceptance: A bomb one-shots the barrel; thorns/melee need several hits
Acceptance: Explosion at HP=0 damages entities in radius including hero
Verification: open panic-petal/index.html

### TASK: 4.2 - Coins with bounce + collection
Type: feature
What: Implement Coin (per-type weight) that falls, bounces off ground/platforms, and is collected on hero touch; coin barrel bursts into mixed coins.
Why: Coin physics is a named design requirement; collection feeds score + 1up threshold.
Files: + panic-petal/js/coin.js
Files: ~ panic-petal/js/object.js
Snippet: // coin.js\nclass Coin extends Entity{ update(dt){ this.vy+=GRAVITY*this.weight; if(grounded) this.vy*=-0.4; } }
Acceptance: Coins bounce with per-type weight differences
Acceptance: Coin barrel spawns several mixed coins
Acceptance: Collection increments stats.coinsCollected
Verification: open panic-petal/index.html

### TASK: 4.3 - Powerups + checkpoint
Type: feature
What: Implement Powerup pickup applying each documented effect (ammo, invincibility duration+blink, special box, rapid, shield, clear, energy, 1up) and Checkpoint setting restart position.
Why: Powerups are the progression/fun loop; checkpoint enables the retry/continue flow.
Files: + panic-petal/js/powerup.js
Files: ~ panic-petal/js/state.js
Snippet: // powerup.js\nconst FX={ ammo:(p,v)=>p.ammo+=v, invincibility:p=>p.invincibleTimer=5, shield:p=>p.shield+=50, clear:killAllOnScreen, ... };
Acceptance: Each powerup applies its §10 effect
Acceptance: Invincibility grants timed no-damage + fast blink
Acceptance: Checkpoint stores position used on death-restart
Verification: open panic-petal/index.html

## MILESTONE: 5 - Full Roster + Level
Pattern: Per-type AI state machines, level struct with random spawn
Objective: All six enemy types implemented with distinct AI, assembled into one level (ground + air platforms, checkpoints 1-1..1-4, random rogue spawn).
Success: A full level plays start-to-boss with all enemy behaviors distinct and fair; energy/lives/death/gameover flow works.
Diagram: graph TD
  A[Level load] --> B[random spawn enemies/powerups/barrels]
  B --> C[hero traverses ground + platforms]
  C --> D{checkpoint?}
  D -->|hit| E[store restart pos]
  C --> F[energy 0 -> death -> lose life]
  F --> G{lives left?}
  G -->|no| H[gameover]

### TASK: 5.1 - Remaining enemy AIs
Type: feature
What: Implement vine_hound, violetta_marionetta, jackolantern, boris_loon (+baby) with their §7 behaviors incl. flyer property and fake-idle from first walk frame.
Why: Completes the roster; each AI is a small isolated state machine per the contract.
Files: + panic-petal/js/vine_hound.js
Files: + panic-petal/js/violetta.js
Files: + panic-petal/js/jackolantern.js
Files: + panic-petal/js/boris_loon.js
Snippet: // boris_loon.js (flyer)\nclass BorisLoon extends Enemy{ constructor(){ this.gravity=0; } ai(dt){ /* sine-wave hover, dive when player below */ } }
Acceptance: Each type exhibits its documented behavior
Acceptance: Flyers ignore gravity; grounders do not
Acceptance: Enemies lacking idle use first walk frame statically
Verification: open panic-petal/index.html

### TASK: 5.2 - Energy / lives / gameover flow
Type: feature
What: Wire hero energy depletion, death (skull sine fade), life loss, respawn at checkpoint, and gameover with retry/continue(3)/quit.
Why: Closes the survival loop so a full run can be lost and continued per design.
Files: ~ panic-petal/js/state.js
Files: ~ panic-petal/js/hero.js
Snippet: // on death: spawn skull effect (sine float+fade); lives--; if(lives>0) respawnAt(checkpoint) else state=OVER
Acceptance: Death shows skull sine-wave fade
Acceptance: Respawn uses last checkpoint position only
Acceptance: Continue costs coins, limited to 3
Verification: open panic-petal/index.html

### TASK: 5.3 - Level struct + random spawn
Type: feature
What: Implement the level struct (name,index,boss,length,checkpoints,platforms, and a spawn budget: counts per enemy type, barrels, coinBarrels, powerups per type) plus a demo rogue spawner that randomly distributes those items along flat ground with min spacing, adding a few air platforms. Coins are NOT spawned directly — they come only from coin-barrel bursts and enemy death drops.
Why: Makes the level data-driven and produces the v1 'rogue' layout for playtesting.
Files: + panic-petal/js/level.js
Snippet: // level.js\nconst level1={ name:'Big Top', index:1, boss:'elephant', length:8000,\n checkpoints:[{id:'1-1',x:2000},...],\n spawn:{ enemies:{jester:6,jackolantern:4,...}, barrels:8, coinBarrels:4,\n         powerups:{ammo:3,rapid:2,shield:1,special:2,...} } };  // no coins field
Acceptance: Level loads with ground + air platforms
Acceptance: Checkpoints 1-1..1-4 placed along length
Acceptance: Rogue spawner places exactly the level.spawn counts of each item
Acceptance: Spawned items respect min spacing / no overlap
Acceptance: No loose coins spawned; coins only from coin barrels + enemy drops
Verification: open panic-petal/index.html

## MILESTONE: 6 - Boss + Win
Pattern: Boss phase state machine, camera lock
Objective: Overgrown Elephant boss with telegraphed charge/stomp/trunk-blast phases, weak point, and win state on death.
Success: Boss arena locks camera; phases are readable and dodgeable; defeating it triggers the win screen.
Diagram: stateDiagram-v2
  Idle --> Charge : trigger
  Charge --> Stomp : recover
  Stomp --> TrunkBlast : recover
  TrunkBlast --> Idle : recover
  Idle --> Death : hp 0
  Death --> Win

### TASK: 6.1 - Elephant boss + win
Type: feature
What: Implement Boss (elephant) with HP, camera-lock arena, phase loop (charge/stomp/trunk_blast escalating with low HP), weak point, contact damage, and win state on death.
Why: The level's climax; proves the boss pattern for the future 8-boss roadmap.
Files: + panic-petal/js/boss.js
Files: ~ panic-petal/js/state.js
Snippet: // boss.js\nclass Elephant extends Enemy{ constructor(){ this.isBoss=true; } ai(dt){ /* phase machine; escalate speed/freq as hp drops */ } onDeath(){ state=WIN; } }
Acceptance: Camera locks to boss arena during fight
Acceptance: Each phase is telegraphed and dodgeable
Acceptance: Trunk/head weak point takes bonus damage
Acceptance: Death triggers win state
Verification: open panic-petal/index.html

## MILESTONE: 7 - Polish + Tuning Harness
Pattern: Debug/test sandbox, effects, stats export, playtest tuning
Objective: Full effect set, the F1 debug/test harness (spawn, god mode, slow-mo, anim scrubber, AI inspection), live stats HUD + export, and a tuning pass on feel/AI/difficulty.
Success: All §12 effects play; F1 harness lets any entity be spawned/inspected/frame-scrubbed in seconds; stats dump to console/file at win/gameover; jump, enemy fairness, and difficulty are tuned via playtests.
Diagram: graph LR
  A[F1 harness] --> B[spawn / god / slow-mo]
  A --> C[anim scrubber + box overlay]
  A --> D[AI state force + aggro viz]
  E[win/gameover] --> F[dumpStats -> console/file]
  F --> G[tune feel/AI/difficulty]

### TASK: 7.1 - Effects + particles
Type: feature
What: Implement all §12 effects: hero damage vignette, enemy shake/flash, death sparkle+fade, barrel break/explosion VFX, checkpoint flash, invincibility blink, pickup pop, red hit sparkles.
Why: Juice makes hits and deaths read clearly; several are already required by combat/world tasks.
Files: + panic-petal/js/effects.js
Snippet: // effects.js\nfunction spawnSparkle(x,y,size){...} function vignette(intensity){...} function floatText(x,y,str){...}
Acceptance: Each §12 effect triggers on its event
Acceptance: Enemy death fades fast while sparkle sized to sprite plays
Verification: open panic-petal/index.html

### TASK: 7.2 - Debug/test harness (F1)
Type: feature
What: Build the Debug module: free-spawn any entity in a chosen state, god mode, slow-mo/freeze, hero swap, AI-state force + aggro/facing viz, anim frame scrubber with box overlay, live stats HUD, event log.
Why: Cuts tuning time dramatically — test any bat/clown/hero/powerup in seconds without playing the real game.
Files: + panic-petal/js/debug.js
Files: ~ panic-petal/js/main.js
Snippet: // debug.js\nconst Debug={ enabled:false, spawn(type,state,x,y){...}, god:false, slowmo:1, selected:null, log:[] };
Acceptance: Any enemy/boss/powerup/barrel spawns at cursor in a chosen state
Acceptance: Anim scrubber steps frames and overlays the collision box
Acceptance: AI state can be forced; aggro radius + label drawn
Acceptance: Live stats HUD reflects §4.1 telemetry
Verification: open panic-petal/index.html

### TASK: 7.3 - Stats export + tuning pass
Type: feature
What: Add dumpStats() serializing §4.1 to console/file at win/gameover, then run playtests to tune jump feel, per-enemy fairness (via damageDealt-byEnemy vs kills), powerup values, and difficulty.
Why: Turns telemetry into a balance tool; the tuning pass is where the game actually gets made.
Files: ~ panic-petal/js/state.js
Files: + panic-petal/js/stats.js
Snippet: // stats.js\nfunction dumpStats(p){ const o={...p.stats}; console.table(o.damageDealt.byEnemy); downloadJSON(o); }
Acceptance: Stats dump to console + downloadable JSON on win/gameover
Acceptance: Jump arc/feel validated via slow-mo + playtest
Acceptance: Per-enemy effective HP reviewed and tuned
Verification: open panic-petal/index.html

## MILESTONE: 8 - Screens & HUD
Pattern: Screen-per-state, canvas UI, state-driven input
Objective: All game screens (home, select, pause, gameover, win) wired to the state machine with their assets and interactions, plus a functional HUD over Play.
Success: Full flow plays: animated home -> hero select -> play (with readable HUD) -> pause/gameover/win screens all work with correct options and transitions.
Diagram: stateDiagram-v2
  Home --> Select : Enter
  Select --> Play : confirm hero
  Play --> Pause : Esc
  Pause --> Play : resume
  Pause --> Home : quit
  Play --> GameOver : lives 0
  Play --> Win : boss dead
  GameOver --> Play : retry/continue
  Win --> Select : play again

### TASK: 8.1 - Home + Select screens
Type: feature
What: Implement Home (parallax bigtop + logo, Enter to continue) and Select (two hero panels, focus + confirm drives active Hero def) using the home_* and select_* assets.
Why: Entry flow into the game; establishes the Screen-per-state pattern for all other screens.
Files: + panic-petal/js/screens.js
Files: ~ panic-petal/js/state.js
Snippet: // screens.js\nconst Home={ draw(ctx){ /* parallax layers + logo */ }, onKey(k){ if(k==='enter') set(S.SELECT); } };\nconst Select={ focus:0, draw(ctx){ /* select_scarlet_vale / select_balthazar panels */ }, onKey(k){ /* left/right focus, enter -> PLAY with hero */ } };
Acceptance: Home shows animated bigtop + logo; Enter goes to Select
Acceptance: Select focuses between the two heroes; confirm starts Play with that hero's stats
Verification: open panic-petal/index.html

### TASK: 8.2 - Pause / Game Over / Win screens
Type: feature
What: Implement Pause overlay (Resume/Retry/Quit), Game Over (score+stats, Retry/Continue/Quit), and Win (full stats summary, Play Again/Quit) screens wired to the state machine.
Why: Closes the full game loop presentation so every end-state is reachable and navigable per §20.
Files: ~ panic-petal/js/screens.js
Files: ~ panic-petal/js/state.js
Snippet: // screens.js\nconst Pause={ options:['resume','retry','quit'] };\nconst GameOver={ draw(){ /* score + key stats */ }, opts:['retry','continue','quit'] };\nconst Win={ draw(){ /* full §4.1 summary */ }, opts:['playAgain','quit'] };
Acceptance: Pause freezes Play and offers Resume/Retry/Quit
Acceptance: Game Over shows score+stats with Retry/Continue(3)/Quit
Acceptance: Win shows full stats summary with Play Again/Quit
Verification: open panic-petal/index.html

### TASK: 8.3 - HUD
Type: feature
What: Build the functional Play HUD: red energy bar with cyan shield overlay, ammo + special ammo counts, coins, lives, selected-hero portrait, and checkpoint progress line with markers + hero icon.
Why: Player must read energy/shield/ammo/progress during play; depends only on player state so it stubs early and polishes late.
Files: + panic-petal/js/hud.js
Files: ~ panic-petal/js/main.js
Snippet: // hud.js\nfunction drawHUD(ctx,p){ /* red energy + cyan shield bar; ammo/special; coins/lives; checkpoint line w/ hero marker */ }
Acceptance: Energy bar shows red fill + cyan shield overlay
Acceptance: Ammo, special ammo, coins, lives display live
Acceptance: Checkpoint line shows markers 1-1..1-4 and hero position along level length
Verification: open panic-petal/index.html
