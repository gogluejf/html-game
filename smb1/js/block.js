// Block interaction class - handles dynamic block behavior
// (Most block logic is in level.js and collision.js, this handles special behavior)

// Block hit tracking
const hitBlocks = [];

function handleBlockHit(tx, ty, level, gameState, fromBelow) {
    const tile = level.getTile(tx, ty);

    if (fromBelow) {
        if (tile === T.QUESTION_MUSHROOM) {
            playSound('bump');
            level.setTile(tx, ty, T.USED_BLOCK);
            gameState.mushrooms.push(new Mushroom(tx * TILE, (ty - 1) * TILE));
            playSound('powerup');
            return 'mushroom';
        } else if (tile === T.QUESTION_COIN) {
            playSound('bump');
            level.setTile(tx, ty, T.USED_BLOCK);
            gameState.score += 200;
            gameState.coins++;
            playSound('coin');
            return 'coin';
        } else if (tile === T.BRICK) {
            playSound('bump');
            if (gameState.mario.state === 'big') {
                level.setTile(tx, ty, T.AIR);
                playSound('break');
                gameState.score += 50;
            }
            return 'brick';
        }
    }
    return null;
}
