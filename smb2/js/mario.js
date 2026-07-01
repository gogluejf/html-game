const GRAVITY = 1200;

class Mario extends Entity {
    constructor(x, y) {
        super(x, y, 16, 16);
        this.state = 'small';        // small | big | dead | invulnerable
        this.speed = 180;
        this.runSpeed = 280;
        this.accel = 1000;
        this.decel = 1400;
        this.maxSpeed = this.speed;
        this.jumpVel = -380;
        this.onGround = false;
        this.facing = 1;            // 1 = right, -1 = left
        this.walkFrame = 0;
        this.walkTimer = 0;
        this.deathTimer = 0;
        this.invulnTimer = 0;
        this.invulnBlink = 0;
        this.isJumping = false;
        this.coyoteTime = 0;        // frames after leaving ground where jump still works
        this.jumpBuffer = 0;        // frames after jump press before actually jumping
        this.atFlag = false;
    }

    update(dt, level) {
        if (this.state === 'dead') {
            this.deathTimer -= dt;
            if (this.deathTimer <= 0 && this.vy >= 0 && this.y >= canvas.height) {
                // Truly dead - game over
                game.lives--;
                if (game.lives <= 0) {
                    game.state = State.GAME_OVER;
                } else {
                    game.restartLevel();
                }
            }
            this.vy += GRAVITY * dt;
            this.y += this.vy * dt;
            return;
        }

        // Invulnerability timer
        if (this.invulnTimer > 0) {
            this.invulnTimer -= dt;
            this.invulnBlink += dt;
            if (this.invulnTimer <= 0) {
                this.state = this.h == 32 ? 'big' : 'small';
            }
            // Still process movement
        }

        // Horizontal movement
        const currentMaxSpeed = keys['ShiftLeft'] || keys['ShiftRight'] ? this.runSpeed : this.maxSpeed;
        
        if (keys['ArrowRight']) {
            this.vx += this.accel * dt;
            this.facing = 1;
        } else if (keys['ArrowLeft']) {
            this.vx -= this.accel * dt;
            this.facing = -1;
        } else {
            // Decelerate
            if (this.vx > 0) {
                this.vx -= this.decel * dt;
                if (this.vx < 0) this.vx = 0;
            } else if (this.vx < 0) {
                this.vx += this.decel * dt;
                if (this.vx > 0) this.vx = 0;
            }
        }

        // Cap speed
        if (this.vx > currentMaxSpeed) this.vx = currentMaxSpeed;
        if (this.vx < -currentMaxSpeed) this.vx = -currentMaxSpeed;

        // Jump input buffering
        if (keys['ArrowUp'] || keys['KeyZ']) {
            this.jumpBuffer = 0.1;  // 100ms buffer
        }
        if (this.jumpBuffer > 0) this.jumpBuffer -= dt;

        // Coyote time
        if (this.onGround) {
            this.coyoteTime = 0.1;  // 100ms coyote
        }
        if (this.coyoteTime > 0) this.coyoteTime -= dt;

        // Jump execution
        if (this.jumpBuffer > 0 && this.coyoteTime > 0 && !this.isJumping) {
            this.doJump();
        }

        // Variable height jump - cut velocity on release
        if (!keys['ArrowUp'] && !keys['KeyZ'] && this.vy < -100 && this.isJumping) {
            this.vy = -100;
        }

        // Apply gravity
        this.vy += GRAVITY * dt;
        if (this.vy > 600) this.vy = 600; // Terminal velocity

        // Move horizontally
        this.x += this.vx * dt;

        // Resolve X collision with level
        if (level) {
            resolveTileCollisionX(this, level);
        }

        // Move vertically
        this.y += this.vy * dt;
        this.onGround = false;

        // Resolve Y collision with level
        if (level) {
            resolveTileCollisionY(this, level);
        }

        // Fall into pit
        if (this.y > canvas.height + 50) {
            this.die();
        }

        // Walk animation
        if (this.onGround && Math.abs(this.vx) > 10) {
            this.walkTimer += dt;
            if (this.walkTimer > 0.1) {
                this.walkTimer = 0;
                this.walkFrame = (this.walkFrame + 1) % 3;
            }
        } else {
            this.walkFrame = 0;
            this.walkTimer = 0;
        }
    }

    doJump() {
        this.vy = this.jumpVel;
        this.onGround = false;
        this.isJumping = true;
        this.coyoteTime = 0;
        this.jumpBuffer = 0;
        play('jump');
    }

    land() {
        this.isJumping = false;
        this.onGround = true;
    }

    grow() {
        if (this.state === 'small' || this.state === 'invulnerable') {
            this.state = 'big';
            this.h = 32;
            this.y -= 16;
            play('powerup');
        }
    }

    shrink() {
        if (this.state === 'big') {
            this.state = 'invulnerable';
            this.h = 16;
            this.y += 16;
            this.invulnTimer = 2.0;
            play('bump');
        } else {
            this.die();
        }
    }

    die() {
        this.state = 'dead';
        this.vy = -300;
        this.vx = 0;
        this.deathTimer = 1.5;
        play('death');
    }

    render(ctx, camera) {
        const rx = this.x - camera.x;
        const ry = this.y;

        // Blink when invulnerable
        if (this.state === 'invulnerable' && Math.floor(this.invulnBlink * 10) % 2 === 0) {
            return;
        }

        if (!spritesLoaded) {
            drawFallback(ctx, rx, ry, this.w, this.h, RED);
            return;
        }

        if (this.state === 'dead') {
            drawSprite(ctx, 0, 0, rx, ry);
            return;
        }

        if (this.h == 32) {
            // Big Mario
            drawSprite(ctx, 1, 0, rx, ry, 16, 16);       // top half
            drawSprite(ctx, 2, 0, rx, ry + 16, 16, 16);  // bottom half
            return;
        }

        // Small Mario
        let spriteCol = 0;
        if (!this.onGround) {
            spriteCol = 3; // jump
        } else if (Math.abs(this.vx) > 10) {
            spriteCol = 1 + (this.walkFrame % 2); // walk1 or walk2
        }
        drawSprite(ctx, 0, spriteCol, rx, ry);
    }
}
