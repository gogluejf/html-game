# EPIC: Sprite Animation Engine — Runtime Wiring (v1)
Why: Entities currently render placeholder rects; the Animation Studio sheet JSONs (frames, bbox, timing) exist in assets but nothing in the game consumes them. The 2026-10-27 session proposed the entity.sprite contract (anchor + anims dict + setAnim) but it was never written down or built.
Outcomes: Real sprite frames on entities driven by sheet JSON; uniform per-animation scaling from target height (48px/Y-unit); fixed physical anchor with collision box re-resolution; playback mode/direction/timing per docs/architecture/sprites.md; every entity type wired through one generic setAnim() path.

## MILESTONE: 1 - Sheet Loader
Pattern: Port & Adapter (pure data core + DOM adapter)
Objective: Parse Animation Studio _sheet.json into a runtime-ready SpriteData model and load the frame PNGs, with zero game-state coupling.
Success: loadSpriteData() returns frames, bboxes, fps, mode/direction/timing for any sheet path; node-testable without DOM; all 189 petal-panic sheet paths parse.
Diagram: graph TD
    A[assets levels/enemies */*_sheet.json] --> B[sheetLoader.parseSheet - pure]
    B --> C[SpriteData: anims dict]
    D[browser Image loader] --> E[frame cache keyed by path]
    C --> F[SpriteData ready]
    E --> F

### TASK: 1.1 - SpriteData model + sheet parser
Type: feature
What: Add js/core/spriteData.js: pure parse of a _sheet.json into {anims: {name → {fps, mode, direction, timing, frames: [{file, bbox}], collisionBox, pivot}}} plus validation (nonzero source box height, frame count from JSON only).
Why: Single runtime shape every later milestone consumes; keeps Animation Studio JSON as source of truth per sprites.md §2.
Files: + petal-panic/js/core/spriteData.js
Files: + petal-panic/js/test/spriteData.test.js
Snippet: // spriteData.js (pure — no DOM)\nexport function parseSheet(json) -> SpriteData\n// SpriteData = { anims: { [name]: AnimData } }\n// AnimData  = { fps, mode, direction, timing,\n//               frames: [{ file, bbox: [x,y,w,h] }],\n//               collisionBox, pivot }\n// rules: frame count ONLY from json.frames.length\n//        throw on zero-height source collision box (§4)
Acceptance: parseSheet on level1 block_single_sheet.json yields 1 anim with 2 frames and correct bboxes
Acceptance: parseSheet on a platform sheet yields 4 frames
Acceptance: frame count never defaults to 8 — comes from JSON only
Acceptance: zero-height collision box throws
Verification: node --test petal-panic/js/test/spriteData.test.js

### TASK: 1.2 - Frame image loader + cache
Type: feature
What: Add browser adapter loadFrames(spriteData, baseDir) that resolves each frame file to a PNG via new Image(), caches by path, and marks readiness; no-op safe in node.
Why: Separates DOM I/O from the pure model so tests stay headless and images load once per session.
Files: + petal-panic/js/core/frameLoader.js
Files: ~ petal-panic/js/test/spriteData.test.js
Snippet: // frameLoader.js (DOM adapter)\nexport function loadFrames(data, baseDir) -> Promise<Map<string, HTMLImageElement>>\n// key = frame.file path; cached module-level\n// resolve when every img.complete && naturalWidth > 0
Acceptance: loading level1 block_single yields 2 complete images
Acceptance: second call for same sheet returns cache without new Image()
Verification: node --test petal-panic/js/test/spriteData.test.js

## MILESTONE: 2 - Scale + Anchor Transform
Pattern: Single transform pipeline (sprites.md §22)
Objective: Implement per-animation uniform scaling from target height and the fixed physical anchor, so sprite and geometry never drift apart.
Success: An entity with 1.0-unit idle and 0.6-unit crouch renders at coherent sizes; anchor stays world-fixed across setAnim; all geometry uses one pipeline: scale → anchor → pivot → mirror → rotate.
Diagram: graph LR
    A[targetH units x 48px] --> B[scale = targetPx / sourceBoxH]
    B --> C[uniform scalar on frames+boxes+markers]
    C --> D[translate into anchor space]
    D --> E[anchor fixed in world]
    E --> F[pivot / mirror / rotate]

### TASK: 2.1 - entity.sprite contract + setAnim()
Type: feature
What: Extend Entity with sprite = {anchor, anims: {name → {sheet|data, targetH, fps?, mode?, timing?}}} and generic loadSprite()/setAnim(name): compute uniform scale (targetH*48 / source box height), re-resolve collision box around the fixed anchor, swap active anim. Keep old this.anim working as fallback.
Why: The 2026-10-27 session contract, now codified; every entity type gets identical behavior from one code path and hand-rolled per-entity scaling dies.
Files: ~ petal-panic/js/core/entity.js
Files: + petal-panic/js/test/spriteSetAnim.test.js
Snippet: // entity.js additions\nthis.sprite = opts.sprite ?? null\n// sprite = { anchor: 'bottom-center',\n//             anims: { idle: { data, targetH: 1.0 }, ... } }\nloadSprite()      // resolve data+frames for all anims, pick default\nsetAnim(name)     // scale from targetH, re-resolve box around anchor,\n                  // swap this.anim; anchor world position unchanged (§3, §19)\n// draw(): if active sprite anim → transform pipeline §22\n//         else legacy rect (unchanged)
Acceptance: setAnim between two targetH values changes rendered size by exactly the ratio, width included (uniform)
Acceptance: entity world position (anchor) is identical before/after setAnim
Acceptance: collision box re-resolves around anchor, no teleport
Acceptance: entity without sprite block still draws legacy rect
Verification: node --test petal-panic/js/test/spriteSetAnim.test.js

### TASK: 2.2 - Anchor + transform pipeline in draw()
Type: feature
What: Replace Entity.draw()'s center-pivot translate with the §22 pipeline: uniform scale → translate into physical-anchor space (default bottom-center) → pivot → mirrorX/Y → rotate. Collision box and any per-frame geometry use the same transforms.
Why: One pipeline for sprite AND geometry is the core invariant of sprites.md — rendered art and spatial metadata must never drift apart.
Files: ~ petal-panic/js/core/entity.js
Files: ~ petal-panic/js/test/spriteSetAnim.test.js
Snippet: // draw() pipeline (§22, same order every time)\nctx.translate(anchorWorldX, anchorWorldY)   // fixed world point\nctx.scale(s, s)                              // §4 uniform scalar\nctx.translate(-pivot.x, -pivot.y)           // §11 per-anim pivot\nif (mirrorX) ctx.scale(-1, 1)\nif (mirrorY) ctx.scale(1, -1)\nctx.rotate(rotation)\n// frame drawn at its bbox offset; boxes/markers transformed identically
Acceptance: mirrored entity keeps collision box symmetric and world-fixed
Acceptance: rotation about pivot moves sprite and its boxes together
Acceptance: bottom-center anchor: feet stay on floor across anim switch
Verification: node --test petal-panic/js/test/spriteSetAnim.test.js

## MILESTONE: 3 - Playback Engine
Pattern: State machine + strategy (timing mode)
Objective: Replace the v1 Anim (single speed+loop) with full sprites.md §5–7 playback: per-frame durations, loop/once, forward/reverse/ping_pong(_reverse), and fps vs relative timing.
Success: All four directions traverse correctly with no endpoint duplication; once-completion is exposed for gameplay; relative mode maps [0,1] progress to traversal ignoring per-frame durations.
Diagram: stateDiagram-v2
    [*] --> Playing
    Playing --> Playing : tick dt / setProgress p
    Playing --> Completed : once + terminal frame elapsed
    Completed --> Playing : replay from start

### TASK: 3.1 - SpritePlayer (mode/direction/timing)
Type: feature
What: Add js/core/spritePlayer.js implementing §5–7: frame traversal for forward/reverse/ping_pong/ping_pong_reverse, per-frame duration overrides, loop/once with completion flag, and fps vs relative (setProgress 0..1) timing.
Why: The existing Anim class only does constant-speed forward loop; the sheet JSONs already carry mode/direction/timing that must be honored exactly.
Files: + petal-panic/js/core/spritePlayer.js
Files: + petal-panic/js/test/spritePlayer.test.js
Snippet: // spritePlayer.js\nexport class SpritePlayer {\n  constructor(animData)          // frames + durations + fps + mode + direction + timing\n  tick(dt)                       // fps mode advance; per-frame duration override\n  setProgress(p)                 // relative mode: map [0,1] onto traversal\n  get frameIndex()               // current frame in stored order\n  get done()                     // once-completion (after terminal frame elapsed)\n}\n// ping_pong: 1→2→3→4→5→4→3→2→1→2… NO endpoint duplication (§6)\n// relative mode ignores per-frame durations (§7)
Acceptance: ping_pong sequence over 5 frames visits 1,2,3,4,5,4,3,2,1,2 with no 5,5 or 1,1
Acceptance: reverse+once completes on frame 1; forward+once on last frame
Acceptance: frame with explicit duration holds longer than 1/fps neighbors
Acceptance: relative: progress 0.5 lands mid-traversal regardless of fps
Verification: node --test petal-panic/js/test/spritePlayer.test.js

### TASK: 3.2 - Wire SpritePlayer into Entity, retire v1 Anim path
Type: refactor
What: Entity.setAnim() now builds a SpritePlayer from the anim's data; tick(dt) advances it; relative-timing anims expose setProgress for gameplay (jump phase mapping later). Keep Anim class for legacy placeholder users until all entities migrate.
Why: One playback implementation everywhere; completion flag lets AI react to 'once' anims per §6.
Files: ~ petal-panic/js/core/entity.js
Files: ~ petal-panic/js/test/spriteSetAnim.test.js
Snippet: // entity.js\nsetAnim(name) { this._player = new SpritePlayer(animData); ... }\ntickAnim(dt)   // called from update loop; no-op without sprite\nget animDone() // exposes player.done for gameplay reactions\n// relative anims: gameplay calls entity.setProgress(p)
Acceptance: loop anim runs indefinitely; once anim stops and animDone=true after terminal duration
Acceptance: legacy entities using Anim still render (no regression)
Verification: node --test petal-panic/js/test/spriteSetAnim.test.js petal-panic/js/test/spritePlayer.test.js

## MILESTONE: 4 - First Wiring — Blocks & Platforms
Pattern: Vertical slice (data → render → verify in game)
Objective: Render real block/platform art from their sheets through the new engine — the smallest safe first integration, building directly on today's parallax work.
Success: In-game horizontal + vertical areas show real single/double/triple block and platform frames instead of orange rects; collision boxes unchanged; debug view modes still work.
Diagram: graph TD
    A[block_single/double/triple _sheet.json] --> B[SpriteData + frames]
    C[level def: sprite blocks for solids] --> D[setAnim per width variant]
    B --> E[Entity draw pipeline §22]
    D --> E
    E --> F[render.js solid loop uses entity.draw]

### TASK: 4.1 - Terrain sprite defs + render integration
Type: feature
What: Add per-level terrain sprite config (block_single/double/triple, platform_single/double/triple sheet paths + targetH in units) and make the solid/platform draw loop in render.js use entity.draw() with width-variant tiling (5-unit platform = triple+double) instead of fillRect.
Why: First real-sprite vertical slice; validates loader→scale→anchor→playback end-to-end on static art before touching heroes/enemies.
Files: + petal-panic/js/world/terrainSprites.js
Files: ~ petal-panic/js/systems/render.js
Snippet: // terrainSprites.js\nexport function terrainSpriteDef(level, kind, widthUnits)\n// -> { data, targetH: 1.0, variant: 'single'|'double'|'triple', tiles: [...] }\n// render.js solid loop:\nif (!(Debug.viewMode === 1)) for (const s of getSolids()) {\n  const def = terrainSpriteDef(level, s.oneWay ? 'platform' : 'block', s.w);\n  drawTiled(ctx, def, s);   // §22 pipeline per tile\n}
Acceptance: horizontal area shows level-themed block art, not orange rects
Acceptance: one-way platforms show platform art as a thin strip anchored to the landing face (R5.1 rule kept)
Acceptance: width > 3 tiles variants without stretching (uniform scale preserved)
Acceptance: collision-only debug mode (viewMode 1) still hides sprites
Verification: node --test petal-panic/js/test/spriteData.test.js

### TASK: 4.2 - In-browser visual verification harness
Type: test
What: Add a debug spawn/test screen (or extend the existing debug keys) that walks a horizontal + vertical area with real terrain sprites and logs any frame-load failures or scale mismatches.
Why: Headless tests can't see pixels; a quick in-game pass is how we confirm the art actually looks right before wiring heroes.
Files: ~ petal-panic/js/debug/debug.js
Snippet: // debug: press key → jump to area 1 (horizontal) / vertical area\n// HUD line: 'sprites: 12/12 frames loaded, 0 scale warnings'
Acceptance: all terrain frames report loaded in both orientations
Acceptance: no console errors on zone transition with sprites active
Verification: manual browser check (documented steps in task)

## MILESTONE: 5 - Geometry Collections (boxes + markers)
Pattern: Query-by-type collections (sprites.md §15–21)
Objective: Expose per-frame boxes, point markers, and radius markers as typed collections with world-transformed queries, keeping gameplay logic out of the sprite engine.
Success: getBoxes('melee'), getPoint('beam-origin'), getRadii('explosion') return world-space geometry aligned to the rendered sprite; zero entries are legal; labels need not be unique.
Diagram: graph TD
    A[frame.boxes / points / radii - typed] --> B[transform pipeline §22]
    B --> C[world-space collections]
    C --> D[gameplay queries by type]
    D --> E[AI / attack patterns interpret meaning]

### TASK: 5.1 - Per-frame boxes + point/radius markers
Type: feature
What: Extend SpriteData parsing for per-frame boxes[]/points[]/radii[] (type, position, size/radius) and add Entity query methods returning world-transformed copies: getBoxes(type), getPoint(type), getRadii(type). All use the §22 pipeline; zero entries legal.
Why: Melee damage stays frame-defined (§16) and markers give attack patterns their WHERE without turning JSON into a scripting language (§20).
Files: ~ petal-panic/js/core/spriteData.js
Files: ~ petal-panic/js/core/entity.js
Files: ~ petal-panic/js/test/spriteData.test.js
Snippet: // spriteData AnimData.frame gains:\n//   boxes:  [{ type, x, y, w, h }]\n//   points: [{ type, x, y }]\n//   radii:  [{ type, x, y, r }]\n// entity queries (world space, current frame):\ngetBoxes('melee')      -> [ {x,y,w,h} ]\ngetPoint('beam-origin')-> {x,y} | null\ngetRadii('explosion')  -> [ {x,y,r} ]
Acceptance: marker world position matches rendered sprite pixel under mirror+rotation
Acceptance: frame with no boxes returns [] not error
Acceptance: duplicate labels both returned (no uniqueness assumption)
Verification: node --test petal-panic/js/test/spriteData.test.js

### TASK: 5.2 - Transition safety (clamp-first)
Type: feature
What: Implement §19: on setAnim, if the new collision box overlaps solids, clamp the anchor along the smallest axis until clear; if no free direction, keep the old box and retry next frame.
Why: Standing up from crouch under a low ceiling must never force penetration — the doc's acceptance test requires it.
Files: ~ petal-panic/js/core/entity.js
Files: + petal-panic/js/test/spriteTransition.test.js
Snippet: // setAnim geometry expansion check (§19)\nif (newBox overlaps any solid) {\n  clamp anchor on smallest-penetration axis\n  if (no axis free) { keep old box; this._pendingAnim = name }\n}\n// update(): retry pending anim each frame until space opens
Acceptance: crouch→stand under low ceiling clamps instead of penetrating
Acceptance: boxed-in entity keeps old box and transitions when space opens
Verification: node --test petal-panic/js/test/spriteTransition.test.js

## MILESTONE: 6 - First Wiring — Checkpoint & Barrels
Pattern: Vertical slice (data → render → verify in game)
Objective: Render real checkpoint flag and barrel art from their sheets through the new engine — static single-anim entities, the smallest safe first integration.
Success: In-game checkpoints show level/boss flag art (triggered state swaps anim) and barrels show wooden/coin/explosive art; collision boxes unchanged; debug view modes still work.
Diagram: graph TD
    A[objects/checkpoint + objects/barrel _sheet.json] --> B[SpriteData + frames]
    C[entity defs: sprite blocks, bbox = scale reference] --> D[setAnim per type/state]
    B --> E[Entity draw pipeline]
    D --> E
    E --> F[existing draw loops call entity.draw]

### TASK: 6.1 - Checkpoint + barrel sprite wiring
Type: feature
What: Add sprite blocks to checkpoint and barrel entity defs (sheet paths per type/state; frame bbox as scale reference: scale = box.h / bbox.h) and make their draw() use the sprite pipeline with legacy rect fallback until frames load.
Why: First real sprites in-game on static entities — validates loader→scale→draw end-to-end with zero state-machine complexity.
Files: ~ petal-panic/js/objects/checkpoint.js
Files: ~ petal-panic/js/objects/barrel.js
Snippet: // checkpoint def\nsprite: { anchor: 'bottom-center',\n  anims: { level: { sheet: '.../checkpoint/level_sheet.json' },\n           boss:  { sheet: '.../checkpoint/boss_sheet.json' } } }\n// triggered state → setAnim(dimmed/triggered variant)\n// barrel: one anim per type (wooden/coin/explosion)
Acceptance: checkpoints render flag art sized to their collision box, bottom-anchored
Acceptance: boss-zone checkpoint uses boss flag art
Acceptance: all three barrel types render their own art
Acceptance: collision-only debug mode still hides sprites
Verification: node --test petal-panic/js/test/spriteData.test.js
