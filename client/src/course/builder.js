// Turns a hole definition (see holes.js) into THREE meshes + cannon-es bodies.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { flagTexture, plaqueTexture, questionBoardTexture, cardTexture, textTexture } from '../textures.js';

// Designsystemet logo colours, used for anything "branded" on the course.
export const LOGO_COLORS = { red: '#F45F63', yellow: '#E5AA20', blue: '#1E98F5', grey: '#68707C' };

export const WALL_T = 0.5; // collider thickness, matches the log diameter
export const LOG_R = 0.26;
export const WALL_H = 0.5;
export const FLOOR_T = 0.3;
export const GROUND_Y = -FLOOR_T; // meadow surface sits flush with the course underside
export const TEX_SCALE = 2; // world units covered by one texture repeat (wood, bark)
export const GRASS_SCALE = 1.6; // one checker texture repeat (2 cells) = 1.6 units
export const CUP_R = 0.32; // ~2x the ball diameter, like a real cup
export const CUP_DEPTH = 0.4;

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const DIR_YAW = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };

// BoxGeometry whose UVs are scaled so a shared texture tiles at a constant
// world-space density regardless of the box dimensions.
export function boxGeometry(w, h, d, s = TEX_SCALE) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * su) / s, (uv.getY(k) * sv) / s);
    }
  }
  return g;
}

// Re-projects the UVs of upward-facing vertices from their world XZ position so
// the checker pattern lines up across neighbouring tiles and ramps.
export function alignTopUVs(geometry, matrix, s = GRASS_SCALE) {
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nrm, i).applyMatrix3(nm);
    if (n.y < 0.5) continue;
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    uv.setXY(i, v.x / s, v.z / s);
  }
  uv.needsUpdate = true;
}

// A convex prism: a 2D profile in the (along=z, up=y) plane extruded along x.
// Returns geometry + cannon shape, both centered on the centroid, plus that centroid.
// Faces with an upward normal go to material group 0, the rest to group 1.
export function prism(profileIn, width) {
  let profile = profileIn.map(([z, y]) => [z, y]);
  let area = 0;
  for (let i = 0; i < profile.length; i++) {
    const [z1, y1] = profile[i];
    const [z2, y2] = profile[(i + 1) % profile.length];
    area += z1 * y2 - z2 * y1;
  }
  if (area < 0) profile.reverse();

  const hw = width / 2;
  const verts = [];
  for (const [z, y] of profile) verts.push([-hw, y, z], [hw, y, z]);
  const c = [0, 0, 0];
  for (const v of verts) for (let i = 0; i < 3; i++) c[i] += v[i] / verts.length;
  for (const v of verts) for (let i = 0; i < 3; i++) v[i] -= c[i];

  const n = profile.length;
  const faces = [];
  faces.push(profile.map((_, i) => i * 2));
  faces.push(profile.map((_, i) => i * 2 + 1));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i * 2, j * 2, j * 2 + 1, i * 2 + 1]);
  }

  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const normal = new THREE.Vector3(), center = new THREE.Vector3();
  const faceNormal = (f) => {
    va.fromArray(verts[f[0]]);
    vb.fromArray(verts[f[1]]);
    vc.fromArray(verts[f[2]]);
    normal.subVectors(vb, va).cross(vc.clone().sub(va)).normalize();
    center.set(0, 0, 0);
    for (const idx of f) center.add(va.fromArray(verts[idx]));
    center.divideScalar(f.length);
    return normal;
  };
  for (const f of faces) {
    faceNormal(f);
    if (normal.dot(center) < 0) f.reverse();
  }

  const shape = new CANNON.ConvexPolyhedron({
    vertices: verts.map((v) => new CANNON.Vec3(v[0], v[1], v[2])),
    faces: faces.map((f) => f.slice()),
  });

  const positions = [], normals = [], uvs = [];
  const groups = [];
  for (const f of faces) {
    const nrm = faceNormal(f).clone();
    const upward = nrm.y > 0.3;
    const isCap = Math.abs(nrm.x) > 0.9;
    let tangent = null;
    if (!isCap) {
      const a = verts[f[0]], b = verts[f[1]], cc = verts[f[2]];
      const e1 = new THREE.Vector3().fromArray(b).sub(new THREE.Vector3().fromArray(a));
      const e2 = new THREE.Vector3().fromArray(cc).sub(new THREE.Vector3().fromArray(b));
      tangent = Math.abs(e1.x) < 1e-6 ? e1.normalize() : e2.normalize();
    }
    const uvOf = (v) => {
      if (isCap) return [v[2] / TEX_SCALE, v[1] / TEX_SCALE];
      return [v[0] / TEX_SCALE, (v[1] * tangent.y + v[2] * tangent.z) / TEX_SCALE];
    };
    const start = positions.length / 3;
    for (let i = 1; i < f.length - 1; i++) {
      for (const idx of [f[0], f[i], f[i + 1]]) {
        positions.push(...verts[idx]);
        normals.push(nrm.x, nrm.y, nrm.z);
        uvs.push(...uvOf(verts[idx]));
      }
    }
    groups.push({ start, count: positions.length / 3 - start, materialIndex: upward ? 0 : 1 });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  for (const g of groups) geometry.addGroup(g.start, g.count, g.materialIndex);

  return { geometry, shape, center: new THREE.Vector3(c[0], c[1], c[2]) };
}

// Gentle cloth ripple: two travelling waves whose amplitude grows from the pole
// edge (x = -w/2, pinned) to the free edge.
function waveFlag(flag, t) {
  const pos = flag.geometry.attributes.position;
  const base = flag.userData.base;
  const w = flag.userData.width ?? 0.55;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3], y = base[i * 3 + 1];
    const u = (x + w / 2) / w; // 0 at the pole, 1 at the free edge
    const env = u * u;
    const z = Math.sin(x * 7 - t * 5.5 + y * 3) * 0.05 * env + Math.sin(x * 13 - t * 8.5) * 0.016 * env;
    const sag = -Math.sin(t * 2.1) * 0.018 * env;
    pos.setXYZ(i, x, y + sag, z);
  }
  pos.needsUpdate = true;
  flag.geometry.computeVertexNormals();
}

