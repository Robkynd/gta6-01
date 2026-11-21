// Neon Bay vehicles: parked cars Rex can steal, plus arcade driving physics.
// A car is a box-and-cylinder model facing local +Z; heading h moves it along
// (sin h, cos h), the same convention as the player and the city grid.

import * as THREE from 'three';

const PARKED_COLORS = [0x2a6fd6, 0xd63a2a, 0xe8b93a, 0x37b268, 0x8a8f96, 0x7a4fd0];
const ENTER_RANGE = 3.2;
const ACCEL = 14; // m/s^2, forward throttle
const MAX_FORWARD = 34; // m/s (~122 km/h)
const MAX_REVERSE = 8; // m/s
const BRAKE_DECEL = 25; // m/s^2, brake pedal and S-while-moving
const ROLL_DECEL = 6; // m/s^2, coasting friction with no input
const STEER_RATE = 1.9; // rad/s at full grip
const CRASH_COOLDOWN = 0.5; // seconds between onCrash reports
const WHEEL_RADIUS = 0.36;

// Move v toward target by at most step; never overshoots.
function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}

// A car facing local +Z: slab body, dark cabin, four cylinder wheels, small
// emissive lamps. Police cars get a black coat and a red/blue light bar.
export function makeCarMesh(color, opts = {}) {
  const group = new THREE.Group();
  const bodyColor = opts.police ? 0x14161a : color;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.55, 4.4),
    new THREE.MeshLambertMaterial({ color: bodyColor }),
  );
  body.position.y = 0.55;
  group.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.5, 2.2),
    new THREE.MeshLambertMaterial({ color: 0x1a2028 }),
  );
  cabin.position.set(0, 1.05, -0.2);
  group.add(cabin);

  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.25, 12);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const frontWheels = [];
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.36, wz);
    group.add(wheel);
    if (wz > 0) frontWheels.push(wheel);
  }

  const headMat = new THREE.MeshLambertMaterial({ color: 0xfff6d8, emissive: 0xfff2b0 });
  const tailMat = new THREE.MeshLambertMaterial({ color: 0x7a1010, emissive: 0xff2a1a });
  for (const side of [-0.6, 0.6]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.06), headMat);
    head.position.set(side, 0.62, 2.21);
    group.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.06), tailMat);
    tail.position.set(side, 0.62, -2.21);
    group.add(tail);
  }

  if (opts.police) {
    const barGeo = new THREE.BoxGeometry(0.55, 0.18, 0.3);
    const red = new THREE.Mesh(
      barGeo,
      new THREE.MeshLambertMaterial({ color: 0x7a1010, emissive: 0xff2020 }),
    );
    red.position.set(-0.45, 1.35, -0.2);
    group.add(red);
    const blue = new THREE.Mesh(
      barGeo,
      new THREE.MeshLambertMaterial({ color: 0x10107a, emissive: 0x2040ff }),
    );
    blue.position.set(0.45, 1.35, -0.2);
    group.add(blue);
  }

  group.userData = { width: 1.9, length: 4.4, frontWheels };
  return group;
}

// Six parked cars on the asphalt near the kerb (offset 4.2 m from a road
// centre, road half-width is 6), spread around the spawn, headings parallel
// to the road they sit on. Roads come from city.roads, so this follows any
// grid the city builder produces.
function pickParkedSpots(city) {
  const r = city.roads;
  return [
    { x: r[3] + 4.2, z: 84, heading: 0 }, // north-south avenue, east kerb
    { x: r[2] - 4.2, z: 36, heading: Math.PI }, // north-south avenue, west kerb
    { x: -36, z: r[4] + 4.2, heading: Math.PI / 2 }, // east-west street
    { x: r[4] - 4.2, z: -12, heading: 0 }, // north-south avenue, west kerb
    { x: 48, z: r[2] - 4.2, heading: -Math.PI / 2 }, // east-west street
    { x: r[1] + 4.2, z: -36, heading: Math.PI }, // north-south avenue, east kerb
  ];
}

