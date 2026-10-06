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

    this.style = this.createLowPolyStyle();
    this.applyLowPolyRenderer();

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
    const p = this.style.palette;
    return {
      asphalt: this.lowPolyMaterial(p.asphalt, 'ground', { roughness: .96 }),
      road: this.lowPolyMaterial(p.road, 'road', { roughness: .98 }),
      roof: this.lowPolyMaterial(p.roof, 'roof', { roughness: .9 }),
      grass: this.lowPolyMaterial(p.grass, 'grass', { roughness: 1 }),
      lane: this.lowPolyMaterial(p.lane, 'lane', { roughness: .82 }),
      curb: this.lowPolyMaterial(p.curb, 'curb', { roughness: .9 }),
      accent: this.lowPolyMaterial(p.accent, 'accent', { roughness: .46, emissive: p.accentGlow, emissiveIntensity: .35 })
    };
  }
  createLighting() {
    this.ambient = new THREE.HemisphereLight(0xb9c2d3, 0x11151d, 1.35);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xffd8aa, 2.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 1500;
    this.sun.shadow.camera.left = -600;
    this.sun.shadow.camera.right = 600;
    this.sun.shadow.camera.top = 600;
    this.sun.shadow.camera.bottom = -600;
    this.scene.add(this.sun, this.sun.target);

    this.moon = new THREE.DirectionalLight(0x7182d9, .42);
    this.scene.add(this.moon, this.moon.target);
  }
  createLowPolyStyle() {
    return {
      rules: {
        flatShading: true,
        maxRadialSegments: 8,
        wheelSegments: 8,
        treeSegments: 6,
        bevelRatio: .055,
        buildingTiers: 2,
        facadeDensity: .18,
        roofDetailLimit: 2,
        npcSegments: 6,
        minFeature: 1.2
      },
      palette: {
        ink: 0x0d1018,
        asphalt: 0x2a2f3a,
        road: 0x171b23,
        roof: 0x3b4350,
        curb: 0x667080,
        lane: 0xd7b665,
        grass: 0x30473d,
        buildingA: 0x3e4653,
        buildingB: 0x4a5260,
        buildingC: 0x343b47,
        trim: 0x626c7b,
        window: 0xffc857,
        accent: 0xffc857,
        accentGlow: 0xff9f2d,
        cyan: 0x38a7a7,
        red: 0xd65b55,
        carGold: 0xd6a84f,
        police: 0x27304a,
        glass: 0x101720,
        tire: 0x090b10,
        skin: 0xc2a88b,
        civilian: 0x7e8797,
        gang: 0x8e4149
      }
    };
  }

  applyLowPolyRenderer() {
    this.scene.background = new THREE.Color(this.style.palette.ink);
    this.scene.fog.color.setHex(0x141923);
    this.bloom.strength = .42;
    this.bloom.radius = .72;
    this.bloom.threshold = .76;
  }

  lowPolyMaterial(color, role = 'prop', options = {}) {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: options.roughness ?? .88,
      metalness: options.metalness ?? 0,
      emissive: options.emissive ?? 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 0,
      flatShading: this.style.rules.flatShading
    });
    material.userData.role = role;
    return material;
  }

  chamferPrism(width, depth, height, bevel = null) {
    const b = clamp(bevel ?? Math.min(width, depth) * this.style.rules.bevelRatio, Math.min(width, depth) * .22);
    const w = width / 2;
    const d = depth / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-w + b, -d);
    shape.lineTo(w - b, -d);
    shape.lineTo(w, -d + b);
    shape.lineTo(w, d - b);
    shape.lineTo(w - b, d);
    shape.lineTo(-w + b, d);
    shape.lineTo(-w, d - b);
    shape.lineTo(-w, -d + b);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
      curveSegments: 1,
      steps: 1
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, height / 2, 0);
    geometry.computeVertexNormals();
    return geometry;
  }

  sideProfilePrism(length, width, height, profile = [0, .7, 1, .72, 0]) {
    const half = length / 2;
    const y0 = 0;
    const shape = new THREE.Shape();
    shape.moveTo(-half, y0);
    shape.lineTo(-half * .78, height * profile[1]);
    shape.lineTo(-half * .28, height * profile[2]);
    shape.lineTo(half * .46, height * profile[3]);
    shape.lineTo(half, y0);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: width,
      bevelEnabled: false,
      curveSegments: 1,
      steps: 1
    });
    geometry.translate(0, 0, -width / 2);
    geometry.rotateY(Math.PI / 2);
    geometry.translate(0, 0, 0);
    geometry.computeVertexNormals();
    return geometry;
  }

  addLowPolyMesh(root, geometry, material, position = null, scale = null) {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.copy(position);
    if (scale) mesh.scale.copy(scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }

  facetedIco(radius, detail = 1, material) {
    const safeDetail = Math.min(detail, 1);
    return new THREE.Mesh(new THREE.IcosahedronGeometry(radius, safeDetail), material);
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
    const p = this.style.palette;
    const r = this.rng;
    const variant = r();
    const bodyColor = variant < .34 ? p.buildingA : variant < .67 ? p.buildingB : p.buildingC;
    const root = new THREE.Group();
    root.position.set(x, 0, z);

    const bevel = Math.min(w, d) * this.style.rules.bevelRatio;
    const baseH = h * (.66 + r() * .16);
    const body = this.addLowPolyMesh(
      root,
      this.chamferPrism(w, d, baseH, bevel),
      this.lowPolyMaterial(bodyColor, 'building', { roughness: .94 }),
      new THREE.Vector3(0, 0, 0)
    );

    this.world.buildings.push(root);
    this.world.colliders.push({
      minX: x - w / 2, maxX: x + w / 2,
      minZ: z - d / 2, maxZ: z + d / 2
    });

    const tierCount = h > 96 ? 2 : h > 58 ? 1 : 0;
    let currentW = w;
    let currentD = d;
    let currentY = baseH;

    for (let tier = 0; tier < tierCount; tier += 1) {
      const shrink = .74 + r() * .08;
      currentW *= shrink;
      currentD *= shrink;
      const tierH = Math.max(9, (h - currentY) * (tier === 0 ? .58 : .66));
      const tierMesh = this.addLowPolyMesh(
        root,
        this.chamferPrism(currentW, currentD, tierH, Math.min(currentW, currentD) * .05),
        this.lowPolyMaterial(tier % 2 ? p.buildingC : p.buildingB, 'buildingTier', { roughness: .92 }),
        new THREE.Vector3((r() - .5) * 5, currentY, (r() - .5) * 5)
      );
      currentY += tierH;
      tierMesh.rotation.y = (r() > .5 ? 1 : -1) * Math.PI / 2 * .5;
    }

    const trim = this.lowPolyMaterial(p.trim, 'trim', { roughness: .84, metalness: .06 });
    const window = this.lowPolyMaterial(p.window, 'window', {
      roughness: .36, emissive: p.accentGlow, emissiveIntensity: .72
    });

    const stripeCount = Math.max(2, Math.min(5, Math.floor(h / 27)));
    for (let i = 0; i < stripeCount; i += 1) {
      const y = 10 + (baseH - 18) * (i / Math.max(1, stripeCount - 1));
      const panelW = Math.max(2.2, w * this.style.rules.facadeDensity);
      const panel = this.addLowPolyMesh(
        root,
        this.chamferPrism(panelW, 1.15, 4.5, .45),
        i % 2 ? window : trim,
        new THREE.Vector3(-w * .18 + (i % 3) * w * .18, y, d / 2 + .7)
      );
      panel.rotation.y = 0;
    }

    for (let i = 0; i < 2; i += 1) {
      const vertical = this.addLowPolyMesh(
        root,
        this.chamferPrism(1.2, d * .72, Math.max(8, baseH * .66), .24),
        trim,
        new THREE.Vector3(w / 2 + .65, 4 + baseH * .33, (i ? .26 : -.26) * d)
      );
      vertical.rotation.y = Math.PI / 2;
    }

    const roof = this.addLowPolyMesh(
      root,
      this.chamferPrism(currentW + 7, currentD + 7, 2.6, 1),
      this.lowPolyMaterial(p.roof, 'roof', { roughness: .9 }),
      new THREE.Vector3(0, currentY + 1.3, 0)
    );

    const podCount = h > 72 ? 2 : 1;
    for (let i = 0; i < podCount && i < this.style.rules.roofDetailLimit; i += 1) {
      const podW = currentW * (.18 + r() * .12);
      const podD = currentD * (.18 + r() * .12);
      const pod = this.addLowPolyMesh(
        root,
        this.chamferPrism(podW, podD, 5 + r() * 4, 1),
        i ? trim : this.lowPolyMaterial(p.roof, 'roofPod', { roughness: .9 }),
        new THREE.Vector3((r() - .5) * currentW * .22, currentY + 5, (r() - .5) * currentD * .22)
      );
      pod.rotation.y = (r() - .5) * .45;
    }

    root.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        if (node.material) node.material.flatShading = true;
      }
    });
    this.scene.add(root);
  }
  createPark(x, z) {
    const p = this.style.palette;
    const base = this.addLowPolyMesh(
      this.scene,
      this.chamferPrism(226, 226, .18, 5),
      this.lowPolyMaterial(p.grass, 'park', { roughness: 1 }),
      new THREE.Vector3(x, .09, z)
    );
    base.receiveShadow = true;

    for (let i = 0; i < 13; i += 1) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(.8, 1.05, 9, this.style.rules.treeSegments, 1, true),
        this.lowPolyMaterial(p.trim, 'treeTrunk', { roughness: 1 })
      );
      trunk.position.y = 4.5;

      const crown = this.facetedIco(6 + this.rng() * 3, 1, this.lowPolyMaterial(
        i % 3 === 0 ? p.cyan : p.grass, 'treeCrown', { roughness: 1 }
      ));
      crown.scale.y = .85 + this.rng() * .3;
      crown.position.y = 10 + this.rng() * 2;

      tree.add(trunk, crown);
      tree.position.set(x + (this.rng() - .5) * 190, 0, z + (this.rng() - .5) * 190);
      tree.rotation.y = this.rng() * Math.PI * 2;
      tree.traverse((node) => {
        if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
      });
      this.scene.add(tree);
    }
  }
  createStreetLight(x, z) {
    const p = this.style.palette;
    const group = new THREE.Group();

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(.5, .72, 18, 6, 1),
      this.lowPolyMaterial(0x29303a, 'streetPole', { roughness: .62, metalness: .28 })
    );
    pole.position.y = 9;

    const head = this.addLowPolyMesh(
      group,
      this.chamferPrism(2.8, 2.2, 1.1, .32),
      this.lowPolyMaterial(0x1b2028, 'streetHead', {
        roughness: .48, metalness: .18, emissive: p.accentGlow, emissiveIntensity: .12
      }),
      new THREE.Vector3(0, 18, 0)
    );
    head.rotation.y = Math.PI / 4;

    const point = new THREE.PointLight(0xffb95c, 5.2, 108, 2);
    point.position.y = 16;

    group.add(pole, point);
    group.position.set(x, 0, z);
    this.scene.add(group);
    this.world.lights.push({ point, head });
  }
  createPuddle(x, z, size) {
    const puddle = new THREE.Mesh(
      new THREE.CircleGeometry(size, 12),
      new THREE.MeshPhysicalMaterial({
        color: 0x405064,
        roughness: .12,
        metalness: .78,
        transparent: true,
        opacity: .18,
        flatShading: true
      })
    );
    puddle.rotation.x = -Math.PI / 2;
    puddle.rotation.z = (this.rng() - .5) * .35;
    puddle.position.set(x, .15, z);
    puddle.scale.set(1, .58 + this.rng() * .25, 1);
    this.scene.add(puddle);
    this.world.puddles.push(puddle);
  }
  createPlayer() {
    const p = this.style.palette;
    this.playerGroup = new THREE.Group();

    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(.62, .72, 1.65, this.style.rules.npcSegments, 1, false),
      this.lowPolyMaterial(0xc7d0d6, 'playerBody', { roughness: .86 })
    );
    torso.position.y = 1.25;

    const head = this.facetedIco(
      .48,
      1,
      this.lowPolyMaterial(p.skin, 'playerHead', { roughness: .9 })
    );
    head.position.y = 2.62;

    const pack = this.addLowPolyMesh(
      this.playerGroup,
      this.chamferPrism(.72, .38, 1.15, .16),
      this.lowPolyMaterial(0x33483d, 'playerPack', { roughness: 1 }),
      new THREE.Vector3(0, 1.22, -.42)
    );

    this.playerGroup.add(torso, head, pack);
    this.playerGroup.rotation.order = 'YXZ';
    this.playerGroup.traverse((node) => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
    this.scene.add(this.playerGroup);
    this.playerGroup.position.set(this.player.x, 0, this.player.z);
  }
  createCar({ police = false, color = 0.4 } = {}) {
    const p = this.style.palette;
    const group = new THREE.Group();
    const tint = police ? p.police : [p.red, p.cyan, p.carGold][Math.floor(clamp(color, 0, .999) * 3)];
    const bodyMaterial = this.lowPolyMaterial(tint, police ? 'policeBody' : 'carBody', {
      roughness: .42, metalness: .16
    });
    const glassMaterial = this.lowPolyMaterial(p.glass, 'carGlass', { roughness: .23, metalness: .08 });
    const tireMaterial = this.lowPolyMaterial(p.tire, 'carTire', { roughness: .98 });

    const body = this.addLowPolyMesh(
      group,
      this.chamferPrism(4.5, 8.8, 1.12, .42),
      bodyMaterial,
      new THREE.Vector3(0, 1.0, 0)
    );

    const cabin = this.addLowPolyMesh(
      group,
      this.sideProfilePrism(4.7, 3.2, 1.15),
      glassMaterial,
      new THREE.Vector3(0, 1.7, -.35)
    );
    cabin.rotation.y = Math.PI / 2;

    const roofAccent = this.addLowPolyMesh(
      group,
      this.chamferPrism(2.8, 3.1, .16, .12),
      police ? this.lowPolyMaterial(p.red, 'policeAccent', { roughness: .4, emissive: p.red, emissiveIntensity: .35 }) : this.lowPolyMaterial(p.trim, 'carTrim', { roughness: .7 }),
      new THREE.Vector3(0, 2.32, -.35)
    );

    for (const x of [-2.0, 2.0]) {
      for (const z of [-2.95, 2.95]) {
        const wheel = new THREE.Mesh(
          new THREE.CylinderGeometry(.78, .78, .48, this.style.rules.wheelSegments, 1),
          tireMaterial
        );
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, .7, z);
        wheel.castShadow = true;
        wheel.receiveShadow = true;
        group.add(wheel);
      }
    }

    const headlightMaterial = this.lowPolyMaterial(p.window, 'headlight', {
      roughness: .28, emissive: p.accentGlow, emissiveIntensity: 1.15
    });
    for (const x of [-1.18, 1.18]) {
      const lamp = this.addLowPolyMesh(
        group,
        this.chamferPrism(.68, .24, .34, .08),
        headlightMaterial,
        new THREE.Vector3(x, 1.25, 4.34)
      );
    }

    if (police) {
      const bar = this.addLowPolyMesh(
        group,
        this.chamferPrism(2.4, .74, .22, .09),
        this.lowPolyMaterial(p.cyan, 'policeBar', { roughness: .3, emissive: p.cyan, emissiveIntensity: 2.1 }),
        new THREE.Vector3(0, 2.48, -.3)
      );
      bar.material.emissiveIntensity = 2.1;
    }

    const leftHeadlight = new THREE.SpotLight(0xffd6a0, 6.5, 115, Math.PI / 7, .44, 1.4);
    const rightHeadlight = leftHeadlight.clone();
    leftHeadlight.position.set(-1.15, 1.55, 4.0);
    rightHeadlight.position.set(1.15, 1.55, 4.0);
    leftHeadlight.target.position.set(-1.15, 0, 28);
    rightHeadlight.target.position.set(1.15, 0, 28);
    group.add(leftHeadlight, leftHeadlight.target, rightHeadlight, rightHeadlight.target);
    leftHeadlight.visible = false;
    rightHeadlight.visible = false;

    group.traverse((node) => {
      if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
    });
    this.scene.add(group);

    const car = {
      group, x: 0, z: 0, yaw: 0, speed: 0,
      maxSpeed: police ? 12 : 8 + this.rng() * 4,
      health: 100, police, occupied: false, stolen: false, marked: false,
      headlights: [leftHeadlight, rightHeadlight], marker: null
    };

    this.world.cars.push(car);
    return car;
  }
  createNPC(kind = 'civilian') {
    const p = this.style.palette;
    const group = new THREE.Group();
    const bodyMaterial = this.lowPolyMaterial(
      kind === 'gang' ? p.gang : p.civilian,
      kind === 'gang' ? 'npcGang' : 'npcCivilian',
      { roughness: .94 }
    );
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(.52, 1.15, 2, this.style.rules.npcSegments),
      bodyMaterial
    );
    body.position.y = 1.15;

    const head = this.facetedIco(
      .43, 1,
      this.lowPolyMaterial(p.skin, 'npcHead', { roughness: .94 })
    );
    head.position.y = 2.48;

    const shoulder = this.addLowPolyMesh(
      group,
      this.chamferPrism(1.18, .58, .36, .12),
      this.lowPolyMaterial(kind === 'gang' ? p.red : p.cyan, 'npcAccent', { roughness: .9 }),
      new THREE.Vector3(0, 1.58, 0)
    );

    group.add(body, head, shoulder);
    group.rotation.order = 'YXZ';
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
