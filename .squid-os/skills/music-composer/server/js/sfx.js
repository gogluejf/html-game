export function makeSfx(ctx) {
    const master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 1.0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return { ctx, master, noiseBuffer: buf };
  }
