// Petal Panic — shared color utility (single source of truth).
//
// Several draw effects (auraGlow §22, beam §26) need to paint a CSS color at a
// varying alpha via an rgba() string. Rather than duplicate the ~20-line hex/rgb
// parser across every consumer, it lives here so each effect reads one copy.
//
// Pure function module — no DOM, no dependencies, fully deterministic.

/**
 * Produce an rgba() string for a CSS color at the given alpha. Supports hex
 * (#rgb / #rrggbb) and rgb()/rgba() inputs; unknown formats fall back to black
 * channels. Deterministic — no randomness.
 * @param {string} color CSS color
 * @param {number} alpha 0..1
 * @returns {string}
 */
export function colorWithAlpha(color, alpha) {
  const a = Math.min(1, Math.max(0, alpha));
  let r = 0, g = 0, b = 0;
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      let h = hex[1];
      if (h.length === 3) h = [...h].map(c => c + c).join('');
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    } else {
      const m = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
      if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
    }
  }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
