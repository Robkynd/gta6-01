// Neon Bay police: wanted stars spawn patrol cars that chase Rex, ram him on
// foot or in a car, and bust him if they corner him on foot. Wanted decays
// once Rex has been quiet and out of sight for a while.

import * as THREE from 'three';
import { makeCarMesh } from './vehicles.js';

const MAX_COPS = 5;
const CHASE_ACCEL = 10; // m/s^2
const MAX_CHASE_SPEED = 30; // m/s, top speed of a patrol car
const FOOT_CHASE_SPEED = 12; // m/s when Rex is on foot
const TURN_RATE = 2.2; // rad/s, how fast a cop can swing its heading
const RAM_RANGE = 2.8; // metres, cop close enough to hit Rex
const RAM_COOLDOWN = 2; // seconds between hits from one cop
const BUST_RANGE = 2.5; // metres, cop on top of Rex on foot
const BUST_TIME = 2.5; // seconds cornered on foot before the bust
const QUIET_TIME = 8; // seconds since the last crime before heat can cool
const DECAY_INTERVAL = 5; // seconds of quiet + unseen per lost star
const SIGHT_RANGE = 45; // metres, a cop this close keeps the heat on
const DESPAWN_RANGE = 150; // metres, heatless cops this far away give up
const DISABLED_DESPAWN = 5; // seconds before a wrecked cop is towed away

// Shortest signed turn from current heading to target, in (-PI, PI].
function angleDiff(target, current) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Move v toward target by at most step; never overshoots.
function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}

// Push a circle out of every building footprint it overlaps. Same idea as
// the player collide in main.js, kept local so this module stands alone.
function pushOutOfBuildings(city, x, z, r) {
  for (const box of city.colliders) {
    const nearestX = Math.max(box.minX, Math.min(x, box.maxX));
    const nearestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
    const dx = x - nearestX;
    const dz = z - nearestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < r * r) {
      if (distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        x = nearestX + (dx / dist) * r;
        z = nearestZ + (dz / dist) * r;
      } else {
        // Dead centre inside a footprint: shove out along the shortest side.
        const pushLeft = x - box.minX;
        const pushRight = box.maxX - x;
        const pushBack = z - box.minZ;
        const pushFront = box.maxZ - z;
        const min = Math.min(pushLeft, pushRight, pushBack, pushFront);
        if (min === pushLeft) x = box.minX - r;
        else if (min === pushRight) x = box.maxX + r;
        else if (min === pushBack) z = box.minZ - r;
        else z = box.maxZ + r;
      }
    }
  }
  return { x, z };
}

