// Neon Bay boot and game loop: builds the renderer and the city, then runs the
// whole open world — Rex Marlowe on foot or behind the wheel, traffic and
// pedestrians on the streets, police chasing the wanted level, chained
// missions, cartel thugs to fight, and a HUD with a minimap.
// ?shot=chase|city|drive|mission stages a scene for screenshots and sets
// window.__shotReady once it has painted; any other ?shot= falls back to city.

import * as THREE from 'three';
import { buildCity } from './city.js';
import {
  ACTION_ATTACK, ACTION_CONFIRM, ACTION_ENTER_CAR, ACTION_PAUSE, createInput,
} from './input.js';
import { createTraffic } from './traffic.js';
import { createPedestrians } from './pedestrians.js';
import { createVehicles } from './vehicles.js';
import { createPolice } from './police.js';
import { createMissions } from './missions.js';
import { createCombat } from './combat.js';
import { createAudio } from './audio.js';
import { createSave } from './save.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const WALK_SPEED = 6; // metres per second on foot
const PLAYER_RADIUS = 0.6;
const SAVE_EVERY = 10; // seconds between autosaves

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1337;

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const startScreen = document.getElementById('start-screen');
const startButton = document.getElementById('start-button');
const continueButton = document.getElementById('continue-button');
const healthFill = document.getElementById('hud-health-fill');
const cashEl = document.getElementById('hud-cash');
const wantedEl = document.getElementById('hud-wanted');
const minimap = document.getElementById('hud-minimap');
const minimapCtx = minimap.getContext('2d');
const objectiveEl = document.getElementById('hud-objective');
const speedValue = document.getElementById('hud-speed-value');
const speedLabel = document.getElementById('hud-speed-label');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 900);

const city = buildCity(scene, seed);

// Rex Marlowe on foot: a capsule in an orange courier jacket with a dark cap.
const playerMat = new THREE.MeshLambertMaterial({ color: 0xff7a1a });
const playerMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.0, 4, 10), playerMat);
playerMesh.position.set(city.spawn.x, 1.05, city.spawn.z);
scene.add(playerMesh);
const capMat = new THREE.MeshLambertMaterial({ color: 0x22242a });
const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), capMat);
cap.position.y = 0.95;
playerMesh.add(cap);

// Every system in the world, each in its own file with one job.
const traffic = createTraffic(scene, city);
const peds = createPedestrians(scene, city);
const vehicles = createVehicles(scene, city, traffic);
const police = createPolice(scene, city, vehicles);
const missions = createMissions(scene, city);
const combat = createCombat(scene, city);
const audio = createAudio();
const save = createSave();

const state = {
  screen: 'title', // title | play | paused
  health: 100,
  cash: 0,
  heading: city.spawn.heading, // direction Rex faces, radians around Y
  camYaw: city.spawn.heading + Math.PI, // camera looks back at Rex from behind
  camPitch: 0.32,
  speed: 0,
};

let worldTime = 0;
let saveTimer = 0;
let lastWanted = -1;
let lastObjective = '';

const input = createInput(canvas);

function announce(message) {
  statusEl.textContent = message;
}

function playerPos() {
  if (vehicles.isDriving()) {
    const car = vehicles.current;
    return { x: car.x, z: car.z };
  }
  return { x: playerMesh.position.x, z: playerMesh.position.z };
}

function currentSpeed() {
  return vehicles.isDriving() ? Math.abs(vehicles.current.speed) : state.speed;
}

function addCash(n) {
  state.cash += n;
}

function setWanted(level) {
  if (level === lastWanted) return;
  lastWanted = level;
  let stars = '';
  for (let i = 0; i < 5; i += 1) {
    stars += i < level
      ? '<span>★</span>'
      : '<span class="dim">★</span>';
  }
  wantedEl.innerHTML = stars;
}

