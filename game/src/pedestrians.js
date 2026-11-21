// Neon Bay pedestrians: locals strolling the sidewalks, turning at random
// intersections, scattering when a car (or Rex) bears down on them — and
// occasionally ending up flat on the asphalt when a car does not stop in time.

import * as THREE from 'three';

const PED_COUNT = 12;
const SIDEWALK = 7.25; // sidewalk centre offset from the road centre line
const WALK_MIN = 1;
const WALK_MAX = 2;
const FLEE_SPEED = 5;
const FLEE_CAR_DIST = 9; // flee a player-driven car inside this range
const FLEE_FOOT_DIST = 3; // flee Rex on foot inside this range
const HIT_DIST = 1.6; // a moving car closer than this knocks a ped down
const HIT_SPEED = 3; // only cars moving faster than this can knock a ped down
const DOWN_TIME = 4; // seconds a downed ped stays on the ground
const TURN_CHANCE = 0.6; // per second, chance to turn at an intersection

const SHIRTS = [0xe8e8e8, 0x2a6fd6, 0xd63a2a, 0x37b268, 0xe8b93a, 0x9a5fd0, 0x37c2c2];
const SKINS = [0xe8b88a, 0xc98d5f, 0x8a5a3b, 0xf0c8a0];

function headingFor(axis, dir) {
  if (axis === 'z') return dir === 1 ? 0 : Math.PI;
  return dir === 1 ? Math.PI / 2 : -Math.PI / 2;
}