export function createPolice(scene, city, vehicles) {
  // `vehicles` is accepted for the coordinator's wiring; patrol cars are
  // built with makeCarMesh imported from './vehicles.js' above.
  void vehicles;
  let wanted = 0;
  const cops = [];
  let lastCrime = -Infinity;
  let lastTime = 0;
  let closeTimer = 0;
  let decayTimer = 0;
  let lastSiren = null;

  function removeCop(index) {
    const [cop] = cops.splice(index, 1);
    if (cop) scene.remove(cop.mesh);
  }

  // Drop a patrol car on a road 60-80 m from the player; fall back to 70 m
  // in a random direction if no road point in that ring is found.
  function spawnCop(px, pz) {
    let x = px;
    let z = pz;
    let placed = false;
    for (let attempt = 0; attempt < 8 && !placed; attempt += 1) {
      const road = city.roads[Math.floor(Math.random() * city.roads.length)];
      const along = (Math.random() * 2 - 1) * (city.half - 10);
      const northSouth = Math.random() < 0.5;
      const cx = northSouth ? road : along;
      const cz = northSouth ? along : road;
      if (Math.hypot(cx - px, cz - pz) >= 60 && Math.hypot(cx - px, cz - pz) <= 80) {
        x = cx;
        z = cz;
        placed = true;
      }
    }
    if (!placed) {
      const a = Math.random() * Math.PI * 2;
      x = Math.max(-city.half, Math.min(city.half, px + Math.sin(a) * 70));
      z = Math.max(-city.half, Math.min(city.half, pz + Math.cos(a) * 70));
    }
    const mesh = makeCarMesh(0x14161a, { police: true });
    mesh.position.set(x, 0, z);
    const heading = Math.atan2(px - x, pz - z);
    mesh.rotation.y = heading;
    scene.add(mesh);
    cops.push({
      mesh, x, z, heading, speed: 0,
      hp: 100, disabled: false, hitCooldown: 0, stuckTimer: 0, despawnTimer: 0,
    });
  }

  function update(dt, ctx) {
    const time = ctx?.time ?? lastTime;
    lastTime = time;
    const player = ctx?.player ?? { x: 0, z: 0 };
    const inCar = !!ctx?.inCar;
    const playerSpeed = ctx?.playerSpeed ?? 0;

    const sirenOn = wanted > 0;
    if (sirenOn !== lastSiren) {
      lastSiren = sirenOn;
      if (ctx && typeof ctx.siren === 'function') ctx.siren(sirenOn);
    }

    // One fresh patrol car per frame until the street matches the heat.
    if (cops.length < wanted) spawnCop(player.x, player.z);

    let nearestCop = Infinity;
    let bustedClose = false;
    for (let i = cops.length - 1; i >= 0; i -= 1) {
      const cop = cops[i];
      const dist = Math.hypot(player.x - cop.x, player.z - cop.z);
      if (dist < nearestCop) nearestCop = dist;

      // A wrecked cop (hp <= 0, set by combat) stops and is towed after 5 s.
      if (cop.hp <= 0 && !cop.disabled) {
        cop.disabled = true;
        cop.despawnTimer = 0;
      }
      // No heat: the patrol breaks off, drives away from Rex, then leaves.
      if (wanted === 0 && !cop.disabled) {
        const awayHeading = Math.atan2(cop.x - player.x, cop.z - player.z);
        const diff = angleDiff(awayHeading, cop.heading);
        cop.heading += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, diff));
        cop.speed = approach(cop.speed, 12, CHASE_ACCEL * dt);
        cop.x += Math.sin(cop.heading) * cop.speed * dt;
        cop.z += Math.cos(cop.heading) * cop.speed * dt;
        const fixed = pushOutOfBuildings(city, cop.x, cop.z, 1.3);
        cop.x = fixed.x;
        cop.z = fixed.z;
        cop.mesh.position.set(cop.x, 0, cop.z);
        cop.mesh.rotation.y = cop.heading;
        cop.giveUpTimer = (cop.giveUpTimer || 0) + dt;
        if (dist > 100 || cop.giveUpTimer > 8) removeCop(i);
        continue;
      }
      if (cop.disabled) {
        cop.speed = approach(cop.speed, 0, CHASE_ACCEL * dt);
        cop.despawnTimer += dt;
        if (cop.despawnTimer >= DISABLED_DESPAWN) {
          removeCop(i);
          continue;
        }
      } else {
        const targetHeading = Math.atan2(player.x - cop.x, player.z - cop.z);
        const diff = angleDiff(targetHeading, cop.heading);
        cop.heading += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, diff));
        const targetSpeed = inCar
          ? Math.min(MAX_CHASE_SPEED, playerSpeed + 4)
          : FOOT_CHASE_SPEED;
        cop.speed = approach(cop.speed, targetSpeed, CHASE_ACCEL * dt);
        cop.x += Math.sin(cop.heading) * cop.speed * dt;
        cop.z += Math.cos(cop.heading) * cop.speed * dt;
        const fixed = pushOutOfBuildings(city, cop.x, cop.z, 1.3);
        cop.x = fixed.x;
        cop.z = fixed.z;
        cop.x = Math.max(-city.half - 8, Math.min(city.half + 8, cop.x));
        cop.z = Math.max(-city.half - 8, Math.min(city.half + 8, cop.z));

        // Ram the player, at most once every 2 s per cop.
        cop.hitCooldown = Math.max(0, cop.hitCooldown - dt);
        if (dist < RAM_RANGE && cop.hitCooldown <= 0) {
          if (ctx && typeof ctx.onCopHit === 'function') ctx.onCopHit();
          cop.hitCooldown = RAM_COOLDOWN;
          cop.speed *= 0.5;
        }
        if (!inCar && dist < BUST_RANGE) bustedClose = true;
      }
      cop.mesh.position.set(cop.x, 0, cop.z);
      cop.mesh.rotation.y = cop.heading;

      // No heat and far away, or surplus cars that drifted off: give up.
      if (dist > DESPAWN_RANGE && (wanted === 0 || cops.length > wanted)) {
        removeCop(i);
      }
    }

    // Busted: cornered on foot by a cop for 2.5 s straight.
    if (!inCar && bustedClose) {
      closeTimer += dt;
      if (closeTimer > BUST_TIME) {
        if (ctx && typeof ctx.onCaught === 'function') ctx.onCaught();
        closeTimer = 0;
      }
    } else {
      closeTimer = 0;
    }

    // Wanted decay: quiet for 8 s and no cop within 45 m, one star per 5 s.
    if (wanted > 0 && time - lastCrime > QUIET_TIME && nearestCop > SIGHT_RANGE) {
      decayTimer += dt;
      if (decayTimer >= DECAY_INTERVAL) {
        wanted = Math.max(0, wanted - 1);
        decayTimer = 0;
      }
    } else {
      decayTimer = 0;
    }
  }

  function setWanted(n) {
    wanted = Math.max(0, Math.min(MAX_COPS, n));
  }

  function addWanted(n) {
    wanted = Math.max(0, Math.min(MAX_COPS, wanted + n));
    lastCrime = lastTime;
  }

  function reset() {
    for (let i = cops.length - 1; i >= 0; i -= 1) removeCop(i);
    wanted = 0;
    closeTimer = 0;
    decayTimer = 0;
    lastSiren = null;
  }

  return {
    cops,
    get wanted() { return wanted; },
    setWanted,
    addWanted,
    update,
    reset,
  };
}