function collide(x, z, radius = PLAYER_RADIUS) {
  // Push a circle out of every building footprint it overlaps.
  for (const box of city.colliders) {
    const nearestX = Math.max(box.minX, Math.min(x, box.maxX));
    const nearestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
    const dx = x - nearestX;
    const dz = z - nearestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < radius * radius) {
      if (distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        x = nearestX + (dx / dist) * radius;
        z = nearestZ + (dz / dist) * radius;
      } else {
        // Dead centre inside a footprint: shove out along the shortest side.
        const pushLeft = x - box.minX;
        const pushRight = box.maxX - x;
        const pushBack = z - box.minZ;
        const pushFront = box.maxZ - z;
        const min = Math.min(pushLeft, pushRight, pushBack, pushFront);
        if (min === pushLeft) x = box.minX - radius;
        else if (min === pushRight) x = box.maxX + radius;
        else if (min === pushBack) z = box.minZ - radius;
        else z = box.maxZ + radius;
      }
    }
  }
  const limit = city.half + 30;
  x = Math.max(-city.half - 6, Math.min(limit, x));
  z = Math.max(-city.half - 6, Math.min(city.half + 6, z));
  return { x, z };
}

function respawn() {
  if (vehicles.isDriving()) vehicles.exitCar();
  state.health = 100;
  police.reset();
  combat.reset();
  playerMesh.visible = true;
  playerMesh.position.set(city.spawn.x, 1.05, city.spawn.z);
  state.heading = city.spawn.heading;
  state.camYaw = city.spawn.heading + Math.PI;
}

function damagePlayer(dmg) {
  if (state.screen !== 'play') return;
  state.health = Math.max(0, state.health - dmg);
  if (state.health <= 0) {
    announce('You got dropped. Woke up back at the start — the package is still yours.');
    audio.busted();
    respawn();
  }
}

function busted() {
  state.cash = Math.max(0, state.cash - 100);
  announce('Busted! The cops took $100 and dumped you back at the start.');
  audio.busted();
  respawn();
}

function autosave() {
  if (state.screen !== 'play') return;
  const pp = playerPos();
  save.save({
    cash: state.cash,
    missionIndex: missions.index,
    x: pp.x,
    z: pp.z,
    health: state.health,
  });
}

// Context objects, rebuilt fresh each step so every system sees live values.
function vehiclesCtx() {
  return {
    state,
    collide: (x, z, r) => collide(x, z, r),
    onSteal: () => {
      police.addWanted(1);
      announce('You stole the car! Wanted up. WASD to drive, Space to brake, E to step out.');
    },
    onCrash: () => { audio.crash(); },
    onExit: () => {},
  };
}

function pedsCtx(pp) {
  const cars = [];
  if (vehicles.isDriving()) {
    cars.push({ mesh: vehicles.current.mesh, speed: Math.abs(vehicles.current.speed) });
  }
  return {
    time: worldTime,
    player: pp,
    playerSpeed: currentSpeed(),
    inCar: vehicles.isDriving(),
    cars,
    onPedHit: () => {
      police.addWanted(1);
      announce('You hit a pedestrian! Wanted up.');
    },
  };
}

function policeCtx(pp) {
  return {
    time: worldTime,
    player: pp,
    inCar: vehicles.isDriving(),
    playerSpeed: currentSpeed(),
    onCopHit: () => damagePlayer(10),
    onCaught: () => busted(),
    siren: (on) => audio.siren(on),
  };
}

function missionCtx(pp) {
  return {
    player: pp,
    wanted: police.wanted,
    addWanted: (n) => police.addWanted(n),
    onComplete: (m) => {
      addCash(m.reward);
      audio.pickup();
      announce(`${m.title} complete — $${m.reward}.`);
      autosave();
    },
    onPickup: (m) => {
      announce('Package picked up — now drop it at the south garage. Watch out for the cartel.');
      combat.spawnThugs(m.pickup.x, m.pickup.z, 3);
    },
    onAllComplete: () => {
      announce('NEON BAY — package delivered. The city is yours now.');
    },
  };
}

function combatCtx(pp) {
  return {
    player: { x: pp.x, z: pp.z, heading: state.heading },
    inCar: vehicles.isDriving(),
    cops: police.cops,
    onPlayerHit: (dmg) => damagePlayer(dmg),
    addCash: (n) => addCash(n),
    audio,
    onCopShot: () => police.addWanted(1),
  };
}

