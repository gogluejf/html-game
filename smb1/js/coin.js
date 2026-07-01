// Floating coin effect (visual only, score already added in block.js)
class FloatingCoin {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vy = -100;
        this.life = 0.5;
        this.alive = true;
        this.frame = 0;
        this.timer = 0;
    }

    update(dt) {
        this.life -= dt;
        this.y += this.vy * dt;
        this.timer += dt;
        if (this.timer > 0.1) {
            this.timer = 0;
            this.frame = (this.frame + 1) % 4;
        }
        if (this.life <= 0) this.alive = false;
    }

    render(ctx, camera) {
        if (!this.alive) return;
        drawSprite(ctx, 'coin', this.x - camera.x, this.y, 16, 16);
    }
}
