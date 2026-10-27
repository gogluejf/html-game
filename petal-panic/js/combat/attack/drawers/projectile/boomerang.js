// Drawer contract: (ctx, state) => void
// Boomerang is a state machine (no entity). State: {x, y, phase, t, vx, vy}

/**
 * Boomerang: spinning curved blade. Cyan-tinted outbound, warm return.
 */
export function boomerangDrawer(ctx, st) {
  const color = st.phase === 'outbound' ? '#66ddff' : '#ffcc44';
  ctx.save();
  ctx.translate(st.x, st.y);
  ctx.rotate(st.t * 12); // fast spin

  // Two curved arms (boomerang shape).
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let arm = 0; arm < 2; arm++) {
    ctx.beginPath();
    ctx.arc(0, 0, 8, arm * Math.PI, arm * Math.PI + Math.PI * 0.7);
    ctx.stroke();
  }

  // Center dot.
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