function stepOnFoot(dt) {
  const drag = input.takeDrag();
  state.camYaw -= drag.x * 0.005;
  state.camPitch = Math.max(0.05, Math.min(1.1, state.camPitch + drag.y * 0.004));

  const move = input.move();
  const forwardX = Math.sin(state.camYaw);
  const forwardZ = Math.cos(state.camYaw);
  const rightX = Math.cos(state.camYaw);
  const rightZ = -Math.sin(state.camYaw);
  let mx = forwardX * move.forward + rightX * move.strafe;
  let mz = forwardZ * move.forward + rightZ * move.strafe;
  const len = Math.hypot(mx, mz);
  if (len > 0) {
    mx /= len;
    mz /= len;
    const pos = collide(
      playerMesh.position.x + mx * WALK_SPEED * dt,
      playerMesh.position.z + mz * WALK_SPEED * dt,
    );
    playerMesh.position.x = pos.x;
    playerMesh.position.z = pos.z;
    state.speed = WALK_SPEED;
    // Turn Rex to face where he walks, smoothly.
    const target = Math.atan2(mx, mz);
    let diff = target - state.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    state.heading += diff * Math.min(1, dt * 12);
  } else {
    state.speed = 0;
  }
  playerMesh.rotation.y = state.heading;
}

// One fixed step of the whole world — used by the live loop and by shot staging.
function stepWorld(dt) {
  worldTime += dt;
  const pp = playerPos();
  if (vehicles.isDriving()) {
    vehicles.update(dt, input, vehiclesCtx());
    const car = vehicles.current;
    state.heading = car.heading;
    state.camYaw = car.heading;
    state.speed = car.speed;
    playerMesh.position.set(car.x, 1.05, car.z);
  } else {
    stepOnFoot(dt);
  }
  traffic.update(dt, { time: worldTime, player: playerPos() });
  peds.update(dt, pedsCtx(playerPos()));
  police.update(dt, policeCtx(playerPos()));
  missions.update(dt, missionCtx(playerPos()));
  combat.update(dt, combatCtx(playerPos()));
  audio.engine(vehicles.isDriving()
    ? Math.abs(state.speed) / 34
    : (state.speed > 0 ? 0.25 : 0));
  saveTimer += dt;
  if (saveTimer >= SAVE_EVERY) {
    saveTimer = 0;
    autosave();
  }
}

function updateCamera(dt) {
  if (vehicles.isDriving()) {
    // Chase camera: low behind the car, looking ahead down the road.
    const car = vehicles.current;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const target = new THREE.Vector3(car.x + fx * 6, 1.6, car.z + fz * 6);
    const desired = new THREE.Vector3(car.x - fx * 11, 4.6, car.z - fz * 11);
    camera.position.lerp(desired, Math.min(1, dt * 6));
    camera.lookAt(target);
    return;
  }
  const target = new THREE.Vector3(
    playerMesh.position.x,
    playerMesh.position.y + 1.4,
    playerMesh.position.z,
  );
  const distance = 9;
  const height = Math.sin(state.camPitch) * distance;
  const flat = Math.cos(state.camPitch) * distance;
  const desired = new THREE.Vector3(
    target.x - Math.sin(state.camYaw) * flat,
    target.y + height,
    target.z - Math.cos(state.camYaw) * flat,
  );
  camera.position.lerp(desired, Math.min(1, dt * 8));
  camera.lookAt(target);
}

