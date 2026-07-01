// Mario class - main character
class Mario extends Entity {
    constructor(x, y) {
        super(x, y, 16, 16);
        this.state = 'small'; // 'small', 'big', 'dead'
        this.speed = 200;
        this.maxSpeed = 200;
        this.accel = 1200;
        this.decel = 1800;
        this.jumpVel = -480;
        this.onGround = true; // Start on ground
        this.invulnerable = false;
        this.invulnTimer = 0;
        this.facing = 1; // 1 = right, -1 = left
        this.walkFrame = 0;
        this.walkTimer = 0;
        this.isJumping = false;
        this.deathTimer = 0;
        this.isDead = false;
        this.flagSlide = false;
        this.flagSlideY = 0;
        this.wasMoving = false;
    }

    update(dt, level, gameState) {
        if (this.isDead) {
            this.deathTimer += dt;
            if (this.deathTimer < 0.3) {
                this.vy = -200;
            }
            this.vy += GRAVITY * dt;
            this.y += this.vy * dt;
            if (this.deathTimer > 2.0) {
                gameState.lives--;
                if (gameState.lives <= 0) {
                    gameState.state = State.GAME_OVER;
                } else {
                    gameState.restartLevel();
                }
            }
            return;
        }

        if (this.flagSlide) {
            // Sliding down flag pole
            this.y += 300 * dt;
            if (this.y >= level.groundY - this.h) {
                this.y = level.groundY - this.h;
                this.flagSlide = false;
                gameState.levelComplete();
            }
            return;
        }

        // Horizontal movement
        if (keys['ArrowRight']) {
            this.vx += this.accel * dt;
            this.facing = 1;
            this.wasMoving = true;
        } else if (keys['ArrowLeft']) {
            this.vx -= this.accel * dt;
            this.facing = -1;
            this.wasMoving = true;
        } else {
            // Decelerate
            if (this.vx > 0) {
                this.vx -= this.decel * dt;
                if (this.vx < 0) this.vx = 0;
            } else if (this.vx < 0) {
                this.vx += this.decel * dt;
                if (this.vx > 0) this.vx = 0;
            }
            this.wasMoving = false;
        }

        // Clamp speed
        if (this.vx > this.maxSpeed) this.vx = this.maxSpeed;
        if (this.vx < -this.maxSpeed) this.vx = -this.maxSpeed;

        // Jump
        if ((keys['ArrowUp'] || keys['Space']) && this.onGround && !this.isJumping) {
            this.vy = this.jumpVel;
            this.onGround = false;
            this.isJumping = true;
            playSound('jump');
        }

        // Variable height jump - release early cuts velocity
        if (!(keys['ArrowUp'] || keys['Space']) && this.vy < -100) {
            this.vy = -100;
        }

        if (!(keys['ArrowUp'] || keys['Space'])) {
            this.isJumping = false;
        }

        // Gravity
        this.vy += GRAVITY * dt;
        this.y += this.vy * dt;

        // Move and collide horizontally
        this.x += this.vx * dt;
        resolveHorizontal(this, level);

        // Move and collide vertically
        const hitResult = resolveVertical(this, level);

        // Check if we hit a tile from below
        if (hitResult === 'top') {
            this.handleHeadBump(level, gameState);
        }

        // Walk animation
        if (this.onGround && Math.abs(this.vx) > 10) {
            this.walkTimer += dt;
            if (this.walkTimer > 0.1) {
                this.walkTimer = 0;
                this.walkFrame = (this.walkFrame + 1) % 2;
            }
        } else if (this.onGround) {
            this.walkFrame = 0;
        }

        // Invulnerability timer
        if (this.invulnerable) {
            this.invulnTimer -= dt;
            if (this.invulnTimer <= 0) {
                this.invulnerable = false;
            }
        }

        // Fall into pit check
        if (this.y > level.height) {
            this.die();
        }

        // Check flag pole collision
        const flagCol = 198;
        const flagX = flagCol * TILE;
        if (!this.flagSlide && this.x + this.w >= flagX && this.x <= flagX + TILE && this.state !== 'dead') {
            this.flagSlide = true;
            this.x = flagX - this.w;
            this.vx = 0;
            this.vy = 0;
            this.flagSlideY = this.y;
            playSound('flagpole');

            // Calculate score based on height
            const heightScore = Math.max(0, Math.floor((level.groundY - this.y) / TILE) * 100);
            gameState.score += heightScore;
        }
    }

    handleHeadBump(level, gameState) {
        // Find the tile we hit
        const midX = Math.floor((this.x + this.w / 2) / TILE);
        const topY = Math.floor(this.y / TILE);

        const tile = level.getTile(midX, topY);

        if (tile === T.QUESTION_MUSHROOM || tile === T.QUESTION_COIN) {
            playSound('bump');
            if (tile === T.QUESTION_MUSHROOM) {
                level.setTile(midX, topY, T.USED_BLOCK);
                gameState.mushrooms.push(new Mushroom(midX * TILE, (topY - 1) * TILE));
                playSound('powerup');
            } else if (tile === T.QUESTION_COIN) {
                level.setTile(midX, topY, T.USED_BLOCK);
                gameState.score += 200;
                gameState.coins++;
                playSound('coin');
            }
        } else if (tile === T.BRICK) {
            playSound('bump');
            if (this.state === 'big') {
                level.setTile(midX, topY, T.AIR);
                playSound('break');
                gameState.score += 50;
            }
        }
    }

    grow() {
        if (this.state === 'small') {
            this.state = 'big';
            this.h = 32;
            this.y -= 16;
            playSound('powerup');
        }
    }

    shrink() {
        if (this.state === 'big') {
            this.state = 'small';
            this.h = 16;
            this.invulnerable = true;
            this.invulnTimer = 2.0;
            playSound('bump');
        } else {
            this.die();
        }
    }

    die() {
        if (this.isDead) return;
        if (this.invulnerable) return;
        this.isDead = true;
        this.vy = -300;
        this.vx = 0;
        this.state = 'dead';
        playSound('death');
    }

    render(ctx, camera) {
        if (this.isDead) {
            const sprite = 'mario-dead';
            const sy = this.state === 'big' ? 0 : 0;
            drawSprite(ctx, sprite, this.x - camera.x, this.y, this.w, this.h);
            return;
        }

        if (this.invulnerable && Math.floor(Date.now() / 100) % 2 === 0) {
            return; // Flicker - skip every other frame
        }

        let sprite;
        if (!this.onGround) {
            sprite = this.state === 'big' ? 'mario-big-jump' : 'mario-jump';
        } else if (Math.abs(this.vx) > 10) {
            sprite = this.state === 'big'
                ? (this.walkFrame === 0 ? 'mario-big-walk1' : 'mario-big-walk2')
                : (this.walkFrame === 0 ? 'mario-walk1' : 'mario-walk2');
        } else {
            sprite = this.state === 'big' ? 'mario-big-idle' : 'mario-idle';
        }

        drawSprite(ctx, sprite, this.x - camera.x, this.y, this.w, this.h);
    }
}
