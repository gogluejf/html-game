// Thorn SOTA wiring — pure target model + sprite + orientation (plan T5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseSheet } from '../core/spriteData.js';
import { Entity } from '../core/entity.js';
import { Projectile, aimRotation, PROJECTILE_TARGET_H } from '../objects/projectile.js';
import { dirAngle } from '../core/vec.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const peaSheet = JSON.parse(readFileSync(join(HERE, '..', '..', 'assets', 'projectiles', 'pea', 'shoot_sheet.json'), 'utf8'));

test('T4: pea sheet declares playback in DATA (fps 14, mode loop)', () => {
  const data = parseSheet(peaSheet);
  const a = data.anims.shoot;
  assert.equal(a.fps, 14);
  assert.equal(a.mode, 'loop');
  assert.equal(a.frames.length, 8);
  // Square collision box → thorn AABB stays 12×12 at targetH 0.25u.
  assert.ok(a.collisionBox, 'collision box must be authored (§4)');
  assert.equal(a.collisionBox.w, a.collisionBox.h, 'box must be square for the 12px AABB');
});

test('T5: projectile uses pure target model — no hardcoded w/h', () => {
  const p = new Projectile(100, 100, 0, true);
  // h = targetH × 48 exactly (the §4 reference height).
  assert.ok(Math.abs(p.h - PROJECTILE_TARGET_H * 48) < 1e-9, `h=${p.h}`);
  // Width is SHEET-OWNED: collisionBox.w × scale. With the square box this
  // resolves to the same 12px as the legacy AABB (±1 tolerance for drift).
  const data = parseSheet(peaSheet);
  const cb = data.anims.shoot.collisionBox;
  const scale = (PROJECTILE_TARGET_H * 48) / cb.h;
  const expectedW = cb.w * scale;
  assert.ok(Math.abs(p.w - expectedW) < 1, `w=${p.w} want ${expectedW}`);
  assert.ok(Math.abs(p.w - 12) <= 1, `thorn AABB width ~12px, got ${p.w}`);
});

test('T5: constructor aims the nose along velocity for all 8 directions', () => {
  for (let dir = 0; dir < 8; dir++) {
    const p = new Projectile(0, 0, dir, true);
    const vAng = Math.atan2(p.vy, p.vx);
    // Nose direction in world space = rotation + baseSpriteAngle(0) + art-up offset.
    // The art's up-vector rotated by `rotation` must align with velocity.
    const nose = p.rotation + Math.PI / 2; // up-vector (−y) rotated by rotation
    const dot = Math.cos(nose - vAng);
    assert.ok(dot > 0.999, `dir ${dir}: nose·velocity = ${dot}`);
  }
});

test('T5: aimRotation handles free angles (non-8-way shots)', () => {
  for (const ang of [0, Math.PI / 8, Math.PI / 2, -Math.PI / 3, Math.PI]) {
    const vx = Math.cos(ang), vy = Math.sin(ang);
    const rot = aimRotation(vx, vy);
    const nose = rot + Math.PI / 2;
    assert.ok(Math.abs(Math.cos(nose - ang)) > 0.999, `angle ${ang}`);
  }
});

test('T5: pool respawn resets player state (no stale frame/done)', () => {
  const data = parseSheet(peaSheet);
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
  assert.ok(Math.abs(Math.cos(recycled.rotation + Math.PI / 2 - vAng)) > 0.999);
});
