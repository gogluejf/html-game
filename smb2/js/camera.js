class Camera {
    constructor(levelWidth) {
        this.x = 0;
        this.y = 0; // Could scroll vertically later
        this.levelWidth = levelWidth || 800;
    }

    update(playerX) {
        // Camera starts following once Mario passes x=300 (screen left offset)
        const targetX = Math.max(0, playerX - 300);
        // Never scroll past the end of the level
        this.x = Math.min(targetX, this.levelWidth - 800);
        // Never scroll negative
        if (this.x < 0) this.x = 0;
    }
}
