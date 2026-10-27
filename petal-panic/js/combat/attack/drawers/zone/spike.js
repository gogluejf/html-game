// Drawer contract: (ctx, params) => void
// Spike is not a HazardZone — it's a phase machine. This drawer is called
// by the host (theater/gameplay) during the 'visible' phase only.
// params: { x, y, width } (center-based, SPIKE_HEIGHT = 16)

const SPIKE_H = 16;

/**
 * Spike strip: row of triangular teeth pointing up, yellow-white gradient.
 */
export function spikeDrawer(ctx, p) {
  const x = p.x - p.width / 2;
  const y = p.y - SPIKE_H / 2;
  const w = p.width;
  const h = SPIKE_H;
  const teeth = Math.max(3, Math.floor(w / 12));
  const tw = w / teeth;

  ctx.save();
  // Base plate.
  ctx.fillStyle = '#555';
  ctx.fillRect(x, y + h - 3, w, 3);

  // Teeth (triangles).
  for (let i = 0; i < teeth; i++) {
    const tx = x + i * tw;
    const grad = ctx.createLinearGradient(tx, y, tx, y + h);
    grad.addColorStop(0, '#fff8d0');
    grad.addColorStop(1, '#f0c040');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(tx, y + h - 3);
    ctx.lineTo(tx + tw / 2, y);
    ctx.lineTo(tx + tw, y + h - 3);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}
