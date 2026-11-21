// Neon Bay city builder: a sun-soaked coastal city on a road grid — blocks of towers
// with lit windows, palm-lined avenues, street lamps, and the bay itself to the east.
// Everything is procedural and seeded, so the same seed always builds the same city.
// buildCity returns the colliders (building footprints) the player walks around.

import * as THREE from 'three';

// Deterministic RNG (mulberry32) so the city never changes between visits.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BLOCK = 36; // building block side, metres
const ROAD = 12; // road width, metres
const PITCH = BLOCK + ROAD;
const BLOCKS = 5; // blocks per side
const HALF = (BLOCKS * BLOCK + (BLOCKS + 1) * ROAD) / 2; // city half-extent (126)

// Road centre lines, from the west edge to the east edge.
function roadCenters() {
  const centers = [];
  for (let k = 0; k <= BLOCKS; k += 1) centers.push(-HALF + ROAD / 2 + k * PITCH);
  return centers;
}

function makeSkyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0.0, '#3a2060'); // dusk purple overhead
  gradient.addColorStop(0.45, '#c65a7a'); // pink band
  gradient.addColorStop(0.72, '#ff7a3c'); // sunset orange
  gradient.addColorStop(1.0, '#ffc46b'); // golden horizon
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A facade texture: dark concrete with a grid of warm lit windows.
function makeFacadeTexture(random, litRatio) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3d3a44';
  ctx.fillRect(0, 0, 128, 256);
  const cols = 6;
  const rows = 14;
  const cellW = 128 / cols;
  const cellH = 256 / rows;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const lit = random() < litRatio;
      ctx.fillStyle = lit ? '#ffd27a' : '#232028';
      ctx.fillRect(c * cellW + 4, r * cellH + 4, cellW - 8, cellH - 8);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makePalm(random) {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 5.5, 6), trunkMat);
  trunk.position.y = 2.75;
  trunk.rotation.z = (random() - 0.5) * 0.16;
  group.add(trunk);
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x2f8f4e, side: THREE.DoubleSide });
  for (let i = 0; i < 6; i += 1) {
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.2, 4), frondMat);
    const angle = (i / 6) * Math.PI * 2;
    frond.position.set(Math.cos(angle) * 1.1, 5.6, Math.sin(angle) * 1.1);
    frond.rotation.set(Math.sin(angle) * 1.1, 0, -Math.cos(angle) * 1.1);
    frond.scale.set(1, 1, 0.25);
    group.add(frond);
  }
  return group;
}

function makeLamp() {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x22242a });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 6), poleMat);
  pole.position.y = 3;
  group.add(pole);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), bulbMat);
  bulb.position.y = 6.1;
  group.add(bulb);
  return group;
}

