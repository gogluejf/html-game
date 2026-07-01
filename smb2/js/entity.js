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

    update(dt) {
        // Override in subclasses
    }

    render(ctx, camera) {
        // Override in subclasses
    }

    // AABB collision box
    getBounds() {
        return {
            left: this.x,
            right: this.x + this.w,
            top: this.y,
            bottom: this.y + this.h
        };
    }

    // Check AABB overlap with another entity/bounds
    overlaps(other) {
        const a = this.getBounds();
        const b = other.getBounds ? other.getBounds() : other;
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }

    // Center X and Y
    get centerX() { return this.x + this.w / 2; }
    get centerY() { return this.y + this.h / 2; }
    get bottom()  { return this.y + this.h; }
}
