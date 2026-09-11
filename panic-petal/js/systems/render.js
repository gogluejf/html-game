// Petal Panic — render system. Draws in 960x540 logical coords; the
// logical→screen transform is applied by main.js before this runs.

import { VIEW_W, VIEW_H } from '../main.js';
import { getTestBox } from './update.js';

export function render(ctx) {
  // Background
  ctx.fillStyle = '#101018';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Test box (verifies the fixed-step loop and scaling)
  const t = performance.now() / 1000;
  const box = getTestBox();
  ctx.fillStyle = `hsl(${(t * 60) % 360}, 80%, 60%)`;
  ctx.fillRect(box.x, box.y, box.w, box.h);
}
