// Neon Bay traffic: AI cars cruising the avenue grid, obeying the lights and
// each other. A car owns one road line, one axis and one direction; it wraps
// around the far edge of the city instead of turning around.

import * as THREE from 'three';
import { makeCarMesh } from './vehicles.js';

const PALETTE = [0x2a6fd6, 0xd63a2a, 0xe8b93a, 0x37b268, 0x8a8f96, 0x7a4fd0];
const CAR_COUNT = 10;
const LANE_OFFSET = 2.5; // right-hand lane offset from the road centre
const WRAP = 6; // metres past the city edge before wrapping
const STOP_AT_LIGHT = 10; // stop if an intersection is closer than this
const FOLLOW_GAP = 7; // stop if a car ahead on the same lane is closer
const LIGHT_PERIOD = 6; // seconds per light phase

function headingFor(axis, dir) {
  if (axis === 'z') return dir === 1 ? 0 : Math.PI;
  return dir === 1 ? Math.PI / 2 : -Math.PI / 2;
}

// Coordinate along the car's travel axis (x for east-west roads, z for north-south).
function along(car) {
  return car.axis === 'z' ? car.mesh.position.z : car.mesh.position.x;
}

function setAlong(car, value) {
  if (car.axis === 'z') car.mesh.position.z = value;
  else car.mesh.position.x = value;
}

export function createTraffic(scene, city) {
  const cars = [];
  const roads = city.roads;
  const half = city.half;

  for (let i = 0; i < CAR_COUNT; i += 1) {
    const axis = i % 2 === 0 ? 'z' : 'x';
    const road = roads[Math.floor(Math.random() * roads.length)];
    const dir = Math.random() < 0.5 ? 1 : -1;
    const speed = 8 + Math.random() * 4;
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const mesh = makeCarMesh(color);
    mesh.rotation.y = headingFor(axis, dir);
    // Start scattered along the road so cars do not bunch up at spawn.
    const start = -half + ((i * 37 + Math.random() * 20) % (half * 2));
    if (axis === 'z') {
      mesh.position.set(road + dir * LANE_OFFSET, 0, start);
    } else {
      mesh.position.set(start, 0, road - dir * LANE_OFFSET);
    }
    scene.add(mesh);
    cars.push({ mesh, axis, road, dir, speed, heading: mesh.rotation.y });
  }

  // Distance to the nearest intersection ahead of this car, or Infinity.
  function distanceToIntersection(car) {
    const pos = along(car);
    let best = Infinity;
    for (const c of roads) {
      const ahead = (c - pos) * car.dir;
      if (ahead > 0 && ahead < best) best = ahead;
    }
    return best;
  }

  // True when a car on the same lane ahead of this one is within FOLLOW_GAP.
  function blockedByCarAhead(car) {
    const pos = along(car);
    for (const other of cars) {
      if (other === car) continue;
      if (other.axis !== car.axis || other.road !== car.road || other.dir !== car.dir) continue;
      const gap = (along(other) - pos) * car.dir;
      if (gap > 0 && gap < FOLLOW_GAP) return true;
    }
    return false;
  }

  function update(dt, ctx) {
    // One global light phase: z-axis roads get green for one period, then x-axis.
    const zGreen = Math.floor(ctx.time / LIGHT_PERIOD) % 2 === 0;
    const greenAxis = zGreen ? 'z' : 'x';
    for (const car of cars) {
      let speed = car.speed;
      const redLight = car.axis !== greenAxis && distanceToIntersection(car) < STOP_AT_LIGHT;
      if (redLight || blockedByCarAhead(car)) speed = 0;
      car.speedNow = speed;
      let pos = along(car) + car.dir * speed * dt;
      if (Math.abs(pos) > half + WRAP) pos = -Math.sign(pos) * (half + WRAP);
      setAlong(car, pos);
      car.mesh.rotation.y = car.heading;
      car.mesh.position.y = 0;
    }
  }

  function nearestCar(x, z, maxDist) {
    let best = null;
    let bestDist = maxDist;
    for (const car of cars) {
      const dx = car.mesh.position.x - x;
      const dz = car.mesh.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d < bestDist) {
        bestDist = d;
        best = car;
      }
    }
    return best;
  }

  function removeCar(car) {
    const idx = cars.indexOf(car);
    if (idx === -1) return;
    scene.remove(car.mesh);
    cars.splice(idx, 1);
  }

  return { cars, update, nearestCar, removeCar };
}
