// Tile IDs
const T = {
    AIR: 0,
    GROUND: 1,
    BRICK: 2,
    QUESTION_MUSHROOM: 3,
    QUESTION_COIN: 4,
    PIPE_TL: 5,
    PIPE_TR: 6,
    PIPE_BL: 7,
    PIPE_BR: 8,
    USED_BLOCK: 9,
    STAIRCASE: 10,
    FLAG_POLE: 11,
    FLAG_TOP: 12,
    INVISIBLE: 13, // Hidden blocks (used for secret 1-ups etc)
};

const TILE = 16;
const GRAVITY = 1200;

// Solid tiles
const SOLID_TILES = new Set([T.GROUND, T.BRICK, T.QUESTION_MUSHROOM, T.QUESTION_COIN,
    T.PIPE_TL, T.PIPE_TR, T.PIPE_BL, T.PIPE_BR, T.USED_BLOCK, T.STAIRCASE]);

function isSolid(tileId) {
    return SOLID_TILES.has(tileId);
}

// Background elements (clouds, hills, bushes) - these are decorative
const BACKGROUND = [
    // { type, x, y, count }
    { type: 'cloud', x: 100, y: 40, count: 1 },
    { type: 'cloud', x: 400, y: 60, count: 2 },
    { type: 'cloud', x: 900, y: 30, count: 1 },
    { type: 'cloud', x: 1400, y: 50, count: 3 },
    { type: 'cloud', x: 2200, y: 35, count: 1 },
    { type: 'cloud', x: 2800, y: 55, count: 2 },
    { type: 'cloud', x: 3600, y: 40, count: 1 },
    { type: 'cloud', x: 4200, y: 30, count: 2 },
    { type: 'hill', x: 0, y: 0, count: 1 },
    { type: 'hill', x: 600, y: 0, count: 1 },
    { type: 'hill', x: 1200, y: 0, count: 1 },
    { type: 'hill', x: 1800, y: 0, count: 1 },
    { type: 'hill', x: 2600, y: 0, count: 1 },
    { type: 'hill', x: 3200, y: 0, count: 1 },
    { type: 'hill', x: 3800, y: 0, count: 1 },
    { type: 'bush', x: 200, y: 0, count: 1 },
    { type: 'bush', x: 800, y: 0, count: 2 },
    { type: 'bush', x: 1600, y: 0, count: 1 },
    { type: 'bush', x: 2400, y: 0, count: 1 },
    { type: 'bush', x: 3000, y: 0, count: 2 },
    { type: 'bush', x: 3700, y: 0, count: 1 },
];

// Simplified World 1-1 layout
// 30 rows x ~224 cols (the level is about 6500px wide)
// Ground is at row 22-23 (y = 352-384)

