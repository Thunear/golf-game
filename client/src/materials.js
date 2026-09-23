import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  grassTexture, woodTexture, sandTexture, bumperTexture, noiseTexture,
  checkerGrassTexture, barkTexture, logEndTexture, flagTexture, grassTuftTexture,
} from './textures.js';

// One shared set of THREE materials. Geometry UVs are scaled per-mesh so every
// mesh can share these textures without per-object texture clones.
export function createMaterials() {
  const bump = noiseTexture();

  const grass = new THREE.MeshStandardMaterial({
    map: grassTexture(),
    bumpMap: bump,
    bumpScale: 0.02,
    roughness: 0.92,
    metalness: 0,
  });
  // Checkered putting green (UVs are world-aligned by the builder so tiles line up).
  const green = new THREE.MeshStandardMaterial({
    map: checkerGrassTexture(),
    bumpMap: bump,
    bumpScale: 0.015,
    roughness: 0.9,
    metalness: 0,
  });
  // Lush meadow grass around the course.
  const grassDark = new THREE.MeshStandardMaterial({
    map: grassTexture({ base: [58, 124, 46], seed: 9 }),
    bumpMap: bump,
    bumpScale: 0.03,
    roughness: 1,
  });
  const bark = new THREE.MeshStandardMaterial({ map: barkTexture(), bumpMap: bump, bumpScale: 0.03, roughness: 0.95 });
  const logEnd = new THREE.MeshStandardMaterial({ map: logEndTexture(), roughness: 0.8 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x8a3a2a, roughness: 0.85 });
  const plaster = new THREE.MeshStandardMaterial({ color: 0xe6dcc3, roughness: 0.95, bumpMap: bump, bumpScale: 0.02 });
  const rock = new THREE.MeshStandardMaterial({ color: 0x8b8f89, roughness: 1, bumpMap: bump, bumpScale: 0.05, flatShading: true });
  const bush = new THREE.MeshStandardMaterial({ color: 0x2e6b31, roughness: 1 });
  const bushLight = new THREE.MeshStandardMaterial({ color: 0x3f8a3d, roughness: 1 });
  // Front-side only: the tuft geometry already includes mirrored faces.
  const tuft = new THREE.MeshStandardMaterial({
    map: grassTuftTexture(),
    alphaTest: 0.5,
    side: THREE.FrontSide,
    roughness: 1,
  });
  const wood = new THREE.MeshStandardMaterial({
    map: woodTexture(),
    bumpMap: bump,
    bumpScale: 0.012,
    roughness: 0.72,
  });
  const skirt = new THREE.MeshStandardMaterial({
    map: woodTexture({ base: [104, 74, 46], seed: 3, planks: 3 }),
    roughness: 0.88,
  });
  const sand = new THREE.MeshStandardMaterial({
    map: sandTexture(),
    bumpMap: bump,
    bumpScale: 0.03,
    roughness: 1,
  });
  const bumper = new THREE.MeshStandardMaterial({ map: bumperTexture(), roughness: 0.55 });
  const bumperCap = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.35, metalness: 0.75 });
  const water = new THREE.MeshStandardMaterial({
    color: 0x2f8fdc,
    transparent: true,
    opacity: 0.72,
    roughness: 0.12,
    metalness: 0.15,
  });
  const basin = new THREE.MeshStandardMaterial({ color: 0x1b4664, roughness: 0.9 });
  const cup = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 1 });
  const cupWall = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.95, side: THREE.BackSide });
  const rim = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.6 });
  const pole = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4, metalness: 0.3 });
  const flag = new THREE.MeshStandardMaterial({ map: flagTexture(), roughness: 0.85, side: THREE.DoubleSide });
  const tee = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, transparent: true, opacity: 0.55 });
  const trunk = new THREE.MeshStandardMaterial({ map: barkTexture({ base: [88, 58, 36], seed: 21 }), roughness: 1 });
  const leaves = new THREE.MeshStandardMaterial({ color: 0x2f7a3a, roughness: 1 });
  const leaves2 = new THREE.MeshStandardMaterial({ color: 0x3f9a48, roughness: 1 });
  const leaves3 = new THREE.MeshStandardMaterial({ color: 0x276a2c, roughness: 1 });

  return {
    grass, green, grassDark, wood, skirt, sand, bumper, bumperCap, metal, water, basin,
    cup, cupWall, rim, pole, flag, tee, trunk, leaves, leaves2, leaves3,
    bark, logEnd, roof, plaster, rock, bush, bushLight, tuft,
  };
}

// Physics materials + how the ball interacts with each surface type.
export function createPhysicsMaterials(world) {
  const ball = new CANNON.Material('ball');
  const grass = new CANNON.Material('grass');
  const sand = new CANNON.Material('sand');
  const wall = new CANNON.Material('wall');
  const bumper = new CANNON.Material('bumper');
  const metal = new CANNON.Material('metal');

  const add = (a, b, opts) => world.addContactMaterial(new CANNON.ContactMaterial(a, b, opts));
  add(ball, grass, { friction: 0.5, restitution: 0.12 });
  add(ball, sand, { friction: 0.9, restitution: 0.0 });
  add(ball, wall, { friction: 0.08, restitution: 0.62 });
  add(ball, bumper, { friction: 0.05, restitution: 1.05 });
  add(ball, metal, { friction: 0.2, restitution: 0.5 });
  world.defaultContactMaterial.friction = 0.4;
  world.defaultContactMaterial.restitution = 0.3;

  return { ball, grass, sand, wall, bumper, metal };
}
