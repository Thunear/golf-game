// Rendering, physics, camera and input for the local player's ball, plus
// display of the other players' balls.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createMaterials, createPhysicsMaterials } from './materials.js';
import { HoleBuilder, CUP_R, CUP_DEPTH, GROUND_Y } from './course/builder.js';
import { labelTexture } from './textures.js';
import { audio } from './audio.js';

export const BALL_R = 0.16;
export const MAX_STROKES = 12;
const FIXED_DT = 1 / 120;
// The cup is a real hole in the floor; the ball counts as sunk once its centre has
// dropped this far below its normal resting height while inside the cup radius.
const SINK_DROP = 0.18;
const SETTLE_MS = 1600; // how long the sunk ball keeps simulating (rattling) before it freezes
const MIN_SHOT = 1.5;
const MAX_SHOT = 16;
// Rolling resistance. Fraction of velocity lost per second on each surface.
// 0.35 gives long, fast greens suited to big maps (full power rolls ~35 m).
const DAMPING_GRASS = 0.35;
const DAMPING_SAND = 0.92;
const SETTLE_SPEED = 0.4;
const AIM_RANGE = 4.5;
const NET_INTERVAL = 1 / 15;
const BLOB_OPACITY = 0.45;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Game {
  constructor({ container, course, onEvent }) {
    this.container = container;
    this.course = course;
    this.onEvent = onEvent || (() => {});
    this.playing = false;
    this.holeIndex = -1;
    this.hole = null;
    this.holeStartAt = 0;
    this.serverNow = () => Date.now();
    this.remotes = new Map();
    this.spectateId = null; // remote player the camera follows once we're done
    this.keys = new Set();
    this.orbit = { yaw: 0, pitch: 0.55, dist: 7.5 };
    this.camTarget = new THREE.Vector3();
    this.input = { mode: null, last: { x: 0, y: 0 }, aim: { dir: new THREE.Vector3(0, 0, -1), power: 0 } };
    this.netTimer = 0;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.shadows = true;

    this._initRenderer();
    this._initScene();
    this._initPhysics();
    this._initBall();
    this._initArrow();
    this._bindInput();

    this.builder = new HoleBuilder(this.scene, this.world, this.mats, this.phys);
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
    this._running = true;
    requestAnimationFrame((t) => this._frame(t));
  }

  // ---------- setup ----------
  _initRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;
  }

  _initScene() {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xc4dccb, 40, 175);
    this.scene = scene;
    this.mats = createMaterials();

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 600);

    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x3f6a30, 0.95);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffeccd, 2.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(3072, 3072);
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.02;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 140;
    scene.add(sun, sun.target);
    this.sun = sun;

    // Gradient sky dome.
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x2b6fd6) },
        horizon: { value: new THREE.Color(0xcfe3f7) },
      },
      vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; varying vec3 vPos;
        void main(){
          float h = normalize(vPos).y;
          float t = smoothstep(-0.05, 0.55, h);
          vec3 col = mix(horizon, top, t);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
    scene.add(sky);

    // Meadow the course sits in, flush with the underside of the green.
    const groundGeo = new THREE.PlaneGeometry(600, 600);
    const guv = groundGeo.attributes.uv;
    for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) * 150, guv.getY(i) * 150);
    const ground = new THREE.Mesh(groundGeo, this.mats.grassDark);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    ground.receiveShadow = true;
    scene.add(ground);

    this._buildForest(scene);
  }

  // Forest around the clearing, in depth: a sparse near ring, then denser and
  // taller trees out to the fog. Instanced so a few hundred trees stay cheap.
  _buildForest(scene) {
    let seed = 42;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const TREES = 240;
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.32, 1, 7);
    trunkGeo.translate(0, 0.5, 0); // pivot at the base
    const coneGeo = new THREE.ConeGeometry(1, 1, 7);
    const ballGeo = new THREE.SphereGeometry(1, 7, 6);
    const trunkMat = this.mats.trunk;
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREES);
    const cones = new THREE.InstancedMesh(coneGeo, leafMat, TREES * 3);
    const balls = new THREE.InstancedMesh(ballGeo, leafMat, TREES * 3);
    trunks.castShadow = cones.castShadow = balls.castShadow = true;
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    let ti = 0, ci = 0, bi = 0;
    for (let i = 0; i < TREES; i++) {
      const a = rnd() * Math.PI * 2;
      // Bias towards the far rings; nothing inside 16 m so no hole is touched.
      const r = 16 + Math.pow(rnd(), 0.55) * 100;
      const far = r / 116;
      const s = (1.2 + rnd() * 1.1) * (1 + far * 0.9);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const trunkH = 3 * s;
      dummy.position.set(x, GROUND_Y, z);
      dummy.rotation.set(0, rnd() * Math.PI, 0);
      dummy.scale.set(s, trunkH, s);
      dummy.updateMatrix();
      trunks.setMatrixAt(ti++, dummy.matrix);

      const hue = 0.3 + (rnd() - 0.5) * 0.06;
      const light = 0.22 + rnd() * 0.16;
      if (rnd() < 0.62) {
        for (let k = 0; k < 3; k++) {
          const cs = (1.9 - k * 0.45) * s;
          dummy.position.set(x, GROUND_Y + trunkH * 0.55 + k * 1.15 * s + 1.3 * s, z);
          dummy.rotation.set(0, rnd() * Math.PI, 0);
          dummy.scale.set(cs, 2.6 * s, cs);
          dummy.updateMatrix();
          cones.setMatrixAt(ci, dummy.matrix);
          cones.setColorAt(ci, col.setHSL(hue, 0.5, light - k * 0.02, THREE.SRGBColorSpace));
          ci++;
        }
      } else {
        for (let k = 0; k < 3; k++) {
          const bs = (1.25 - k * 0.22) * s;
          dummy.position.set(x + (rnd() - 0.5) * s * 0.8, GROUND_Y + trunkH * 0.95 + k * 0.7 * s, z + (rnd() - 0.5) * s * 0.8);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(bs);
          dummy.updateMatrix();
          balls.setMatrixAt(bi, dummy.matrix);
          balls.setColorAt(bi, col.setHSL(hue + 0.02, 0.45, light + 0.04, THREE.SRGBColorSpace));
          bi++;
        }
      }
    }
    trunks.count = ti; cones.count = ci; balls.count = bi;
    for (const m of [trunks, cones, balls]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      // Bounds over all instances; otherwise culling (incl. the shadow pass) uses the unit geometry.
      m.computeBoundingSphere();
    }
    scene.add(trunks, cones, balls);
  }

  _initPhysics() {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
    // Note: SAPBroadphase drops sphere-vs-rotated-box pairs for static walls in
    // cannon-es 0.20, letting the ball roll through them. Naive is fine at this body count.
    world.broadphase = new CANNON.NaiveBroadphase();
    world.allowSleep = true;
    world.solver.iterations = 12;
    this.world = world;
    this.phys = createPhysicsMaterials(world);
  }

  _initBall() {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 32, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 })
    );
    // No shadow-map shadow on the ball: at this size it comes out blotchy. The
    // soft contact blob below does the job cleanly.
    mesh.castShadow = false;
    mesh.visible = false;
    this.scene.add(mesh);
    const blob = this._makeBlob();
    this.scene.add(blob);

    // Yellow "your turn" ring on the ground, shown only while a putt is allowed.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(BALL_R * 1.55, BALL_R * 2.0, 48),
      new THREE.MeshBasicMaterial({ color: 0xffc81e, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 3;
    ring.visible = false;
    this.scene.add(ring);

    const body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Sphere(BALL_R),
      material: this.phys.ball,
      linearDamping: DAMPING_GRASS,
      angularDamping: DAMPING_GRASS,
      allowSleep: true,
      sleepSpeedLimit: 0.6,
      sleepTimeLimit: 0.5,
    });
    body.addEventListener('collide', (e) => {
      const s = e.body.surface;
      if (s === 'wall' || s === 'bumper' || s === 'mover' || s === 'cup') {
        const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
        if (v > 0.8) audio.bounce(v / 10);
      }
    });
    this.ball = {
      mesh,
      blob,
      ring,
      body,
      groundY: 0,
      strokes: 0,
      finished: false,
      canShoot: false,
      shotFrom: new CANNON.Vec3(),
      sinking: null,
      lastShotAt: 0,
      inWorld: false,
      color: '#ffffff',
    };
  }

  // The shadow map is too coarse for a 20 cm ball, so each ball gets a soft
  // contact-shadow decal that sits on the ground beneath it.
  _makeBlob() {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { opacity: { value: BLOB_OPACITY } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float opacity; varying vec2 vUv;
        void main(){
          // Soft disc: darkest under the ball, fading smoothly to the edge.
          float d = length(vUv - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.3, d);
          gl_FragColor = vec4(0.0, 0.0, 0.0, a * opacity);
        }`,
    });
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(BALL_R * 3.2, BALL_R * 3.2), material);
    blob.rotation.x = -Math.PI / 2;
    blob.renderOrder = 2;
    blob.visible = false;
    return blob;
  }

  _placeBlob(blob, pos, groundY) {
    const height = Math.max(0, pos.y - BALL_R - groundY);
    blob.position.set(pos.x, groundY + 0.012, pos.z);
    const k = clamp(1 - height / 0.8, 0, 1);
    blob.material.uniforms.opacity.value = BLOB_OPACITY * k;
    blob.scale.setScalar(1 + height * 0.8);
    blob.visible = k > 0.02;
  }

  _initArrow() {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x6ee27a, transparent: true, opacity: 0.9, depthWrite: false });
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 1), mat);
    shaft.position.z = 0.5;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 16), mat);
    head.rotation.x = Math.PI / 2;
    head.position.z = 1.2;
    const headHolder = new THREE.Group();
    headHolder.add(head);
    group.add(shaft, headHolder);
    group.visible = false;
    group.renderOrder = 5;
    this.scene.add(group);
    this.arrow = { group, shaft, headHolder, mat };
  }

  // ---------- public API ----------
  setLocalPlayer({ color }) {
    this.ball.color = color;
    this.ball.mesh.material.color.set(color);
  }

  setServerClock(fn) {
    this.serverNow = fn;
  }

  setShadows(on) {
    this.shadows = on;
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  setPlaying(on) {
    this.playing = on;
    if (!on) this._clearAim();
  }

  startHole(index, startAt) {
    if (this.hole) this.hole.dispose();
    const def = this.course.holes[index];
    this.holeIndex = index;
    this.holeStartAt = startAt;
    this.hole = this.builder.build(def, index);

    // Fit the sun's shadow frustum to this hole.
    const b = this.hole.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    // Cover the hole plus the meadow and near treeline, so bushes, stumps and
    // trees around the course cast shadows too.
    const radius = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 18;
    this.sun.position.set(cx + 22, 40, cz + 16);
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    sc.left = -radius; sc.right = radius; sc.top = radius; sc.bottom = -radius;
    sc.updateProjectionMatrix();

    // Reset the ball on the tee.
    const ball = this.ball;
    ball.strokes = 0;
    ball.finished = false;
    ball.settleUntil = 0;
    ball.mesh.visible = true;
    ball.mesh.scale.setScalar(1);
    if (!ball.inWorld) {
      this.world.addBody(ball.body);
      ball.inWorld = true;
    }
    const tee = this.hole.tee;
    ball.body.position.set(tee.x, tee.y + BALL_R + 0.01, tee.z);
    ball.body.velocity.setZero();
    ball.body.angularVelocity.setZero();
    ball.body.quaternion.set(0, 0, 0, 1);
    ball.body.sleep();
    ball.shotFrom.copy(ball.body.position);
    ball.mesh.position.copy(ball.body.position);
    ball.groundY = tee.y;
    this._placeBlob(ball.blob, ball.body.position, ball.groundY);

    // Camera behind the ball, looking towards the cup.
    const cup = this.hole.cup;
    this.orbit.yaw = Math.atan2(tee.x - cup.x, tee.z - cup.z);
    this.orbit.pitch = 0.55;
    this.orbit.dist = 7.5;
    this.camTarget.set(tee.x, tee.y, tee.z);
    this._updateCamera(1);
    this.netTimer = NET_INTERVAL; // send position right away
    this._sentSleeping = false;
    this._setSpectate(null);
    for (const r of this.remotes.values()) {
      r.target.set(tee.x, tee.y + BALL_R, tee.z);
      r.mesh.position.copy(r.target);
      r.groundY = tee.y;
    }
    this.onEvent('strokes', { strokes: 0 });
  }

  syncPlayers(players, myId) {
    const seen = new Set();
    for (const p of players) {
      if (p.id === myId) continue;
      seen.add(p.id);
      let r = this.remotes.get(p.id);
      if (!r) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(BALL_R, 24, 18),
          new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.4, transparent: true, opacity: 0.6 })
        );
        mesh.castShadow = false;
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(p.name, p.color), depthTest: false, transparent: true }));
        label.scale.set(1.7, 0.425, 1);
        label.position.y = 0.55;
        mesh.add(label);
        const tee = this.hole?.tee ?? { x: 0, y: 0, z: 0 };
        mesh.position.set(tee.x, tee.y + BALL_R, tee.z);
        this.scene.add(mesh);
        const blob = this._makeBlob();
        this.scene.add(blob);
        r = {
          mesh, label, blob,
          target: mesh.position.clone(),
          quat: new THREE.Quaternion(),
          groundY: tee.y,
          name: p.name,
          color: p.color,
        };
        this.remotes.set(p.id, r);
      }
      if (r.name !== p.name || r.color !== p.color) {
        r.name = p.name; r.color = p.color;
        r.mesh.material.color.set(p.color);
        r.label.material.map.dispose();
        r.label.material.map = labelTexture(p.name, p.color);
      }
      r.mesh.visible = !p.done;
      r.done = p.done;
    }
    for (const [id, r] of this.remotes) {
      if (!seen.has(id)) {
        this.scene.remove(r.mesh, r.blob);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        r.blob.geometry.dispose();
        r.blob.material.dispose();
        r.label.material.map.dispose();
        this.remotes.delete(id);
      }
    }
    this._refreshSpectate();
  }

  // ----- spectating -----
  // Once the local ball is done, the camera follows another player who is still
  // playing; when they finish it moves on to the next one. Tab / Space cycles.
  _spectateCandidates() {
    return [...this.remotes.entries()].filter(([, r]) => !r.done).map(([id]) => id);
  }

  _setSpectate(id) {
    if (this.spectateId === id) return;
    this.spectateId = id;
    const r = id ? this.remotes.get(id) : null;
    this.onEvent('spectate', r ? { id, name: r.name, color: r.color, count: this._spectateCandidates().length } : null);
  }

  _pickSpectate() {
    const ids = this._spectateCandidates();
    if (!ids.length) return this._setSpectate(null);
    // Prefer someone whose ball is moving right now, so there is something to watch.
    const moving = ids.find((id) => {
      const r = this.remotes.get(id);
      return r.mesh.position.distanceTo(r.target) > 0.05;
    });
    this._setSpectate(moving ?? ids[0]);
  }

  _cycleSpectate(dir) {
    const ids = this._spectateCandidates();
    if (!ids.length) return this._setSpectate(null);
    const i = ids.indexOf(this.spectateId);
    this._setSpectate(ids[(i + dir + ids.length) % ids.length]);
  }

  // Called whenever the player list changes: drop a finished/left target, or start
  // spectating if we are done and somebody is still out there.
  _refreshSpectate() {
    if (!this.ball.finished) return this._setSpectate(null);
    const cur = this.spectateId ? this.remotes.get(this.spectateId) : null;
    if (cur && !cur.done) {
      // Keep following, but refresh the count shown in the banner.
      this.onEvent('spectate', { id: this.spectateId, name: cur.name, color: cur.color, count: this._spectateCandidates().length });
      return;
    }
    this._pickSpectate();
  }

  onRemoteBall({ id, p, q }) {
    const r = this.remotes.get(id);
    if (!r || !p) return;
    r.target.set(p[0], p[1], p[2]);
    if (q) r.quat.set(q[0], q[1], q[2], q[3]);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  destroy() {
    this._running = false;
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- input ----------
  _bindInput() {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('pointerdown', (e) => {
      audio.ensure();
      el.setPointerCapture(e.pointerId);
      this.input.last = { x: e.clientX, y: e.clientY };
      if (e.button === 0 && this._canShootNow() && this._hitsBall(e)) {
        this.input.mode = 'aim';
        this._updateAim(e);
      } else {
        this.input.mode = 'orbit';
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (this.input.mode === 'aim') {
        this._updateAim(e);
      } else if (this.input.mode === 'orbit') {
        const dx = e.clientX - this.input.last.x, dy = e.clientY - this.input.last.y;
        this.orbit.yaw -= dx * 0.006;
        this.orbit.pitch = clamp(this.orbit.pitch + dy * 0.005, 0.12, 1.45);
        this.input.last = { x: e.clientX, y: e.clientY };
      } else {
        el.style.cursor = this._canShootNow() && this._hitsBall(e) ? 'grab' : 'default';
      }
    });

    const release = () => {
      if (this.input.mode === 'aim') {
        if (this.input.aim.power > 0.04) this._shoot();
        this._clearAim();
      }
      this.input.mode = null;
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbit.dist = clamp(this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.1), 2.5, 20);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      this.keys.add(e.code);
      if (e.code === 'Escape') this._clearAim();
      if (e.code === 'KeyM') this.onEvent('mute', { muted: audio.toggleMute() });
      if ((e.code === 'Tab' || e.code === 'Space') && this.ball.finished) {
        e.preventDefault();
        this._cycleSpectate(e.shiftKey ? -1 : 1);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _canShootNow() {
    const b = this.ball;
    return this.playing && !b.finished && b.body.sleepState === CANNON.Body.SLEEPING;
  }

  _ray(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return rc.ray;
  }

  _hitsBall(e) {
    const ray = this._ray(e);
    const pos = this.ball.mesh.position;
    const dist = this.camera.position.distanceTo(pos);
    const pick = Math.max(BALL_R * 2.5, dist * 0.045);
    return ray.intersectSphere(new THREE.Sphere(pos, pick), new THREE.Vector3()) !== null;
  }

  _updateAim(e) {
    const ray = this._ray(e);
    const pos = this.ball.mesh.position;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -pos.y);
    const hit = ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return;
    const v = new THREE.Vector3(pos.x - hit.x, 0, pos.z - hit.z);
    const len = v.length();
    const aim = this.input.aim;
    aim.power = clamp((len - 0.15) / AIM_RANGE, 0, 1);
    if (len > 0.05) aim.dir.copy(v).normalize();
    this._showArrow(aim);
    this.onEvent('aim', { power: aim.power });
  }

  _showArrow(aim) {
    const a = this.arrow;
    a.group.visible = aim.power > 0.02;
    a.group.position.copy(this.ball.mesh.position);
    a.group.position.y = this.ball.mesh.position.y - BALL_R + 0.03;
    a.group.rotation.y = Math.atan2(aim.dir.x, aim.dir.z);
    const len = 0.6 + aim.power * 3.2;
    a.shaft.scale.z = len;
    a.shaft.position.z = len / 2;
    a.headHolder.position.z = len - 1.0;
    const c = new THREE.Color();
    if (aim.power < 0.5) c.lerpColors(new THREE.Color(0x6ee27a), new THREE.Color(0xffd23f), aim.power * 2);
    else c.lerpColors(new THREE.Color(0xffd23f), new THREE.Color(0xff4b4b), (aim.power - 0.5) * 2);
    a.mat.color.copy(c);
  }

  _clearAim() {
    this.arrow.group.visible = false;
    this.input.aim.power = 0;
    if (this.input.mode === 'aim') this.input.mode = null;
    this.onEvent('aim', { power: null });
  }

  _shoot() {
    const { dir, power } = this.input.aim;
    const speed = MIN_SHOT + power * (MAX_SHOT - MIN_SHOT);
    const b = this.ball;
    b.shotFrom.copy(b.body.position);
    b.body.wakeUp();
    b.body.velocity.set(dir.x * speed, 0, dir.z * speed);
    // Start it rolling (not sliding) so friction doesn't eat the launch speed.
    // For pure rolling, omega x (0,-r,0) must equal -v, giving omega = (vz, 0, -vx) / r.
    const w = speed / BALL_R;
    b.body.angularVelocity.set(dir.z * w, 0, -dir.x * w);
    b.strokes++;
    b.lastShotAt = performance.now();
    audio.hit(power);
    this.onEvent('shot', { strokes: b.strokes, power });
  }

  // ---------- per-frame ----------
  _frame(now) {
    if (!this._running) return;
    requestAnimationFrame((t) => this._frame(t));
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = Math.min(dt, 0.05);

    if (this.hole) {
      const t = (this.serverNow() - this.holeStartAt) / 1000;
      this.hole.update(t);

      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < 8) {
        this.world.step(FIXED_DT);
        this._settleBall();
        this._cupStep();
        this.accumulator -= FIXED_DT;
        steps++;
      }
      this._updateBall(dt);
      this._updateRemotes(dt);
      this._netTick(dt);
    }

    this._handleKeys(dt);
    this._updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  // Extra rolling resistance at low speed so the ball settles instead of creeping.
  // Only on (near) level ground: on a slope the ball must be free to roll back down,
  // and it must not fall asleep there either.
  _settleBall() {
    const body = this.ball.body;
    if (this.ball.finished || body.sleepState === CANNON.Body.SLEEPING) return;
    let onSlope = false;
    for (const c of this.world.contacts) {
      if (c.bi !== body && c.bj !== body) continue;
      // Contact normal points from bi to bj; we only care about how vertical it is.
      if (Math.abs(c.ni.y) > 0.5 && Math.abs(c.ni.y) < 0.995) onSlope = true;
    }
    body.allowSleep = !onSlope;
    if (onSlope) return;
    const speed = body.velocity.length();
    if (speed < SETTLE_SPEED) {
      body.velocity.scale(0.92, body.velocity);
      body.angularVelocity.scale(0.92, body.angularVelocity);
    }
  }

  // Runs every physics step. The cup is real geometry, so this only has to notice
  // that the ball has actually fallen in.
  _cupStep() {
    const b = this.ball;
    const body = b.body;
    if (b.finished || !this.hole) return;
    const cup = this.hole.cup;
    const pos = body.position;

    // Quiz gate: the first opening the ball passes through decides the outcome.
    const qz = this.hole.quiz;
    if (qz && !qz.triggered) {
      const hit = qz.sensors.find((s) => s.test(pos));
      if (hit) {
        qz.triggered = true;
        const ok = hit.index === qz.correct;
        qz.reveal();
        if (ok) audio.correct(); else audio.fail();
        this.onEvent('toast', {
          message: ok ? 'Riktig! Snarveien ligger rett fram.' : `Ikke helt. Riktig svar var «${qz.answers[qz.correct]}».`,
        });
      }
    }
    // Buttons on the green: rolling over one "clicks" it (opens its gate).
    for (const bt of this.hole.buttons) {
      if (!bt.pressed && bt.test(pos)) {
        bt.press();
        audio.correct();
        this.onEvent('toast', { message: bt.message });
      }
    }
    const d = Math.hypot(cup.x - pos.x, cup.z - pos.z);
    if (d < CUP_R && pos.y < cup.y + BALL_R - SINK_DROP) this._sink();
  }

  _updateBall(dt) {
    const b = this.ball;
    if (b.finished) {
      if (b.inWorld) {
        // Sunk: follow the body while it rattles in the cup, then freeze it there.
        b.mesh.position.copy(b.body.position);
        b.mesh.quaternion.copy(b.body.quaternion);
        this._placeBlob(b.blob, b.body.position, this.hole.cup.y - CUP_DEPTH);
        if (performance.now() > b.settleUntil) {
          this.world.removeBody(b.body);
          b.inWorld = false;
        }
      } else {
        // Done (in the cup or out of strokes): hide our ball so the spectator
        // view shows only the players still going.
        b.mesh.visible = false;
        b.blob.visible = false;
      }
      return;
    }
    const body = b.body;
    const pos = body.position;
    b.mesh.position.copy(pos);
    b.mesh.quaternion.copy(body.quaternion);

    // Which surfaces are we touching?
    let onSand = false, inWater = false, onGround = false;
    for (const c of this.world.contacts) {
      const other = c.bi === body ? c.bj : c.bj === body ? c.bi : null;
      if (!other) continue;
      if (other.surface === 'sand') onSand = true;
      if (other.surface === 'water') inWater = true;
      if (other.surface === 'grass' || other.surface === 'sand') onGround = true;
    }
    body.linearDamping = onSand ? DAMPING_SAND : DAMPING_GRASS;
    body.angularDamping = onSand ? DAMPING_SAND : DAMPING_GRASS;
    if (onGround || body.sleepState === CANNON.Body.SLEEPING) b.groundY = pos.y - BALL_R;
    this._placeBlob(b.blob, pos, b.groundY);

    // Turn ring: visible only while a putt is allowed, with a gentle pulse.
    const ring = b.ring;
    ring.visible = this._canShootNow();
    if (ring.visible) {
      const pulse = Math.sin(performance.now() * 0.004);
      ring.position.set(pos.x, b.groundY + 0.016, pos.z);
      ring.scale.setScalar(1 + pulse * 0.04);
      ring.material.opacity = 0.8 + pulse * 0.15;
    }

    const bounds = this.hole.bounds;
    if (inWater) return this._penalty('Plask! +1 slag', 'splash');
    if (
      pos.y < bounds.minY - 4 ||
      pos.x < bounds.minX - 8 || pos.x > bounds.maxX + 8 ||
      pos.z < bounds.minZ - 8 || pos.z > bounds.maxZ + 8
    ) {
      return this._penalty('Utenfor banen! +1 slag', 'fail');
    }

    const sleeping = body.sleepState === CANNON.Body.SLEEPING;
    if (sleeping !== b.canShoot) {
      b.canShoot = sleeping;
      this.onEvent('ready', { ready: sleeping });
    }
    if (sleeping && b.strokes >= MAX_STROKES && performance.now() - b.lastShotAt > 400) {
      this._finish(MAX_STROKES, false);
    }
  }

  _penalty(message, sound) {
    const b = this.ball;
    b.body.position.copy(b.shotFrom);
    b.body.velocity.setZero();
    b.body.angularVelocity.setZero();
    b.body.sleep();
    b.mesh.position.copy(b.body.position);
    b.groundY = b.body.position.y - BALL_R;
    b.strokes++;
    if (sound === 'splash') audio.splash(); else audio.fail();
    this.onEvent('penalty', { strokes: b.strokes, message });
    if (b.strokes >= MAX_STROKES) this._finish(MAX_STROKES, false);
  }

  _sink() {
    const b = this.ball;
    // Keep simulating for a moment so the ball rattles and settles in the cup.
    b.settleUntil = performance.now() + SETTLE_MS;
    audio.sink();
    this._finish(b.strokes, true);
  }

  _finish(strokes, sunk) {
    const b = this.ball;
    if (b.finished) return;
    b.finished = true;
    b.strokes = strokes;
    if (b.inWorld && !sunk) {
      this.world.removeBody(b.body);
      b.inWorld = false;
    }
    b.ring.visible = false;
    this._clearAim();
    this.onEvent('done', { strokes, sunk });
    // Give the sink animation a moment before the camera leaves the cup.
    setTimeout(() => { if (this.ball.finished) this._pickSpectate(); }, sunk ? 1400 : 300);
  }

  _updateRemotes(dt) {
    const k = 1 - Math.exp(-dt * 14);
    for (const r of this.remotes.values()) {
      r.mesh.position.lerp(r.target, k);
      r.mesh.quaternion.slerp(r.quat, k);
      // Track the ground under a remote ball: whenever it is basically resting
      // at ball height above some level, remember that level.
      const rest = r.mesh.position.y - BALL_R;
      if (Math.abs(rest - r.groundY) > 0.02 && Math.abs(r.target.y - r.mesh.position.y) < 0.01) r.groundY = rest;
      if (r.done) r.blob.visible = false;
      else this._placeBlob(r.blob, r.mesh.position, r.groundY);
      // Other balls are ghosted so they never hide your own; the one you are
      // watching is drawn solid.
      const solid = this.ball.finished && this.spectateId !== null && this.remotes.get(this.spectateId) === r;
      r.mesh.material.opacity = solid ? 1 : 0.6;
    }
  }

  _netTick(dt) {
    const b = this.ball;
    if (b.finished && !b.inWorld) return;
    this.netTimer += dt;
    if (this.netTimer < NET_INTERVAL) return;
    this.netTimer = 0;
    const awake = b.body.sleepState !== CANNON.Body.SLEEPING;
    if (!awake && this._sentSleeping) return;
    this._sentSleeping = !awake;
    const p = b.body.position, q = b.body.quaternion;
    const r = (v) => Math.round(v * 1000) / 1000;
    this.onEvent('ball', { p: [r(p.x), r(p.y), r(p.z)], q: [r(q.x), r(q.y), r(q.z), r(q.w)] });
  }

  _handleKeys(dt) {
    const k = this.keys;
    if (k.has('ArrowLeft') || k.has('KeyA')) this.orbit.yaw += dt * 2.2;
    if (k.has('ArrowRight') || k.has('KeyD')) this.orbit.yaw -= dt * 2.2;
    if (k.has('ArrowUp') || k.has('KeyW')) this.orbit.dist = clamp(this.orbit.dist - dt * 6, 2.5, 20);
    if (k.has('ArrowDown') || k.has('KeyS')) this.orbit.dist = clamp(this.orbit.dist + dt * 6, 2.5, 20);
    if (k.has('KeyQ')) this.orbit.pitch = clamp(this.orbit.pitch + dt * 1.2, 0.12, 1.45);
    if (k.has('KeyE')) this.orbit.pitch = clamp(this.orbit.pitch - dt * 1.2, 0.12, 1.45);
  }

  _updateCamera(dt) {
    const b = this.ball;
    let target;
    const spec = b.finished && this.spectateId ? this.remotes.get(this.spectateId) : null;
    if (spec && !spec.done) target = spec.mesh.position;
    else if (b.finished && this.hole) target = new THREE.Vector3(this.hole.cup.x, this.hole.cup.y, this.hole.cup.z);
    else target = b.mesh.position;
    const k = 1 - Math.exp(-dt * 8);
    this.camTarget.lerp(target, k);
    const { yaw, pitch, dist } = this.orbit;
    const off = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch) * dist,
      Math.sin(pitch) * dist,
      Math.cos(yaw) * Math.cos(pitch) * dist
    );
    this.camera.position.copy(this.camTarget).add(off);
    this.camera.lookAt(this.camTarget.x, this.camTarget.y + 0.3, this.camTarget.z);
  }
}