function generateLevel() {
    const rows = 30;
    const cols = 224;
    // Initialize with air
    const layout = [];
    for (let y = 0; y < rows; y++) {
        layout[y] = new Array(cols).fill(T.AIR);
    }

    // Ground level is at row 22 (y=352), 2 rows thick
    const groundRow = 22;

    // Fill ground sections (with gaps/pits)
    // Pit 1: cols 69-71
    // Pit 2: cols 86-88
    // Pit 3: cols 154-156

    for (let x = 0; x < cols; x++) {
        let isPit = false;
        // Pit 1
        if (x >= 69 && x <= 71) isPit = true;
        // Pit 2
        if (x >= 86 && x <= 88) isPit = true;
        // Pit 3
        if (x >= 154 && x <= 156) isPit = true;

        if (!isPit) {
            layout[groundRow][x] = T.GROUND;
            layout[groundRow + 1][x] = T.GROUND;
        }
    }

    // === BLOCK ARRANGEMENTS ===

    // First question block (mushroom) - col 16
    layout[18][16] = T.QUESTION_MUSHROOM;

    // Brick/question sequence - cols 20-26
    layout[14][20] = T.BRICK;
    layout[14][21] = T.QUESTION_COIN;
    layout[14][22] = T.BRICK;
    layout[14][23] = T.QUESTION_MUSHROOM;  // Hidden under invisible
    layout[14][24] = T.BRICK;
    layout[14][25] = T.QUESTION_COIN;
    layout[14][26] = T.BRICK;

    // Invisible blocks over the mushroom (so you can't see it without bumping)
    // We'll handle invisible blocks specially - they're question_mushroom but disguised

    // Upper question blocks - col 22
    layout[10][22] = T.QUESTION_COIN;
    layout[10][23] = T.QUESTION_COIN;
    layout[10][24] = T.QUESTION_COIN;
    layout[10][25] = T.QUESTION_COIN;

    // Second brick group - cols 34-38
    layout[14][34] = T.BRICK;
    layout[14][35] = T.BRICK;
    layout[14][36] = T.QUESTION_COIN;
    layout[14][37] = T.BRICK;

    // Third brick group - cols 51-55
    layout[14][51] = T.BRICK;
    layout[14][52] = T.BRICK;
    layout[14][53] = T.QUESTION_COIN;
    layout[14][54] = T.BRICK;
    layout[14][55] = T.BRICK;

    // Upper blocks
    layout[10][53] = T.QUESTION_MUSHROOM;
    layout[10][52] = T.BRICK;
    layout[10][54] = T.BRICK;
    layout[10][55] = T.BRICK;
    layout[10][56] = T.BRICK;
    layout[10][57] = T.BRICK;
    layout[10][58] = T.BRICK;
    layout[10][59] = T.BRICK;
    layout[10][60] = T.BRICK;

    // Fourth brick group - cols 78-80
    layout[14][78] = T.BRICK;
    layout[14][79] = T.QUESTION_COIN;
    layout[14][80] = T.BRICK;

    // Blocks near second pit
    layout[14][91] = T.BRICK;
    layout[14][92] = T.BRICK;
    layout[14][93] = T.QUESTION_COIN;
    layout[14][94] = T.BRICK;

    // Upper blocks near second pit
    layout[10][94] = T.BRICK;
    layout[10][95] = T.QUESTION_COIN;
    layout[10][96] = T.BRICK;

    // More blocks
    layout[14][100] = T.QUESTION_COIN;

    // Blocks near staircase area
    layout[14][106] = T.BRICK;
    layout[14][107] = T.BRICK;
    layout[14][108] = T.QUESTION_MUSHROOM;
    layout[14][109] = T.BRICK;
    layout[14][110] = T.BRICK;

    // Staircase 1 (before pit 3) - cols 118-121
    for (let step = 0; step < 3; step++) {
        for (let h = 0; h <= step; h++) {
            layout[groundRow - 1 - h][118 + step] = T.STAIRCASE;
        }
    }

    // Staircase 2 (descending) - cols 125-128
    for (let step = 0; step < 3; step++) {
        for (let h = 0; h <= (2 - step); h++) {
            layout[groundRow - 1 - h][125 + step] = T.STAIRCASE;
        }
    }

    // Blocks after second staircase
    layout[14][135] = T.BRICK;
    layout[14][136] = T.BRICK;
    layout[14][137] = T.BRICK;

    // Upper blocks
    layout[10][135] = T.QUESTION_COIN;
    layout[10][136] = T.QUESTION_COIN;

    // Staircase 3 - cols 140-143
    for (let step = 0; step < 3; step++) {
        for (let h = 0; h <= step; h++) {
            layout[groundRow - 1 - h][140 + step] = T.STAIRCASE;
        }
    }

    // Staircase 4 (ascending taller) - cols 148-153
    for (let step = 0; step < 5; step++) {
        for (let h = 0; h <= step; h++) {
            layout[groundRow - 1 - h][148 + step] = T.STAIRCASE;
        }
    }

    // Blocks after final staircase
    layout[14][168] = T.BRICK;
    layout[14][169] = T.QUESTION_COIN;
    layout[14][170] = T.BRICK;

    // === PIPES ===
    // Pipe 1 - col 28 (tall, 2 rows)
    layout[groundRow - 2][28] = T.PIPE_TL;
    layout[groundRow - 2][29] = T.PIPE_TR;
    layout[groundRow - 1][28] = T.PIPE_BL;
    layout[groundRow - 1][29] = T.PIPE_BR;

    // Pipe 2 - col 38 (short, 1 row)
    layout[groundRow - 1][38] = T.PIPE_TL;
    layout[groundRow - 1][39] = T.PIPE_TR;

    // Pipe 3 - col 46 (short, 1 row)
    layout[groundRow - 1][46] = T.PIPE_TL;
    layout[groundRow - 1][47] = T.PIPE_TR;

    // Pipe 4 - col 103 (tall, 3 rows)
    layout[groundRow - 3][103] = T.PIPE_TL;
    layout[groundRow - 3][104] = T.PIPE_TR;
    layout[groundRow - 2][103] = T.PIPE_BL;
    layout[groundRow - 2][104] = T.PIPE_BR;
    layout[groundRow - 1][103] = T.PIPE_BL;
    layout[groundRow - 1][104] = T.PIPE_BR;

    // Pipe 5 - col 131 (tall, 2 rows)
    layout[groundRow - 2][131] = T.PIPE_TL;
    layout[groundRow - 2][132] = T.PIPE_TR;
    layout[groundRow - 1][131] = T.PIPE_BL;
    layout[groundRow - 1][132] = T.PIPE_BR;

    // === FLAG POLE ===
    // Flag pole at col 198
    const flagCol = 198;
    layout[groundRow - 1][flagCol] = T.FLAG_POLE;
    for (let r = groundRow - 2; r >= 8; r--) {
        layout[r][flagCol] = T.FLAG_POLE;
    }
    layout[8][flagCol] = T.FLAG_TOP;

    return layout;
}

