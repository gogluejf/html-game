const keys = {};

window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    // Prevent scrolling on arrow keys/space
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

// Convenience check (debounce not needed for raw keyboard)
function isPressed(code) {
    return !!keys[code];
}
