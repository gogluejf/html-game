class Koopa extends Entity {
    constructor(x, y) {
        super(x, y, 16, 32);
        this.vx = -40;
        this.state = 'walking';  // walking | shell | shell-moving
        this.walkFrame = 0;
        this.walkTimer = 0;
        this.active = false;
        this.activateThreshold = 100;
    }

    update(dt, level) {
        if (!this.alive) return;

        // Lazy activation
        if (!this.active) {
            if (Math.abs(this.x - game.camera.x) < this.activateThreshold + 400) {
                this.active = true;
            } else {
                return;
            }
        }

        if (this.state === 'shell') {
            // Idle shell - don't move, wait for kick
            return;
        }

        // Walking or shell-moving
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

        // Reverse at walls (only when walking, not shell-moving)
        if (this.state === 'walking') {
            const frontX = this.vx < 0 ? this.x : this.x + this.w;
            const frontTile = level ? level.getTile(frontX, this.y + this.h / 2) : T.AIR;
            if (isSolid(frontTile)) {
                this.vx *= -1;
            }
        } else if (this.state === 'shell-moving') {
            // Shell moving through walls/pipes - just keep going
            // Kill other enemies on contact
            for (const entity of game.entities) {
                if (entity === this || !entity.alive) continue;
                if (entity instanceof Goomba || entity instanceof Koopa) {
                    if (this.overlaps(entity)) {
                        entity.alive = false;
                        game.score += 100;
                        play('stomp');
                    }
                }
            }
        }

        // Walk animation
        if (this.state === 'walking') {
            this.walkTimer += dt;
            if (this.walkTimer > 0.2) {
                this.walkTimer = 0;
                this.walkFrame = (this.walkFrame + 1) % 2;
            }
        }

        // Fall into pit
        if (this.y > canvas.height + 100) {
            this.alive = false;
        }
    }

    stomp(mario) {
        this.state = 'shell';
        this.h = 16;
        this.y += 16;
        this.vx = 0;
        game.score += 100;
        play('stomp');
    }

    kick(direction) {
        if (this.state === 'shell') {
            this.state = 'shell-moving';
            this.vx = direction * 300;
            play('kick');
        }
    }

    render(ctx, camera) {
        if (!this.alive || !this.active) return;

        const rx = this.x - camera.x;
        const ry = this.y;

        if (!spritesLoaded) {
            const color = this.state === 'shell' ? '#80b040' : '#50a830';
            drawFallback(ctx, rx, ry, this.w, this.h, color);
            return;
        }

        if (this.state === 'walking') {
            drawSprite(ctx, 1, 1, rx, ry, 16, 32);
        } else if (this.state === 'shell') {
            drawSprite(ctx, 1, 2, rx, ry);
        } else if (this.state === 'shell-moving') {
            drawSprite(ctx, 1, 3, rx, ry);
        }
    }
}
