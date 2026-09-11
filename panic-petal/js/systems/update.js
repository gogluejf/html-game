// Petal Panic — update system (fixed 60Hz physics step).
// Placeholder for now: moves a test box so loop smoothness is verifiable.
// Later systems (player, enemies, camera) will be composed here.

import { VIEW_W, VIEW_H } from '../main.js';

const testBox = { x: 480, y: 270, w: 48, h: 48 };

export function update(dt) {
  // Bounce the test box around the logical viewport.
  const t = performance.now() / 1000;
  testBox.x = 480 + Math.cos(t * 2) * 200 - testBox.w / 2;
  testBox.y = 270 + Math.sin(t * 3) * 120 - testBox.h / 2;
}

export function getTestBox() {
  return testBox;
}
