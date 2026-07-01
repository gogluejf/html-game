// Level class - manages tilemap and rendering
class Level {
    constructor(layout) {
        this.layout = layout;
        this.rows = layout.length;
        this.cols = layout[0].length;
        this.width = this.cols * TILE;
        this.height = this.rows * TILE;
        this.groundY = groundRow() * TILE;
    }

    getTile(tx, ty) {
        if (ty < 0 || ty >= this.rows || tx < 0 || tx >= this.cols) return 0;
        return this.layout[ty][tx];
    }

    setTile(tx, ty, val) {
        if (ty >= 0 && ty < this.rows && tx >= 0 && tx < this.cols) {
            this.layout[ty][tx] = val;
        }
    }

    render(ctx, camera) {
        // Render background color
        ctx.fillStyle = '#6b8cff';
        ctx.fillRect(0, 0, 800, 480);

        // Render background decorations (parallax)
        this.renderBackground(ctx, camera);

        // Calculate visible tile range
        const startX = Math.max(0, Math.floor(camera.x / TILE));
        const endX = Math.min(this.cols - 1, Math.floor((camera.x + 800) / TILE));

        // Render tiles - only rows near ground + blocks
        for (let ty = 10; ty < this.rows; ty++) {
            for (let tx = startX; tx <= endX; tx++) {
                const tile = this.layout[ty][tx];
                if (tile === 0) continue;
                this.drawTile(ctx, tx, ty, tile, camera);
            }
        }

        // Render flag pole and flag
        this.renderFlag(ctx, camera);
    }

    renderBackground(ctx, camera) {
        // Parallax background elements
        for (const bg of BACKGROUND) {
            const parallaxX = (bg.x - camera.x * 0.3);
            if (parallaxX < -100 || parallaxX > 900) continue;

            const groundLevelY = this.groundY;
            for (let i = 0; i < bg.count; i++) {
                let drawX = parallaxX + i * 24;
                let drawY = bg.y;

                if (bg.type === 'hill') {
                    drawY = groundLevelY - 16;
                    drawSprite(ctx, 'hill', drawX, drawY, 48, 16);
                } else if (bg.type === 'bush') {
                    drawY = groundLevelY - 16;
                    drawSprite(ctx, 'bush', drawX, drawY, 16, 16);
                } else if (bg.type === 'cloud') {
                    drawSprite(ctx, 'cloud', drawX, drawY, 48, 32);
                }
            }
        }
    }

    drawTile(ctx, tx, ty, tile, camera) {
        const dx = tx * TILE - camera.x;
        const dy = ty * TILE;

        switch (tile) {
            case T.GROUND:
                drawSprite(ctx, 'ground', dx, dy, TILE, TILE);
                break;
            case T.BRICK:
                drawSprite(ctx, 'brick', dx, dy, TILE, TILE);
                break;
            case T.QUESTION_MUSHROOM:
                drawSprite(ctx, 'question-full', dx, dy, TILE, TILE);
                break;
            case T.QUESTION_COIN:
                drawSprite(ctx, 'question-full', dx, dy, TILE, TILE);
                break;
            case T.USED_BLOCK:
                drawSprite(ctx, 'used-block', dx, dy, TILE, TILE);
                break;
            case T.PIPE_TL:
                drawSprite(ctx, 'pipe-tl', dx, dy, TILE, TILE);
                break;
            case T.PIPE_TR:
                drawSprite(ctx, 'pipe-tr', dx, dy, TILE, TILE);
                break;
            case T.PIPE_BL:
                drawSprite(ctx, 'pipe-bl', dx, dy, TILE, TILE);
                break;
            case T.PIPE_BR:
                drawSprite(ctx, 'pipe-br', dx, dy, TILE, TILE);
                break;
            case T.STAIRCASE:
                drawSprite(ctx, 'brick', dx, dy, TILE, TILE);
                break;
        }
    }

    renderFlag(ctx, camera) {
        // Find flag pole column
        const flagCol = 198;
        const dx = flagCol * TILE - camera.x;

        // Draw flag pole from top to ground
        for (let ty = 8; ty < groundRow(); ty++) {
            const tile = this.layout[ty][flagCol];
            if (tile === T.FLAG_TOP) {
                drawSprite(ctx, 'flag-top', dx, ty * TILE, TILE, TILE);
            } else if (tile === T.FLAG_POLE) {
                drawSprite(ctx, 'flag-pole', dx, ty * TILE, TILE, TILE);
            }
        }
    }
}
