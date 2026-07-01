const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = 800;
canvas.height = 480;

let lastTime = 0;
let entities = [];
let particles = [];

function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // cap dt
    lastTime = timestamp;
    update(dt);
    render();
    requestAnimationFrame(gameLoop);
}

function update(dt) {
    if (!game) return;
    game.update(dt);
}

function render() {
    if (!game) {
        ctx.fillStyle = '#5c94fc';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }
    game.render(ctx);
}

// Start the game
requestAnimationFrame(gameLoop);
