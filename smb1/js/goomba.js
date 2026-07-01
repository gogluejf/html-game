// Goomba enemy
class Goomba extends Entity {
    constructor(x, y) {
        super(x, y, 16, 16);
        this.vx = -50;
        this.walkFrame = 0;
        this.walkTimer = 0;
        this.stomped = false;
        this.deathTimer = 0;
        this.alive = true;
    }

    update(dt, level, gameState) {
        if (!this.alive) return;

        if (this.stomped) {
            this.deathTimer -= dt;
            if (this.deathTimer <= 0) {
                this.alive = false;
            }
            return;
        }

        // Walk
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
        if (this.stomped) return;
        this.stomped = true;
        this.deathTimer = 0.5;
        this.vx = 0;
        this.h = 8;
        this.y += 8;
        gs.score += 100;
        playSound('stomp');
    }

    render(ctx, camera) {
        if (!this.alive) return;

        const sprite = this.stomped
            ? 'goomba-stomped'
            : (this.walkFrame === 0 ? 'goomba-walk1' : 'goomba-walk2');

        drawSprite(ctx, sprite, this.x - camera.x, this.y, this.w, this.h);
    }
}