export function createVehicles(scene, city, traffic) {
  const parked = [];
  const spots = pickParkedSpots(city);
  for (let i = 0; i < spots.length; i += 1) {
    const spot = spots[i];
    const color = PARKED_COLORS[i % PARKED_COLORS.length];
    const mesh = makeCarMesh(color);
    mesh.position.set(spot.x, 0, spot.z);
    mesh.rotation.y = spot.heading;
    scene.add(mesh);
    parked.push({ mesh, x: spot.x, z: spot.z, heading: spot.heading, color, taken: false });
  }

  let current = null; // { mesh, x, z, heading, speed, color, isPolice, trafficCar }
  let lastCtx = null;
  let crashCooldown = 0;

  // Step into the nearest car within range: a parked car, or a live traffic
  // car (which stops being traffic and becomes the player's). Returns true
  // when Rex gets behind the wheel.
  function tryEnter(playerPos, ctx) {
    if (ctx) lastCtx = ctx;
    const cb = ctx || lastCtx;
    const px = playerPos.x;
    const pz = playerPos.z;
    let best = null;
    let bestDist = ENTER_RANGE;
    for (const car of parked) {
      if (car.taken) continue;
      const d = Math.hypot(car.x - px, car.z - pz);
      if (d < bestDist) {
        bestDist = d;
        best = { kind: 'parked', car };
      }
    }
    if (traffic && typeof traffic.nearestCar === 'function') {
      const tCar = traffic.nearestCar(px, pz, ENTER_RANGE);
      if (tCar) {
        const tx = tCar.x ?? tCar.mesh?.position.x ?? 0;
        const tz = tCar.z ?? tCar.mesh?.position.z ?? 0;
        const d = Math.hypot(tx - px, tz - pz);
        if (d < bestDist) {
          bestDist = d;
          best = { kind: 'traffic', car: tCar };
        }
      }
    }
    if (!best) return false;
    if (best.kind === 'traffic') {
      if (typeof traffic.removeCar === 'function') traffic.removeCar(best.car);
      const mesh = best.car.mesh ?? best.car;
      current = {
        mesh,
        x: best.car.x ?? mesh.position.x,
        z: best.car.z ?? mesh.position.z,
        heading: best.car.heading ?? 0,
        speed: 0,
        color: best.car.color ?? 0x8a8f96,
        isPolice: false,
        trafficCar: true,
      };
    } else {
      best.car.taken = true;
      current = {
        mesh: best.car.mesh,
        x: best.car.x,
        z: best.car.z,
        heading: best.car.heading,
        speed: 0,
        color: best.car.color,
        isPolice: false,
        trafficCar: false,
      };
    }
    if (cb && typeof cb.onSteal === 'function') cb.onSteal(current);
    return true;
  }

  // Step out on the car's right flank; returns where Rex lands.
  function exitCar() {
    if (!current) return null;
    const rightX = Math.cos(current.heading);
    const rightZ = -Math.sin(current.heading);
    const pos = { x: current.x + rightX * 2.5, z: current.z + rightZ * 2.5 };
    current = null;
    if (lastCtx && typeof lastCtx.onExit === 'function') lastCtx.onExit();
    return pos;
  }

  function update(dt, input, ctx) {
    if (ctx) lastCtx = ctx;
    crashCooldown = Math.max(0, crashCooldown - dt);
    if (!current) return; // parked cars sit still; nothing to drive
    const move = input.move();
    const fwd = move.forward;
    const steer = move.strafe; // D / right arrow steers right (heading grows)
    if (input.braking()) {
      current.speed = approach(current.speed, 0, BRAKE_DECEL * dt);
    } else if (fwd > 0) {
      current.speed += ACCEL * dt;
    } else if (fwd < 0) {
      // S brakes while rolling forward, reverses once nearly stopped.
      if (current.speed > 0.5) current.speed -= BRAKE_DECEL * dt;
      else current.speed -= ACCEL * dt;
    } else {
      current.speed = approach(current.speed, 0, ROLL_DECEL * dt);
    }
    current.speed = Math.max(-MAX_REVERSE, Math.min(MAX_FORWARD, current.speed));

    // Steering bites harder the faster the car goes, and flips in reverse.
    const dir = Math.sign(current.speed);
    if (dir !== 0) {
      const grip = Math.min(1, Math.abs(current.speed) / 12);
      current.heading += steer * STEER_RATE * dt * grip * dir;
    }

    let nx = current.x + Math.sin(current.heading) * current.speed * dt;
    let nz = current.z + Math.cos(current.heading) * current.speed * dt;
    const limit = city.half + 8;
    nx = Math.max(-limit, Math.min(limit, nx));
    nz = Math.max(-limit, Math.min(limit, nz));
    if (lastCtx && typeof lastCtx.collide === 'function') {
      const speedBefore = current.speed;
      const fixed = lastCtx.collide(nx, nz, 1.3);
      if (fixed.x !== nx || fixed.z !== nz) {
        if (Math.abs(speedBefore) > 8) {
          current.speed *= 0.4;
          if (crashCooldown <= 0) {
            if (typeof lastCtx.onCrash === 'function') lastCtx.onCrash(Math.abs(speedBefore));
            crashCooldown = CRASH_COOLDOWN;
          }
        }
      }
      nx = fixed.x;
      nz = fixed.z;
    }
    current.x = nx;
    current.z = nz;
    current.mesh.position.set(nx, 0, nz);
    current.mesh.rotation.y = current.heading;
    for (const wheel of current.mesh.userData.frontWheels || []) {
      wheel.rotation.x += (current.speed * dt) / WHEEL_RADIUS;
    }
  }

  return {
    parked,
    get current() { return current; },
    isDriving() { return current !== null; },
    speedKmh() { return current ? Math.abs(current.speed) * 3.6 : 0; },
    tryEnter,
    exitCar,
    update,
  };
}
