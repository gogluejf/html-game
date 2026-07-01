class Goomba extends Entity {
    constructor(x, y) {
        super(x, y, 16, 16);
        this.vx = -40;
        this.state = 'walking';  // walking | stomped
        this.walkFrame = 0;
        this.walkTimer = 0;
        this.stompTimer = 0;
        this.active = false;  // only activate when on screen
        this.activateThreshold = 100;
    }

    update(dt, level) {
        if (!this.alive) return;
        
        // Lazy activation - only update when near camera
        if (!this.active) {
            if (Math.abs(this.x - game.camera.x) < this.activateThreshold + 400) {
                this.active = true;
            } else {
                return;
            }
        }

        if (this.state === 'stomped') {
            this.stompTimer -= dt;
            if (this.stompTimer <= 0) {
                this.alive = false;
            }
            return;
        }

        // Walk
        this.x += this.vx * dt;

        // Gravity
        this.vy += GRAVITY * dt;
        if (this.vy > 500) this.vy = 500;
        this.y += this.vy * dt;
        this.onGround = false;

        // Tile collision
        if (level) {
            resolveTileCollision(this, level);
        }

        // Reverse direction at walls
        const frontX = this.vx < 0 ? this.x : this.x + this.w;
        const frontTile = level ? level.getTile(frontX, this.y + this.h / 2) : T.AIR;
        if (isSolid(frontTile)) {
            this.vx *= -1;
        }

        // Check if about to fall into pit
        const groundTile = level ? level.getTile(this.x + this.w / 2, this.y + this.h + 2) : T.AIR;
        if (!this.onGround && this.vy > 100) {
            // Already falling - fine
        }

        // Walk animation
        this.walkTimer += dt;
        if (this.walkTimer > 0.2) {
            this.walkTimer = 0;
            this.walkFrame = (this.walkFrame + 1) % 2;
        }

        // Fall into pit
        if (this.y > canvas.height + 100) {
            this.alive = false;
        }
    }

    stomp(mario) {
        this.state = 'stomped';
        this.stompTimer = 0.4;
        this.vx = 0;
        this.h = 8;
        this.y += 8;
        game.score += 100;
        play('stomp');
    }

    render(ctx, camera) {
        if (!this.alive || !this.active) return;
        
        const rx = this.x - camera.x;
        const ry = this.y;

        if (!spritesLoaded) {
            drawFallback(ctx, rx, ry, this.w, this.h, '#8B4513');
            return;
        }

        if (this.state === 'stomped') {
            // Draw flattened goomba
            ctx.fillStyle = '#8B4513';
            ctx.fillRect(rx, ry, this.w, this.h);
            return;
        }

        drawSprite(ctx, 0, 4 + this.walkFrame, rx, ry);
    }
}
