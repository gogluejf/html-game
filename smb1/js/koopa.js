// Koopa Troopa enemy
class Koopa extends Entity {
    constructor(x, y) {
        super(x, y, 16, 32);
        this.state = 'walking'; // walking, shell, shell-moving
        this.vx = -50;
        this.walkFrame = 0;
        this.walkTimer = 0;
        this.alive = true;
    }

    update(dt, level, gameState) {
        if (!this.alive) return;

        if (this.state === 'shell-moving') {
            this.x += this.vx * dt;

            // Kill other enemies on contact
            for (const enemy of gameState.enemies) {
                if (enemy !== this && enemy.alive && this.overlaps(enemy)) {
                    if (enemy instanceof Goomba) {
                        enemy.alive = false;
                        gameState.score += 100;
                    } else if (enemy instanceof Koopa && enemy.state === 'walking') {
                        enemy.state = 'shell';
                        enemy.h = 16;
                        enemy.y += 16;
                        gameState.score += 100;
                    }
                }
            }

            // Wall/pipe collision - reverse
            const midY = Math.floor((this.y + this.h / 2) / TILE);
            if (this.vx > 0) {
                const rightTile = Math.floor((this.x + this.w) / TILE);
                if (isSolid(level.getTile(rightTile, midY))) {
                    this.vx = -300;
                    this.x = rightTile * TILE - this.w;
                }
            } else {
                const leftTile = Math.floor(this.x / TILE);
                if (isSolid(level.getTile(leftTile, midY))) {
                    this.vx = 300;
                    this.x = (leftTile + 1) * TILE;
                }
            }

            // Fall into pit
            if (this.y > level.height + 50) {
                this.alive = false;
            }
            return;
        }

        if (this.state === 'shell') {
            // Idle shell - do nothing except gravity
            this.vy += GRAVITY * dt;
            this.y += this.vy * dt;
            // Ground collision
            const bottom = Math.floor((this.y + this.h) / TILE);
            const left = Math.floor(this.x / TILE);
            const right = Math.floor((this.x + this.w - 1) / TILE);
            for (let tx = left; tx <= right; tx++) {
                if (isSolid(level.getTile(tx, bottom))) {
                    this.y = bottom * TILE - this.h;
                    this.vy = 0;
                    break;
                }
            }
            return;
        }

        // Walking state
        this.x += this.vx * dt;
        this.vy += GRAVITY * dt;
        this.y += this.vy * dt;

        // Ground collision
        const bottom = Math.floor((this.y + this.h) / TILE);
        const left = Math.floor(this.x / TILE);
        const right = Math.floor((this.x + this.w - 1) / TILE);
        for (let tx = left; tx <= right; tx++) {
            if (isSolid(level.getTile(tx, bottom))) {
                this.y = bottom * TILE - this.h;
                this.vy = 0;
                this.onGround = true;
                break;
            }
        }

        // Wall/pipe collision - reverse
        const midY = Math.floor((this.y + this.h / 2) / TILE);
        if (this.vx < 0) {
            const leftTile = Math.floor(this.x / TILE);
            if (isSolid(level.getTile(leftTile, midY))) {
                this.vx = -this.vx;
                this.x = (leftTile + 1) * TILE;
            }
        } else {
            const rightTile = Math.floor((this.x + this.w) / TILE);
            if (isSolid(level.getTile(rightTile, midY))) {
                this.vx = -this.vx;
                this.x = rightTile * TILE - this.w;
            }
        }

        // Walk animation
        this.walkTimer += dt;
        if (this.walkTimer > 0.2) {
            this.walkTimer = 0;
            this.walkFrame = (this.walkFrame + 1) % 2;
        }

        // Fall into pit
        if (this.y > level.height + 50) {
            this.alive = false;
        }
    }

    stomp(gs) {
        if (this.state === 'walking') {
            this.state = 'shell';
            this.h = 16;
            this.y += 16;
            this.vx = 0;
            playSound('stomp');
            gs.score += 100;
        }
    }

    kick(gs, direction) {
        if (this.state === 'shell') {
            this.state = 'shell-moving';
            this.vx = direction > 0 ? 300 : -300;
            playSound('kick');
        }
    }

    render(ctx, camera) {
        if (!this.alive) return;

        let sprite;
        if (this.state === 'shell' || this.state === 'shell-moving') {
            sprite = 'koopa-shell';
        } else {
            sprite = this.walkFrame === 0 ? 'koopa-walk1' : 'koopa-walk2';
        }

        drawSprite(ctx, sprite, this.x - camera.x, this.y, this.w, this.h);
    }
}