function drawMinimap() {
  const size = 180;
  const worldMinX = -city.half - 10;
  const worldMaxX = city.half + 160;
  const worldMinZ = -city.half - 10;
  const worldMaxZ = city.half + 10;
  const scaleX = size / (worldMaxX - worldMinX);
  const scaleZ = size / (worldMaxZ - worldMinZ);
  const toMapX = (x) => (x - worldMinX) * scaleX;
  const toMapZ = (z) => (z - worldMinZ) * scaleZ;

  minimapCtx.fillStyle = 'rgba(20, 24, 30, 0.9)';
  minimapCtx.fillRect(0, 0, size, size);
  // The bay, east.
  minimapCtx.fillStyle = '#1a6f8e';
  minimapCtx.fillRect(toMapX(city.half + 26), 0, size - toMapX(city.half + 26), size);
  // Roads.
  minimapCtx.strokeStyle = '#5a5f68';
  minimapCtx.lineWidth = 3;
  for (const c of city.roads) {
    minimapCtx.beginPath();
    minimapCtx.moveTo(toMapX(c), 0);
    minimapCtx.lineTo(toMapX(c), size);
    minimapCtx.stroke();
    minimapCtx.beginPath();
    minimapCtx.moveTo(0, toMapZ(c));
    minimapCtx.lineTo(size, toMapZ(c));
    minimapCtx.stroke();
  }
  // Buildings.
  minimapCtx.fillStyle = '#c9a86a';
  for (const box of city.colliders) {
    minimapCtx.fillRect(
      toMapX(box.minX), toMapZ(box.minZ),
      (box.maxX - box.minX) * scaleX, (box.maxZ - box.minZ) * scaleZ,
    );
  }
  // Mission target, a yellow diamond.
  const target = missions.getTarget();
  if (target) {
    const tx = toMapX(target.x);
    const tz = toMapZ(target.z);
    minimapCtx.fillStyle = '#ffd23e';
    minimapCtx.beginPath();
    minimapCtx.moveTo(tx, tz - 6);
    minimapCtx.lineTo(tx + 6, tz);
    minimapCtx.lineTo(tx, tz + 6);
    minimapCtx.lineTo(tx - 6, tz);
    minimapCtx.closePath();
    minimapCtx.fill();
  }
  // Police, blue dots.
  minimapCtx.fillStyle = '#4d8dff';
  for (const cop of police.cops) {
    minimapCtx.beginPath();
    minimapCtx.arc(toMapX(cop.x), toMapZ(cop.z), 3, 0, Math.PI * 2);
    minimapCtx.fill();
  }
  // Rex (or his car), as an arrow pointing where he faces.
  const pp = playerPos();
  const px = toMapX(pp.x);
  const pz = toMapZ(pp.z);
  minimapCtx.save();
  minimapCtx.translate(px, pz);
  minimapCtx.rotate(Math.atan2(Math.sin(state.heading), Math.cos(state.heading)) + Math.PI / 2);
  minimapCtx.fillStyle = '#ff7a1a';
  minimapCtx.beginPath();
  minimapCtx.moveTo(0, -7);
  minimapCtx.lineTo(5, 6);
  minimapCtx.lineTo(-5, 6);
  minimapCtx.closePath();
  minimapCtx.fill();
  minimapCtx.restore();
}

function updateHud() {
  healthFill.style.width = `${state.health}%`;
  cashEl.textContent = `$ ${state.cash.toLocaleString('en-US')}`;
  setWanted(police.wanted);
  if (vehicles.isDriving()) {
    speedValue.textContent = String(Math.round(vehicles.speedKmh()));
    speedLabel.textContent = 'KM/H — DRIVING';
  } else {
    speedValue.textContent = String(Math.round(state.speed * 3.6));
    speedLabel.textContent = state.speed > 0 ? 'KM/H — ON FOOT' : 'ON FOOT';
  }
  const obj = missions.isComplete()
    ? 'NEON BAY — package delivered. Free roam the city.'
    : missions.current
      ? `${missions.current.title} — ${missions.current.text}`
      : 'NEON BAY — explore the city. Find a car and drive.';
  if (obj !== lastObjective) {
    lastObjective = obj;
    objectiveEl.textContent = obj;
  }
  drawMinimap();
}

// ---- Shot staging: put the world in a posed state, let it run a couple of
// seconds so traffic, pedestrians and police settle, then render it. ----
function stagingVehiclesCtx() {
  return {
    state,
    collide: (x, z, r) => collide(x, z, r),
    onSteal: () => {},
    onCrash: () => {},
    onExit: () => {},
  };
}

