// Petal Panic — display fonts & marquee text treatments (polish).
// Replaces the old flat `monospace` + black shadowBlur look with a circus-
// marquee identity that matches the painted logo: cream letters, red drop
// bevel, gold glow. Three Google Fonts are loaded in index.html:
//   TITLE  = 'Alfa Slab One'  — chunky slab serif, matches the logo lettering
//   UI     = 'Lilita One'     — round, friendly, legible at small sizes
//   MENACE = 'Pirata One'     — dark blackletter for GAME OVER / boss names
// Canvas can't use CSS @font-face directly, so we wait for document.fonts to
// load before the first frame (see main.js) and set ctx.font with the family
// name here. If a font fails to load we fall back gracefully.

export const FONT_TITLE = "'Alfa Slab One', 'Georgia', serif";
export const FONT_UI    = "'Lilita One', 'Trebuchet MS', sans-serif";
export const FONT_MENACE= "'Pirata One', 'Georgia', serif";

// Palette pulled from the bigtop art + logo.
export const CREAM = '#f6e7c1';
export const GOLD  = '#ffd700';
export const RED   = '#c0392b';
export const PINK  = '#ff6ec7';

/**
 * Wait until the three display fonts are actually available (or give up after
 * ~2.5 s so a blocked network never blocks the game). Resolves true when ready.
 */
export function waitForFonts(timeoutMs = 2500) {
  if (!('fonts' in document)) return Promise.resolve(false);
  const needed = ['16px "Alfa Slab One"', '16px "Lilita One"', '16px "Pirata One"'];
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = () => {
      let ready = true;
      for (const f of needed) if (!document.fonts.check(f)) { ready = false; break; }
      if (ready || performance.now() > deadline) { resolve(ready); return; }
      setTimeout(check, 40);
    };
    // Kick the loads, then poll.
    for (const f of needed) document.fonts.load(f).catch(() => {});
    check();
  });
}

/**
 * Marquee title: cream fill with a stacked red bevel + soft gold glow.
 * Mimics the 3D cream+red+gold lettering on the PETAL PANIC signboard.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x  center x
 * @param {number} y  baseline y
 * @param {number} size px
 * @param {{color?:string, align?:string, font?:string}} [o]
 */
