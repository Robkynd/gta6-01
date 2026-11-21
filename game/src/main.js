// Neon Bay boot and game loop: builds the renderer and the city, walks the player
// (Rex Marlowe) through it in third person, and paints the HUD and minimap.
// ?shot=city stages a cinematic view of the city for screenshots and sets
// window.__shotReady once it has painted; ?shot=start|play|end map to the same view.

import * as THREE from 'three';
import { buildCity } from './city.js';
import { ACTION_CONFIRM, ACTION_ENTER_CAR, ACTION_PAUSE, createInput } from './input.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const WALK_SPEED = 6; // metres per second on foot
const PLAYER_RADIUS = 0.6;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1337;

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const startScreen = document.getElementById('start-screen');
const startButton = document.getElementById('start-button');
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

const state = {
  screen: 'title', // title | play | paused
  health: 100,
  cash: 0,
  wanted: 0,
  heading: city.spawn.heading, // direction Rex faces, radians around Y
  camYaw: city.spawn.heading + Math.PI, // camera looks back at Rex from behind
  camPitch: 0.32,
  speed: 0,
};

const input = createInput(canvas);

function announce(message) {
  statusEl.textContent = message;
}

function setWanted(level) {
  state.wanted = level;
  let stars = '';
  for (let i = 0; i < 5; i += 1) {
    stars += i < level
      ? '<span>★</span>'
      : '<span class="dim">★</span>';
  }
  wantedEl.innerHTML = stars;
}

function setObjective(text) {
  objectiveEl.textContent = text;
}

function collide(x, z) {
  // Push the player circle out of every building footprint it overlaps.
  for (const box of city.colliders) {
    const nearestX = Math.max(box.minX, Math.min(x, box.maxX));
    const nearestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
    const dx = x - nearestX;
    const dz = z - nearestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < PLAYER_RADIUS * PLAYER_RADIUS) {
      if (distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        x = nearestX + (dx / dist) * PLAYER_RADIUS;
        z = nearestZ + (dz / dist) * PLAYER_RADIUS;
      } else {
        // Dead centre inside a footprint: shove out along the shortest side.
        const pushLeft = x - box.minX;
        const pushRight = box.maxX - x;
        const pushBack = z - box.minZ;
        const pushFront = box.maxZ - z;
        const min = Math.min(pushLeft, pushRight, pushBack, pushFront);
        if (min === pushLeft) x = box.minX - PLAYER_RADIUS;
        else if (min === pushRight) x = box.maxX + PLAYER_RADIUS;
        else if (min === pushBack) z = box.minZ - PLAYER_RADIUS;
        else z = box.maxZ + PLAYER_RADIUS;
      }
    }
  }
  const limit = city.half + 30;
  x = Math.max(-city.half - 6, Math.min(limit, x));
  z = Math.max(-city.half - 6, Math.min(city.half + 6, z));
  return { x, z };
}

function step(dt) {
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

function updateCamera(dt) {
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
  // Rex, as an arrow pointing where he faces.
  const px = toMapX(playerMesh.position.x);
  const pz = toMapZ(playerMesh.position.z);
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
  speedValue.textContent = String(Math.round(state.speed * 3.6));
  speedLabel.textContent = state.speed > 0 ? 'KM/H — ON FOOT' : 'ON FOOT';
  drawMinimap();
}

function stageShot() {
  // Cinematic postcard of Neon Bay: high over the central avenue at sunset, the bay
  // to the east, towers lit, Rex small on the road below.
  startScreen.style.display = 'none';
  state.screen = 'play';
  camera.position.set(-60, 55, 95);
  camera.lookAt(40, 8, -10);
  playerMesh.position.set(0, 1.05, 24);
  setObjective('NEON BAY — the package is hot. Lose the cartel, make the delivery.');
  setWanted(0);
  updateHud();
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  window.__shotReady = true;
}

function startGame() {
  startScreen.style.display = 'none';
  state.screen = 'play';
  setObjective('NEON BAY — explore the city. Find a car and drive.');
  announce('Neon Bay. Walk with WASD, drag the mouse to look around.');
}

function runGame() {
  let accumulator = 0;
  let last = performance.now();

  startButton.addEventListener('click', startGame);

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = input.takeActions();
    if (actions & ACTION_CONFIRM && state.screen === 'title') startGame();
    if (actions & ACTION_PAUSE) {
      if (state.screen === 'play') {
        state.screen = 'paused';
        announce('Paused.');
      } else if (state.screen === 'paused') {
        state.screen = 'play';
        announce('Playing.');
      }
    }
    if (state.screen === 'play') {
      while (accumulator >= STEP) {
        step(STEP);
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

  setWanted(0);
  updateHud(); // Paint the minimap once so it is filled behind the title screen too.
  announce('Neon Bay. Press Start to play.');
  requestAnimationFrame(frame);
}

if (shot) stageShot();
else runGame();
