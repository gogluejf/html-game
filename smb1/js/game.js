// Game state management
const State = {
    PLAYING: 0,
    GAME_OVER: 1,
    LEVEL_COMPLETE: 2,
};

let gameState = {
    state: State.PLAYING,
    score: 0,
    coins: 0,
    lives: 3,
    time: 400,
    timeTimer: 0,
    mario: null,
    level: null,
    camera: null,
    enemies: [],
    mushrooms: [],
    floatingCoins: [],
    levelData: null,
    flagReached: false,
    completeTimer: 0,
};

function initLevel() {
    gameState.levelData = generateLevel();
    gameState.level = new Level(gameState.levelData);
    gameState.camera = new Camera();
    gameState.camera.x = 0;
    gameState.mario = new Mario(3 * TILE, gameState.level.groundY - 16);
    gameState.enemies = [];
    gameState.mushrooms = [];
    gameState.floatingCoins = [];
    gameState.flagReached = false;
    gameState.completeTimer = 0;

    // Spawn enemies
    for (const ed of ENEMIES) {
        if (ed.type === 'goomba') {
            gameState.enemies.push(new Goomba(ed.x, ed.y));
        } else if (ed.type === 'koopa') {
            gameState.enemies.push(new Koopa(ed.x, ed.y));
        }
    }
}

function initGame() {
    gameState.score = 0;
    gameState.coins = 0;
    gameState.lives = 3;
    gameState.time = 400;
    gameState.timeTimer = 0;
    gameState.state = State.PLAYING;
    initLevel();
}

gameState.restartLevel = function() {
    gameState.time = 400;
    gameState.timeTimer = 0;
    this.state = State.PLAYING;
    initLevel();
};

gameState.levelComplete = function() {
    if (this.flagReached) return;
    this.flagReached = true;
    this.completeTimer = 0;
};

// Update game logic
function update(dt) {
    if (gameState.state === State.GAME_OVER) {
        return;
    }

    if (gameState.state === State.LEVEL_COMPLETE) {
        gameState.completeTimer += dt;
        return;
    }

    if (gameState.state !== State.PLAYING) return;

    const { mario, level, camera } = gameState;

    // Timer
    gameState.timeTimer += dt;
    if (gameState.timeTimer >= 1) {
        gameState.timeTimer -= 1;
        gameState.time--;
        if (gameState.time <= 0) {
            mario.die();
        }
    }

    // Update Mario
    mario.update(dt, level, gameState);

    // Update camera
    if (!mario.isDead) {
        camera.update(mario.x, level.width);
    }

    // Update enemies
    for (const enemy of gameState.enemies) {
        enemy.update(dt, level, gameState);
    }

    // Update mushrooms
    for (const mushroom of gameState.mushrooms) {
        mushroom.update(dt, level, gameState);
    }
    // Remove dead mushrooms
    gameState.mushrooms = gameState.mushrooms.filter(m => m.alive);

    // Update floating coins
    for (const fc of gameState.floatingCoins) {
        fc.update(dt);
    }
    gameState.floatingCoins = gameState.floatingCoins.filter(fc => fc.alive);

    // Check Mario-enemy collisions
    if (!mario.isDead && !mario.invulnerable) {
        for (const enemy of gameState.enemies) {
            if (!enemy.alive) continue;

            if (mario.overlaps(enemy)) {
                // Check if stomping (Mario falling onto enemy)
                const marioBottom = mario.y + mario.h;
                const enemyTop = enemy.y;
                const isStomping = mario.vy > 0 && marioBottom > enemyTop && marioBottom < enemyTop + enemy.h * 0.5 + 8;

                if (isStomping) {
                    if (enemy instanceof Goomba) {
                        enemy.stomp(gameState);
                        mario.vy = -200; // Bounce
                    } else if (enemy instanceof Koopa) {
                        enemy.stomp(gameState);
                        mario.vy = -200;
                    }
                } else if (enemy instanceof Koopa && enemy.state === 'shell') {
                    // Kick shell
                    const kickDir = mario.x < enemy.x ? 1 : -1;
                    enemy.kick(gameState, kickDir);
                } else if (enemy instanceof Koopa && enemy.state === 'shell-moving') {
                    // Moving shell hurts
                    mario.shrink();
                } else {
                    // Side contact with walking enemy
                    mario.shrink();
                }
            }
        }
    }

    // Clean up dead enemies
    gameState.enemies = gameState.enemies.filter(e => e.alive);
}

// Render everything
function render() {
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    const { mario, level, camera, state } = gameState;

    if (!level || !mario) return;

    // Render level
    level.render(ctx, camera);

    // Render enemies
    for (const enemy of gameState.enemies) {
        enemy.render(ctx, camera);
    }

    // Render mushrooms
    for (const mushroom of gameState.mushrooms) {
        mushroom.render(ctx, camera);
    }

    // Render floating coins
    for (const fc of gameState.floatingCoins) {
        fc.render(ctx, camera);
    }

    // Render Mario
    mario.render(ctx, camera);

    // HUD
    renderHUD(ctx);

    // Game over screen
    if (state === State.GAME_OVER) {
        renderGameOver(ctx);
    }

    // Level complete screen
    if (state === State.LEVEL_COMPLETE) {
        renderLevelComplete(ctx);
    }
}

function renderHUD(ctx) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';

    // Mario score
    ctx.fillText('MARIO', 30, 20);
    ctx.fillText(gameState.score.toString().padStart(6, '0'), 30, 36);

    // Coins
    ctx.fillText('\u00D7' + gameState.coins.toString().padStart(2, '0'), 200, 36);

    // World
    ctx.textAlign = 'center';
    ctx.fillText('WORLD', 400, 20);
    ctx.fillText('1-1', 400, 36);

    // Time
    ctx.textAlign = 'right';
    ctx.fillText('TIME', 750, 20);
    ctx.fillText(gameState.time.toString().padStart(3, '0'), 750, 36);

    // Lives
    ctx.textAlign = 'left';
    ctx.fillText('LIVES: ' + gameState.lives, 30, 52);
}

function renderGameOver(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, 800, 480);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', 400, 200);

    ctx.font = 'bold 20px monospace';
    ctx.fillText('Score: ' + gameState.score.toString().padStart(6, '0'), 400, 240);

    ctx.font = '16px monospace';
    ctx.fillText('Press R to restart', 400, 280);
}

function renderLevelComplete(ctx) {
    const t = gameState.completeTimer;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, 800, 480);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LEVEL COMPLETE!', 400, 180);

    ctx.font = 'bold 20px monospace';
    ctx.fillText('Score: ' + gameState.score.toString().padStart(6, '0'), 400, 220);
    ctx.fillText('Coins: ' + gameState.coins, 400, 250);

    if (t > 1.5) {
        ctx.font = '16px monospace';
        ctx.fillText('Press R to play again', 400, 300);
    }
}

// Handle restart
function handleRestart() {
    if (keys['KeyR']) {
        keys['KeyR'] = false;
        initGame();
    }
}
