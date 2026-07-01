// Sprite sheet manager - loads and extracts sub-images from sprite sheet
const TILE = 16;
let spriteSheet = null;
let spritesLoaded = false;

function loadSpriteSheet(url, callback) {
    const img = new Image();
    img.onload = () => {
        spriteSheet = img;
        spritesLoaded = true;
        if (callback) callback();
    };
    img.onerror = () => {
        console.error('Failed to load sprite sheet:', url);
        spritesLoaded = false;
    };
    img.src = url;
}

// Draw a sub-image from sprite sheet
function drawSprite(ctx, row, col, dx, dy, w, h) {
    if (!spritesLoaded) return;
    const sx = col * TILE;
    const sy = row * TILE;
    const sw = w || TILE;
    const sh = h || TILE;
    ctx.drawImage(spriteSheet, sx, sy, sw, sh, dx, dy, sw, sh);
}

// Extract a sub-image from sprite sheet
function getSprite(row, col, w, h) {
    if (!spritesLoaded) return null;
    const c = document.createElement('canvas');
    c.width = w || TILE;
    c.height = h || TILE;
    const cCtx = c.getContext('2d');
    cCtx.drawImage(spriteSheet, col * TILE, row * TILE, w || TILE, h || TILE, 0, 0, w || TILE, h || TILE);
    return c;
}

// Draw colored rectangle fallback when sprites aren't loaded
function drawFallback(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
}
