// Camera system - follows player with clamping
class Camera {
    constructor() {
        this.x = 0;
        this.targetX = 0;
        this.levelWidth = 0;
    }

    update(playerX, levelWidth) {
        this.levelWidth = levelWidth;
        // Camera follows Mario, keeping him around 1/3 from left
        this.targetX = playerX - 250;
        // Clamp to level bounds
        this.targetX = Math.max(0, Math.min(this.targetX, levelWidth - 800));
        // Smooth follow
        this.x += (this.targetX - this.x) * 0.1;
        // Ensure no negative (don't scroll left past start)
        if (this.x < 0) this.x = 0;
    }
}
