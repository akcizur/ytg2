import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const SAVE_KEY = 'gotdope-save-v2';
const WORLD_SIZE = 2400;
const WORLD_HALF = WORLD_SIZE / 2;
const BLOCK = 300;
const ROAD = 82;
const MAX_PIXEL_RATIO = 1.75;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function dist2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
function makeRng(seed = 1337) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ t >>> 15, 1 | t);
    r ^= r + Math.imul(r ^ r >>> 7, 61 | r);
    return ((r ^ r >>> 14) >>> 0) / 4294967296;
  };
}
function grayscale(value) { return new THREE.Color(value, value, value); }

export class Game {
  constructor({ canvas, input, ui }) {
    this.canvas = canvas; this.input = input; this.ui = ui;

    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl2')) throw new Error('WEBGL2_UNAVAILABLE');

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x111111, 1);

    this.scene = new THREE.Scene();
    this.scene.background = grayscale(0.055);
    this.scene.fog = new THREE.FogExp2(0x121212, 0.0021);

    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 2600);
    this.camera.position.set(260, 430, 330);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.38, 0.62, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.rng = makeRng(20261006);
    this.state = {
      started: false, paused: true, pauseReason: 'launcher', dead: false,
      time: 18.5, money: 1250, health: 100, stamina: 100, wanted: 0, heat: 0, score: 0,
      weather: 0, weatherNames: ['CLEAR', 'RAIN', 'STORM', 'FOG'],
      mission: 0, missionStep: 0, missionKills: 0, autosave: 7, elapsed: 0
    };

    this.world = { roads: [], colliders: [], buildings: [], lights: [], cars: [], npcs: [], puddles: [], particles: [], rain: null, rainMaterial: null, jobs: [] };
    this.player = { x: -450, z: -450, yaw: 0, car: null, fireCooldown: 0 };

    this.materials = this.createMaterials();
    this.createLighting();
    this.createCity();
    this.createPlayer();
    this.createJobs();
    this.createRain();
    this.placeActors();
    this.bindEvents();
    this.loadSave();

    this.updateHUD();
    this.render();

    this.boundLoop = (time) => this.loop(time);
    this.frameId = requestAnimationFrame(this.boundLoop);
  }

  createMaterials() {
    return {
      asphalt: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.92, flatShading: true }),
      road: new THREE.MeshStandardMaterial({ color: 0x232323, roughness: 0.98, flatShading: true }),
      roof: new THREE.MeshStandardMaterial({ color: 0x4b4b4b, roughness: 0.98, flatShading: true }),
      grass: new THREE.MeshStandardMaterial({ color: 0x4e4e4e, roughness: 1, flatShading: true }),
      lane: new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1, flatShading: true })
    };
  }

  createLighting() {
    this.ambient = new THREE.HemisphereLight(0xffffff, 0x141414, 1.55);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xffffff, 3.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 1500;
    this.sun.shadow.camera.left = -600; this.sun.shadow.camera.right = 600;
    this.sun.shadow.camera.top = 600; this.sun.shadow.camera.bottom = -600;
    this.scene.add(this.sun, this.sun.target);

    this.moon = new THREE.DirectionalLight(0xbababa, 0.28);
    this.scene.add(this.moon, this.moon.target);
  }

  createCity() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE), this.materials.asphalt);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);

    for (let x = -WORLD_HALF; x <= WORLD_HALF; x += BLOCK) {
      const road = new THREE.Mesh(new THREE.BoxGeometry(ROAD, 0.14, WORLD_SIZE), this.materials.road);
      road.position.set(x, 0.07, 0); road.receiveShadow = true; this.scene.add(road);
      this.world.roads.push({ x, z: 0, vertical: true });
    }
    for (let z = -WORLD_HALF; z <= WORLD_HALF; z += BLOCK) {
      const road = new THREE.Mesh(new THREE.BoxGeometry(WORLD_SIZE, 0.14, ROAD), this.materials.road);
      road.position.set(0, 0.08, z); road.receiveShadow = true; this.scene.add(road);
      this.world.roads.push({ x: 0, z, vertical: false });
    }

    for (let x = -WORLD_HALF; x <= WORLD_HALF; x += BLOCK) {
      for (let z = -WORLD_HALF; z < WORLD_HALF; z += 86) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(2, 0.16, 34), this.materials.lane);
        dash.position.set(x, 0.16, z); this.scene.add(dash);
      }
    }
    for (let z = -WORLD_HALF; z <= WORLD_HALF; z += BLOCK) {
      for (let x = -WORLD_HALF; x < WORLD_HALF; x += 86) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(34, 0.16, 2), this.materials.lane);
        dash.position.set(x, 0.16, z); this.scene.add(dash);
      }
    }

    for (let bx = -WORLD_HALF + BLOCK / 2; bx < WORLD_HALF; bx += BLOCK) {
      for (let bz = -WORLD_HALF + BLOCK / 2; bz < WORLD_HALF; bz += BLOCK) {
        if (this.rng() < 0.14) this.createPark(bx, bz);
        else {
          const w = 125 + this.rng() * 96, d = 125 + this.rng() * 96, h = 24 + this.rng() * 120;
          this.createBuilding(bx + (this.rng() - 0.5) * 45, bz + (this.rng() - 0.5) * 45, w, d, h);
        }
      }
    }

    for (let i = 0; i < 82; i += 1) {
      const vertical = this.rng() > 0.5;
      const roadIndex = Math.floor(this.rng() * 9) - 4;
      const roadCoord = roadIndex * BLOCK;
      const x = vertical ? roadCoord + (this.rng() > 0.5 ? 30 : -30) : -WORLD_HALF + this.rng() * WORLD_SIZE;
      const z = vertical ? -WORLD_HALF + this.rng() * WORLD_SIZE : roadCoord + (this.rng() > 0.5 ? 30 : -30);
      this.createStreetLight(x, z);
    }

    for (let i = 0; i < 32; i += 1) {
      this.createPuddle(-1000 + this.rng() * 2000, -1000 + this.rng() * 2000, 5 + this.rng() * 17);
    }

    this.scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(1750, 28, 18),
      new THREE.MeshBasicMaterial({ color: 0x101010, side: THREE.BackSide })
    ));
  }

  createBuilding(x, z, w, d, h) {
    const material = new THREE.MeshStandardMaterial({
      color: grayscale(0.22 + this.rng() * 0.26),
      roughness: 0.94, flatShading: true
    });
    const building = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    building.position.set(x, h / 2, z);
    building.castShadow = true; building.receiveShadow = true; this.scene.add(building);

    this.world.buildings.push(building);
    this.world.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 4, 2, d + 4), this.materials.roof);
    roof.position.set(x, h + 1, z); roof.castShadow = true; roof.receiveShadow = true; this.scene.add(roof);

    if (h > 70) {
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(Math.min(w, d) * 0.18, Math.min(w, d) * 0.24, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x5b5b5b, roughness: 1, flatShading: true })
      );
      cap.position.set(x, h + 7, z); cap.castShadow = true; this.scene.add(cap);
    }
  }

  createPark(x, z) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(226, 0.16, 226), this.materials.grass);
    base.position.set(x, 0.08, z); base.receiveShadow = true; this.scene.add(base);

    for (let i = 0; i < 13; i += 1) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 1, 9, 6),
        new THREE.MeshStandardMaterial({ color: 0x383838, roughness: 1, flatShading: true })
      );
      trunk.position.y = 4.5;
      const crown = new THREE.Mesh(
        new THREE.IcosahedronGeometry(6 + this.rng() * 3, 1),
        new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 1, flatShading: true })
      );
      crown.position.y = 10;
      tree.add(trunk, crown);
      tree.position.set(x + (this.rng() - 0.5) * 190, 0, z + (this.rng() - 0.5) * 190);
      tree.traverse((node) => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
      this.scene.add(tree);
    }
  }

  createStreetLight(x, z) {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.72, 18, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.55, metalness: 0.45, flatShading: true })
    );
    pole.position.y = 9;

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 1.1, 2.3),
      new THREE.MeshStandardMaterial({
        color: 0x1a1a1a, roughness: 0.5, metalness: 0.25,
        emissive: 0xffffff, emissiveIntensity: 0.15, flatShading: true
      })
    );
    head.position.y = 18;

    const point = new THREE.PointLight(0xffffff, 5.2, 108, 2);
    point.position.y = 16;

    group.add(pole, head, point);
    group.position.set(x, 0, z);
    this.scene.add(group);
    this.world.lights.push({ point, head });
  }

  createPuddle(x, z, size) {
    const puddle = new THREE.Mesh(
      new THREE.CircleGeometry(size, 24),
      new THREE.MeshPhysicalMaterial({
        color: 0x6d6d6d, roughness: 0.12, metalness: 0.72, transparent: true, opacity: 0.18
      })
    );
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(x, 0.15, z);
    this.scene.add(puddle);
    this.world.puddles.push(puddle);
  }

  createPlayer() {
    this.playerGroup = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.62, 1.6, 5, 8),
      new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.85, flatShading: true })
    );
    body.position.y = 1.25;

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x929292, roughness: 0.9, flatShading: true })
    );
    head.position.y = 2.72;

    this.playerGroup.add(body, head);
    this.playerGroup.traverse((node) => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
    this.scene.add(this.playerGroup);
    this.playerGroup.position.set(this.player.x, 0, this.player.z);
  }

  createCar({ police = false, color = 0.4 } = {}) {
    const group = new THREE.Group();
    const tone = police ? 0.72 : 0.25 + color * 0.38;
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: grayscale(tone), roughness: 0.38, metalness: 0.25, flatShading: true });
    const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.25, metalness: 0.05, flatShading: true });
    const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1, flatShading: true });

    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.15, 8.6), bodyMaterial); body.position.y = 1.05;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.35, 1.0, 4.15), glassMaterial); cabin.position.set(0, 1.8, -0.15);
    group.add(body, cabin);

    for (const x of [-1.9, 1.9]) {
      for (const z of [-2.9, 2.9]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.48, 12), tireMaterial);
        wheel.rotation.z = Math.PI / 2; wheel.position.set(x, 0.76, z); group.add(wheel);
      }
    }

    const headlightMaterial = new THREE.MeshStandardMaterial({
      color: 0xdcdcdc, emissive: 0xffffff, emissiveIntensity: 1.0, flatShading: true
    });
    for (const x of [-1.15, 1.15]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.38, 0.2), headlightMaterial);
      lamp.position.set(x, 1.3, 4.36); group.add(lamp);
    }

    if (police) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.22, 0.72),
        new THREE.MeshStandardMaterial({ color: 0x8a8a8a, emissive: 0xffffff, emissiveIntensity: 2.6, flatShading: true })
      );
      bar.position.y = 2.45; group.add(bar);
    }

    const leftHeadlight = new THREE.SpotLight(0xffffff, 6.5, 115, Math.PI / 7, 0.44, 1.4);
    const rightHeadlight = leftHeadlight.clone();
    leftHeadlight.position.set(-1.15, 1.55, 4.0);
    rightHeadlight.position.set(1.15, 1.55, 4.0);
    leftHeadlight.target.position.set(-1.15, 0, 28);
    rightHeadlight.target.position.set(1.15, 0, 28);
    group.add(leftHeadlight, leftHeadlight.target, rightHeadlight, rightHeadlight.target);
    leftHeadlight.visible = false; rightHeadlight.visible = false;

    group.traverse((node) => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
    this.scene.add(group);

    const car = {
      group, x: 0, z: 0, yaw: 0, speed: 0, maxSpeed: police ? 12 : 8 + this.rng() * 4,
      health: 100, police, occupied: false, stolen: false, marked: false,
      headlights: [leftHeadlight, rightHeadlight], marker: null
    };

    this.world.cars.push(car);
    return car;
  }

  createNPC(kind = 'civilian') {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.52, 1.45, 4, 7),
      new THREE.MeshStandardMaterial({ color: kind === 'gang' ? 0x4f4f4f : 0x575757, roughness: 0.95, flatShading: true })
    );
    body.position.y = 1.15;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.43, 9, 7),
      new THREE.MeshStandardMaterial({ color: 0x898989, roughness: 1, flatShading: true })
    );
    head.position.y = 2.55;
    group.add(body, head);
    group.traverse((node) => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
    this.scene.add(group);

    const npc = {
      group, x: 0, z: 0, yaw: this.rng() * Math.PI * 2,
      speed: kind === 'civilian' ? 1.4 + this.rng() * 1.6 : 2.2,
      health: kind === 'gang' ? 60 : 35, kind, alive: true, fire: this.rng()
    };
    this.world.npcs.push(npc);
    return npc;
  }

  createJobs() {
    this.jobs = [
      { x: -450, z: -450, label: 'SAFEHOUSE', tone: 0xffffff },
      { x: 900, z: -900, label: 'DOCKS', tone: 0xbdbdbd },
      { x: 900, z: 900, label: 'GARAGE', tone: 0x888888 },
      { x: -850, z: 720, label: 'MARKET', tone: 0xe0e0e0 }
    ];

    for (const job of this.jobs) {
      const group = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(8, 0.8, 8, 32),
        new THREE.MeshBasicMaterial({ color: job.tone, transparent: true, opacity: 0.9 })
      );
      ring.rotation.x = Math.PI / 2;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.35, 20, 8),
        new THREE.MeshBasicMaterial({ color: job.tone, transparent: true, opacity: 0.12, depthWrite: false })
      );
      beam.position.y = 10;
      group.add(ring, beam);
      group.position.set(job.x, 0.45, job.z);
      this.scene.add(group);
      this.world.jobs.push({ ...job, group });
    }
  }

  createRain() {
    const count = 4200;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (this.rng() - 0.5) * 1500;
      positions[i * 3 + 1] = this.rng() * 520;
      positions[i * 3 + 2] = (this.rng() - 0.5) * 1500;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'uniform float uTime; varying float vAlpha; void main(){vec3 p=position;p.y=mod(p.y-uTime*320.0,520.0);p.x+=sin(p.z*.01+uTime)*3.0;vec4 mvPosition=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mvPosition;gl_PointSize=2.1;vAlpha=.18+.82*clamp(p.y/520.0,0.0,1.0);}',
      fragmentShader: 'varying float vAlpha;void main(){vec2 uv=gl_PointCoord.xy-.5;if(length(uv)>.5)discard;gl_FragColor=vec4(.84,.84,.84,.25*vAlpha);}'
    });

    this.world.rainMaterial = material;
    this.world.rain = new THREE.Points(geometry, material);
    this.world.rain.visible = false;
    this.world.rain.frustumCulled = false;
    this.scene.add(this.world.rain);
  }

  placeActors() {
    const roadCoords = [-900, -600, -300, 0, 300, 600, 900];

    for (let i = 0; i < 34; i += 1) {
      const car = this.createCar({ color: this.rng() });
      const vertical = this.rng() > 0.5;

      if (vertical) {
        car.x = roadCoords[Math.floor(this.rng() * roadCoords.length)] + (this.rng() > 0.5 ? 26 : -26);
        car.z = -1000 + this.rng() * 2000; car.yaw = Math.PI / 2;
      } else {
        car.x = -1000 + this.rng() * 2000;
        car.z = roadCoords[Math.floor(this.rng() * roadCoords.length)] + (this.rng() > 0.5 ? 26 : -26);
        car.yaw = 0;
      }
      this.syncCar(car);
    }

    for (let i = 0; i < 3; i += 1) {
      const police = this.createCar({ police: true, color: 0.85 });
      police.x = roadCoords[i + 1]; police.z = roadCoords[i + 2];
      police.yaw = this.rng() > 0.5 ? 0 : Math.PI / 2;
      this.syncCar(police);
    }

    for (let i = 0; i < 65; i += 1) this.placeNPC(this.createNPC('civilian'));
    for (let i = 0; i < 7; i += 1) this.placeNPC(this.createNPC('gang'));
  }

  placeNPC(npc) {
    const road = this.world.roads[Math.floor(this.rng() * this.world.roads.length)];
    npc.x = road.x + (road.vertical ? (this.rng() - 0.5) * 50 : 0);
    npc.z = road.z + (road.vertical ? 0 : (this.rng() - 0.5) * 50);
    this.syncNPC(npc);
  }

  syncCar(car) { car.group.position.set(car.x, 0, car.z); car.group.rotation.y = car.yaw; }
  syncNPC(npc) { npc.group.position.set(npc.x, 0, npc.z); npc.group.rotation.y = npc.yaw; }

  isBlocked(x, z, radius = 1) {
    for (const box of this.world.colliders) {
      const px = clamp(x, box.minX, box.maxX);
      const pz = clamp(z, box.minZ, box.maxZ);
      if (Math.hypot(x - px, z - pz) < radius) return true;
    }
    return x < -WORLD_HALF + radius || x > WORLD_HALF - radius || z < -WORLD_HALF + radius || z > WORLD_HALF - radius;
  }

  moveCircle(x, z, dx, dz, radius) {
    let nextX = x + dx; let nextZ = z + dz;
    if (this.isBlocked(nextX, z, radius)) nextX = x;
    if (this.isBlocked(nextX, nextZ, radius)) nextZ = z;
    return { x: nextX, z: nextZ };
  }

  nearestCar(maxDistance = 7) {
    let nearest = null; let best = maxDistance;
    for (const car of this.world.cars) {
      if (car.occupied) continue;
      const distance = dist2(car.x, car.z, this.player.x, this.player.z);
      if (distance < best) { best = distance; nearest = car; }
    }
    return nearest;
  }

  toggleVehicle() {
    if (this.player.car) {
      const car = this.player.car;
      const sideX = Math.cos(car.yaw + Math.PI / 2) * 4.4;
      const sideZ = Math.sin(car.yaw + Math.PI / 2) * 4.4;
      const exit = this.moveCircle(car.x + sideX, car.z + sideZ, 0, 0, 1.15);

      this.player.x = exit.x; this.player.z = exit.z;
      car.occupied = false; this.setHeadlights(car, false);
      this.player.car = null; this.playerGroup.visible = true;
      return;
    }

    const car = this.nearestCar();
    if (!car) return;

    this.player.car = car; car.occupied = true; car.stolen = true;
    this.setHeadlights(car, true);
    this.state.wanted = clamp(this.state.wanted + 0.7, 0, 5);
    this.state.heat = 8; this.playerGroup.visible = false;
  }

  setHeadlights(car, enabled) { for (const light of car.headlights) light.visible = enabled; }

  updateAim() {
    const aim = this.input.aim();
    if (aim.type === 'none') return null;

    if (aim.type === 'mouse') {
      const rect = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((aim.x - rect.left) / rect.width) * 2 - 1,
        -(((aim.y - rect.top) / rect.height) * 2 - 1)
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, this.camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const target = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, target)) return null;

      const direction = new THREE.Vector3(target.x - this.player.x, 0, target.z - this.player.z);
      if (direction.lengthSq() < 0.0001) return null;
      return direction.normalize();
    }

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    up.y = 0; up.normalize();

    const direction = right.multiplyScalar(aim.x).add(up.multiplyScalar(-aim.y));
    direction.y = 0;
    if (direction.lengthSq() < 0.0001) return null;
    return direction.normalize();
  }

  fire() {
    if (this.player.fireCooldown > 0 || this.state.health <= 0) return;
    const aim = this.updateAim();
    if (!aim) return;

    this.player.fireCooldown = 0.16;
    const start = new THREE.Vector3(this.player.x, 1.7, this.player.z);
    const end = start.clone().add(aim.clone().multiplyScalar(95));

    const tracer = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([start, end]),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
    );
    this.scene.add(tracer);
    this.world.particles.push({ object: tracer, life: 0.045 });

    this.state.wanted = clamp(this.state.wanted + 0.08, 0, 5);
    this.state.heat = 7;

    let target = null; let targetDistance = 4;
    for (const npc of this.world.npcs) {
      if (!npc.alive || npc.kind !== 'gang') continue;
      const point = new THREE.Vector3(npc.x, 1.15, npc.z);
      const lineDistance = this.pointLineDistance(point, start, end);
      const distance = point.distanceTo(start);
      if (distance < 95 && lineDistance < targetDistance && this.lineOfSight(start.x, start.z, npc.x, npc.z)) {
        target = npc; targetDistance = lineDistance;
      }
    }

    if (target) {
      target.health -= 30;
      if (target.health <= 0) {
        target.alive = false; target.group.visible = false;
        this.state.missionKills += 1; this.state.score += 150; this.state.money += 100;
      }
    }
  }

  pointLineDistance(point, a, b) {
    const ab = b.clone().sub(a);
    const denominator = Math.max(ab.lengthSq(), 0.0001);
    const t = clamp(point.clone().sub(a).dot(ab) / denominator, 0, 1);
    return point.distanceTo(a.clone().add(ab.multiplyScalar(t)));
  }

  lineOfSight(x1, z1, x2, z2) {
    for (let i = 1; i < 18; i += 1) {
      const t = i / 18;
      const x = THREE.MathUtils.lerp(x1, x2, t);
      const z = THREE.MathUtils.lerp(z1, z2, t);
      if (this.world.colliders.some((box) => x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ)) return false;
    }
    return true;
  }

  interact() {
    const safehouse = this.jobs[0];
    if (this.state.mission === 0 && dist2(this.player.x, this.player.z, safehouse.x, safehouse.z) < 32) {
      this.state.mission = 1; this.state.missionStep = 1;
      this.state.money += 150; this.state.score += 300;

      const marked = this.world.cars.find((car) => !car.police && !car.occupied);
      if (marked) { marked.marked = true; this.createCarMarker(marked); }
      return;
    }
    this.toggleVehicle();
  }

  createCarMarker(car) {
    if (car.marker) return;
    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(2.8, 0.22, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    );
    marker.rotation.x = Math.PI / 2; marker.position.y = 6;
    car.group.add(marker); car.marker = marker;
  }

  updatePlayer(dt) {
    if (this.state.dead) return;
    this.player.fireCooldown = Math.max(0, this.player.fireCooldown - dt);

    if (this.player.car) {
      const car = this.player.car; const movement = this.input.movement(); const steer = movement.x;

      if (movement.y < -0.12) car.speed = THREE.MathUtils.lerp(car.speed, car.maxSpeed, dt * 3.6);
      else if (movement.y > 0.12) car.speed = THREE.MathUtils.lerp(car.speed, -car.maxSpeed * 0.45, dt * 4.5);
      else car.speed = THREE.MathUtils.lerp(car.speed, 0, dt * 2.4);

      if (Math.abs(car.speed) > 0.2) car.yaw -= steer * (Math.abs(car.speed) / car.maxSpeed) * dt * 2.1;

      const next = this.moveCircle(car.x, car.z, Math.sin(car.yaw) * car.speed * dt, Math.cos(car.yaw) * car.speed * dt, 2.6);
      car.x = next.x; car.z = next.z; this.syncCar(car);

      for (const other of this.world.cars) {
        if (other === car) continue;
        if (dist2(car.x, car.z, other.x, other.z) < 5.5 && Math.abs(car.speed) > 2.5) {
          other.health = Math.max(0, other.health - Math.abs(car.speed) * dt * 2.4);
          car.speed *= 0.8; this.state.wanted = clamp(this.state.wanted + 0.015, 0, 5);
        }
      }

      this.player.x = car.x; this.player.z = car.z; this.player.yaw = car.yaw;
      return;
    }

    const movement = this.input.movement();
    const sprinting = this.input.actionDown('sprint') && movement.magnitude > 0.05;
    const speed = sprinting && this.state.stamina > 1 ? 7.5 : 5.2;

    if (movement.magnitude > 0.03) {
      const next = this.moveCircle(this.player.x, this.player.z, movement.x * speed * dt, movement.y * speed * dt, 1.15);
      this.player.x = next.x; this.player.z = next.z; this.player.yaw = Math.atan2(movement.x, -movement.y);
      this.state.stamina = sprinting ? Math.max(0, this.state.stamina - 15 * dt) : Math.min(100, this.state.stamina + 10 * dt);
    } else {
      this.state.stamina = Math.min(100, this.state.stamina + 12 * dt);
    }

    const aim = this.updateAim();
    if (aim) this.player.yaw = Math.atan2(aim.x, aim.z);
    if (this.input.actionDown('fire')) this.fire();

    this.playerGroup.position.set(this.player.x, 0, this.player.z);
    this.playerGroup.rotation.y = this.player.yaw;
  }

  updateTraffic(dt) {
    for (const car of this.world.cars) {
      if (car === this.player.car || car.health <= 0) continue;

      if (car.police && this.state.wanted > 0.4) {
        const targetAngle = Math.atan2(this.player.x - car.x, this.player.z - car.z);
        car.yaw = THREE.MathUtils.lerp(car.yaw, Math.round(targetAngle / (Math.PI / 2)) * (Math.PI / 2), dt * 2.6);
        car.speed = THREE.MathUtils.lerp(car.speed, car.maxSpeed + 3, dt * 1.3);
      } else {
        car.speed = THREE.MathUtils.lerp(car.speed, car.maxSpeed * 0.48, dt * 0.8);
        if (this.rng() < dt * 0.24) car.yaw = Math.round(car.yaw / (Math.PI / 2)) * (Math.PI / 2);
      }

      const next = this.moveCircle(car.x, car.z, Math.sin(car.yaw) * car.speed * dt, Math.cos(car.yaw) * car.speed * dt, 2.5);
      car.x = next.x; car.z = next.z; this.syncCar(car);

      if (car.marked && car.marker) {
        car.marker.rotation.z += dt * 2.6;
        car.marker.material.opacity = 0.55 + 0.35 * (Math.sin(this.state.elapsed * 5) + 1) * 0.5;
      }

      this.setHeadlights(car, this.isNight() || this.state.weather > 0);
      if (car.police && this.state.wanted < 0.2 && dist2(car.x, car.z, this.player.x, this.player.z) > 900) car.health -= dt * 3;
    }

    this.world.cars = this.world.cars.filter((car) => {
      if (car.health > 0) return true;
      car.group.removeFromParent();
      return false;
    });
  }

  updateNPCs(dt) {
    for (const npc of this.world.npcs) {
      if (!npc.alive) continue;

      const distance = dist2(npc.x, npc.z, this.player.x, this.player.z);
      let yaw = npc.yaw;

      if (npc.kind === 'gang' && this.state.mission === 2 && distance < 45) {
        yaw = Math.atan2(this.player.x - npc.x, this.player.z - npc.z);
        if (npc.fire <= 0 && this.lineOfSight(npc.x, npc.z, this.player.x, this.player.z)) {
          npc.fire = 1; this.state.health = clamp(this.state.health - 9, 0, 100);
        }
      } else if (npc.kind === 'civilian' && this.state.wanted > 1.2 && distance < 28) {
        yaw = Math.atan2(npc.x - this.player.x, npc.z - this.player.z);
      } else if (this.rng() < dt * 0.55) {
        yaw += (this.rng() - 0.5) * 1.6;
      }

      npc.yaw = THREE.MathUtils.lerp(npc.yaw, yaw, dt * 1.8);
      const movement = npc.kind === 'civilian' ? npc.speed : 2.1;
      const next = this.moveCircle(npc.x, npc.z, Math.sin(npc.yaw) * movement * dt, Math.cos(npc.yaw) * movement * dt, 0.85);
      npc.x = next.x; npc.z = next.z; npc.fire = Math.max(0, npc.fire - dt); this.syncNPC(npc);
    }
  }

  updateWanted(dt) {
    if (this.state.heat > 0) this.state.heat -= dt;
    else this.state.wanted = Math.max(0, this.state.wanted - dt * 0.065);
  }

  updateMission() {
    if (this.state.mission === 0) {
      this.ui.setMission({
        no: 1,
        text: dist2(this.player.x, this.player.z, -450, -450) < 36
          ? 'Press E to accept the courier contract.'
          : 'Reach the safehouse to start a job.'
      });
      return;
    }

    if (this.state.mission === 1) {
      if (this.state.missionStep === 1) this.ui.setMission({ no: 2, text: 'Find the marked vehicle.' });
      else if (this.state.missionStep === 2) this.ui.setMission({ no: 2, text: 'Enter the marked vehicle.' });
      else this.ui.setMission({ no: 2, text: 'Lose the police and reach the garage.' });
      return;
    }

    this.ui.setMission({ no: 3, text: 'Gang sweep: ' + this.state.missionKills + '/6 targets. Return to the market.' });
  }

  progressMission() {
    if (this.state.mission === 1 && this.state.missionStep === 1) {
      const marked = this.world.cars.find((car) => car.marked);
      if (marked && this.player.car === marked) {
        this.state.missionStep = 3; this.state.wanted = 3; this.state.heat = 10;
      }
      return;
    }

    if (this.state.mission === 1 && this.state.missionStep === 3) {
      const garage = this.jobs[2];
      if (this.state.wanted < 0.35 && dist2(this.player.x, this.player.z, garage.x, garage.z) < 40) {
        this.state.money += 850; this.state.score += 1600;
        this.state.mission = 2; this.state.missionStep = 0;
        for (let i = 0; i < 8; i += 1) this.placeNPC(this.createNPC('gang'));
      }
      return;
    }

    if (this.state.mission === 2 && this.state.missionKills >= 6 && dist2(this.player.x, this.player.z, this.jobs[3].x, this.jobs[3].z) < 42) {
      this.state.money += 1200; this.state.score += 2200;
      this.state.mission = 0; this.state.missionStep = 0; this.state.missionKills = 0;
      for (const npc of this.world.npcs) {
        if (npc.kind === 'gang') { npc.alive = false; npc.group.visible = false; }
      }
    }
  }

  updateWeather(dt) {
    this.state.time += dt * 0.018;
    if (this.state.time >= 24) this.state.time -= 24;

    const night = this.isNight();
    const angle = (this.state.time / 24) * Math.PI * 2 - Math.PI / 2;

    this.sun.position.set(Math.cos(angle) * 720, Math.max(80, Math.sin(angle) * 720), Math.sin(angle) * 560);
    this.sun.target.position.set(this.player.x, 0, this.player.z);
    this.moon.position.set(-Math.cos(angle) * 620, Math.max(120, -Math.sin(angle) * 620), -Math.sin(angle) * 460);
    this.moon.target.position.set(this.player.x, 0, this.player.z);

    this.sun.intensity = night ? 0.95 : 3.5;
    this.moon.intensity = night ? 0.32 : 0.06;
    this.ambient.intensity = night ? 0.65 : 1.55;

    const fogTone = this.state.weather === 3 ? 0.36 : night ? 0.055 : 0.42;
    this.scene.fog.color.copy(grayscale(fogTone));
    this.scene.fog.density = this.state.weather === 3 ? 0.0044 : this.state.weather === 2 ? 0.0028 : 0.0020;
    this.bloom.strength = night ? 0.7 : 0.34;

    if (this.world.rain) {
      this.world.rain.visible = this.state.weather === 1 || this.state.weather === 2;
      this.world.rain.position.set(this.player.x, 0, this.player.z);
    }
    if (this.world.rainMaterial) this.world.rainMaterial.uniforms.uTime.value = performance.now() * 0.001;

    this.materials.asphalt.roughness = this.state.weather > 0 ? 0.46 : 0.86;
    for (const street of this.world.lights) {
      street.point.intensity = night ? (this.state.weather === 2 ? 10 : 6.5) : 0.35;
      street.head.material.emissiveIntensity = night ? 2.4 : 0.18;
    }
    for (const puddle of this.world.puddles) puddle.material.opacity = this.state.weather > 0 ? 0.48 : 0.12;
    if (this.player.car) this.setHeadlights(this.player.car, night || this.state.weather > 0);
  }

  updateCamera(dt) {
    const focusX = this.player.x + (this.player.car ? Math.sin(this.player.yaw) * 40 : 0);
    const focusZ = this.player.z + (this.player.car ? Math.cos(this.player.yaw) * 40 : 0);
    const desired = new THREE.Vector3(focusX + 235, 405, focusZ + 285);
    this.camera.position.lerp(desired, 1 - Math.pow(0.00055, dt));
    this.camera.lookAt(focusX, 0, focusZ);
  }

  updateMarkers(dt) {
    for (const job of this.world.jobs) {
      job.group.rotation.y += dt * 0.7;
      const pulse = 1 + 0.08 * Math.sin(this.state.elapsed * 4);
      job.group.scale.setScalar(pulse);
    }
  }

  updateParticles(dt) {
    for (let i = this.world.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.world.particles[i];
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.object.removeFromParent();
        this.world.particles.splice(i, 1);
      }
    }
  }

  isNight() { return this.state.time >= 18 || this.state.time < 6; }

  cycleWeather() {
    this.state.weather = (this.state.weather + 1) % this.state.weatherNames.length;
    this.state.heat = Math.max(this.state.heat, 1);
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        money: this.state.money, score: this.state.score,
        mission: this.state.mission, missionStep: this.state.missionStep,
        missionKills: this.state.missionKills, time: this.state.time, weather: this.state.weather
      }));
    } catch {}
  }

  loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const save = JSON.parse(raw);
      this.state.money = Number(save.money) || 1250;
      this.state.score = Number(save.score) || 0;
      this.state.mission = Number.isFinite(save.mission) ? save.mission : 0;
      this.state.missionStep = Number.isFinite(save.missionStep) ? save.missionStep : 0;
      this.state.missionKills = Number.isFinite(save.missionKills) ? save.missionKills : 0;
      this.state.time = Number.isFinite(save.time) ? save.time : 18.5;
      this.state.weather = Number.isFinite(save.weather) ? save.weather : 0;
    } catch {}
  }

  start() {
    this.state.started = true; this.state.paused = false; this.state.pauseReason = ''; this.state.dead = false;
    this.input.clearAll('start'); this.ui.showGame();
  }

  pause(reason = 'manual') {
    if (!this.state.started || this.state.dead) return;
    this.state.paused = true; this.state.pauseReason = reason;
    this.input.clearAll(reason); this.ui.showPause(reason);
  }

  resume() {
    if (!this.state.started || this.state.dead) return;
    this.state.paused = false; this.state.pauseReason = '';
    this.input.clearAll('resume'); this.ui.hidePause();
  }

  togglePause() { if (this.state.paused) this.resume(); else this.pause('manual'); }

  respawn() {
    this.state.dead = false; this.state.paused = false; this.state.pauseReason = '';
    this.state.health = 100; this.state.stamina = 100; this.state.wanted = 0; this.state.heat = 0;

    if (this.player.car) {
      this.setHeadlights(this.player.car, false);
      this.player.car.occupied = false;
      this.player.car = null;
    }

    this.player.x = -450; this.player.z = -450; this.player.yaw = 0;
    this.playerGroup.visible = true; this.ui.hideBusted();
  }

  handleDeath() {
    if (this.state.dead) return;
    this.state.dead = true; this.state.paused = true;
    this.input.clearAll('death'); this.save();
    this.ui.showBusted({ score: Math.floor(this.state.score), money: Math.floor(this.state.money) });
  }

  update(dt) {
    if (!this.state.started || this.state.dead) return;

    if (this.state.paused) {
      if (this.input.consume('pause')) this.resume();
      return;
    }

    this.state.elapsed += dt;

    if (this.input.consume('pause')) { this.togglePause(); return; }
    if (this.input.consume('interact')) this.interact();
    if (this.input.consume('weather')) this.cycleWeather();

    this.updatePlayer(dt); this.updateTraffic(dt); this.updateNPCs(dt); this.updateWanted(dt);
    this.progressMission(); this.updateMission(); this.updateWeather(dt); this.updateCamera(dt);
    this.updateMarkers(dt); this.updateParticles(dt);

    this.state.autosave -= dt;
    if (this.state.autosave <= 0) { this.state.autosave = 7; this.save(); }
    if (this.state.health <= 0) this.handleDeath();
  }

  updateHUD() {
    const starCount = Math.ceil(this.state.wanted);
    const hours = Math.floor(this.state.time);
    const minutes = Math.floor((this.state.time - hours) * 60);

    this.ui.updateHUD({
      health: this.state.health, stamina: this.state.stamina, money: this.state.money,
      wanted: starCount, weather: this.state.weatherNames[this.state.weather],
      time: String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0'),
      playerX: this.player.x, playerZ: this.player.z, worldHalf: WORLD_HALF,
      colliders: this.world.colliders, police: this.world.cars.filter((car) => car.police), jobs: this.jobs
    });
  }

  render() { this.composer.render(); this.updateHUD(); }

  loop(time) {
    if (!this.lastTime) this.lastTime = time;
    const dt = Math.min(0.033, Math.max(0.001, (time - this.lastTime) / 1000));
    this.lastTime = time;
    this.update(dt); this.render();
    this.frameId = requestAnimationFrame(this.boundLoop);
  }

  bindEvents() {
    this.boundInputCleared = (event) => {
      if (this.state.started && !this.state.dead && (event.detail.reason === 'blur' || event.detail.reason === 'hidden')) {
        this.pause('focus');
      }
    };
    this.boundDeviceChange = (event) => this.ui.setInputDevice(event.detail.device, this.input);
    this.boundResize = () => this.resize();

    this.input.addEventListener('cleared', this.boundInputCleared);
    this.input.addEventListener('devicechange', this.boundDeviceChange);
    window.addEventListener('resize', this.boundResize, { passive: true });
  }

  resize() {
    const width = innerWidth; const height = innerHeight;
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  }

  dispose() {
    cancelAnimationFrame(this.frameId);
    this.input.removeEventListener('cleared', this.boundInputCleared);
    this.input.removeEventListener('devicechange', this.boundDeviceChange);
    window.removeEventListener('resize', this.boundResize);
    this.input.clearAll('dispose');
    this.renderer.dispose();
  }
}
