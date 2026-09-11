// Petal Panic — render system. Draws in 960x540 logical coords; the
// logical→screen transform is applied by main.js before this runs.

import { VIEW_W, VIEW_H } from '../view.js';
import { getHero, getSolids, isDebugEnabled } from './update.js';

export function render(ctx) {
  // Background
  ctx.fillStyle = '#101018';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Solid platforms (orange per design §16 debug palette).
  for (const s of getSolids()) {
    ctx.fillStyle = '#ff9f43';
    ctx.fillRect(s.x, s.y, s.w, s.h);
  }

  // Hero test box — drawn through Entity.draw() so the full transform
  // pipeline (mirror/rotate/scale + debug rect fallback) is exercised.
  getHero().draw(ctx);

  // Debug overlay (F3): collision boxes + hint text. Basic version;
  // the full §16/§19 overlay lands in task 1.4.
  if (isDebugEnabled()) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;

    // Solids: orange outlines
    ctx.strokeStyle = '#ff9f43';
    for (const s of getSolids()) ctx.strokeRect(s.x, s.y, s.w, s.h);

    // Hero: green outline
    const wb = getHero().worldBox();
    ctx.strokeStyle = '#2ecc71';
    ctx.strokeRect(wb.x, wb.y, wb.w, wb.h);

    ctx.restore();

    // Hint text
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '12px monospace';
    ctx.fillText('DEBUG ON — F3 to toggle', 8, 16);
  }
}
