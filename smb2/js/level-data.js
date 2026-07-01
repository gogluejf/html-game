// World 1-1 Level Layout
// Based on original SMB1 World 1-1
// Tile IDs defined in tilemap.js

// The level is defined as rows of tile data
// Each row is an array of tile IDs
// Level dimensions: ~222 tiles wide x 15 tiles tall (NES original)
// We'll use a compact representation

function buildLevel1_1() {
    const ROWS = 15;  // 15 rows of 16px tiles = 240px visible + sky
    const COLS = 222; // 222 columns wide (classic 1-1 width)
    
    // Initialize all air
    const tiles = [];
    for (let r = 0; r < ROWS; r++) {
        tiles[r] = new Array(COLS).fill(T.AIR);
    }
    
    // Ground: rows 13 and 14 (bottom 2 rows)
    // Ground from col 0 to 69, gap at 69-71, ground 72-86, gap 86-89, ground 90 to 221
    for (let r = 13; r <= 14; r++) {
        // Section 1: cols 0-68
        for (let c = 0; c <= 68; c++) tiles[r][c] = T.GROUND;
        // Section 2: cols 71-85
        for (let c = 71; c <= 85; c++) tiles[r][c] = T.GROUND;
        // Section 3: cols 88-154
        for (let c = 88; c <= 154; c++) tiles[r][c] = T.GROUND;
        // Section 4: cols 156-221
        for (let c = 156; c < COLS; c++) tiles[r][c] = T.GROUND;
    }
    
    // === Question blocks and bricks ===
    
    // First ? block row (above ground, row 9)
    // ? mushroom at col 16
    tiles[9][16] = T.QUESTION_MUSHROOM;
    // Brick ? Brick ? Brick at cols 20-24
    tiles[9][20] = T.BRICK;
    tiles[9][21] = T.QUESTION_EMPTY;
    tiles[9][22] = T.BRICK;
    tiles[9][23] = T.QUESTION_MUSHROOM;
    tiles[9][24] = T.BRICK;
    // ? at col 26 (overhead - 1 row higher, row 5)
    tiles[5][23] = T.QUESTION_MUSHROOM;
    // Brick ? Brick at cols 28-30
    tiles[9][28] = T.BRICK;
    tiles[9][29] = T.QUESTION_MUSHROOM;
    tiles[9][30] = T.BRICK;
    
    // === Pipes ===
    // Pipe 1 (col 28-29, 2 rows tall)
    tiles[11][28] = T.PIPE_TL; tiles[11][29] = T.PIPE_TR;
    tiles[12][28] = T.PIPE_BL; tiles[12][29] = T.PIPE_BR;
    
    // Pipe 2 (col 38-39, 3 rows tall)
    tiles[10][38] = T.PIPE_TL; tiles[10][39] = T.PIPE_TR;
    tiles[11][38] = T.PIPE_BL; tiles[11][39] = T.PIPE_BR;
    tiles[12][38] = T.PIPE_BL; tiles[12][39] = T.PIPE_BR;
    
    // Pipe 3 (col 46-47, 3 rows tall)
    tiles[10][46] = T.PIPE_TL; tiles[10][47] = T.PIPE_TR;
    tiles[11][46] = T.PIPE_BL; tiles[11][47] = T.PIPE_BR;
    tiles[12][46] = T.PIPE_BL; tiles[12][47] = T.PIPE_BR;
    
    // Pipe 4 (col 57-58, 2 rows tall)
    tiles[11][57] = T.PIPE_TL; tiles[11][58] = T.PIPE_TR;
    tiles[12][57] = T.PIPE_BL; tiles[12][58] = T.PIPE_BR;
    
    // Pipe 5 (col 67-68, 2 rows tall)
    tiles[11][67] = T.PIPE_TL; tiles[11][68] = T.PIPE_TR;
    tiles[12][67] = T.PIPE_BL; tiles[12][68] = T.PIPE_BR;
    
    // === Second section (after gap) ===
    // ? blocks row 9
    tiles[9][77] = T.QUESTION_MUSHROOM;
    tiles[9][79] = T.BRICK;
    tiles[9][80] = T.QUESTION_MUSHROOM;
    tiles[9][81] = T.BRICK;
    
    // Brick formation row 5
    for (let c = 80; c <= 87; c++) tiles[5][c] = T.BRICK;
    // 4 ? blocks above ground at col 91-94
    tiles[9][91] = T.QUESTION_COIN;
    tiles[9][94] = T.QUESTION_COIN;
    tiles[5][94] = T.QUESTION_MUSHROOM;
    
    // Pipes in section 2
    tiles[11][100] = T.PIPE_TL; tiles[11][101] = T.PIPE_TR;
    tiles[12][100] = T.PIPE_BL; tiles[12][101] = T.PIPE_BR;
    
    tiles[10][109] = T.PIPE_TL; tiles[10][110] = T.PIPE_TR;
    tiles[11][109] = T.PIPE_BL; tiles[11][110] = T.PIPE_BR;
    tiles[12][109] = T.PIPE_BL; tiles[12][110] = T.PIPE_BR;
    
    tiles[10][118] = T.PIPE_TL; tiles[10][119] = T.PIPE_TR;
    tiles[11][118] = T.PIPE_BL; tiles[11][119] = T.PIPE_BR;
    tiles[12][118] = T.PIPE_BL; tiles[12][119] = T.PIPE_BR;
    
    // Brick row 9 at col 128-131
    for (let c = 128; c <= 131; c++) tiles[9][c] = T.BRICK;
    // 4 ? blocks at col 133-136
    tiles[5][129] = T.QUESTION_MUSHROOM;
    tiles[5][130] = T.QUESTION_MUSHROOM;
    tiles[5][131] = T.QUESTION_MUSHROOM;
    
    // === Staircase section ===
    // Staircase 1 (8 steps up, col 134-141)
    for (let step = 0; step < 8; step++) {
        for (let r = 12; r >= 13 - step; r--) {
            tiles[r][134 + step] = T.STAIR;
        }
    }
    // Staircase 2 (descending, col 143-150)
    for (let step = 0; step < 8; step++) {
        for (let r = 12; r >= 13 - (7 - step); r--) {
            tiles[r][143 + step] = T.STAIR;
        }
    }
    
    // Final staircase (4 steps, col 198-201)
    for (let step = 0; step < 4; step++) {
        for (let r = 12; r >= 13 - step; r--) {
            tiles[r][198 + step] = T.STAIR;
        }
    }
    
    // === Flag pole ===
    // Pole at col 202, from row 3 to 12
    tiles[3][202] = T.FLAG_TOP;
    for (let r = 4; r <= 12; r++) {
        tiles[r][202] = T.FLAG_POLE;
    }
    
    const level = new Level(tiles, COLS, ROWS);
    return level;
}

