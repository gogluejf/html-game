// Sound effects using Web Audio API - synthesized sounds (no external files needed)
let audioCtx = null;

function getAudioCtx() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

function playSound(name) {
    const ctx = getAudioCtx();
    if (!ctx) return;

    switch (name) {
        case 'jump': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(400, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
            osc.start();
            osc.stop(ctx.currentTime + 0.15);
            break;
        }
        case 'coin': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(988, ctx.currentTime);
            osc.frequency.setValueAtTime(1319, ctx.currentTime + 0.07);
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
            osc.start();
            osc.stop(ctx.currentTime + 0.2);
            break;
        }
        case 'bump': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(260, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(130, ctx.currentTime + 0.05);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
            osc.start();
            osc.stop(ctx.currentTime + 0.1);
            break;
        }
        case 'powerup': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(523, ctx.currentTime);
            osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1);
            osc.frequency.setValueAtTime(784, ctx.currentTime + 0.2);
            osc.frequency.setValueAtTime(1047, ctx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
            break;
        }
        case 'stomp': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(300, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
            osc.start();
            osc.stop(ctx.currentTime + 0.15);
            break;
        }
        case 'death': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(600, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(200, ctx.currentTime + 0.8);
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.0);
            osc.start();
            osc.stop(ctx.currentTime + 1.0);
            break;
        }
        case 'kick': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(500, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(300, ctx.currentTime + 0.05);
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
            osc.start();
            osc.stop(ctx.currentTime + 0.1);
            break;
        }
        case 'break': {
            const bufferSize = ctx.sampleRate * 0.1;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
            }
            const source = ctx.createBufferSource();
            const gain = ctx.createGain();
            source.buffer = buffer;
            source.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
            source.start();
            break;
        }
        case 'flagpole': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.connect(gain);
            gain.connect(ctx.destination);
            const t = ctx.currentTime;
            osc.frequency.setValueAtTime(660, t);
            osc.frequency.setValueAtTime(880, t + 0.1);
            osc.frequency.setValueAtTime(1100, t + 0.2);
            osc.frequency.setValueAtTime(1320, t + 0.3);
            osc.frequency.setValueAtTime(1540, t + 0.4);
            gain.gain.setValueAtTime(0.12, t);
            gain.gain.linearRampToValueAtTime(0, t + 0.6);
            osc.start(t);
            osc.stop(t + 0.6);
            break;
        }
        case '1up': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.connect(gain);
            gain.connect(ctx.destination);
            const t = ctx.currentTime;
            osc.frequency.setValueAtTime(523, t);
            osc.frequency.setValueAtTime(659, t + 0.08);
            osc.frequency.setValueAtTime(784, t + 0.16);
            osc.frequency.setValueAtTime(1047, t + 0.24);
            osc.frequency.setValueAtTime(784, t + 0.32);
            osc.frequency.setValueAtTime(1047, t + 0.4);
            gain.gain.setValueAtTime(0.12, t);
            gain.gain.linearRampToValueAtTime(0, t + 0.5);
            osc.start(t);
            osc.stop(t + 0.5);
            break;
        }
    }
}
