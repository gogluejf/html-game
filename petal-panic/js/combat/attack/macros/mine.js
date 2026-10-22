// Persistent mine: macro-owned body/clock, rendered through the shared zone hook.
import { defineMacro } from '../defineMacro.js';
import { AttackHandle, invoke } from '../engine.js';
import { isValidTarget } from '../../explosion.js';
import { fireDeclared } from '../../../effects/index.js';
import '../primitives/explosion.js';
import '../primitives/shockwave.js';

export const MINE_DEFAULTS = Object.freeze({
  x: 0, groundY: null, ttl: 4, blinkDuration: 2,
  mineType: 'explosion', team: 'neutral', damage: 40, radius: 70,
});
export const MINE_PARAMS = [
  { key: 'ttl', desc: 'seconds after settling; null = contact only' },
  { key: 'blinkDuration', desc: 'warning seconds before detonation' },
  { key: 'mineType', desc: 'explosion | shockwave' },
  { key: 'team', desc: 'ally targets enemies; foe targets hero; neutral targets both' },
  { key: 'damage', desc: 'payload damage' },
  { key: 'radius', desc: 'payload radius (px)' },
];

export function createMine(p, ctx) {
  const h = new AttackHandle('mine', null, ['blink-transition']);
  h._params = p;
  const box = { x: p.x - 12, y: (p.groundY ?? ctx.groundY ?? 0) - 8, w: 24, h: 8 };
  h.state = { phase: 'idle', elapsed: 0, warningElapsed: 0, armed: false, settled: true, box };
  h.handles = [];
  // A real persistent base, independent of the transparent/red warning layer.
  h.zone = { draw(c) {
    if (h._completed || h._cancelled || h.state.phase === 'payload') return;
    c.save();
    c.fillStyle = '#222b32'; c.fillRect(box.x, box.y, box.w, box.h);
    c.fillStyle = '#879878'; c.fillRect(box.x + 2, box.y + 1, 20, 5);
    c.fillStyle = '#c7d2ac'; c.fillRect(box.x + 3, box.y + 1, 18, 1);
    c.fillStyle = '#e6bf55'; c.fillRect(box.x + 10, box.y + 2, 4, 3);
    c.restore();
  } };
  const candidates = (targets) => [...new Set([...(targets ?? ctx.world?.targets ?? []), ctx.world?.hero, p.target ?? ctx.target].filter(Boolean))];
  h.validTarget = t => isValidTarget({ team: p.team, ctx: { hero: ctx.world?.hero } }, t, ctx.attacker);
  h.checkContact = targets => candidates(targets).some(t => {
    if (!h.validTarget(t)) return false;
    const b = t.worldBox?.() ?? t;
    return box.x < b.x + b.w && box.x + box.w > b.x &&
      box.y < b.y + b.h && box.y + box.h > b.y;
  });
  h.arm = () => {
    if (h.state.phase === 'payload' || h._completed || h._cancelled) return;
    h.state.armed = true;
  };
  const startWarning = () => {
    h.state.phase = 'warning';
    h.warning = fireDeclared({ type: 'blink-transition', params: {
      box, frameA: null, frameB: 'rgba(255,0,0,0.65)', direction: 'forward',
      duration: Math.max(0.001, p.blinkDuration),
      // speed 2, endSpeed 30, acceleration 2: effect defaults, not a second clock.
    } }, h.declaredEffectTypes());
  };
  const detonate = targets => {
    h.state.phase = 'payload'; // latch BEFORE invoking synchronous payload
    h.warning?.complete();
    const valid = candidates(targets).filter(h.validTarget);
    const payload = invoke(p.mineType === 'shockwave' ? 'shockwave' : 'explosion', {
      x: box.x + box.w / 2, y: box.y + box.h / 2,
      radius: p.radius, damage: p.damage, team: p.team, targets: valid,
      // Direct primitive invocation: no telegraph, gap, blink or impact delay.
    }, ctx);
    h.handles.push(payload);
    for (const target of payload._lastResult?.hit ?? []) h._emit('hit', { target, dealt: p.damage });
    h._emit('detonate', { x: box.x + box.w / 2, y: box.y + box.h / 2 });
    if (payload._completed) h._complete();
  };
  h.step = (dt, targets) => {
    if (h._completed || h._cancelled) return true;
    const s = h.state;
    if (s.phase === 'payload') {
      for (const child of h.handles) child.step?.(dt, candidates(targets).filter(h.validTarget));
      if (h.handles.every(child => child._completed || child._cancelled)) h._complete();
      return h._completed;
    }
    if (h.checkContact(targets)) h.arm();
    if (!s.settled) return false;
    if (s.phase === 'idle') {
      s.elapsed += dt;
      if (s.armed || (p.ttl !== null && s.elapsed >= p.ttl)) startWarning();
      else return false;
      if (p.blinkDuration > 0) return false;
    } else s.warningElapsed += dt;
    if (s.warningElapsed >= p.blinkDuration) detonate(targets);
    return h._completed;
  };
  const cancel = h.cancel.bind(h);
  h.cancel = () => { h.warning?.complete(); for (const child of h.handles) child.cancel(); cancel(); };
  return h;
}

defineMacro('mine', {
  attacks: [{ id: 'explosion', role: 'payload' }, { id: 'shockwave', role: 'payload' }],
  params: { ...MINE_DEFAULTS },
  meta: { name: 'Mine', desc: 'Rectangular ground mine: hostile contact or TTL → red blink → payload.',
    effects: [{ type: 'blink-transition', desc: 'transparent to red overlay; base stays visible' }],
    params: [{ key: 'x', desc: 'center x' }, { key: 'groundY', desc: 'surface top y' }, ...MINE_PARAMS] },
  impl: createMine,
});
