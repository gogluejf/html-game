// Mushroom powerup
class Mushroom extends Entity {
    constructor(x, y) {
        super(x, y, 16, 16);
        this.vx = 100;
        this.alive = true;
    }

    update(dt, level, gameState) {
        if (!this.alive) return;

        this.vy += GRAVITY * dt;
        this.x += this.vx * dt;
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

        // Wall collision - reverse
        const midY = Math.floor((this.y + this.h / 2) / TILE);
        if (this.vx > 0) {
            const rightTile = Math.floor((this.x + this.w) / TILE);
            if (isSolid(level.getTile(rightTile, midY))) {
                this.vx = -100;
                this.x = rightTile * TILE - this.w;
            }
        } else {
            const leftTile = Math.floor(this.x / TILE);
            if (isSolid(level.getTile(leftTile, midY))) {
                this.vx = 100;
                this.x = (leftTile + 1) * TILE;
            }
        }

        // Check collision with Mario
        if (!gameState.mario.isDead && this.overlaps(gameState.mario)) {
            gameState.mario.grow();
            gameState.score += 1000;
            this.alive = false;
            playSound('1up');
        }

        // Fall into pit
        if (this.y > level.height + 50) {
            this.alive = false;
        }
    }

    render(ctx, camera) {
        if (!this.alive) return;
        drawSprite(ctx, 'mushroom', this.x - camera.x, this.y, this.w, this.h);
    }
}
