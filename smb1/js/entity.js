// Base entity class
class Entity {
    constructor(x, y, w, h) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.vx = 0;
        this.vy = 0;
        this.alive = true;
        this.onGround = false;
    }

    update(dt) {}

    render(ctx, camera) {}

    // Get collision box
    getBounds() {
        return {
            left: this.x,
            right: this.x + this.w,
            top: this.y,
            bottom: this.y + this.h
        };
    }

    // Check overlap with another entity
    overlaps(other) {
        const a = this.getBounds();
        const b = other.getBounds();
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }
}
