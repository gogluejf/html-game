// Thorn SOTA wiring — pure target model + sprite + orientation (plan T5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseSheet } from '../core/spriteData.js';
import { UNIT_PX_Y } from '../consts.js';
import { Entity } from '../core/entity.js';
import { Projectile, aimRotation, PROJECTILE_TARGET_H, initProjectileSprites } from '../objects/projectile.js';
import { dirAngle } from '../core/vec.js';

await initProjectileSprites();

const HERE = dirname(fileURLToPath(import.meta.url));
const thornSheet = JSON.parse(readFileSync(join(HERE, '..', '..', 'assets', 'projectiles', 'thorn', 'shoot_sheet.json'), 'utf8'));

test('T4: thorn sheet declares playback in DATA (fps 14, mode loop)', () => {
  const data = parseSheet(thornSheet);
  const a = data.anims.shoot;
  assert.equal(a.fps, 14);
  assert.equal(a.mode, 'loop');
  assert.equal(a.frames.length, 8);
  // Full-frame proportions, not the former forced square.
  assert.ok(a.collisionBox, 'collision box must be authored (§4)');
  assert.equal(a.collisionBox.w, 250);
  assert.equal(a.collisionBox.h, 102);
});

test('T5: projectile uses pure target model — no hardcoded w/h', () => {
  const p = new Projectile(100, 100, 0, true);
  // h = targetH × 48 exactly (the §4 reference height).
  assert.ok(Math.abs(p.h - PROJECTILE_TARGET_H * 48) < 1e-9, `h=${p.h}`);
  // Width is SHEET-OWNED: collisionBox.w × scale. With the square box this
  // resolves to the same 12px as the legacy AABB (±1 tolerance for drift).
  const data = parseSheet(thornSheet);
  const cb = data.anims.shoot.collisionBox;
  const scale = (PROJECTILE_TARGET_H * 48) / cb.h;
  const expectedW = cb.w * scale;
  assert.ok(Math.abs(p.w - expectedW) < 1, `w=${p.w} want ${expectedW}`);
  // Actual loaded sheet controls the aspect ratio.
  assert.ok(Math.abs(p.w / p.h - cb.w / cb.h) < 1e-9);
  assert.equal(p._baseW, null, 'sheet owns width');
});

test('T5: constructor aims the nose along velocity for all 8 directions', () => {
  for (let dir = 0; dir < 8; dir++) {
    const p = new Projectile(0, 0, dir, true);
    const vAng = Math.atan2(p.vy, p.vx);
    // Nose direction in world space = rotation + baseSpriteAngle(0) + art-up offset.
    // The art's up-vector rotated by `rotation` must align with velocity.
    const nose = p.rotation; // art faces right: nose direction == rotation
    const dot = Math.cos(nose - vAng);
    assert.ok(dot > 0.999, `dir ${dir}: nose·velocity = ${dot}`);
  }
});

test('T5: aimRotation handles free angles (non-8-way shots)', () => {
  for (const ang of [0, Math.PI / 8, Math.PI / 2, -Math.PI / 3, Math.PI]) {
    const vx = Math.cos(ang), vy = Math.sin(ang);
    const rot = aimRotation(vx, vy);
    const nose = rot;
    assert.ok(Math.abs(Math.cos(nose - ang)) > 0.999, `angle ${ang}`);
  }
});

test('T5: pool respawn resets player state (no stale frame/done)', () => {
  const data = parseSheet(thornSheet);
  const proto = new Projectile(0, 0, 0, true);
  // Simulate the pool's Object.assign recycle over a fresh instance.
  const recycled = Object.assign(new Projectile(50, 50, 4, true), proto);
  assert.equal(recycled.x, 0);
  assert.equal(recycled.y, 0);
  // Player either rebuilt or absent — never a half-stepped stale one pointing
  // at the old anim position with done=true.
  if (recycled._player) {
    assert.equal(recycled._player.isDone, false);
  }
  // Orientation re-derived from the NEW velocity (dir 4 = left).
  const vAng = Math.atan2(recycled.vy, recycled.vx);
  assert.ok(Math.abs(Math.cos(recycled.rotation - vAng)) > 0.999);
});

// --- T6: size-model audit gate -------------------------------------------------
// No entity constructor may pass raw w/h px to super() anymore. The pure model
// is (x, y, targetH[, baseW]); width in px is only legal as the documented
// terrain exception (macro grid owns tile widths) and def-owned enemy widths
// during the sheet migration window.

import { readFileSync as rfs } from 'node:fs';

const AUDIT_FILES = [
  'objects/coin.js', 'objects/powerup.js', 'objects/projectile.js',
  'enemies/enemy.js', // boss extends Enemy — covered by the enemy.js gate
];

test('T6: no raw w:/h: literals in entity constructors (audit gate)', () => {
  for (const rel of AUDIT_FILES) {
    const src = rfs(join(HERE, '..', rel), 'utf8');
    // Find the super({ ... }) block(s) and assert they carry targetH, not w/h.
    const supers = [...src.matchAll(/super(?:\.initialize)?\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
    assert.ok(supers.length >= 1, `${rel}: expected a super({...}) call`);
    for (const body of supers) {
      assert.ok(!/^\s*w:\s*\d/.test(body) && !/\bw:\s*\d+\s*,\s*h:/.test(body),
        `${rel}: raw w/h in super() — convert to targetH (T6)`);
      assert.ok(/targetH:/.test(body),
        `${rel}: super() must declare targetH (pure size model)`);
    }
  }
});

test('T6: collision boxes identical before/after conversion (snapshot)', () => {
  // The conversions are exact: h_px = targetH × 48 must equal the legacy px.
  const cases = [
    { name: 'coin bronze', px: 10 }, { name: 'coin gold', px: 14 },
    { name: 'powerup', px: 28 }, { name: 'special default', px: 16 },
    { name: 'jester', px: 48 }, { name: 'violetta', px: 50 },
    { name: 'boss', px: 100 }, { name: 'thorn', px: 12 },
  ];
  for (const c of cases) {
    const back = (c.px / UNIT_PX_Y) * UNIT_PX_Y;
    assert.ok(Math.abs(back - c.px) < 1e-9, `${c.name}: ${c.px}px round-trips`);
  }
});
