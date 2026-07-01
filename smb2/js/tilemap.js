// Tilemap renderer - draws tiles from sprite sheet
const TILE_SIZE = 16;

// Tile ID constants
const T = {
    AIR: 0,
    GROUND: 1,
    BRICK: 2,
    QUESTION_MUSHROOM: 3,
    QUESTION_COIN: 4,
    QUESTION_LIFE: 5,
    QUESTION_EMPTY: 6,
    USED: 7,
    PIPE_TL: 8,
    PIPE_TR: 9,
    PIPE_BL: 10,
    PIPE_BR: 11,
    STAIR: 13,
    HARD: 14,  // indestructible block
    FLAG_POLE: 15,
    FLAG_TOP: 16,
};

// Which tiles are solid (collidable)
function isSolid(tileId) {
    return [T.GROUND, T.BRICK, T.QUESTION_MUSHROOM, T.QUESTION_COIN, T.QUESTION_LIFE,
            T.QUESTION_EMPTY, T.USED, T.PIPE_TL, T.PIPE_TR, T.PIPE_BL, T.PIPE_BR,
            T.STAIR, T.HARD].includes(tileId);
}

// Sprite sheet mapping: tileId -> [row, col]
function tileToSprite(tileId) {
    switch(tileId) {
        case T.GROUND:   return [2, 1];
        case T.BRICK:    return [2, 2];
        case T.QUESTION_MUSHROOM:
        case T.QUESTION_COIN:
        case T.QUESTION_LIFE:
        case T.QUESTION_EMPTY: return [2, 3];
        case T.USED:     return [2, 5];
        case T.PIPE_TL:  return [3, 0];
        case T.PIPE_TR:  return [3, 1];
        case T.PIPE_BL:  return [3, 2];
        case T.PIPE_BR:  return [3, 3];
        case T.STAIR:    return [5, 4];
        case T.HARD:     return [2, 1];
        case T.FLAG_POLE: return [4, 2];
        case T.FLAG_TOP: return [4, 3];
        default:         return null;
    }
}

function drawTile(ctx, tileId, tx, ty, camera) {
    const mapping = tileToSprite(tileId);
    if (!mapping) return;
    const [row, col] = mapping;
    const dx = tx * TILE_SIZE - camera.x;
    const dy = ty * TILE_SIZE;
    
    if (!spritesLoaded) {
        drawFallback(ctx, dx, dy, TILE_SIZE, TILE_SIZE, '#888');
        return;
    }
    
    drawSprite(ctx, row, col, dx, dy);
}