export function drawMarqueeTitle(ctx, text, x, y, size, o = {}) {
  const color = o.color ?? CREAM;
  const font = o.font ?? FONT_TITLE;
  ctx.save();
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${size}px ${font}`;

  // Gold outer glow.
  ctx.shadowColor = 'rgba(255,215,0,0.55)';
  ctx.shadowBlur = size * 0.18;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;

  // Stacked red bevel below the letters (two offset passes = 3D depth).
  const bevel = Math.max(2, size * 0.06);
  ctx.fillStyle = '#7a1f16';
  ctx.fillText(text, x, y + bevel);
  ctx.fillStyle = RED;
  ctx.fillText(text, x, y + bevel * 0.55);

  // Re-draw the top face on top so the bevel only shows underneath.
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);

  // Thin gold edge on the top face.
  ctx.lineWidth = Math.max(1, size * 0.012);
  ctx.strokeStyle = 'rgba(255,215,0,0.45)';
  ctx.strokeText(text, x, y);
  ctx.restore();
}

/**
 * Prompt / menu line: warm gold with a dark-amber drop + subtle glow.
 * Used for PRESS ENTER, menu options, HUD labels.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} size px
 * @param {{color?:string, align?:string, font?:string, blink?:boolean}} [o]
 */
export function drawPrompt(ctx, text, x, y, size, o = {}) {
  const color = o.color ?? GOLD;
  const font = o.font ?? FONT_UI;
  ctx.save();
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${size}px ${font}`;
  if (o.blink !== undefined) ctx.globalAlpha = o.blink ? 1 : 0.35;

  ctx.shadowColor = 'rgba(255,215,0,0.5)';
  ctx.shadowBlur = size * 0.25;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;

  // Dark amber drop for legibility over bright art.
  ctx.fillStyle = 'rgba(60,35,0,0.9)';
  ctx.fillText(text, x, y + Math.max(1.5, size * 0.05));
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * Menace heading: Pirata One, deep red with a cold glow — for GAME OVER and
 * boss-name callouts.
 */
export function drawMenace(ctx, text, x, y, size, o = {}) {
  const color = o.color ?? '#e74c3c';
  ctx.save();
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${size}px ${FONT_MENACE}`;
  ctx.shadowColor = 'rgba(231,76,60,0.6)';
  ctx.shadowBlur = size * 0.22;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(text, x, y + Math.max(2, size * 0.05));
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Draw a rounded rectangle path (does not fill/stroke — caller does). */
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Draw a navigation hint bar in the select-screen keycap style.
 * Each entry is { icons, label } where each icon is { icon, action?, isActive? }.
 * One chip per icon; a chip is highlighted when its own isActive() returns true
 * (per-chip highlight — never the whole entry). Falls back to a legacy
 * string[] icons / entry-level `active` for backward compatibility.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx — center X of the bar
 * @param {number} y — vertical center
 * @param {{icons:(string|{icon:string,isActive?:()=>boolean})[], label:string, active?:boolean}[]} entries
 */
export function drawNavBar(ctx, cx, y, entries) {
  const gap = 8;       // chip-to-chip gap within an entry
  const dotGap = 20;   // space between entries (the "·" separator)
  const wordGap = 6;   // chip-to-word gap
  const chipH = 24;
  const chipPadX = 10; // horizontal padding inside chip

  // Normalize each icon to { text, isActive } so both the new object form and
  // the legacy string form work. Legacy entries fall back to entry.active.
  const norm = entries.map(e => ({
    label: e.label,
    entryActive: !!e.active,
    icons: (e.icons || []).map(ic => typeof ic === 'string'
      ? { text: ic, isActive: () => false }
      : { text: ic.icon, isActive: typeof ic.isActive === 'function' ? ic.isActive : (() => false) }),
  }));

  // Measure total width
  ctx.font = `13px ${FONT_UI}`;
  const wordFont = `bold 14px ${FONT_UI}`;
  let total = 0;
  const metrics = norm.map((e, i) => {
    const chipWidths = e.icons.map(icon => {
      ctx.font = `13px ${FONT_UI}`;
      return ctx.measureText(icon.text).width + chipPadX * 2;
    });
    ctx.font = wordFont;
    const wordW = ctx.measureText(e.label).width;
    const entryW = chipWidths.reduce((a, b) => a + b, 0) + (e.icons.length - 1) * gap + wordGap + wordW;
    total += entryW;
    if (i < norm.length - 1) total += dotGap;
    return { chipWidths, wordW };
  });

  let px = cx - total / 2;
  ctx.save();
  ctx.textBaseline = 'middle';

  for (let i = 0; i < norm.length; i++) {
    const e = norm[i];
    const { chipWidths, wordW } = metrics[i];

    // Draw each icon as its own chip, highlighting it only when ITS trigger fires.
    for (let j = 0; j < e.icons.length; j++) {
      const cw = chipWidths[j];
      const active = e.icons[j].isActive() || e.entryActive;
      ctx.fillStyle = active ? 'rgba(255,215,0,0.22)' : 'rgba(255,255,255,0.07)';
      roundRect(ctx, px, y - chipH / 2, cw, chipH, 6);
      ctx.fill();
      ctx.strokeStyle = active ? GOLD : '#5a5a72';
      ctx.lineWidth = active ? 2 : 1.5;
      roundRect(ctx, px, y - chipH / 2, cw, chipH, 6);
      ctx.stroke();
      ctx.font = `13px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = active ? CREAM : '#9a8f78';
      ctx.fillText(e.icons[j].text, px + cw / 2, y + 1);
      px += cw + gap;
    }
    px -= gap; // remove last gap before word

    // Word (bold)
    ctx.font = wordFont;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#6e6552';
    ctx.fillText(e.label, px + wordGap, y);
    px += wordGap + wordW + dotGap;
  }
  ctx.restore();
}