function simulate(seconds, drive) {
  const steps = Math.round(seconds * 60);
  const fakeInput = {
    move: () => ({ forward: drive ? 1 : 0, strafe: 0 }),
    braking: () => false,
  };
  for (let i = 0; i < steps; i += 1) {
    worldTime += STEP;
    if (vehicles.isDriving()) {
      vehicles.update(STEP, fakeInput, stagingVehiclesCtx());
      const car = vehicles.current;
      state.heading = car.heading;
      state.camYaw = car.heading;
      state.speed = car.speed;
      playerMesh.position.set(car.x, 1.05, car.z);
    }
    const pp = playerPos();
    traffic.update(STEP, { time: worldTime, player: pp });
    peds.update(STEP, {
      time: worldTime, player: pp, playerSpeed: currentSpeed(),
      inCar: vehicles.isDriving(), cars: [], onPedHit: () => {},
    });
    police.update(STEP, {
      time: worldTime, player: playerPos(), inCar: vehicles.isDriving(),
      playerSpeed: currentSpeed(), onCopHit: () => {}, onCaught: () => {},
      siren: () => {},
    });
    missions.update(STEP, {
      player: playerPos(), wanted: police.wanted,
      addWanted: (n) => police.addWanted(n),
      onComplete: () => {}, onPickup: () => {}, onAllComplete: () => {},
    });
    combat.update(STEP, {
      player: { x: pp.x, z: pp.z, heading: state.heading },
      inCar: vehicles.isDriving(), cops: police.cops,
      onPlayerHit: () => {}, addCash: () => {}, audio, onCopShot: () => {},
    });
  }
}

function placePlayerInCar(x, z, heading, speed) {
  // Teleport Rex next to the first parked car, take it, then move it to the
  // staged spot. Any car works for staging; the theft is silent here.
  const spot = vehicles.parked[0];
  playerMesh.position.set(spot.x + 2, 1.05, spot.z);
  vehicles.tryEnter(playerPos(), stagingVehiclesCtx());
  const car = vehicles.current;
  if (!car) return;
  car.x = x;
  car.z = z;
  car.heading = heading;
  car.speed = speed;
  car.mesh.position.set(x, 0, z);
  car.mesh.rotation.y = heading;
  playerMesh.visible = false;
  state.heading = heading;
  state.camYaw = heading;
  state.speed = speed;
}

function chaseCamera() {
  const car = vehicles.current;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  // Pulled back so the patrol cars between camera and Rex stay in frame.
  camera.position.set(car.x - fx * 16, 5.2, car.z - fz * 16);
  camera.lookAt(car.x + fx * 6, 1.6, car.z + fz * 6);
}

function stageShot() {
  startScreen.style.display = 'none';
  state.screen = 'play';
  missions.start({ addWanted: (n) => police.addWanted(n) });

  if (shot === 'chase') {
    // Cover shot: Rex fleeing down the avenue in a stolen car, wanted 3,
    // two patrol cars tight on his tail, mission objective on the HUD.
    placePlayerInCar(28.2, -60, 0, 22);
    police.setWanted(3);
    simulate(1.5, true);
    const car = vehicles.current;
    if (car) {
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      const rx = Math.cos(car.heading);
      const rz = -Math.sin(car.heading);
      police.cops.slice(0, 2).forEach((cop, i) => {
        const side = i === 0 ? -4 : 4;
        cop.x = car.x - fx * 9 + rx * side;
        cop.z = car.z - fz * 9 + rz * side;
        cop.heading = car.heading;
        cop.mesh.position.set(cop.x, 0, cop.z);
        cop.mesh.rotation.y = cop.heading;
      });
      chaseCamera();
    }
  } else if (shot === 'drive') {
    // Rex driving fast down the central avenue at sunset, traffic ahead.
    placePlayerInCar(-72, 60, Math.PI, 26);
    simulate(1.2, true);
    if (vehicles.current) chaseCamera();
  } else if (shot === 'mission') {
    // On foot near the marina drop, the yellow mission beacon in view.
    // Camera goes BEHIND Rex (camYaw = heading, not heading + PI), so the
    // beacon 11 m ahead of him is in frame instead of behind the camera.
    playerMesh.position.set(100, 1.05, -22);
    state.heading = Math.atan2(108 - 100, -30 - (-22));
    state.camYaw = state.heading;
    state.camPitch = 0.5;
    simulate(2, false);
    updateCamera(1); // snap: one shot-mode call must land the camera, not lerp 13%
  } else {
    // 'city' (and legacy start/play/end): Rex on foot at the central
    // intersection, avenues, traffic and pedestrians all around.
    playerMesh.position.set(24, 1.05, 24);
    state.heading = Math.PI;
    state.camYaw = 0;
    simulate(3, false);
    updateCamera(1); // snap: one shot-mode call must land the camera, not lerp 13%
  }

  updateHud();
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  window.__shotReady = true;
}