// Spawn points for enemies
const ENEMY_SPAWNS = [
    // Goombas
    { type: 'goomba', x: 22 * TILE_SIZE, y: 11 * TILE_SIZE },
    { type: 'goomba', x: 40 * TILE_SIZE, y: 11 * TILE_SIZE },
    { type: 'goomba', x: 51 * TILE_SIZE, y: 11 * TILE_SIZE },
    { type: 'goomba', x: 52 * TILE_SIZE, y: 11 * TILE_SIZE },
    { type: 'goomba', x: 80 * TILE_SIZE, y: 11 * TILE_SIZE },
    { type: 'goomba', x: 82 * TILE_SIZE, y: 11 * TILE_SIZE },
    { type: 'goomba', x: 97 * TILE_SIZE, y: 11 * TILE_SIZE },
    { type: 'goomba', x: 98 * TILE_SIZE, y: 11 * TILE_SIZE },
    { type: 'goomba', x: 114 * TILE_SIZE, y: 11 * TILE_SIZE },
    { type: 'goomba', x: 115 * TILE_SIZE, y: 11 * TILE_SIZE },
    { type: 'goomba', x: 124 * TILE_SIZE, y: 11 * TILE_SIZE },
    { type: 'goomba', x: 125 * TILE_SIZE, y: 11 * TILE_SIZE },
    // Koopas
    { type: 'koopa', x: 102 * TILE_SIZE, y: 10 * TILE_SIZE },
    { type: 'koopa', x: 148 * TILE_SIZE, y: 11 * TILE_SIZE },
];
