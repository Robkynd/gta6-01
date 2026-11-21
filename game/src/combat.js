// Neon Bay combat: Marlin Cartel thugs on foot, plus Rex's punch and pistol.
// Thugs chase Rex on foot, freeze when he is in a car, and pay $25 when dropped.
// Police are handled by the police module — combat only damages them here.

import * as THREE from 'three';

const CHASE_RANGE = 25;
const ATTACK_RANGE = 1.8;
const PUNCH_RANGE = 2.6;
const SHOOT_RANGE = 34;
const THUG_SPEED = 3.5;
const THUG_HP = 100;
const PUNCH_DMG = 25;
const SHOT_DMG = 34;
const HIT_DOT = 0.94; // target must be almost straight ahead to be shot

function makeThugMesh() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x6e1423 }); // dark cartel red
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.9, 4, 10), bodyMat);
  body.position.y = 1.0;
  group.add(body);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), headMat);
  head.position.y = 1.95;
  group.add(head);
  return group;
}

export function createCombat(scene, city) {
  const enemies = [];
  let lastCtx = null;
  let tracer = null;
  let tracerTimer = 0;

  function spawnThugs(x, z, n) {
    for (let i = 0; i < n; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1 + Math.random() * 4;
      const mesh = makeThugMesh();
      const ex = x + Math.cos(angle) * radius;
      const ez = z + Math.sin(angle) * radius;
      mesh.position.set(ex, 0, ez);
      scene.add(mesh);
      enemies.push({ mesh, x: ex, z: ez, hp: THUG_HP, state: 'chase', attackCooldown: 0, fallTimer: 0, paid: false });
    }
  }

  function clearTracer() {
    if (!tracer) return;
    scene.remove(tracer);
    tracer.geometry.dispose();
    tracer.material.dispose();
    tracer = null;
  }

  function dropTracer(from, to) {
    clearTracer();
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const material = new THREE.LineBasicMaterial({ color: 0xffe14d });
    tracer = new THREE.Line(geometry, material);
    scene.add(tracer);
    tracerTimer = 0.08;
  }

  // Shared damage path for thugs and cops. Returns true when the target died.
  function damage(target, amount) {
    target.hp -= amount;
    return target.hp <= 0;
  }

  function knockback(target, px, pz, distance) {
    const dx = target.x - px;
    const dz = target.z - pz;
    const len = Math.hypot(dx, dz) || 1;
    target.x += (dx / len) * distance;
    target.z += (dz / len) * distance;
    if (target.mesh) target.mesh.position.set(target.x, target.mesh.position.y, target.z);
  }

  // Nearest live thug or cop within range of a point.
  function nearestTarget(px, pz, range) {
    let best = null;
    let bestDist = range;
    for (const enemy of enemies) {
      if (enemy.hp <= 0) continue;
      const d = Math.hypot(enemy.x - px, enemy.z - pz);
      if (d < bestDist) { bestDist = d; best = enemy; }
    }
    const cops = (lastCtx && Array.isArray(lastCtx.cops)) ? lastCtx.cops : [];
    for (const cop of cops) {
      if (!cop || cop.hp <= 0 || cop.disabled) continue;
      const d = Math.hypot(cop.x - px, cop.z - pz);
      if (d < bestDist) { bestDist = d; best = cop; }
    }
    return best;
  }

  return {
    enemies,
    spawnThugs,
    update(dt, ctx) {
      if (ctx) lastCtx = ctx;
      if (tracer) {
        tracerTimer -= dt;
        if (tracerTimer <= 0) clearTracer();
      }
      if (!ctx || !ctx.player) return;
      const px = ctx.player.x;
      const pz = ctx.player.z;

      for (let i = enemies.length - 1; i >= 0; i -= 1) {
        const enemy = enemies[i];
        if (enemy.hp <= 0) {
          // Fallen: lie flat, then vanish after 3 seconds. Cash paid once.
          if (!enemy.paid) {
            enemy.paid = true;
            enemy.mesh.rotation.x = Math.PI / 2;
            if (typeof ctx.addCash === 'function') ctx.addCash(25);
          }
          enemy.fallTimer += dt;
          if (enemy.fallTimer >= 3) {
            scene.remove(enemy.mesh);
            enemies.splice(i, 1);
          }
          continue;
        }
        enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
        if (ctx.inCar) continue; // thugs will not take on a car — they hold still
        const dx = px - enemy.x;
        const dz = pz - enemy.z;
        const dist = Math.hypot(dx, dz);
        if (dist >= CHASE_RANGE) continue;
        if (dist < ATTACK_RANGE) {
          if (enemy.attackCooldown <= 0) {
            enemy.attackCooldown = 1;
            if (typeof ctx.onPlayerHit === 'function') ctx.onPlayerHit(6);
          }
          continue;
        }
        const step = (THUG_SPEED * dt) / dist;
        enemy.x += dx * step;
        enemy.z += dz * step;
        enemy.mesh.position.set(enemy.x, 0, enemy.z);
        enemy.mesh.rotation.y = Math.atan2(dx, dz);
      }
    },
    punch() {
      if (!lastCtx || !lastCtx.player) return false;
      const px = lastCtx.player.x;
      const pz = lastCtx.player.z;
      const target = nearestTarget(px, pz, PUNCH_RANGE);
      if (!target) return false;
      damage(target, PUNCH_DMG);
      knockback(target, px, pz, 1.5);
      if (lastCtx.audio && typeof lastCtx.audio.punch === 'function') lastCtx.audio.punch();
      return true;
    },
    shoot() {
      if (!lastCtx || !lastCtx.player) return false;
      const px = lastCtx.player.x;
      const pz = lastCtx.player.z;
      const heading = lastCtx.player.heading || 0;
      const dirX = Math.sin(heading);
      const dirZ = Math.cos(heading);
      let best = null;
      let bestDist = SHOOT_RANGE;
      const consider = (target) => {
        if (!target || target.hp <= 0 || target.disabled) return;
        const dx = target.x - px;
        const dz = target.z - pz;
        const dist = Math.hypot(dx, dz);
        if (dist > SHOOT_RANGE || dist < 0.001) return;
        const dot = (dx / dist) * dirX + (dz / dist) * dirZ;
        if (dot > HIT_DOT && dist < bestDist) { bestDist = dist; best = target; }
      };
      for (const enemy of enemies) consider(enemy);
      const cops = Array.isArray(lastCtx.cops) ? lastCtx.cops : [];
      for (const cop of cops) consider(cop);
      if (lastCtx.audio && typeof lastCtx.audio.shoot === 'function') lastCtx.audio.shoot();
      if (!best) return false;
      const isCop = !enemies.includes(best);
      damage(best, SHOT_DMG);
      if (isCop && typeof lastCtx.onCopShot === 'function') lastCtx.onCopShot();
      const from = new THREE.Vector3(px, 1.4, pz);
      const to = new THREE.Vector3(best.x, 1.2, best.z);
      dropTracer(from, to);
      return true;
    },
    reset() {
      for (const enemy of enemies) scene.remove(enemy.mesh);
      enemies.length = 0;
      clearTracer();
      lastCtx = null;
    },
  };
}