// Two crossed vertical quads plus their mirrored copies (so every view sees a
// front face), all with UP normals so they take the same light as the meadow.
// Pivot at the base; unit size.
function tuftGeometry() {
  const positions = [], normals = [], uvs = [], index = [];
  const addQuad = (ax, az, flip) => {
    // Quad spanning (-ax,-az)..(ax,az) horizontally, 0..1 vertically.
    const base = positions.length / 3;
    const corners = [[-ax, 0, -az, 0, 0], [ax, 0, az, 1, 0], [ax, 1, az, 1, 1], [-ax, 1, -az, 0, 1]];
    for (const [x, y, z, u, v] of corners) {
      positions.push(x, y, z);
      normals.push(0, 1, 0);
      uvs.push(u, v);
    }
    if (flip) index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  addQuad(0.5, 0, false);
  addQuad(0.5, 0, true);
  addQuad(0, 0.5, false);
  addQuad(0, 0.5, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

function seeded(seed) {
  let s = (Math.imul(seed | 0, 2654435761) >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class HoleBuilder {
  constructor(scene, world, mats, phys) {
    this.scene = scene;
    this.world = world;
    this.mats = mats;
    this.phys = phys;
  }

  build(def, index = 0) {
    const h = {
      group: new THREE.Group(),
      bodies: [],
      movers: [],
      waters: [],
      flags: [],
      walls: [],
      chutes: [],
      buttons: [],
      gates: [],
      flag: def.flag ?? {},
      quiz: null,
      cupBuilt: false,
      number: index + 1,
      cup: { x: def.cup[0], y: def.cup[1] ?? 0, z: def.cup[2] },
      tee: { x: def.tee[0], y: def.tee[1] ?? 0, z: def.tee[2] },
      bounds: { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minY: Infinity, maxY: -Infinity },
    };
    this.cur = h;
    const plaques = [];

    for (const p of def.pieces) {
      switch (p.type) {
        case 'floor': this.addFloor(p); break;
        case 'outline': this.addOutline(p); break;
        case 'wall': this.addWall(p.x1, p.z1, p.y1 ?? 0, p.x2, p.z2, p.y2 ?? p.y1 ?? 0, p.h ?? WALL_H); break;
        case 'ramp': this.addRamp(p); break;
        case 'bumper': this.addBumper(p); break;
        case 'mound': this.addMound(p); break;
        case 'spinner': this.addSpinner(p); break;
        case 'slider': this.addSlider(p); break;
        case 'box': this.addBox(p); break;
        case 'tunnel': this.addTunnel(p); break;
        case 'windmill': this.addWindmill(p); break;
        case 'quiz': this.addQuiz(p); break;
        case 'chute': this.addChute(p); break;
        case 'hill': this.addHill(p); break;
        case 'plaque': plaques.push(p); break;
        case 'button': this.addButton(p); break;
        case 'gate': this.addGate(p); break;
        case 'card': this.addCard(p); break;
        case 'post': this.addPost(p.x, p.z, p.y ?? 0); break;
        default: console.warn('Unknown piece', p);
      }
    }
    this.addCup(h.cup);
    this.addTee(h.tee);
    this.addPlaque(h, index + 1, def.par);
    // Decorative plaques go up last so they can hang on any wall of the hole.
    for (const p of plaques) this.mountPlaque(p.text, { x: p.x, z: p.z }, p.y ?? 0, p);
    this.addDecor(h, hashString(def.name));

    h.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = !o.userData.noShadow;
        o.receiveShadow = true;
      }
    });
    this.scene.add(h.group);

    const world = this.world;
    const scene = this.scene;
    h.update = (t) => {
      for (const m of h.movers) m.update(t);
      for (const w of h.waters) w.material.opacity = 0.68 + Math.sin(t * 1.3 + w.position.x) * 0.05;
      for (const f of h.flags) waveFlag(f, t);
    };
    h.dispose = () => {
      scene.remove(h.group);
      h.group.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          if (o.userData.ownMaterial) {
            for (const m of [].concat(o.material)) {
              if (m.map) m.map.dispose();
              m.dispose();
            }
          }
        }
      });
      for (const b of h.bodies) world.removeBody(b);
    };
    this.cur = null;
    return h;
  }

  // ----- helpers -----
  extend(x1, z1, x2, z2, yTop, yBottom = yTop) {
    const b = this.cur.bounds;
    b.minX = Math.min(b.minX, x1, x2); b.maxX = Math.max(b.maxX, x1, x2);
    b.minZ = Math.min(b.minZ, z1, z2); b.maxZ = Math.max(b.maxZ, z1, z2);
    b.minY = Math.min(b.minY, yBottom); b.maxY = Math.max(b.maxY, yTop);
  }

  addMesh(geometry, material, position, quaternion) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    if (quaternion) mesh.quaternion.copy(quaternion);
    this.cur.group.add(mesh);
    return mesh;
  }

  addBody(shape, position, { quaternion, material, surface = 'solid', type = CANNON.Body.STATIC, mass = 0 } = {}) {
    const body = new CANNON.Body({ mass, type, material });
    if (shape) body.addShape(shape);
    body.position.set(position.x, position.y, position.z);
    if (quaternion) body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    body.surface = surface;
    this.world.addBody(body);
    this.cur.bodies.push(body);
    return body;
  }

  // World-aligns the checker pattern on a mesh's upward faces.
  alignGreen(mesh) {
    mesh.updateMatrix();
    alignTopUVs(mesh.geometry, mesh.matrix);
  }

  // A log: bark cylinder with ring end-caps, axis along local Z.
  logMesh(length, position, quaternion, radius = LOG_R) {
    const geo = new THREE.CylinderGeometry(radius, radius, length, 14, 1);
    geo.rotateX(Math.PI / 2);
    const sideVerts = 15 * 2; // (radialSegments + 1) * (heightSegments + 1)
    const uv = geo.attributes.uv;
    for (let i = 0; i < sideVerts; i++) uv.setXY(i, uv.getX(i) * 2, (uv.getY(i) * length) / TEX_SCALE);
    return this.addMesh(geo, [this.mats.bark, this.mats.logEnd, this.mats.logEnd], position, quaternion);
  }

  // ----- pieces -----
  addFloor(p) {
    const y = p.y ?? 0;
    const mat = p.mat ?? 'grass';
    if (mat === 'water') return this.addWater(p, y);
    if (mat === 'grass' && this.cupInTile(p, y)) return this.addFloorWithCup(p, y);
    const bottom = -FLOOR_T;
    const h = y - bottom;
    const raise = mat === 'sand' ? 0.006 : 0;
    const top = mat === 'sand' ? this.mats.sand : this.mats.green;
    const sk = this.mats.skirt;
    const pos = new THREE.Vector3(p.x, bottom + h / 2, p.z);
    const mesh = this.addMesh(boxGeometry(p.w, h, p.d), [sk, sk, top, sk, sk, sk], pos);
    mesh.position.y += raise;
    if (mat === 'grass') this.alignGreen(mesh);
    this.addBody(new CANNON.Box(new CANNON.Vec3(p.w / 2, h / 2, p.d / 2)), pos, {
      material: mat === 'sand' ? this.phys.sand : this.phys.grass,
      surface: mat,
    });
    this.extend(p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2, y);

    if (p.walls) {
      const x1 = p.x - p.w / 2, x2 = p.x + p.w / 2, z1 = p.z - p.d / 2, z2 = p.z + p.d / 2;
      if (p.walls.includes('n')) this.addWall(x1, z1, y, x2, z1, y);
      if (p.walls.includes('s')) this.addWall(x1, z2, y, x2, z2, y);
      if (p.walls.includes('e')) this.addWall(x2, z1, y, x2, z2, y);
      if (p.walls.includes('w')) this.addWall(x1, z1, y, x1, z2, y);
    }
  }

  cupInTile(p, y) {
    const c = this.cur.cup;
    if (this.cur.cupBuilt || Math.abs(c.y - y) > 1e-3) return false;
    const m = CUP_R + 0.3; // keep the whole cup (and its lip) inside the tile
    return c.x - m >= p.x - p.w / 2 && c.x + m <= p.x + p.w / 2 && c.z - m >= p.z - p.d / 2 && c.z + m <= p.z + p.d / 2;
  }

  // Floor tile with a real cylindrical hole. Visual: extruded slab with the hole
  // cut out plus a dark liner. Physics: four slabs around a square gap, a ring of
  // thin boxes forming the cup wall (their tops are flush with the green so they
  // also act as the lip), and a bottom plate.
  addFloorWithCup(p, y) {
    const c = this.cur.cup;
    const bottom = -FLOOR_T;
    const h = y - bottom;
    const x1 = p.x - p.w / 2, x2 = p.x + p.w / 2, z1 = p.z - p.d / 2, z2 = p.z + p.d / 2;

    // --- visual slab with hole ---
    const shape = new THREE.Shape();
    shape.moveTo(-p.w / 2, -p.d / 2);
    shape.lineTo(p.w / 2, -p.d / 2);
    shape.lineTo(p.w / 2, p.d / 2);
    shape.lineTo(-p.w / 2, p.d / 2);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(c.x - p.x, c.z - p.z, CUP_R, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 36 });
    geo.rotateX(Math.PI / 2); // shape y -> world z, extrusion goes downwards
    const slab = this.addMesh(geo, [this.mats.green, this.mats.skirt], new THREE.Vector3(p.x, y, p.z));
    this.alignGreen(slab);

    // Dark liner and bottom of the cup.
    const liner = new THREE.CylinderGeometry(CUP_R - 0.006, CUP_R - 0.006, CUP_DEPTH, 36, 1, true);
    const linerMesh = this.addMesh(liner, this.mats.cupWall, new THREE.Vector3(c.x, y - CUP_DEPTH / 2, c.z));
    linerMesh.userData.noShadow = true;
    const base = new THREE.Mesh(new THREE.CircleGeometry(CUP_R - 0.006, 36), this.mats.cup);
    base.rotation.x = -Math.PI / 2;
    base.position.set(c.x, y - CUP_DEPTH + 0.003, c.z);
    base.userData.noShadow = true;
    this.cur.group.add(base);

    // --- physics ---
    const g = CUP_R + 0.03; // half side of the square gap
    const slabs = [
      [x1, z1, c.x - g, z2],
      [c.x + g, z1, x2, z2],
      [c.x - g, z1, c.x + g, c.z - g],
      [c.x - g, c.z + g, c.x + g, z2],
    ];
    for (const [ax, az, bx, bz] of slabs) {
      const w = bx - ax, d = bz - az;
      if (w <= 0.01 || d <= 0.01) continue;
      this.addBody(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)), new THREE.Vector3((ax + bx) / 2, bottom + h / 2, (az + bz) / 2), {
        material: this.phys.grass, surface: 'grass',
      });
    }
    const N = 18, t = 0.24;
    const wallH = CUP_DEPTH + 0.2;
    const segHalf = (CUP_R + t) * Math.tan(Math.PI / N) + 0.01;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const r = CUP_R + t / 2;
      const pos = new THREE.Vector3(c.x + Math.cos(ang) * r, y - wallH / 2, c.z + Math.sin(ang) * r);
      const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, -ang);
      this.addBody(new CANNON.Box(new CANNON.Vec3(t / 2, wallH / 2, segHalf)), pos, {
        quaternion: q, material: this.phys.grass, surface: 'cup',
      });
    }
    this.addBody(new CANNON.Box(new CANNON.Vec3(CUP_R + 0.1, 0.05, CUP_R + 0.1)), new THREE.Vector3(c.x, y - CUP_DEPTH - 0.05, c.z), {
      material: this.phys.grass, surface: 'grass',
    });

    this.cur.cupBuilt = true;
    this.extend(x1, z1, x2, z2, y);

    if (p.walls) {
      if (p.walls.includes('n')) this.addWall(x1, z1, y, x2, z1, y);
      if (p.walls.includes('s')) this.addWall(x1, z2, y, x2, z2, y);
      if (p.walls.includes('e')) this.addWall(x2, z1, y, x2, z2, y);
      if (p.walls.includes('w')) this.addWall(x1, z1, y, x1, z2, y);
    }
  }

  addWater(p, y) {
    const top = y - 0.32;
    const bottom = top - 0.6;
    const h = top - bottom;
    const pos = new THREE.Vector3(p.x, bottom + h / 2, p.z);
    this.addMesh(boxGeometry(p.w, h, p.d), this.mats.basin, pos);
    this.addBody(new CANNON.Box(new CANNON.Vec3(p.w / 2, h / 2, p.d / 2)), pos, {
      material: this.phys.grass,
      surface: 'water',
    });
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), this.mats.water.clone());
    surf.rotation.x = -Math.PI / 2;
    surf.position.set(p.x, y - 0.08, p.z);
    surf.userData.noShadow = true;
    surf.userData.ownMaterial = true;
    this.cur.group.add(surf);
    this.cur.waters.push(surf);
    this.extend(p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2, y, top);
  }

  addOutline(p) {
    const pts = p.pts;
    // `open` leaves out the closing segment (last point back to first).
    const segs = p.open ? pts.length - 1 : pts.length;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      this.addWall(a[0], a[1], a[2] ?? 0, b[0], b[1], b[2] ?? 0, p.h ?? WALL_H, { trim: true });
    }
    // A vertical stump at every corner; the horizontal logs end inside it.
    for (const [x, z, y = 0] of pts) this.addPost(x, z, y);
  }

  addPost(x, z, y) {
    const r = LOG_R * 1.12, hgt = 0.8;
    const geo = new THREE.CylinderGeometry(r, r, hgt, 14, 1);
    const uv = geo.attributes.uv;
    for (let i = 0; i < 15 * 2; i++) uv.setXY(i, uv.getX(i) * 2, (uv.getY(i) * hgt) / TEX_SCALE);
    const pos = new THREE.Vector3(x, y - 0.06 + hgt / 2, z);
    this.addMesh(geo, [this.mats.bark, this.mats.logEnd, this.mats.logEnd], pos);
    this.addBody(new CANNON.Cylinder(r, r, hgt, 12), pos, { material: this.phys.wall, surface: 'wall' });
  }

  // Log wall from (x1,z1,y1) to (x2,z2,y2). Collider is a box (or a sloped prism).
  addWall(x1, z1, y1, x2, z2, y2, h = WALL_H, { trim = false } = {}) {
    const dx = x2 - x1, dz = z2 - z1;
    const L = Math.hypot(dx, dz);
    if (L < 1e-6) return;
    const yaw = Math.atan2(dx, dz);
    const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const sink = 0.05;
    this.cur.walls.push({ x1, z1, y1, x2, z2, y2 });

    if (Math.abs(y1 - y2) < 1e-6) {
      const len = L + WALL_T;
      const hh = h + sink;
      const pos = new THREE.Vector3(cx, y1 - sink + hh / 2, cz);
      // Trimmed logs (outline segments) end at the corner, hidden inside the stump.
      this.logMesh(trim ? L : len, new THREE.Vector3(cx, y1 + LOG_R - 0.03, cz), q);
      this.addBody(new CANNON.Box(new CANNON.Vec3(WALL_T / 2, hh / 2, len / 2)), pos, {
        quaternion: q, material: this.phys.wall, surface: 'wall',
      });
    } else {
      const dy = y2 - y1;
      const profile = [[-L / 2, y1 - sink], [L / 2, y2 - sink], [L / 2, y2 + h], [-L / 2, y1 + h]];
      const pr = prism(profile, WALL_T);
      const pos = pr.center.clone().applyQuaternion(q).add(new THREE.Vector3(cx, 0, cz));
      this.addBody(pr.shape, pos, { quaternion: q, material: this.phys.wall, surface: 'wall' });
      const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.atan2(dy, L));
      const lq = q.clone().multiply(tilt);
      this.logMesh(Math.hypot(L, dy) + (trim ? 0 : 0.3), new THREE.Vector3(cx, (y1 + y2) / 2 + LOG_R - 0.03, cz), lq);
    }
  }

  addRamp(p) {
    const y0 = p.y ?? 0;
    const yaw = DIR_YAW[p.dir] ?? 0;
    const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw);
    const profile = [
      [-p.len / 2, -FLOOR_T],
      [p.len / 2, -FLOOR_T],
      [p.len / 2, y0 + p.rise],
      [-p.len / 2, y0],
    ];
    const pr = prism(profile, p.w);
    const pos = pr.center.clone().applyQuaternion(q).add(new THREE.Vector3(p.x, 0, p.z));
    const mesh = this.addMesh(pr.geometry, [this.mats.green, this.mats.skirt], pos, q);
    this.alignGreen(mesh);
    this.addBody(pr.shape, pos, { quaternion: q, material: this.phys.grass, surface: 'grass' });
    const horiz = p.dir === 'e' || p.dir === 'w';
    const w = horiz ? p.len : p.w, d = horiz ? p.w : p.len;
    this.extend(p.x - w / 2, p.z - d / 2, p.x + w / 2, p.z + d / 2, y0 + p.rise, y0);

    if (p.walls) {
      const ends = (side) => {
        const a = new THREE.Vector3((side * p.w) / 2, 0, -p.len / 2).applyQuaternion(q);
        const b = new THREE.Vector3((side * p.w) / 2, 0, p.len / 2).applyQuaternion(q);
        return [a, b];
      };
      for (const side of [-1, 1]) {
        const [a, b] = ends(side);
        this.addWall(p.x + a.x, p.z + a.z, y0, p.x + b.x, p.z + b.z, y0 + p.rise);
      }
    }
  }

  addBox(p) {
    const y = p.y ?? 0;
    const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, p.rotY ?? 0);
    const pos = new THREE.Vector3(p.x, y + p.h / 2, p.z);
    this.addMesh(boxGeometry(p.w, p.h, p.d), this.mats.wood, pos, q);
    this.addBody(new CANNON.Box(new CANNON.Vec3(p.w / 2, p.h / 2, p.d / 2)), pos, {
      quaternion: q, material: this.phys.wall, surface: 'wall',
    });
  }

  // Bouncy post. `color` (a CSS colour or a logo colour name) swaps the striped
  // bumper for a plain painted one, used for "branded" posts like the Button pair.
  addBumper(p) {
    const r = p.r ?? 0.4, h = p.h ?? 0.6, y = p.y ?? 0;
    const pos = new THREE.Vector3(p.x, y + h / 2, p.z);
    const geo = new THREE.CylinderGeometry(r, r, h, 24);
    let mats = [this.mats.bumper, this.mats.bumperCap, this.mats.bumperCap];
    if (p.color) {
      const color = new THREE.Color(LOGO_COLORS[p.color] ?? p.color);
      const side = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
      const cap = new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color('#ffffff'), 0.3), roughness: 0.5 });
      mats = [side, cap, cap];
    }
    const mesh = this.addMesh(geo, mats, pos);
    if (p.color) mesh.userData.ownMaterial = true;
    this.addBody(new CANNON.Cylinder(r, r, h, 16), pos, { material: this.phys.bumper, surface: 'bumper' });
  }

  addMound(p) {
    const y = p.y ?? 0;
    const pos = new THREE.Vector3(p.x, y + p.h - p.r, p.z);
    const geo = new THREE.SphereGeometry(p.r, 36, 20);
    const uv = geo.attributes.uv;
    const su = (2 * Math.PI * p.r) / TEX_SCALE, sv = (Math.PI * p.r) / TEX_SCALE;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    this.addMesh(geo, this.mats.grass, pos);
    this.addBody(new CANNON.Sphere(p.r), pos, { material: this.phys.grass, surface: 'grass' });
  }

  addSpinner(p) {
    const y = p.y ?? 0, h = p.h ?? 0.45, t = p.t ?? 0.3;
    const pos = new THREE.Vector3(p.x, y + h / 2, p.z);
    const mesh = this.addMesh(boxGeometry(p.len, h, t), this.mats.wood, pos);
    const body = this.addBody(new CANNON.Box(new CANNON.Vec3(p.len / 2, h / 2, t / 2)), pos, {
      material: this.phys.metal, surface: 'mover', type: CANNON.Body.KINEMATIC,
    });
    body.angularVelocity.set(0, p.speed, 0);
    const postH = h + 0.25;
    this.addMesh(new THREE.CylinderGeometry(0.11, 0.13, postH, 16), this.mats.metal, new THREE.Vector3(p.x, y + postH / 2, p.z));
    const cap = this.addMesh(new THREE.SphereGeometry(0.16, 16, 12), this.mats.metal, new THREE.Vector3(p.x, y + postH, p.z));
    cap.userData.noShadow = true;
    this.cur.movers.push({
      update: (time) => {
        body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), time * p.speed);
        body.angularVelocity.set(0, p.speed, 0);
        mesh.quaternion.copy(body.quaternion);
      },
    });
  }

  // Block sliding back and forth across the lane. `look: 'switch'` draws it as a
  // giant Designsystemet Switch: a white round thumb on a blue pill track with
  // "Av" / "På" at the ends.
  addSlider(p) {
    const y = p.y ?? 0, h = p.h ?? 0.5;
    const base = new THREE.Vector3(p.x, y + h / 2, p.z);
    const axis = p.axis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const phase = p.phase ?? 0;
    let mesh, body, railLen;
    if (p.look === 'switch') {
      const r = p.r ?? 0.5;
      railLen = p.amp * 2 + r * 2;
      const thumbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 });
      mesh = this.addMesh(new THREE.CylinderGeometry(r, r, h, 28), thumbMat, base);
      mesh.userData.ownMaterial = true;
      body = this.addBody(new CANNON.Cylinder(r, r, h, 16), base, {
        material: this.phys.metal, surface: 'mover', type: CANNON.Body.KINEMATIC,
      });
      // Track: flat blue pill along the axis.
      const trackW = r * 1.9;
      const trackGeo = new THREE.ExtrudeGeometry(this.roundedRect(railLen, trackW, trackW / 2 - 0.01), { depth: 0.05, bevelEnabled: false, curveSegments: 14 });
      trackGeo.rotateX(-Math.PI / 2);
      if (p.axis === 'z') trackGeo.rotateY(Math.PI / 2);
      const track = this.addMesh(trackGeo, new THREE.MeshStandardMaterial({ color: LOGO_COLORS.blue, roughness: 0.6 }), new THREE.Vector3(p.x, y + 0.003, p.z));
      track.userData.ownMaterial = true;
      track.userData.noShadow = true;
      // "Av" / "På" labels under the track ends (approach side), readable from +z.
      const perp = p.axis === 'z' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      for (const [side, text] of [[-1, 'Av'], [1, 'På']]) {
        const lm = new THREE.MeshStandardMaterial({ map: textTexture(text, { fg: '#1e2b3c', font: 120 }), transparent: true, roughness: 0.7, depthWrite: false });
        const lbl = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), lm);
        lbl.rotation.x = -Math.PI / 2;
        const off = axis.clone().multiplyScalar(side * (railLen / 2 - 0.6)).addScaledVector(perp, trackW / 2 + 0.3);
        lbl.position.set(p.x + off.x, y + 0.006, p.z + off.z);
        lbl.userData.noShadow = true;
        lbl.userData.ownMaterial = true;
        this.cur.group.add(lbl);
      }
    } else {
      mesh = this.addMesh(boxGeometry(p.w, h, p.d), this.mats.wood, base);
      body = this.addBody(new CANNON.Box(new CANNON.Vec3(p.w / 2, h / 2, p.d / 2)), base, {
        material: this.phys.metal, surface: 'mover', type: CANNON.Body.KINEMATIC,
      });
      railLen = p.amp * 2 + (p.axis === 'z' ? p.d : p.w);
      const rail = this.addMesh(
        boxGeometry(p.axis === 'z' ? 0.12 : railLen, 0.04, p.axis === 'z' ? railLen : 0.12),
        this.mats.metal,
        new THREE.Vector3(p.x, y + 0.02, p.z)
      );
      rail.userData.noShadow = true;
    }
    this.cur.movers.push({
      update: (time) => {
        const s = Math.sin(time * p.speed + phase);
        const v = Math.cos(time * p.speed + phase) * p.amp * p.speed;
        body.position.set(base.x + axis.x * p.amp * s, base.y, base.z + axis.z * p.amp * s);
        body.velocity.set(axis.x * v, 0, axis.z * v);
        mesh.position.copy(body.position);
      },
    });
  }

  // Hollow log lying on the green, open at both ends. Axis runs along `dir`.
  // Collider: a ring of thin boxes (the floor closes the bottom).
  addTunnel(p) {
    const y = p.y ?? 0, r = p.r ?? 0.65, len = p.len;
    const yaw = DIR_YAW[p.dir] ?? 0;
    const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw);
    const origin = new THREE.Vector3(p.x, y + r - 0.04, p.z);

    const outer = new THREE.CylinderGeometry(r + 0.1, r + 0.1, len, 24, 1, true);
    outer.rotateX(Math.PI / 2);
    const ouv = outer.attributes.uv;
    for (let i = 0; i < ouv.count; i++) ouv.setXY(i, ouv.getX(i) * 3, (ouv.getY(i) * len) / TEX_SCALE);
    this.addMesh(outer, this.mats.bark, origin, q);
    const inner = new THREE.CylinderGeometry(r, r, len - 0.02, 24, 1, true);
    inner.rotateX(Math.PI / 2);
    const innerMat = this.mats.logEnd.clone();
    innerMat.side = THREE.BackSide;
    innerMat.map = this.mats.wood.map;
    const innerMesh = this.addMesh(inner, innerMat, origin, q);
    innerMesh.userData.ownMaterial = true;
    for (const end of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.1, 24), this.mats.logEnd);
      ring.material = this.mats.logEnd;
      const off = new THREE.Vector3(0, 0, (end * len) / 2).applyQuaternion(q);
      ring.position.copy(origin).add(off);
      ring.quaternion.copy(q);
      if (end < 0) ring.rotateY(Math.PI);
      ring.userData.noShadow = true;
      this.cur.group.add(ring);
    }

    const N = 14;
    const segHalf = r * Math.tan(Math.PI / N) + 0.03;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const cy = Math.sin(ang) * r;
      if (cy < -r * 0.55) continue; // floor already closes the bottom
      const local = new THREE.Vector3(Math.cos(ang) * (r + 0.05), cy, 0);
      const pos = local.clone().applyQuaternion(q).add(origin);
      const sq = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang + Math.PI / 2));
      this.addBody(new CANNON.Box(new CANNON.Vec3(segHalf, 0.06, len / 2)), pos, {
        quaternion: sq, material: this.phys.wall, surface: 'wall',
      });
    }
  }

  // Sloped tunnel from (x1,y1,z1) to (x2,y2,z2), where y is the floor level at each
  // end. Full ring of colliders so it carries the ball down through a hill.
  addChute(p) {
    const r = p.r ?? 0.65;
    const a = new THREE.Vector3(p.x1, (p.y1 ?? 0) + r, p.z1);
    const b = new THREE.Vector3(p.x2, (p.y2 ?? 0) + r, p.z2);
    const d = b.clone().sub(a);
    const len = d.length();
    d.normalize();
    const yaw = Math.atan2(d.x, d.z);
    const pitch = -Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    const q = new THREE.Quaternion()
      .setFromAxisAngle(Y_AXIS, yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
    const mid = a.clone().add(b).multiplyScalar(0.5);
    this.cur.chutes.push({ a, b, r });

    const outer = new THREE.CylinderGeometry(r + 0.1, r + 0.1, len, 24, 1, true);
    outer.rotateX(Math.PI / 2);
    const ouv = outer.attributes.uv;
    for (let i = 0; i < ouv.count; i++) ouv.setXY(i, ouv.getX(i) * 3, (ouv.getY(i) * len) / TEX_SCALE);
    this.addMesh(outer, this.mats.bark, mid, q);
    const inner = new THREE.CylinderGeometry(r, r, len - 0.02, 24, 1, true);
    inner.rotateX(Math.PI / 2);
    const innerMat = this.mats.logEnd.clone();
    innerMat.side = THREE.BackSide;
    innerMat.map = this.mats.wood.map;
    const innerMesh = this.addMesh(inner, innerMat, mid, q);
    innerMesh.userData.ownMaterial = true;
    for (const end of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.1, 24), this.mats.logEnd);
      const off = new THREE.Vector3(0, 0, (end * len) / 2).applyQuaternion(q);
      ring.position.copy(mid).add(off);
      ring.quaternion.copy(q);
      if (end < 0) ring.rotateY(Math.PI);
      ring.userData.noShadow = true;
      this.cur.group.add(ring);
    }

    // Ring of 12 boxes, rotated half a segment so one flat strip sits at the very
    // bottom (a seam there would make the ball ride in a crease and stall).
    const N = 12;
    const segHalf = r * Math.tan(Math.PI / N) + 0.03;
    for (let i = 0; i < N; i++) {
      const ang = ((i + 0.5) / N) * Math.PI * 2;
      const local = new THREE.Vector3(Math.cos(ang) * (r + 0.05), Math.sin(ang) * (r + 0.05), 0);
      const pos = local.applyQuaternion(q).add(mid);
      const sq = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang + Math.PI / 2));
      const isFloor = Math.sin(ang) < -0.4;
      this.addBody(new CANNON.Box(new CANNON.Vec3(segHalf, 0.06, len / 2)), pos, {
        quaternion: sq, material: this.phys.grass, surface: isFloor ? 'grass' : 'wall',
      });
    }
    const minY = Math.min(p.y1 ?? 0, p.y2 ?? 0), maxY = Math.max(p.y1 ?? 0, p.y2 ?? 0);
    this.extend(Math.min(p.x1, p.x2) - r, Math.min(p.z1, p.z2) - r, Math.max(p.x1, p.x2) + r, Math.max(p.z1, p.z2) + r, maxY, minY);
  }

  // Rocky hill: clustered boulders in the given regions, kept out of the `avoid`
  // boxes (greens) and away from chute interiors. Blobs above `grassAbove` turn green.
  addHill(p) {
    const rnd = seeded(p.seed ?? 5);
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const avoid = (p.avoid ?? []).map(([min, max]) => ({ min, max }));
    const chutes = this.cur.chutes;
    const segDist = (c, s) => {
      const ab = s.b.clone().sub(s.a);
      const t = THREE.MathUtils.clamp(c.clone().sub(s.a).dot(ab) / ab.lengthSq(), 0, 1);
      return c.distanceTo(s.a.clone().addScaledVector(ab, t));
    };
    for (const reg of p.regions) {
      const [rMin, rMax] = reg.radius ?? [0.7, 1.7];
      let placed = 0;
      for (let tries = 0; tries < reg.n * 40 && placed < reg.n; tries++) {
        const r = rMin + rnd() * (rMax - rMin);
        const c = new THREE.Vector3(
          reg.min[0] + rnd() * (reg.max[0] - reg.min[0]),
          reg.min[1] + rnd() * (reg.max[1] - reg.min[1]),
          reg.min[2] + rnd() * (reg.max[2] - reg.min[2])
        );
        const pad = r * 0.9;
        const hitsBox = avoid.some((b) =>
          c.x > b.min[0] - pad && c.x < b.max[0] + pad &&
          c.y > b.min[1] - pad && c.y < b.max[1] + pad &&
          c.z > b.min[2] - pad && c.z < b.max[2] + pad);
        if (hitsBox) continue;
        if (chutes.some((s) => segDist(c, s) < r + s.r + 0.3)) continue;
        const mat = reg.grassAbove != null && c.y > reg.grassAbove ? this.mats.leaves3 : this.mats.rock;
        const rock = new THREE.Mesh(geo, mat);
        rock.position.copy(c);
        rock.scale.set(r * (0.85 + rnd() * 0.4), r * 0.75, r * (0.85 + rnd() * 0.4));
        rock.rotation.set(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI);
        this.cur.group.add(rock);
        placed++;
      }
    }
  }

  // A little mill house straddling the lane; putt through the doorway while the
  // blades sweep past it. `dir` is the direction of travel through the passage.
  addWindmill(p) {
    const y = p.y ?? 0;
    const width = p.width ?? 4, passage = p.passage ?? 1.3, depth = p.depth ?? 1.6;
    const wallH = 1.7, speed = p.speed ?? 1.2;
    const yaw = DIR_YAW[p.dir] ?? 0;
    const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw);
    const origin = new THREE.Vector3(p.x, y, p.z);
    const place = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(origin);

    // Side blocks with a doorway between them.
    const sideW = (width - passage) / 2;
    for (const side of [-1, 1]) {
      const pos = place(side * (passage / 2 + sideW / 2), wallH / 2, 0);
      this.addMesh(boxGeometry(sideW, wallH, depth), this.mats.plaster, pos, q);
      this.addBody(new CANNON.Box(new CANNON.Vec3(sideW / 2, wallH / 2, depth / 2)), pos, {
        quaternion: q, material: this.phys.wall, surface: 'wall',
      });
      // Timber corner posts for the half-timbered look.
      for (const fz of [-1, 1]) {
        const post = this.addMesh(boxGeometry(0.14, wallH, 0.14), this.mats.wood, place(side * (passage / 2 + sideW - 0.07), wallH / 2, fz * (depth / 2 - 0.07)), q);
        post.userData.noShadow = true;
      }
    }
    // Lintel and roof.
    this.addMesh(boxGeometry(passage + 0.3, 0.5, depth), this.mats.wood, place(0, wallH - 0.25, 0), q);
    const roofGeo = new THREE.ConeGeometry(width * 0.62, 1.3, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roof = this.addMesh(roofGeo, this.mats.roof, place(0, wallH + 0.65, 0), q);
    roof.scale.set(1, 1, depth / width);
    // Door frame arch above the passage.
    const frame = this.addMesh(boxGeometry(passage + 0.3, 0.12, 0.12), this.mats.wood, place(0, 1.05, -depth / 2 - 0.02), q);
    frame.userData.noShadow = true;

    // Blades: a cross rotating in the plane of the approach face.
    const hubY = 1.25, bladeLen = 1.2, bladeZ = -depth / 2 - 0.32;
    const hubPos = place(0, hubY, bladeZ);
    const axle = this.addMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10).rotateX(Math.PI / 2), this.mats.metal, place(0, hubY, bladeZ + 0.2), q);
    axle.userData.noShadow = true;
    const bladeGroup = new THREE.Group();
    bladeGroup.position.copy(hubPos);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.16, 12).rotateX(Math.PI / 2), this.mats.metal);
    bladeGroup.add(hub);
    // `sailColors`: four colours (logo colour names or CSS) for the sails.
    const sailColors = p.sailColors ?? null;
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Mesh(boxGeometry(0.1, bladeLen, 0.08), this.mats.wood);
      arm.position.y = bladeLen / 2;
      let sailMat = this.mats.plaster;
      if (sailColors) {
        const c = sailColors[i % sailColors.length];
        sailMat = new THREE.MeshStandardMaterial({ color: LOGO_COLORS[c] ?? c, roughness: 0.7 });
      }
      const sail = new THREE.Mesh(boxGeometry(sailColors ? 0.5 : 0.42, bladeLen * 0.7, 0.03), sailMat);
      if (sailColors) sail.userData.ownMaterial = true;
      sail.position.set(sailColors ? 0.3 : 0.26, bladeLen * 0.62, 0);
      const spoke = new THREE.Group();
      spoke.add(arm, sail);
      spoke.rotation.z = (i * Math.PI) / 2;
      bladeGroup.add(spoke);
    }
    this.cur.group.add(bladeGroup);

    const body = this.addBody(null, hubPos, { material: this.phys.metal, surface: 'mover', type: CANNON.Body.KINEMATIC });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const off = new CANNON.Vec3(-Math.sin(a) * (bladeLen / 2), Math.cos(a) * (bladeLen / 2), 0);
      const rot = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 0, 1), a);
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.22, bladeLen / 2, 0.06)), off, rot);
    }
    const spinAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const cq = new CANNON.Quaternion();
    this.cur.movers.push({
      update: (time) => {
        const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -time * speed);
        const full = q.clone().multiply(spin);
        cq.set(full.x, full.y, full.z, full.w);
        body.quaternion.copy(cq);
        body.angularVelocity.set(-spinAxis.x * speed, -spinAxis.y * speed, -spinAxis.z * speed);
        bladeGroup.quaternion.copy(full);
      },
    });
  }

  // Quiz gate: a question board over a log wall with three stump-framed openings.
  // Coloured answer lintels sit above the openings; invisible sensor zones behind
  // them tell the game which answer the ball went through. `dir` is the direction
  // of travel through the gate; the wall spans `width` across the lane.
  addQuiz(p) {
    const y = p.y ?? 0;
    const width = p.width ?? 8, opening = p.opening ?? 1.1, spacing = p.spacing ?? 2.6;
    const answers = p.answers;
    const n = answers.length;
    const postR = LOG_R * 1.12;
    const yaw = DIR_YAW[p.dir] ?? 0;
    const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw);
    const origin = new THREE.Vector3(p.x, y, p.z);
    const place = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(origin);
    const world2 = (lx, lz) => { const v = place(lx, 0, lz); return [v.x, v.z]; };
    const colors = [LOGO_COLORS.red, LOGO_COLORS.yellow, LOGO_COLORS.blue, LOGO_COLORS.grey];
    const textOn = { [LOGO_COLORS.red]: '#ffffff', [LOGO_COLORS.yellow]: '#2b2b2b', [LOGO_COLORS.blue]: '#ffffff', [LOGO_COLORS.grey]: '#ffffff' };

    // Openings centred on the wall, stumps at each edge, wall segments between.
    // Facing the travel direction (+z), the player's left is local +x, so A goes
    // at +x and answers read A, B, C from left to right.
    const centers = answers.map((_, i) => ((n - 1) / 2 - i) * spacing);
    let cursor = width / 2;
    const order = centers.map((c, i) => [c, i]).sort((a, b) => b[0] - a[0]); // build from +x down
    order.forEach(([c, i]) => {
      const hi = c + opening / 2 + postR, lo = c - opening / 2 - postR;
      const [ax, az] = world2(cursor, 0), [bx, bz] = world2(hi, 0);
      if (cursor - hi > 0.05) this.addWall(ax, az, y, bx, bz, y, WALL_H, { trim: true });
      const [lx, lz] = world2(hi, 0), [rx, rz] = world2(lo, 0);
      this.addPost(lx, lz, y);
      this.addPost(rx, rz, y);
      cursor = lo;

      // Answer lintel above the opening, in a logo colour.
      const color = colors[i % colors.length];
      const lintelW = opening + postR * 2 + 0.1;
      const lintel = this.addMesh(boxGeometry(lintelW, 0.3, 0.1), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }), place(c, y + 0.92, 0), q);
      lintel.userData.ownMaterial = true;
      lintel.userData.noShadow = true;
      const label = String.fromCharCode(65 + i);
      const faceMat = new THREE.MeshStandardMaterial({
        map: plaqueTexture(`${label} · ${answers[i]}`, { bg: color, fg: textOn[color], grain: false, font: 58 }),
        roughness: 0.8,
      });
      for (const side of [-1, 1]) {
        const face = new THREE.Mesh(new THREE.PlaneGeometry(lintelW - 0.06, 0.24), faceMat);
        face.position.set(0, 0, side * 0.052);
        if (side < 0) face.rotation.y = Math.PI;
        face.userData.noShadow = true;
        face.userData.ownMaterial = side > 0;
        lintel.add(face);
      }
    });
    const [ex, ez] = world2(cursor, 0), [fx, fz] = world2(-width / 2, 0);
    if (cursor + width / 2 > 0.05) this.addWall(ex, ez, y, fx, fz, y, WALL_H, { trim: true });

    // Question board on two posts, on the approach side, facing the player.
    // Low enough to stay in the following camera's frame, just clearing the lintels.
    const boardW = 3.4, boardH = 0.85, boardY = y + 1.55, boardZ = -0.7;
    for (const side of [-1, 1]) {
      const post = this.addMesh(new THREE.CylinderGeometry(0.06, 0.07, boardY + boardH / 2 - y, 8), this.mats.wood, place(side * (boardW / 2 - 0.15), y + (boardY + boardH / 2 - y) / 2, boardZ));
      post.userData.noShadow = true;
    }
    const board = this.addMesh(boxGeometry(boardW, boardH, 0.08), this.mats.wood, place(0, boardY, boardZ), q);
    const boardMat = new THREE.MeshStandardMaterial({ map: questionBoardTexture(p.question), roughness: 0.8 });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(boardW - 0.1, boardH - 0.1), boardMat);
    face.position.set(0, 0, -0.045);
    face.rotation.y = Math.PI; // approach side is local -z
    face.userData.noShadow = true;
    face.userData.ownMaterial = true;
    board.add(face);

    // Sensor zones just behind each opening (local frame: travel is +z).
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const toLocal = (px, pz) => {
      const dx = px - p.x, dz = pz - p.z;
      return [dx * cosY - dz * sinY, dx * sinY + dz * cosY];
    };
    const sensors = centers.map((c, i) => ({
      index: i,
      test: (pos) => {
        const [lx, lz] = toLocal(pos.x, pos.z);
        return lx > c - opening / 2 - 0.1 && lx < c + opening / 2 + 0.1 && lz > 0.3 && lz < 1.2;
      },
    }));
    this.cur.quiz = {
      answers,
      correct: p.correct ?? 0,
      sensors,
      triggered: false,
      reveal: () => {
        const old = boardMat.map;
        boardMat.map = questionBoardTexture(p.question, `Riktig svar: ${answers[p.correct ?? 0]}`);
        boardMat.needsUpdate = true;
        old.dispose();
      },
    };
  }

  // Rounded-rectangle shape centred on the origin.
  roundedRect(w, h, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  // Maps the UVs of an extruded shape to 0..1 across its width/height (shape plane).
  fitUVs(geometry, w, h) {
    const pos = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    uv.needsUpdate = true;
  }

  // A Designsystemet Button lying on the green: a blue rounded pad with a white
  // label. Rolling over it "clicks" it, which opens every gate with id `opens`.
  addButton(p) {
    const y = p.y ?? 0, w = p.w ?? 1.6, d = p.d ?? 1.0, lift = 0.025;
    const yaw = p.yaw ?? 0;
    const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw);
    const color = new THREE.Color(LOGO_COLORS[p.color ?? 'blue'] ?? p.color);
    const label = p.label ?? 'Trykk';
    const doneLabel = p.doneLabel ?? 'Åpnet';

    const geo = new THREE.ExtrudeGeometry(this.roundedRect(w, d, Math.min(w, d) * 0.22), { depth: lift, bevelEnabled: false, curveSegments: 12 });
    geo.rotateX(-Math.PI / 2); // shape (x, y) -> world (x, -z); extrusion goes up
    const padMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    const pad = this.addMesh(geo, padMat, new THREE.Vector3(p.x, y + 0.002, p.z), q);
    pad.userData.ownMaterial = true;
    pad.userData.noShadow = true;
    // Shadow-like dark rim under the pad so it reads as raised.
    const rimGeo = new THREE.ShapeGeometry(this.roundedRect(w + 0.08, d + 0.08, Math.min(w, d) * 0.22 + 0.04), 12);
    rimGeo.rotateX(-Math.PI / 2);
    const rim = this.addMesh(rimGeo, new THREE.MeshStandardMaterial({ color: 0x0a2a10, roughness: 1, transparent: true, opacity: 0.35 }), new THREE.Vector3(p.x, y + 0.004, p.z), q);
    rim.userData.ownMaterial = true;
    rim.userData.noShadow = true;

    const labelMat = new THREE.MeshStandardMaterial({ map: textTexture(label, { font: 110 }), transparent: true, roughness: 0.6, depthWrite: false });
    // Label texture is 4:1; lay it flat on the pad, top of the text towards -z
    // (readable for a player approaching from +z).
    const lw = Math.min(w * 0.9, d * 0.9 * 4);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(lw, lw / 4), labelMat);
    face.rotation.x = -Math.PI / 2;
    face.position.set(0, lift + 0.003, 0);
    face.userData.noShadow = true;
    face.userData.ownMaterial = true;
    pad.add(face);

    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const message = p.message ?? 'Knappen er trykket. Porten åpner seg!';
    const hole = this.cur; // pressed later, when the builder has moved on
    const button = {
      pressed: false,
      message,
      test: (pos) => {
        const dx = pos.x - p.x, dz = pos.z - p.z;
        const lx = dx * cosY - dz * sinY, lz = dx * sinY + dz * cosY;
        return Math.abs(lx) < w / 2 && Math.abs(lz) < d / 2 && Math.abs(pos.y - y) < 0.5;
      },
      press: () => {
        if (button.pressed) return;
        button.pressed = true;
        pad.position.y = y - lift + 0.008; // sinks flush: "pressed"
        padMat.color.set(LOGO_COLORS.grey);
        const old = labelMat.map;
        labelMat.map = textTexture(doneLabel, { font: 110 });
        labelMat.needsUpdate = true;
        old.dispose();
        for (const g of hole.gates) if (!p.opens || g.id === p.opens) g.open();
      },
    };
    this.cur.buttons.push(button);
  }

  // Wooden gate across a lane, closed until a button opens it; then it sinks into
  // the ground. Ends are shortened so they disappear inside the corner stumps.
  addGate(p) {
    const y = p.y ?? 0, h = p.h ?? 0.72, t = 0.1;
    const dx = p.x2 - p.x1, dz = p.z2 - p.z1;
    const L = Math.hypot(dx, dz) - LOG_R * 1.12 * 2;
    const yaw = Math.atan2(dx, dz);
    const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw);
    const cx = (p.x1 + p.x2) / 2, cz = (p.z1 + p.z2) / 2;
    const group = new THREE.Group();
    group.position.set(cx, y, cz);
    group.quaternion.copy(q);
    const wood = this.mats.wood;
    const rail = (yy) => {
      const m = new THREE.Mesh(boxGeometry(t, t, L), wood);
      m.position.y = yy;
      group.add(m);
    };
    rail(h - t / 2);
    rail(0.2);
    const n = Math.max(3, Math.round(L / 0.36));
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(boxGeometry(0.06, h, 0.14), wood);
      s.position.set(0, h / 2, -L / 2 + 0.12 + (i / (n - 1)) * (L - 0.24));
      group.add(s);
    }
    this.cur.group.add(group);
    const bodyBase = new THREE.Vector3(cx, y + h / 2, cz);
    const body = this.addBody(new CANNON.Box(new CANNON.Vec3(t / 2, h / 2, L / 2)), bodyBase, {
      quaternion: q, material: this.phys.wall, surface: 'wall', type: CANNON.Body.KINEMATIC,
    });
    const drop = h + 0.15, dur = 1.1;
    const gate = { id: p.id, openedAt: null, open: () => { if (gate.openedAt === null) gate.openedAt = performance.now(); } };
    this.cur.gates.push(gate);
    this.cur.movers.push({
      update: () => {
        if (gate.openedAt === null) return;
        const k = Math.min(1, (performance.now() - gate.openedAt) / 1000 / dur);
        const e = 1 - Math.pow(1 - k, 3);
        group.position.y = y - drop * e;
        body.position.set(bodyBase.x, bodyBase.y - drop * e, bodyBase.z);
        body.velocity.set(0, k < 1 ? -drop / dur : 0, 0);
      },
    });
  }

  // A standing Card panel on two posts: white rounded board with a heading, text
  // and a button graphic. `dir` is the direction it faces; it leans slightly
  // towards the viewer. Posts run from `base` (default: the meadow) to the panel.
  addCard(p) {
    const w = p.w ?? 2.6, h = p.h ?? 1.6, th = 0.06;
    const centerY = p.y ?? 2.3;
    const base = p.base ?? GROUND_Y;
    const yaw = DIR_YAW[p.dir] ?? 0;
    const tilt = p.tilt ?? 0.18;
    const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
    const geo = new THREE.ExtrudeGeometry(this.roundedRect(w, h, 0.12), { depth: th, bevelEnabled: false, curveSegments: 10 });
    geo.translate(0, 0, -th / 2);
    this.fitUVs(geo, w, h);
    const faceMat = new THREE.MeshStandardMaterial({
      map: cardTexture({ title: p.title, lines: p.lines, button: p.button, width: 1024, height: Math.round((1024 * h) / w) }),
      roughness: 0.7,
    });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe6e8eb, roughness: 0.8 });
    const panel = this.addMesh(geo, [faceMat, edgeMat], new THREE.Vector3(p.x, centerY, p.z), q);
    panel.userData.ownMaterial = true;
    // Posts just behind the panel.
    const postH = centerY - base + h * 0.1;
    for (const side of [-1, 1]) {
      const off = new THREE.Vector3(side * (w / 2 - 0.2), 0, -0.12).applyQuaternion(q);
      const post = this.addMesh(new THREE.CylinderGeometry(0.06, 0.075, postH, 10), this.mats.wood,
        new THREE.Vector3(p.x + off.x, base + postH / 2, p.z + off.z));
      post.userData.noShadow = true;
    }
  }

  addCup(cup) {
    if (!this.cur.cupBuilt) {
      // Cup not on a plain floor tile: fall back to a painted disc.
      const disc = new THREE.Mesh(new THREE.CircleGeometry(CUP_R, 40), this.mats.cup);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(cup.x, cup.y + 0.004, cup.z);
      disc.userData.noShadow = true;
      this.cur.group.add(disc);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(CUP_R, CUP_R + 0.07, 40), this.mats.rim);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cup.x, cup.y + 0.005, cup.z);
    ring.userData.noShadow = true;
    // Flagstick stands at the back of the cup so the ball can settle at the bottom.
    const px = cup.x, pz = cup.z - CUP_R * 0.6;
    // Per-hole flag options: `scale` and `logoOnly` (the finale flag).
    const fo = this.cur.flag ?? {};
    const fs = fo.scale ?? 1;
    const poleH = 2.7 + (fs - 1) * 0.8;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, poleH, 10), this.mats.pole);
    pole.position.set(px, cup.y - CUP_DEPTH + poleH / 2, pz);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), this.mats.pole);
    knob.position.set(px, cup.y - CUP_DEPTH + poleH, pz);
    knob.userData.noShadow = true;
    this.cur.group.add(knob);
    // Subdivided so it can ripple; the edge at the pole stays pinned.
    const flagW = 0.85 * fs, flagH = 0.5 * fs;
    const flagGeo = new THREE.PlaneGeometry(flagW, flagH, 14, 6);
    const flagMat = this.mats.flag.clone();
    flagMat.map = flagTexture(fo.logoOnly ? null : this.cur.number);
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.userData.ownMaterial = true;
    flag.position.set(px + flagW / 2 + 0.02, cup.y - CUP_DEPTH + poleH - flagH / 2 - 0.08, pz);
    flag.userData.base = flagGeo.attributes.position.array.slice();
    flag.userData.width = flagW;
    this.cur.flags.push(flag);
    this.cur.group.add(ring, pole, flag);
  }

  addTee(tee) {
    // Small enough to sit inside the yellow turn ring when the ball is on the tee.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.21, 36), this.mats.tee);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(tee.x, tee.y + 0.004, tee.z);
    ring.userData.noShadow = true;
    this.cur.group.add(ring);
  }

  // "HOLE n · PAR p" plaque leaning against the outside of the log wall nearest
  // the tee, so it reads as part of the course rather than a sign in the grass.
  addPlaque(h, number, par) {
    this.mountPlaque(`HULL ${number}  ·  PAR ${par}`, h.tee, h.tee.y, { facing: 'away' });
  }

  // Nails a small board onto the level log wall (at height `y`) nearest to `from`.
  // `facing: 'toward'` turns the text towards `from`; 'away' hangs it on the far side.
  mountPlaque(text, from, y, { facing = 'toward', w = 0.8, bg, fg, font } = {}) {
    let best = null;
    for (const wl of this.cur.walls) {
      if (Math.abs(wl.y1 - wl.y2) > 1e-6 || Math.abs(wl.y1 - y) > 1e-3) continue;
      const ax = wl.x2 - wl.x1, az = wl.z2 - wl.z1;
      const len2 = ax * ax + az * az;
      if (len2 < (w + 0.3) ** 2) continue;
      const t = Math.max(0.15, Math.min(0.85, ((from.x - wl.x1) * ax + (from.z - wl.z1) * az) / len2));
      const px = wl.x1 + ax * t, pz = wl.z1 + az * t;
      const d = Math.hypot(from.x - px, from.z - pz);
      if (!best || d < best.d) best = { d, px, pz, ax, az, len: Math.sqrt(len2) };
    }
    if (!best) return;
    // Board normal: perpendicular to the wall, towards or away from `from`.
    let nx = best.az / best.len, nz = -best.ax / best.len;
    const pointsAtFrom = nx * (from.x - best.px) + nz * (from.z - best.pz) > 0;
    if (pointsAtFrom === (facing === 'away')) { nx = -nx; nz = -nz; }
    // Nail the board onto the log: sit it on the log's surface at the matching
    // tilt, with its centre sunk in a little so the top and bottom edges touch.
    const logY = y + LOG_R - 0.03; // log axis height (see addWall)
    const boardH = 0.2, boardT = 0.035;
    const mountY = logY + 0.06;
    const theta = Math.asin((mountY - logY) / LOG_R); // surface angle above horizontal
    const surface = LOG_R * Math.cos(theta);
    const offset = surface - 0.012 + boardT / 2;
    const yaw = Math.atan2(nx, nz);
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -theta);
    const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw).multiply(tilt);
    const pos = new THREE.Vector3(best.px + nx * offset, mountY, best.pz + nz * offset);
    const board = this.addMesh(boxGeometry(w, boardH, boardT), this.mats.wood, pos, q);
    board.userData.noShadow = true;
    const texOpts = {};
    if (bg) texOpts.bg = LOGO_COLORS[bg] ?? bg;
    if (fg) texOpts.fg = fg;
    if (font) texOpts.font = font;
    const faceMat = new THREE.MeshStandardMaterial({ map: plaqueTexture(text, texOpts), roughness: 0.8 });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.06, 0.16), faceMat);
    face.position.set(0, 0, boardT / 2 + 0.002);
    face.userData.noShadow = true;
    face.userData.ownMaterial = true;
    board.add(face);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const nail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 8), this.mats.bumperCap);
        nail.rotation.x = Math.PI / 2;
        nail.position.set(sx * (w / 2 - 0.04), sy * 0.07, boardT / 2 + 0.005);
        nail.userData.noShadow = true;
        board.add(nail);
      }
    }
  }

  // Ground cover around the hole: grass tufts hugging the border and thinning
  // out with distance, bush clusters against the logs, a few rocks and stumps.
  addDecor(h, seed) {
    const rnd = seeded(seed);
    const b = h.bounds;
    const tee = h.tee;
    const inside = (x, z, pad) => x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad;
    // Distance from a point to the (padded) bounding box edge.
    const edgeDist = (x, z) => {
      const dx = Math.max(b.minX - x, 0, x - b.maxX);
      const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
      return Math.hypot(dx, dz);
    };
    const nearTee = (x, z, r) => Math.hypot(x - tee.x, z - tee.z) < r;
    // Random point in the band around the course, biased towards the border.
    const sample = (maxOut) => {
      for (let tries = 0; tries < 20; tries++) {
        const x = b.minX - maxOut + rnd() * (b.maxX - b.minX + 2 * maxOut);
        const z = b.minZ - maxOut + rnd() * (b.maxZ - b.minZ + 2 * maxOut);
        if (inside(x, z, 0.55)) continue;
        return { x, z, d: edgeDist(x, z) };
      }
      return null;
    };

    // --- grass tufts (instanced crossed quads, lit like the ground) ---
    const tuftCount = 420;
    const tufts = new THREE.InstancedMesh(tuftGeometry(), this.mats.tuft, tuftCount);
    tufts.userData.noShadow = true;
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    let n = 0;
    for (let tries = 0; tries < tuftCount * 4 && n < tuftCount; tries++) {
      const p = sample(9);
      if (!p || nearTee(p.x, p.z, 7.5)) continue;
      // Dense right at the logs, sparse further out.
      if (rnd() > Math.exp(-p.d / 2.6) + 0.06) continue;
      const s = 0.32 + rnd() * 0.42;
      dummy.position.set(p.x, GROUND_Y, p.z);
      dummy.scale.set(s * (1 + rnd() * 0.5), s, s * (1 + rnd() * 0.5));
      dummy.rotation.set(0, rnd() * Math.PI, 0);
      dummy.updateMatrix();
      tufts.setMatrixAt(n, dummy.matrix);
      // The blade texture already carries the green; this is only a light tint variation.
      col.setHSL(0.26 + (rnd() - 0.5) * 0.08, 0.35, 0.78 + rnd() * 0.22, THREE.SRGBColorSpace);
      tufts.setColorAt(n, col);
      n++;
    }
    tufts.count = n;
    tufts.instanceMatrix.needsUpdate = true;
    if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
    tufts.computeBoundingSphere();
    this.cur.group.add(tufts);

    // --- bush clusters, mostly nestled against the border ---
    const bushGeo = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 16; i++) {
      const p = sample(i < 10 ? 2.2 : 8);
      if (!p || nearTee(p.x, p.z, 8) || p.d < 0.5) continue;
      const cluster = new THREE.Group();
      const k = 2 + Math.floor(rnd() * 3);
      for (let j = 0; j < k; j++) {
        const r = 0.3 + rnd() * 0.4;
        const m = new THREE.Mesh(bushGeo, rnd() < 0.5 ? this.mats.bush : this.mats.bushLight);
        m.position.set((rnd() - 0.5) * 0.8, r * 0.72, (rnd() - 0.5) * 0.8);
        m.scale.set(r, r * 0.85, r);
        cluster.add(m);
      }
      cluster.position.set(p.x, GROUND_Y, p.z);
      this.cur.group.add(cluster);
    }

    // --- a few rocks and cut stumps further out ---
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 7; i++) {
      const p = sample(8);
      if (!p || nearTee(p.x, p.z, 8) || p.d < 1.5) continue;
      const s = 0.25 + rnd() * 0.45;
      const rock = new THREE.Mesh(rockGeo, this.mats.rock);
      rock.position.set(p.x, GROUND_Y + s * 0.35, p.z);
      rock.scale.set(s * (0.8 + rnd() * 0.5), s * 0.6, s);
      rock.rotation.set(rnd() * 0.6, rnd() * Math.PI * 2, rnd() * 0.4);
      this.cur.group.add(rock);
    }
    for (let i = 0; i < 3; i++) {
      const p = sample(9);
      if (!p || nearTee(p.x, p.z, 8) || p.d < 2.5) continue;
      const r = 0.3 + rnd() * 0.2, hgt = 0.3 + rnd() * 0.3;
      const geo = new THREE.CylinderGeometry(r, r * 1.1, hgt, 12);
      const stump = new THREE.Mesh(geo, [this.mats.bark, this.mats.logEnd, this.mats.logEnd]);
      stump.position.set(p.x, GROUND_Y + hgt / 2, p.z);
      stump.rotation.y = rnd() * Math.PI;
      this.cur.group.add(stump);
    }
  }
}