export function createPedestrians(scene, city) {
  const peds = [];
  const roads = city.roads;
  const half = city.half;

  function randomSidewalkSpot() {
    const axis = Math.random() < 0.5 ? 'z' : 'x';
    const road = roads[Math.floor(Math.random() * roads.length)];
    const side = Math.random() < 0.5 ? 1 : -1;
    return {
      axis,
      line: road + side * SIDEWALK,
      pos: -half + Math.random() * half * 2,
      dir: Math.random() < 0.5 ? 1 : -1,
    };
  }

  function makePedMesh() {
    const group = new THREE.Group();
    const shirt = SHIRTS[Math.floor(Math.random() * SHIRTS.length)];
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.6, 4, 8),
      new THREE.MeshLambertMaterial({ color: shirt }),
    );
    body.position.y = 0.85;
    group.add(body);
    const skin = SKINS[Math.floor(Math.random() * SKINS.length)];
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.21, 10, 8),
      new THREE.MeshLambertMaterial({ color: skin }),
    );
    head.position.y = 1.5;
    group.add(head);
    return group;
  }

  function placePed(ped, spot) {
    ped.axis = spot.axis;
    ped.line = spot.line;
    ped.pos = spot.pos;
    ped.dir = spot.dir;
    ped.speed = WALK_MIN + Math.random() * (WALK_MAX - WALK_MIN);
    ped.state = 'walk';
    ped.downTimer = 0;
    ped.fleeing = false;
    ped.mesh.rotation.set(0, headingFor(ped.axis, ped.dir), 0);
    syncPosition(ped);
  }

  function syncPosition(ped) {
    if (ped.axis === 'z') ped.mesh.position.set(ped.line, 0, ped.pos);
    else ped.mesh.position.set(ped.pos, 0, ped.line);
  }

  for (let i = 0; i < PED_COUNT; i += 1) {
    const mesh = makePedMesh();
    scene.add(mesh);
    const ped = { mesh };
    placePed(ped, randomSidewalkSpot());
    peds.push(ped);
  }

  // Nearest road centre to a coordinate along one axis.
  function nearestRoad(value) {
    let best = roads[0];
    for (const c of roads) if (Math.abs(c - value) < Math.abs(best - value)) best = c;
    return best;
  }

  // At an intersection, turn onto a crossing sidewalk line.
  function maybeTurn(ped, dt) {
    if (Math.abs(ped.pos - nearestRoad(ped.pos)) > 1.5) return;
    if (Math.random() > TURN_CHANCE * dt) return;
    const crossing = nearestRoad(ped.pos);
    const side = Math.random() < 0.5 ? 1 : -1;
    const currentLine = ped.line; // where the ped stands on the new axis
    ped.axis = ped.axis === 'z' ? 'x' : 'z';
    ped.line = crossing + side * SIDEWALK;
    ped.pos = currentLine;
    ped.dir = Math.random() < 0.5 ? 1 : -1;
    ped.mesh.rotation.y = headingFor(ped.axis, ped.dir);
  }

  // After fleeing off the sidewalk, snap back to the nearest sidewalk line.
  function resnap(ped) {
    const x = ped.mesh.position.x;
    const z = ped.mesh.position.z;
    const lineZ = nearestRoad(x) + (x - nearestRoad(x) >= 0 ? 1 : -1) * SIDEWALK;
    const lineX = nearestRoad(z) + (z - nearestRoad(z) >= 0 ? 1 : -1) * SIDEWALK;
    if (Math.abs(x - lineZ) <= Math.abs(z - lineX)) {
      ped.axis = 'z';
      ped.line = lineZ;
      ped.pos = z;
    } else {
      ped.axis = 'x';
      ped.line = lineX;
      ped.pos = x;
    }
    ped.dir = Math.random() < 0.5 ? 1 : -1;
    ped.mesh.rotation.y = headingFor(ped.axis, ped.dir);
    syncPosition(ped);
  }

  function update(dt, ctx) {
    const px = ctx.player.x;
    const pz = ctx.player.z;
    for (const ped of peds) {
      if (ped.state === 'down') {
        ped.downTimer -= dt;
        if (ped.downTimer <= 0) placePed(ped, randomSidewalkSpot());
        continue;
      }

      const dx = ped.mesh.position.x - px;
      const dz = ped.mesh.position.z - pz;
      const distToPlayer = Math.hypot(dx, dz);
      const threat = (ctx.inCar && distToPlayer < FLEE_CAR_DIST)
        || (!ctx.inCar && distToPlayer < FLEE_FOOT_DIST);

      if (threat) {
        // Run straight away from the player.
        ped.fleeing = true;
        const len = distToPlayer || 1;
        ped.mesh.position.x += (dx / len) * FLEE_SPEED * dt;
        ped.mesh.position.z += (dz / len) * FLEE_SPEED * dt;
        ped.mesh.rotation.y = Math.atan2(dx, dz);
        continue;
      }
      if (ped.fleeing) {
        ped.fleeing = false;
        resnap(ped);
      }

      // Walk the sidewalk, turning at intersections, wrapping at the edge.
      ped.pos += ped.dir * ped.speed * dt;
      if (Math.abs(ped.pos) > half + 6) ped.pos = -Math.sign(ped.pos) * (half + 6);
      maybeTurn(ped, dt);
      syncPosition(ped);
      ped.mesh.rotation.y = headingFor(ped.axis, ped.dir);

      // Hit by a moving car?
      if (ctx.cars) {
        for (const car of ctx.cars) {
          const speed = car.speedNow ?? car.speed ?? 0;
          if (speed <= HIT_SPEED) continue;
          const cdx = car.mesh.position.x - ped.mesh.position.x;
          const cdz = car.mesh.position.z - ped.mesh.position.z;
          if (Math.hypot(cdx, cdz) < HIT_DIST) {
            ped.state = 'down';
            ped.downTimer = DOWN_TIME;
            ped.mesh.rotation.x = Math.PI / 2;
            if (typeof ctx.onPedHit === 'function') ctx.onPedHit(ped);
            break;
          }
        }
      }
    }
  }

  function nearestPed(x, z, maxDist) {
    let best = null;
    let bestDist = maxDist;
    for (const ped of peds) {
      if (ped.state !== 'walk') continue;
      const dx = ped.mesh.position.x - x;
      const dz = ped.mesh.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d < bestDist) {
        bestDist = d;
        best = ped;
      }
    }
    return best;
  }

  return { peds, update, nearestPed };
}
