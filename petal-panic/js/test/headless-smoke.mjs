// Headless smoke: drive the real update() loop with a stubbed canvas and watch
// coin TTL expiry, bomb fuse explosion, and enemy death despawn.
const noop = () => {};
const ctxStub = new Proxy({}, {
  get: (_t, prop) => {
    if (prop === 'measureText') return () => ({ width: 10 });
    if (prop === 'createLinearGradient' || prop === 'createRadialGradient')
      return () => ({ addColorStop: noop });
    if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    return noop;
  },
  set: () => true,
});
globalThis.document = {
  getElementById: () => ({ getContext: () => ctxStub, width: 960, height: 540 }),
  createElement: () => ({ style: {}, getContext: () => ctxStub, width: 0, height: 0 }),
  addEventListener: noop,
};
globalThis.window = { devicePixelRatio: 1, innerWidth: 960, innerHeight: 540, addEventListener: noop };
globalThis.requestAnimationFrame = noop;

const { update, getCoins, getRealEnemies } = await import('../systems/update.js');
const { coins } = await import('../coin.js');
const { tryTransition, S } = await import('../state.js');
tryTransition(S.PLAY); // enter PLAY so update() runs physics (HOME returns early)

const DT = 1 / 60;
function step(n) { for (let i = 0; i < n; i++) update(DT); }

const before = coins.count;
coins.dropCoins({ min: 4, max: 6, chance: 1.0, types: { bronze: 0.7, silver: 0.25, gold: 0.05 } }, 300, 100);
console.log('coins after burst:', coins.count, '(was', before + ')');
step(60 * 10); // 10s — past COIN_TTL(8)
console.log('coins after 10s:', coins.count, '(expect ~' + before + ' if TTL works)');

const enemies = getRealEnemies();
console.log('live real enemies:', enemies.filter(e => e.alive).length);

// --- Bomb special: spawn, watch it explode on fuse expiry --------------------
const { specialPool } = await import('../projectile.js');
const bomb = specialPool.spawn(400, 100, 2, 'bomb'); // dir 2 = down-ish
console.log('\nbomb spawned:', !!bomb, 'alive:', bomb?.alive, 'ttl:', bomb?.ttl?.toFixed(2));
step(60 * 2); // 2s > BOMB_FUSE(1.5)
console.log('bomb after 2s — exploded flag:', bomb?.exploded, 'alive:', bomb?.alive);

// --- Enemy death: kill one, confirm it despawns (removed from world) ---------
const live = enemies.filter(e => e.alive && e.hp != null);
if (live.length) {
  const victim = live[0];
  const startCount = enemies.filter(e => e.alive).length;
  victim.hp = 0;
  if (typeof victim.die === 'function') victim.die(); else victim.aiState = 'dead';
  step(60 * 2); // 2s > deathDuration(0.6)
  const endCount = enemies.filter(e => e.alive).length;
  console.log('\nenemy death despawn: before=' + startCount + ' after=' + endCount + ' (expect -1)');
}

console.log('\nSMOKE DONE');
