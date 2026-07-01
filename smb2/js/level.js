class Level {
    constructor(tileRows, width, height) {
        this.tiles = tileRows;       // 2D array [row][col]
        this.width = width * TILE_SIZE;
        this.height = height * TILE_SIZE;
        this.rows = tileRows.length;
        this.cols = tileRows[0] ? tileRows[0].length : 0;
    }

    getTile(x, y) {
        const tx = Math.floor(x / TILE_SIZE);
        const ty = Math.floor(y / TILE_SIZE);
        if (ty < 0 || ty >= this.rows || tx < 0 || tx >= this.cols) {
            return T.AIR;
        }
        return this.tiles[ty][tx] || T.AIR;
    }

    setTile(x, y, tileId) {
        const tx = Math.floor(x / TILE_SIZE);
        const ty = Math.floor(y / TILE_SIZE);
        if (ty >= 0 && ty < this.rows && tx >= 0 && tx < this.cols) {
            this.tiles[ty][tx] = tileId;
        }
    }

    render(ctx, camera) {
        // Only render visible tiles (culling)
        const startX = Math.max(0, Math.floor(camera.x / TILE_SIZE));
        const endX = Math.min(this.cols - 1, Math.floor((camera.x + canvas.width) / TILE_SIZE));
        
        for (let ty = 0; ty < this.rows; ty++) {
            for (let tx = startX; tx <= endX; tx++) {
                const tileId = this.tiles[ty] && this.tiles[ty][tx];
                if (tileId && tileId !== T.AIR) {
                    drawTile(ctx, tileId, tx, ty, camera);
                }
            }
        }
    }

    // Render background elements (clouds, hills, bushes) - non-collidable
    renderBackground(ctx, camera) {
        // Sky background
        ctx.fillStyle = '#5c94fc';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw background decorations
        // (handled in game.js render for parallax)
    }
}