// Enemy placement data
const ENEMIES = [
    // Goombas
    { type: 'goomba', x: 22 * TILE, y: (groundRow() - 1) * TILE },
    { type: 'goomba', x: 40 * TILE, y: (groundRow() - 1) * TILE },
    { type: 'goomba', x: 51 * TILE, y: 14 * TILE },
    { type: 'goomba', x: 52 * TILE, y: 14 * TILE },
    { type: 'goomba', x: 75 * TILE, y: (groundRow() - 1) * TILE },
    { type: 'goomba', x: 76 * TILE, y: (groundRow() - 1) * TILE },
    { type: 'goomba', x: 82 * TILE, y: (groundRow() - 1) * TILE },
    { type: 'goomba', x: 83 * TILE, y: (groundRow() - 1) * TILE },
    { type: 'goomba', x: 97 * TILE, y: (groundRow() - 1) * TILE },
    { type: 'goomba', x: 98 * TILE, y: (groundRow() - 1) * TILE },
    { type: 'goomba', x: 114 * TILE, y: (groundRow() - 1) * TILE },
    { type: 'goomba', x: 115 * TILE, y: (groundRow() - 1) * TILE },
    { type: 'goomba', x: 124 * TILE, y: (groundRow() - 1) * TILE },
    { type: 'goomba', x: 125 * TILE, y: (groundRow() - 1) * TILE },
    { type: 'goomba', x: 145 * TILE, y: (groundRow() - 1) * TILE },
    { type: 'goomba', x: 146 * TILE, y: (groundRow() - 1) * TILE },
    { type: 'goomba', x: 172 * TILE, y: (groundRow() - 1) * TILE },
    { type: 'goomba', x: 173 * TILE, y: (groundRow() - 1) * TILE },

    // Koopas
    { type: 'koopa', x: 102 * TILE, y: (groundRow() - 2) * TILE },
    { type: 'koopa', x: 144 * TILE, y: (groundRow() - 2) * TILE },
    { type: 'koopa', x: 170 * TILE, y: (groundRow() - 2) * TILE },
];

function groundRow() {
    return 22;
}
