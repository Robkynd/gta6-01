// Neon Bay missions: Rex Marlowe's chained delivery run for the Marlin Cartel.
// Four jobs, one after the other — deliver, lose the heat, switch the package,
// then one last sunset run with the cops already on his tail.

import * as THREE from 'three';

const REACH = 5; // metres from a target to complete a leg

export function createMissions(scene, city) {
  const all = [
    {
      id: 0,
      title: 'HOT PACKAGE',
      text: 'Deliver the package to the marina drop — east end, by the bay.',
      target: { x: 108, z: -30 },
      reward: 150,
    },
    {
      id: 1,
      title: 'LOSE THE TAIL',
      text: 'The cartel called the cops. Lose the heat — get your wanted level to zero.',
      target: null,
      reward: 200,
    },
    {
      id: 2,
      title: 'THE SWITCH',
      text: 'Pick up the second package at the north depot, then drop it at the south garage.',
      target: { x: -84, z: -84 },
      pickup: { x: -84, z: -84 },
      drop: { x: 48, z: 96 },
      stage: 0,
      reward: 300,
    },
    {
      id: 3,
      title: 'SUNSET RUN',
      text: "Final run: reach the bay overlook with the heat on you. Don't let them take the package.",
      target: { x: 132, z: 0 },
      reward: 500,
    },
  ];

  // Marker: a tall translucent yellow beam with a floating spinning octahedron.
  const marker = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffd23e,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 14, 16, 1, true), beamMat);
  beam.position.y = 7;
  marker.add(beam);
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.7),
    new THREE.MeshBasicMaterial({ color: 0xffd23e }),
  );
  gem.position.y = 3;
  marker.add(gem);
  marker.visible = false;
  scene.add(marker);

  let index = -1;
  let current = null;
  let pulse = 0;
  let completed = false;

  function placeMarker() {
    const target = current ? current.target : null;
    if (!target) {
      marker.visible = false;
      return;
    }
    marker.position.set(target.x, 0, target.z);
    marker.visible = true;
  }

  function activate(i, ctx) {
    index = i;
    current = all[i];
    if (current.id === 1 && ctx && typeof ctx.addWanted === 'function') ctx.addWanted(2);
    if (current.id === 3 && ctx && typeof ctx.addWanted === 'function') ctx.addWanted(1);
    placeMarker();
  }

  function advance(ctx, finished) {
    if (ctx && typeof ctx.onComplete === 'function') ctx.onComplete(finished);
    const next = index + 1;
    if (next >= all.length) {
      index = all.length;
      current = null;
      completed = true;
      marker.visible = false;
      if (ctx && typeof ctx.onAllComplete === 'function') ctx.onAllComplete();
      return;
    }
    activate(next, ctx);
  }

  function distTo(px, pz, target) {
    return Math.hypot(px - target.x, pz - target.z);
  }

  return {
    get index() { return index; },
    get current() { return current; },
    all,
    marker,
    getTarget() {
      return current && current.target ? { x: current.target.x, z: current.target.z } : null;
    },
    start(ctx) {
      completed = false;
      all[2].stage = 0;
      all[2].target = { x: all[2].pickup.x, z: all[2].pickup.z };
      activate(0, ctx);
    },
    // Resume a saved game at mission i (clamped); stage resets to pickup.
    resumeTo(i, ctx) {
      completed = false;
      all[2].stage = 0;
      all[2].target = { x: all[2].pickup.x, z: all[2].pickup.z };
      const idx = Math.max(0, Math.min(all.length - 1, i));
      activate(idx, ctx);
    },
    isComplete() { return completed; },
    update(dt, ctx) {
      pulse += dt;
      gem.rotation.y += dt * 2;
      gem.position.y = 3 + Math.sin(pulse * 2.5) * 0.5;
      if (!current || !ctx || !ctx.player) return;

      // Lose the tail: done when the heat is gone, not by reaching a place.
      if (current.id === 1) {
        if (ctx.wanted === 0) advance(ctx, current);
        return;
      }

      const target = current.target;
      if (!target) return;
      if (distTo(ctx.player.x, ctx.player.z, target) > REACH) return;

      // The switch: first reach is the pickup, second reach is the drop.
      if (current.id === 2 && current.stage === 0) {
        current.stage = 1;
        current.target = { x: current.drop.x, z: current.drop.z };
        if (typeof ctx.onPickup === 'function') ctx.onPickup(current);
        placeMarker();
        return;
      }
      advance(ctx, current);
    },
  };
}
