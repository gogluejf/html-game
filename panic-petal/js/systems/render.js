// Petal Panic — render system. Draws in 960x540 logical coords; the
// logical→screen transform is applied by main.js before this runs.

import { VIEW_W, VIEW_H } from '../view.js';
import { getTestEntity } from './update.js';

export function render(ctx) {
  // Background
  ctx.fillStyle = '#101018';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Floor line for the test entity's bounce (visual reference only).
  const FLOOR_Y = VIEW_H - 40;
  ctx.strokeStyle = '#333';
  ctx.beginPath();
  ctx.moveTo(0, FLOOR_Y);
  ctx.lineTo(VIEW_W, FLOOR_Y);
  ctx.stroke();

  // Test entity — drawn through Entity.draw() so the full transform pipeline
  // (mirror/rotate/scale + debug rect fallback) is exercised.
  getTestEntity().draw(ctx);
}
