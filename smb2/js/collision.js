// AABB tile collision resolution
// Separates X and Y for proper platform physics

function resolveTileCollisionX(entity, level) {
    const left = Math.floor(entity.x / TILE_SIZE);
    const right = Math.floor((entity.x + entity.w - 1) / TILE_SIZE);
    const top = Math.floor(entity.y / TILE_SIZE);
    const bottom = Math.floor((entity.y + entity.h - 1) / TILE_SIZE);
    
    for (let ty = top; ty <= bottom; ty++) {
        for (let tx = left; tx <= right; tx++) {
            const tile = level.getTile(tx * TILE_SIZE, ty * TILE_SIZE);
            if (isSolid(tile)) {
                const tileLeft = tx * TILE_SIZE;
                const tileRight = (tx + 1) * TILE_SIZE;
                
                const entityBounds = entity.getBounds();
                
                if (entity.vx > 0) {
                    // Moving right - push left
                    entity.x = tileLeft - entity.w;
                    entity.vx = 0;
                } else if (entity.vx < 0) {
                    // Moving left - push right
                    entity.x = tileRight;
                    entity.vx = 0;
                }
            }
        }
    }
}

function resolveTileCollisionY(entity, level) {
    const left = Math.floor(entity.x / TILE_SIZE);
    const right = Math.floor((entity.x + entity.w - 1) / TILE_SIZE);
    const top = Math.floor(entity.y / TILE_SIZE);
    const bottom = Math.floor((entity.y + entity.h - 1) / TILE_SIZE);
    
    for (let ty = top; ty <= bottom; ty++) {
        for (let tx = left; tx <= right; tx++) {
            const tile = level.getTile(tx * TILE_SIZE, ty * TILE_SIZE);
            if (isSolid(tile)) {
                const tileTop = ty * TILE_SIZE;
                const tileBottom = (ty + 1) * TILE_SIZE;
                
                if (entity.vy > 0) {
                    // Falling - land on top
                    entity.y = tileTop - entity.h;
                    entity.vy = 0;
                    entity.onGround = true;
                    if (entity.land) entity.land();
                } else if (entity.vy < 0) {
                    // Rising - bump ceiling
                    entity.y = tileBottom;
                    entity.vy = 0;
                    
                    // Check if entity is Mario bumping a block
                    if (entity instanceof Mario) {
                        handleBlockHit(entity, tx, ty, level, tile);
                    }
                }
            }
        }
    }
}

function resolveTileCollision(entity, level) {
    resolveTileCollisionX(entity, level);
    resolveTileCollisionY(entity, level);
}

function handleBlockHit(mario, tx, ty, level, tile) {
    // Question blocks
    if (tile === T.QUESTION_MUSHROOM) {
        level.setTile(tx * TILE_SIZE, ty * TILE_SIZE, T.QUESTION_EMPTY);
        // Spawn mushroom
        const mushroom = new Mushroom(tx * TILE_SIZE, (ty - 1) * TILE_SIZE);
        game.entities.push(mushroom);
        play('powerup');
        animateBlockBounce(tx, ty);
    } else if (tile === T.QUESTION_COIN) {
        level.setTile(tx * TILE_SIZE, ty * TILE_SIZE, T.USED);
        game.score += 200;
        game.coins++;
        play('coin');
        animateBlockBounce(tx, ty);
    } else if (tile === T.QUESTION_LIFE) {
        level.setTile(tx * TILE_SIZE, ty * TILE_SIZE, T.USED);
        game.lives++;
        game.score += 1000;
        play('powerup');
        animateBlockBounce(tx, ty);
    } else if (tile === T.BRICK) {
        if (mario.h >= 32) {
            // Big Mario breaks brick
            level.setTile(tx * TILE_SIZE, ty * TILE_SIZE, T.AIR);
            play('bump');
            // Add debris particles
            addBrickParticles(tx * TILE_SIZE, ty * TILE_SIZE);
        } else {
            // Small Mario just bounces
            play('bump');
            animateBlockBounce(tx, ty);
        }
    }
}

let blockBounces = [];

function animateBlockBounce(tx, ty) {
    blockBounces.push({ tx, ty, timer: 0.15, offset: 0 });
}

function updateBlockBounces(dt) {
    for (let i = blockBounces.length - 1; i >= 0; i--) {
        blockBounces[i].timer -= dt;
        blockBounces[i].offset = Math.sin(blockBounces[i].timer / 0.15 * Math.PI) * 4;
        if (blockBounces[i].timer <= 0) {
            blockBounces.splice(i, 1);
        }
    }
}

function addBrickParticles(x, y) {
    for (let i = 0; i < 4; i++) {
        game.particles.push({
            x: x + (i % 2) * 8,
            y: y + Math.floor(i / 2) * 8,
            vx: (i % 2 === 0 ? -80 : 80),
            vy: -150 - Math.random() * 100,
            life: 0.5,
            color: BRICK_RED || '#d97130'
        });
    }
}

// Patch Level.render to include block bounce offsets
const originalLevelRender = Level.prototype.render;
Level.prototype.render = function(ctx, camera) {
    // Draw bouncy blocks first (offset)
    for (const bounce of blockBounces) {
        const tileId = this.tiles[bounce.ty] && this.tiles[bounce.ty][bounce.tx];
        if (tileId && tileId !== T.AIR) {
            const mapping = tileToSprite(tileId);
            if (mapping) {
                const [row, col] = mapping;
                const dx = bounce.tx * TILE_SIZE - camera.x;
                const dy = bounce.ty * TILE_SIZE + bounce.offset;
                if (spritesLoaded) {
                    drawSprite(ctx, row, col, dx, dy);
                }
            }
        }
    }
    
    // Draw non-bouncing tiles (skip bouncy ones)
    const startX = Math.max(0, Math.floor(camera.x / TILE_SIZE));
    const endX = Math.min(this.cols - 1, Math.floor((camera.x + canvas.width) / TILE_SIZE));
    
    for (let ty = 0; ty < this.rows; ty++) {
        for (let tx = startX; tx <= endX; tx++) {
            const isBouncing = blockBounces.some(b => b.tx === tx && b.ty === ty);
            if (isBouncing) continue;
            
            const tileId = this.tiles[ty] && this.tiles[ty][tx];
            if (tileId && tileId !== T.AIR) {
                drawTile(ctx, tileId, tx, ty, camera);
            }
        }
    }
};
