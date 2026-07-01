// Main entry point - game loop
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = 800;
canvas.height = 480;

let lastTime = 0;

function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // Cap dt to prevent huge jumps
    lastTime = timestamp;

    update(dt);

    // Handle restart key
    if (gameState.state === State.GAME_OVER || (gameState.state === State.LEVEL_COMPLETE && gameState.completeTimer > 1.5)) {
        handleRestart();
    }

    render();
    requestAnimationFrame(gameLoop);
}

// Initialize and start
initGame();

// Click canvas to ensure focus for keyboard
canvas.addEventListener('click', () => {
    canvas.focus();
});
canvas.focus();

requestAnimationFrame(gameLoop);
