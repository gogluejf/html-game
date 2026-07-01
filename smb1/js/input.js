// Input handling - keyboard
const keys = {};
window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
        e.preventDefault();
    }
});
window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});