function startGame(fromSave) {
  audio.resume();
  audio.click();
  startScreen.style.display = 'none';
  state.screen = 'play';
  if (fromSave) {
    const data = save.load();
    if (data) {
      state.cash = data.cash ?? 0;
      state.health = data.health ?? 100;
      playerMesh.position.set(data.x ?? city.spawn.x, 1.05, data.z ?? city.spawn.z);
      state.heading = city.spawn.heading;
      state.camYaw = city.spawn.heading + Math.PI;
      missions.resumeTo(data.missionIndex ?? 0, { addWanted: (n) => police.addWanted(n) });
      announce('Welcome back, Rex. The job continues.');
    } else {
      missions.start({ addWanted: (n) => police.addWanted(n) });
      announce('Neon Bay. Walk with WASD, drag the mouse to look around.');
    }
  } else {
    missions.start({ addWanted: (n) => police.addWanted(n) });
    announce('Neon Bay. Walk with WASD, drag the mouse to look around.');
  }
  updateHud();
}

function runGame() {
  let accumulator = 0;
  let last = performance.now();

  startButton.addEventListener('click', () => startGame(false));
  if (save.hasSave()) {
    const data = save.load();
    continueButton.style.display = 'inline-block';
    if (data) {
      continueButton.textContent = `CONTINUE — $${data.cash ?? 0} · MISSION ${(data.missionIndex ?? 0) + 1}`;
    }
    continueButton.addEventListener('click', () => startGame(true));
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = input.takeActions();
    if (actions & ACTION_CONFIRM && state.screen === 'title') startGame(false);
    if (actions & ACTION_PAUSE) {
      if (state.screen === 'play') {
        state.screen = 'paused';
        announce('Paused.');
      } else if (state.screen === 'paused') {
        state.screen = 'play';
        announce('Playing.');
      }
    }
    if (actions & ACTION_ENTER_CAR && state.screen === 'play') {
      if (vehicles.isDriving()) {
        const pos = vehicles.exitCar();
        playerMesh.position.set(pos.x, 1.05, pos.z);
        playerMesh.visible = true;
        announce('On foot.');
      } else if (vehicles.tryEnter(playerPos(), vehiclesCtx())) {
        playerMesh.visible = false;
      }
    }
    if (actions & ACTION_ATTACK && state.screen === 'play' && !vehicles.isDriving()) {
      if (!combat.punch()) combat.shoot();
    }
    if (state.screen === 'play') {
      while (accumulator >= STEP) {
        stepWorld(STEP);
        accumulator -= STEP;
      }
      updateCamera(1 / 60);
      updateHud();
      renderer.render(scene, camera);
    } else if (state.screen === 'title') {
      // Idle orbit behind the title screen so the city shows through.
      const t = now / 1000;
      camera.position.set(
        Math.sin(t * 0.05) * 90,
        42,
        Math.cos(t * 0.05) * 90,
      );
      camera.lookAt(0, 6, 0);
      renderer.render(scene, camera);
    } else {
      accumulator = 0;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.screen === 'play') {
      state.screen = 'paused';
      announce('Paused.');
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  updateHud(); // Paint the minimap once so it is filled behind the title screen too.
  announce('Neon Bay. Press Start to play.');
  requestAnimationFrame(frame);
}

if (shot) stageShot();
else runGame();