export function buildCity(scene, seed = 1337) {
  const random = mulberry32(seed);
  const colliders = [];

  // Sky, fog and the low western sun.
  scene.background = makeSkyTexture();
  scene.fog = new THREE.Fog(0xe88a4f, 90, 340);
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.7);
  sun.position.set(-140, 55, 60);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xff9a6b, 0x2a2438, 0.95));

  // Ground slab for the whole city, then the bay and its beach to the east.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2 + 260, HALF * 2 + 120),
    new THREE.MeshLambertMaterial({ color: 0x4a4440 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(60, -0.05, 0);
  scene.add(ground);

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(26, HALF * 2 + 120),
    new THREE.MeshLambertMaterial({ color: 0xd9c08a }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(HALF + 13, 0.0, 0);
  scene.add(sand);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(220, HALF * 2 + 120),
    new THREE.MeshLambertMaterial({ color: 0x1a6f8e }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(HALF + 136, -0.3, 0);
  scene.add(water);

  // Roads: dark asphalt strips along every grid line, plus pale sidewalks.
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x1e2126 });
  const walkMat = new THREE.MeshLambertMaterial({ color: 0x8a7f72 });
  for (const c of roadCenters()) {
    const roadNS = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, HALF * 2), roadMat);
    roadNS.rotation.x = -Math.PI / 2;
    roadNS.position.set(c, 0.02, 0);
    scene.add(roadNS);
    const roadEW = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, ROAD), roadMat);
    roadEW.rotation.x = -Math.PI / 2;
    roadEW.position.set(0, 0.02, c);
    scene.add(roadEW);
    for (const side of [-1, 1]) {
      const walkNS = new THREE.Mesh(new THREE.PlaneGeometry(2.5, HALF * 2), walkMat);
      walkNS.rotation.x = -Math.PI / 2;
      walkNS.position.set(c + side * (ROAD / 2 + 1.25), 0.03, 0);
      scene.add(walkNS);
      const walkEW = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, 2.5), walkMat);
      walkEW.rotation.x = -Math.PI / 2;
      walkEW.position.set(0, 0.03, c + side * (ROAD / 2 + 1.25));
      scene.add(walkEW);
    }
  }

  // Centre dashes on every road.
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8c86a });
  for (const c of roadCenters()) {
    for (let t = -HALF + 4; t < HALF - 4; t += 8) {
      const dashNS = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 3), dashMat);
      dashNS.rotation.x = -Math.PI / 2;
      dashNS.position.set(c, 0.04, t);
      scene.add(dashNS);
      const dashEW = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.5), dashMat);
      dashEW.rotation.x = -Math.PI / 2;
      dashEW.position.set(t, 0.04, c);
      scene.add(dashEW);
    }
  }

  // Buildings: one to four towers per block, each with a lit-window facade.
  const facades = [
    makeFacadeTexture(random, 0.55),
    makeFacadeTexture(random, 0.35),
    makeFacadeTexture(random, 0.7),
  ];
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x2c2a30 });
  for (let bx = 0; bx < BLOCKS; bx += 1) {
    for (let bz = 0; bz < BLOCKS; bz += 1) {
      const blockX = -HALF + ROAD + BLOCK / 2 + bx * PITCH;
      const blockZ = -HALF + ROAD + BLOCK / 2 + bz * PITCH;
      const count = 1 + Math.floor(random() * 3);
      for (let i = 0; i < count; i += 1) {
        const w = 10 + random() * 12;
        const d = 10 + random() * 12;
        const h = 9 + random() * random() * 34;
        const x = blockX + (random() - 0.5) * (BLOCK - w - 4);
        const z = blockZ + (random() - 0.5) * (BLOCK - d - 4);
        const facade = facades[Math.floor(random() * facades.length)];
        const mat = new THREE.MeshLambertMaterial({
          map: facade,
          emissiveMap: facade,
          emissive: new THREE.Color(0xffb84d),
          emissiveIntensity: 0.55,
        });
        const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        tower.position.set(x, h / 2, z);
        scene.add(tower);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6), roofMat);
        roof.position.set(x, h + 0.25, z);
        scene.add(roof);
        colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
      }
    }
  }

  // Palms along the avenues and lamps at the intersections.
  for (const c of roadCenters()) {
    for (let t = -HALF + 14; t < HALF - 10; t += 24) {
      const palm = makePalm(random);
      palm.position.set(c + ROAD / 2 + 2.6, 0, t);
      scene.add(palm);
      const palm2 = makePalm(random);
      palm2.position.set(c - ROAD / 2 - 2.6, 0, t + 12);
      scene.add(palm2);
    }
  }
  for (const cx of roadCenters()) {
    for (const cz of roadCenters()) {
      const lamp = makeLamp();
      lamp.position.set(cx + ROAD / 2 + 0.8, 0, cz + ROAD / 2 + 0.8);
      scene.add(lamp);
    }
  }

  return {
    colliders,
    half: HALF,
    roads: roadCenters(),
    // Player starts on the central avenue, facing the bay.
    spawn: { x: 0, z: 60, heading: Math.PI / 2 },
  };
}
