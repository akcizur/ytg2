(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const menu = document.getElementById('menu');
  const pauseOverlay = document.getElementById('pause');
  const deathOverlay = document.getElementById('death');
  const startBtn = document.getElementById('start-btn');
  const resumeBtn = document.getElementById('resume-btn');
  const saveBtn = document.getElementById('save-btn');
  const respawnBtn = document.getElementById('respawn-btn');
  const deathText = document.getElementById('death-text');

  const TAU = Math.PI * 2;
  const WORLD = { w: 4200, h: 3200 };
  const ROAD_W = 92;
  const CELL = 420;
  const SAVE_KEY = 'ytg2-save-v1';

  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let vw = 1280, vh = 720;
  let running = false;
  let paused = false;
  let lastTime = 0;
  let elapsed = 0;
  let spawnTick = 0;
  let policeSpawnTick = 0;
  let audioCtx = null;
  let autosaveClock = 12;

  const keys = Object.create(null);
  const mouse = { x: 0, y: 0, down: false, active: false };
  const camera = { x: 0, y: 0, zoom: 1 };
  const buildings = [];
  const roads = [];
  const parks = [];
  const cars = [];
  const npcs = [];
  const bullets = [];
  const particles = [];
  const decals = [];
  const floatingText = [];

  const missionSpots = [
    { x: 430, y: 390, name: 'SAFEHOUSE' },
    { x: 3590, y: 460, name: 'DOCKS' },
    { x: 3390, y: 2540, name: 'GARAGE' },
    { x: 760, y: 2570, name: 'MARKET' }
  ];

  const player = {
    x: 500, y: 430, angle: 0, speed: 0, health: 100, cash: 1250,
    stamina: 100, inCar: null, fireCooldown: 0, damageFlash: 0,
    invuln: 0, wanted: 0, wantedHeat: 0, score: 0
  };

  const mission = {
    index: 0, state: 'ready', step: 0, target: null, kills: 0,
    completed: 0, reward: 0, text: ''
  };

  const rng = mulberry32(90210);

  function mulberry32(seed) {
    return function() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function angleDiff(a, b) {
    let d = (b - a + Math.PI) % TAU - Math.PI;
    if (d < -Math.PI) d += TAU;
    return d;
  }
  function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = window.innerWidth;
    vh = window.innerHeight;
    canvas.width = Math.floor(vw * dpr);
    canvas.height = Math.floor(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function initAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {}
  }

  function tone(freq, length, volume, type) {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'square';
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    osc.start(now);
    osc.stop(now + length);
  }

  function generateCity() {
    buildings.length = 0;
    roads.length = 0;
    parks.length = 0;
    decals.length = 0;

    for (let x = 0; x <= WORLD.w; x += CELL) roads.push({ x: x - ROAD_W * .5, y: 0, w: ROAD_W, h: WORLD.h });
    for (let y = 0; y <= WORLD.h; y += CELL) roads.push({ x: 0, y: y - ROAD_W * .5, w: WORLD.w, h: ROAD_W });

    const blockInset = ROAD_W / 2 + 18;
    for (let gx = 0; gx < WORLD.w; gx += CELL) {
      for (let gy = 0; gy < WORLD.h; gy += CELL) {
        if (gx < 120 && gy < 120) continue;
        const bx = gx + blockInset;
        const by = gy + blockInset;
        const bw = CELL - blockInset * 2;
        const bh = CELL - blockInset * 2;
        if (rng() < 0.16) {
          parks.push({ x: bx + 8, y: by + 8, w: bw - 16, h: bh - 16, trees: 5 + Math.floor(rng() * 6) });
          continue;
        }
        const cols = rng() < 0.5 ? 2 : 1;
        const rowsN = rng() < 0.55 ? 2 : 1;
        const gap = 18;
        const partW = (bw - gap * (cols - 1)) / cols;
        const partH = (bh - gap * (rowsN - 1)) / rowsN;
        for (let cx = 0; cx < cols; cx++) {
          for (let cy = 0; cy < rowsN; cy++) {
            const x = bx + cx * (partW + gap) + rng() * 5;
            const y = by + cy * (partH + gap) + rng() * 5;
            const w = partW - 10 - rng() * 8;
            const h = partH - 10 - rng() * 8;
            if (w > 80 && h > 80) buildings.push({
              x, y, w, h,
              tone: Math.floor(rng() * 4),
              roof: rng() < .35,
              hp: 999
            });
          }
        }
      }
    }

    for (let i = 0; i < 110; i++) {
      const x = Math.floor(rng() * WORLD.w / 60) * 60 + 10;
      const y = Math.floor(rng() * WORLD.h / 60) * 60 + 10;
      decals.push({
        x, y,
        kind: rng() < .55 ? 'lane' : 'grunge',
        rot: rng() * TAU,
        alpha: .2 + rng() * .35
      });
    }
  }

  function isSolidRect(x, y, radius) {
    if (x < radius || y < radius || x > WORLD.w - radius || y > WORLD.h - radius) return true;
    for (const b of buildings) {
      if (circleRect(x, y, radius, b)) return true;
    }
    return false;
  }

  function circleRect(cx, cy, r, rect) {
    const px = clamp(cx, rect.x, rect.x + rect.w);
    const py = clamp(cy, rect.y, rect.y + rect.h);
    return dist(cx, cy, px, py) < r;
  }

  function moveCircle(obj, dx, dy, radius, bounce) {
    const nx = obj.x + dx;
    const ny = obj.y + dy;
    let movedX = false, movedY = false;
    if (!isSolidRect(nx, obj.y, radius)) { obj.x = nx; movedX = true; }
    else if (bounce && 'speed' in obj) obj.speed *= -0.22;
    if (!isSolidRect(obj.x, ny, radius)) { obj.y = ny; movedY = true; }
    else if (bounce && 'speed' in obj) obj.speed *= -0.22;
    return movedX || movedY;
  }

  function roadPoint() {
    if (rng() < .5) {
      const x = Math.floor(rng() * (WORLD.w / CELL + 1)) * CELL;
      return { x: clamp(x + (rng() - .5) * ROAD_W * .45, 30, WORLD.w - 30), y: rng() * WORLD.h };
    }
    return { x: rng() * WORLD.w, y: clamp(Math.floor(rng() * (WORLD.h / CELL + 1)) * CELL + (rng() - .5) * ROAD_W * .45, 30, WORLD.h - 30) };
  }

  function spawnCar(x, y, police) {
    const colors = ['#c8cad0','#cc4d46','#4f7fc1','#c6a34d','#4b995f','#8d5eb2','#e37e3b'];
    const c = {
      x: x ?? roadPoint().x,
      y: y ?? roadPoint().y,
      angle: rng() < .5 ? 0 : Math.PI / 2,
      speed: 0,
      maxSpeed: police ? 360 : 300 + rng() * 80,
      health: 100,
      width: 42,
      length: police ? 82 : 74,
      color: police ? '#dfe7ef' : pick(colors),
      occupied: false,
      police: !!police,
      stolen: false,
      marked: false,
      sirenPhase: rng() * TAU,
      aiTimer: rng() * 3,
      targetAngle: rng() < .5 ? 0 : Math.PI / 2
    };
    cars.push(c);
    return c;
  }

  function spawnNPC(kind) {
    const p = roadPoint();
    const npc = {
      x: p.x, y: p.y,
      angle: rng() * TAU,
      speed: 22 + rng() * 30,
      radius: 10,
      health: 40,
      kind: kind || (rng() < .18 ? 'gang' : 'civilian'),
      panic: 0,
      wander: rng() * 2,
      alive: true,
      target: null,
      fireCooldown: rng() * 2
    };
    npcs.push(npc);
    return npc;
  }

  function resetEntities() {
    cars.length = 0;
    npcs.length = 0;
    bullets.length = 0;
    particles.length = 0;
    floatingText.length = 0;
    for (let i = 0; i < 28; i++) spawnCar();
    for (let i = 0; i < 70; i++) spawnNPC();
    for (let i = 0; i < 3; i++) spawnCar(undefined, undefined, true);
  }

  function resetPlayer() {
    player.x = 500;
    player.y = 430;
    player.angle = 0;
    player.speed = 0;
    player.health = 100;
    player.cash = 1250;
    player.stamina = 100;
    player.inCar = null;
    player.fireCooldown = 0;
    player.damageFlash = 0;
    player.invuln = 1;
    player.wanted = 0;
    player.wantedHeat = 0;
    player.score = 0;
    mission.index = 0;
    mission.state = 'ready';
    mission.step = 0;
    mission.target = null;
    mission.kills = 0;
    mission.completed = 0;
    mission.reward = 0;
    mission.text = '';
  }

  function worldToScreen(x, y) {
    return { x: (x - camera.x) * camera.zoom + vw / 2, y: (y - camera.y) * camera.zoom + vh / 2 };
  }

  function screenToWorld(x, y) {
    return {
      x: (x - vw / 2) / camera.zoom + camera.x,
      y: (y - vh / 2) / camera.zoom + camera.y
    };
  }

  function nearestCar(maxDist) {
    let best = null, bestD = maxDist;
    for (const car of cars) {
      if (car.police && car.occupied) continue;
      const d = dist(player.x, player.y, car.x, car.y);
      if (d < bestD) { best = car; bestD = d; }
    }
    return best;
  }

  function enterCar() {
    if (player.inCar) {
      const car = player.inCar;
      const ex = car.x + Math.cos(car.angle + Math.PI / 2) * 30;
      const ey = car.y + Math.sin(car.angle + Math.PI / 2) * 30;
      if (!isSolidRect(ex, ey, 12)) {
        player.inCar = null;
        car.occupied = false;
        player.x = ex;
        player.y = ey;
        player.angle = car.angle;
        addFloating('EXIT', car.x, car.y - 48, '#d5d9df');
        tone(240, .08, .03);
      }
      return;
    }
    const car = nearestCar(62);
    if (!car) return;
    player.inCar = car;
    car.occupied = true;
    if (!car.stolen && !car.police) {
      car.stolen = true;
      addWanted(.6);
      addFloating('HOTWIRE', car.x, car.y - 45, '#ffb85c');
    }
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    tone(180, .12, .035);
  }

  function addWanted(amount) {
    player.wanted = clamp(player.wanted + amount, 0, 5);
    player.wantedHeat = 8;
  }

  function loseWanted(dt) {
    if (player.wanted <= 0) return;
    if (player.wantedHeat > 0) {
      player.wantedHeat -= dt;
      return;
    }
    player.wanted = Math.max(0, player.wanted - dt * .055);
  }

  function shoot() {
    if (player.fireCooldown > 0 || player.health <= 0) return;
    const target = screenToWorld(mouse.x, mouse.y);
    const a = Math.atan2(target.y - player.y, target.x - player.x);
    player.angle = a;
    player.fireCooldown = .13;
    bullets.push({
      x: player.x + Math.cos(a) * 18,
      y: player.y + Math.sin(a) * 18,
      vx: Math.cos(a) * 820,
      vy: Math.sin(a) * 820,
      life: .7,
      owner: 'player',
      damage: 25
    });
    particlesBurst(player.x + Math.cos(a) * 18, player.y + Math.sin(a) * 18, 5, '#f7d77a');
    addWanted(.12);
    tone(520, .045, .02);
  }

  function policeShoot(npc) {
    const a = Math.atan2(player.y - npc.y, player.x - npc.x);
    bullets.push({
      x: npc.x + Math.cos(a) * 12,
      y: npc.y + Math.sin(a) * 12,
      vx: Math.cos(a) * 520,
      vy: Math.sin(a) * 520,
      life: 1,
      owner: 'police',
      damage: 10
    });
    npc.fireCooldown = .9 + rng() * .5;
    particlesBurst(npc.x, npc.y, 2, '#86bfff');
  }

  function hitNPC(npc, damage) {
    npc.health -= damage;
    npc.panic = 4;
    if (npc.kind === 'civilian') addWanted(.18);
    if (npc.health <= 0 && npc.alive) {
      npc.alive = false;
      particlesBurst(npc.x, npc.y, 9, npc.kind === 'police' ? '#7fc1ff' : '#b4b8c1');
      addFloating(npc.kind === 'gang' ? '+TARGET' : '+50', npc.x, npc.y - 14, npc.kind === 'gang' ? '#d7ff4a' : '#ffffff');
      player.cash += npc.kind === 'gang' ? 90 : 50;
      player.score += npc.kind === 'gang' ? 400 : 80;
      if (mission.state === 'active' && mission.index === 2 && npc.kind === 'gang') mission.kills++;
    }
  }

  function hitPlayer(damage) {
    if (player.invuln > 0) return;
    const scale = player.inCar ? .4 : 1;
    player.health -= damage * scale;
    player.damageFlash = .16;
    player.invuln = .2;
    if (player.health <= 0) die();
  }

  function die() {
    running = false;
    paused = false;
    if (player.inCar) player.inCar.occupied = false;
    player.inCar = null;
    deathText.textContent = 'Skóre ' + Math.floor(player.score) + '  •  hotovost $' + Math.floor(player.cash);
    deathOverlay.classList.add('active');
    tone(110, .35, .045, 'sawtooth');
    saveGame();
  }

  function addFloating(text, x, y, color) {
    floatingText.push({ text, x, y, color, life: 1, max: 1 });
  }

  function particlesBurst(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      const a = rng() * TAU;
      const s = 40 + rng() * 170;
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: .35 + rng() * .5,
        max: .85,
        size: 1.5 + rng() * 3,
        color
      });
    }
  }

  function maybePolice() {
    const desired = Math.min(10, Math.floor(player.wanted * 1.6));
    const current = cars.filter(c => c.police).length;
    if (current >= desired || player.wanted < .4) return;
    if (policeSpawnTick > 0) return;
    policeSpawnTick = 4.5;
    const a = rng() * TAU;
    const d = 520 + rng() * 360;
    const x = clamp(player.x + Math.cos(a) * d, 80, WORLD.w - 80);
    const y = clamp(player.y + Math.sin(a) * d, 80, WORLD.h - 80);
    const p = spawnCar(x, y, true);
    p.angle = Math.atan2(player.y - p.y, player.x - p.x);
  }

  function updatePlayer(dt) {
    if (player.invuln > 0) player.invuln -= dt;
    if (player.damageFlash > 0) player.damageFlash -= dt;
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);

    if (player.inCar) {
      updateCarPlayer(player.inCar, dt);
      player.x = player.inCar.x;
      player.y = player.inCar.y;
      player.angle = player.inCar.angle;
      return;
    }

    const up = keys.w || keys.arrowup;
    const down = keys.s || keys.arrowdown;
    const left = keys.a || keys.arrowleft;
    const right = keys.d || keys.arrowright;
    let mx = (right ? 1 : 0) - (left ? 1 : 0);
    let my = (down ? 1 : 0) - (up ? 1 : 0);
    const moving = mx !== 0 || my !== 0;
    if (moving) {
      const len = Math.hypot(mx, my);
      mx /= len; my /= len;
      const sprint = keys.shift && player.stamina > 5;
      const speed = sprint ? 255 : 190;
      if (sprint) player.stamina = Math.max(0, player.stamina - dt * 16);
      else player.stamina = Math.min(100, player.stamina + dt * 12);
      moveCircle(player, mx * speed * dt, my * speed * dt, 11, false);
      if (!mouse.active) player.angle = Math.atan2(my, mx);
    } else {
      player.stamina = Math.min(100, player.stamina + dt * 18);
    }

    if (mouse.down || keys[' ']) shoot();
  }

  function updateCarPlayer(car, dt) {
    const up = keys.w || keys.arrowup;
    const down = keys.s || keys.arrowdown;
    const left = keys.a || keys.arrowleft;
    const right = keys.d || keys.arrowright;

    if (up) car.speed = lerp(car.speed, car.maxSpeed, dt * 2.8);
    else if (down) car.speed = lerp(car.speed, -car.maxSpeed * .44, dt * 4.3);
    else car.speed = lerp(car.speed, 0, dt * 1.9);

    const steer = (right ? 1 : 0) - (left ? 1 : 0);
    const turnRate = (0.95 + Math.min(1, Math.abs(car.speed) / car.maxSpeed) * 2.1);
    car.angle += steer * turnRate * dt * (car.speed >= 0 ? 1 : -1);

    const beforeX = car.x, beforeY = car.y;
    moveCircle(car, Math.cos(car.angle) * car.speed * dt, Math.sin(car.angle) * car.speed * dt, 21, true);
    if (beforeX === car.x && beforeY === car.y) car.speed *= .4;

    if (Math.abs(car.speed) > 20 && Math.random() < dt * .7) {
      particles.push({
        x: car.x - Math.cos(car.angle) * 30,
        y: car.y - Math.sin(car.angle) * 30,
        vx: (rng() - .5) * 20,
        vy: (rng() - .5) * 20,
        life: .2 + rng() * .2,
        max: .3,
        size: 2 + rng() * 2,
        color: 'rgba(210,215,220,.3)'
      });
    }
  }

  function updateCars(dt) {
    spawnTick += dt;
    policeSpawnTick = Math.max(0, policeSpawnTick - dt);
    maybePolice();

    for (let i = cars.length - 1; i >= 0; i--) {
      const car = cars[i];
      if (car === player.inCar) continue;
      if (car.health <= 0) {
        particlesBurst(car.x, car.y, 15, '#e56b52');
        cars.splice(i, 1);
        continue;
      }

      if (car.police && player.wanted > .1) {
        const a = Math.atan2(player.y - car.y, player.x - car.x);
        const delta = angleDiff(car.angle, a);
        car.angle += clamp(delta, -1.6 * dt, 1.6 * dt);
        car.speed = lerp(car.speed, car.maxSpeed, dt * 1.1);
      } else {
        car.aiTimer -= dt;
        if (car.aiTimer <= 0) {
          car.aiTimer = 1.8 + rng() * 3;
          if (rng() < .4) car.targetAngle += (rng() - .5) * Math.PI;
          else car.targetAngle = Math.round(car.targetAngle / (Math.PI / 2)) * (Math.PI / 2);
        }
        const d = angleDiff(car.angle, car.targetAngle);
        car.angle += clamp(d, -dt * .8, dt * .8);
        car.speed = lerp(car.speed, car.maxSpeed * .42, dt * .45);
      }

      const oldX = car.x, oldY = car.y;
      moveCircle(car, Math.cos(car.angle) * car.speed * dt, Math.sin(car.angle) * car.speed * dt, 20, true);
      if (oldX === car.x && oldY === car.y) {
        car.targetAngle += Math.PI / 2;
        car.speed *= .25;
      }

      if (car.police && dist(car.x, car.y, player.x, player.y) < 120) {
        car.speed *= .94;
        if (player.inCar && Math.abs(player.inCar.speed) > 80) {
          player.inCar.health -= dt * 8;
          if (player.inCar.health < 0) player.inCar.health = 0;
        } else {
          hitPlayer(dt * 12);
        }
      }

      if (car.police && dist(car.x, car.y, player.x, player.y) < 420 && !player.inCar) {
        if (lineClear(car.x, car.y, player.x, player.y)) {
          // police vehicle is a pressure system; foot officers do the actual shooting
        }
      }

      if (!car.police && player.inCar === null && car.stolen && car.health < 100) car.stolen = false;
    }
  }

  function updateNPCs(dt) {
    for (let i = npcs.length - 1; i >= 0; i--) {
      const n = npcs[i];
      if (!n.alive) {
        n.panic -= dt;
        if (n.panic < -2) npcs.splice(i, 1);
        continue;
      }

      const d = dist(n.x, n.y, player.x, player.y);
      const policeAggro = player.wanted > 0.8 && d < 560;
      if (n.kind === 'police' || (n.kind === 'gang' && mission.state === 'active' && mission.index === 2)) {
        if (d < 620) {
          n.target = { x: player.x, y: player.y };
          const a = Math.atan2(player.y - n.y, player.x - n.x);
          n.angle = lerpAngle(n.angle, a, dt * 2.2);
          n.speed = n.kind === 'police' ? 92 : 78;
          n.fireCooldown -= dt;
          if (d < 420 && lineClear(n.x, n.y, player.x, player.y) && n.fireCooldown <= 0) policeShoot(n);
        } else {
          n.target = null;
        }
      } else if (n.panic > 0 && d < 400) {
        n.angle = Math.atan2(n.y - player.y, n.x - player.x);
        n.speed = 100;
        n.panic -= dt;
      } else {
        n.wander -= dt;
        if (n.wander <= 0) {
          n.wander = 1.5 + rng() * 3;
          n.angle += (rng() - .5) * 2;
        }
        n.speed = 22 + rng() * 8;
      }

      moveCircle(n, Math.cos(n.angle) * n.speed * dt, Math.sin(n.angle) * n.speed * dt, n.radius, false);

      if (n.kind === 'gang' && mission.state === 'active' && mission.index === 2 && d < 450 && lineClear(n.x, n.y, player.x, player.y)) {
        n.fireCooldown -= dt;
        if (n.fireCooldown <= 0) policeShoot(n);
      }
    }
  }

  function lerpAngle(a, b, t) {
    return a + angleDiff(a, b) * clamp(t, 0, 1);
  }

  function lineClear(x1, y1, x2, y2) {
    const steps = Math.ceil(dist(x1, y1, x2, y2) / 28);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = lerp(x1, x2, t), y = lerp(y1, y2, t);
      for (const b of buildings) {
        if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return false;
      }
    }
    return true;
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      if (b.life <= 0 || isSolidRect(b.x, b.y, 2)) {
        bullets.splice(i, 1);
        continue;
      }

      if (b.owner === 'player') {
        let hit = false;
        for (const n of npcs) {
          if (!n.alive) continue;
          if (dist(b.x, b.y, n.x, n.y) < n.radius + 5) {
            hitNPC(n, b.damage);
            hit = true;
            break;
          }
        }
        if (!hit) {
          for (const c of cars) {
            if (c === player.inCar) continue;
            if (dist(b.x, b.y, c.x, c.y) < 24) {
              c.health -= b.damage * .8;
              addWanted(.08);
              hit = true;
              break;
            }
          }
        }
        if (hit) bullets.splice(i, 1);
      } else {
        if (player.inCar) {
          const c = player.inCar;
          if (dist(b.x, b.y, c.x, c.y) < 24) {
            c.health -= b.damage * .65;
            hitPlayer(b.damage * .35);
            particlesBurst(b.x, b.y, 3, '#ff8b7d');
            bullets.splice(i, 1);
          }
        } else if (dist(b.x, b.y, player.x, player.y) < 13) {
          hitPlayer(b.damage);
          bullets.splice(i, 1);
        }
      }
    }
  }

  function updateMission() {
    if (mission.state === 'ready') {
      mission.text = 'START A JOB';
      return;
    }

    if (mission.index === 0 && mission.state === 'active') {
      mission.text = 'Deliver the package to the docks';
      mission.target = missionSpots[1];
      if (dist(player.x, player.y, mission.target.x, mission.target.y) < 80) {
        if (!mission.step) {
          mission.step = 1;
          mission.target = missionSpots[0];
          addFloating('DROP COMPLETE', mission.target.x, mission.target.y - 50, '#d7ff4a');
          tone(820, .12, .03);
        } else {
          completeMission(250);
        }
      }
    }

    if (mission.index === 1 && mission.state === 'active') {
      mission.text = 'Steal the marked vehicle';
      mission.target = cars.find(c => c.marked && c.health > 0) || null;
      if (mission.target && player.inCar === mission.target) {
        mission.step = 1;
        mission.text = 'Lose the police';
        mission.target = missionSpots[2];
        addWanted(2.2);
      }
      if (mission.step === 1 && player.wanted < .25 && dist(player.x, player.y, missionSpots[2].x, missionSpots[2].y) < 100) {
        completeMission(500);
      }
    }

    if (mission.index === 2 && mission.state === 'active') {
      mission.text = 'Eliminate gang targets: ' + mission.kills + '/6';
      mission.target = missionSpots[3];
      if (mission.kills >= 6 && dist(player.x, player.y, mission.target.x, mission.target.y) < 100) {
        completeMission(750);
      }
    }
  }

  function startMission() {
    if (mission.state === 'active') return;
    mission.state = 'active';
    mission.step = 0;
    mission.kills = 0;
    if (mission.index === 1) {
      const target = pick(cars.filter(c => !c.police && !c.occupied));
      if (target) target.marked = true;
    }
    if (mission.index === 2) {
      for (let i = 0; i < 12; i++) spawnNPC('gang');
    }
    addFloating('JOB START', player.x, player.y - 40, '#d7ff4a');
    tone(640, .16, .03);
  }

  function completeMission(reward) {
    mission.state = 'complete';
    mission.reward = reward;
    mission.completed++;
    player.cash += reward;
    player.score += reward * 2;
    player.wanted = Math.max(0, player.wanted - 1.5);
    addFloating('+$' + reward, player.x, player.y - 45, '#d7ff4a');
    tone(880, .12, .035);
    setTimeout(() => {
      mission.index = Math.min(2, mission.index + 1);
      mission.state = 'ready';
      mission.step = 0;
      mission.reward = 0;
      for (const c of cars) c.marked = false;
    }, 700);
  }

  function update(dt) {
    elapsed += dt;
    player.wantedHeat = Math.max(0, player.wantedHeat);
    updatePlayer(dt);
    updateCars(dt);
    updateNPCs(dt);
    updateBullets(dt);
    updateMission();
    loseWanted(dt);

    autosaveClock -= dt;
    if (autosaveClock <= 0) {
      autosaveClock = 12;
      saveGame();
    }

    if (player.wanted < .35) {
      cars.forEach(c => {
        if (c.police && dist(c.x, c.y, player.x, player.y) > 800) c.health -= dt * 10;
      });
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - dt * 3; p.vy *= 1 - dt * 3;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    for (let i = floatingText.length - 1; i >= 0; i--) {
      const f = floatingText[i];
      f.y -= 26 * dt;
      f.life -= dt;
      if (f.life <= 0) floatingText.splice(i, 1);
    }

    // Keep civilian population alive.
    if (spawnTick > 3 && npcs.filter(n => n.alive).length < 68) {
      spawnTick = 0;
      spawnNPC();
    }

    // Camera follows the active body.
    const focus = player.inCar || player;
    const lead = player.inCar ? 80 : 0;
    const tx = focus.x + Math.cos(player.angle) * lead;
    const ty = focus.y + Math.sin(player.angle) * lead;
    camera.x = lerp(camera.x, tx, 1 - Math.pow(.0001, dt));
    camera.y = lerp(camera.y, ty, 1 - Math.pow(.0001, dt));
    camera.x = clamp(camera.x, vw / 2 / camera.zoom, WORLD.w - vw / 2 / camera.zoom);
    camera.y = clamp(camera.y, vh / 2 / camera.zoom, WORLD.h - vh / 2 / camera.zoom);

    if (player.inCar && player.inCar.health <= 0) {
      const c = player.inCar;
      player.inCar = null;
      c.occupied = false;
      player.x = c.x + 25; player.y = c.y + 25;
      hitPlayer(35);
      particlesBurst(c.x, c.y, 25, '#ef7a5d');
      addFloating('CAR WRECK', c.x, c.y - 50, '#ff6b63');
    }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.fillStyle = '#0a0d10';
    ctx.fillRect(0, 0, vw, vh);

    ctx.save();
    ctx.translate(vw / 2, vh / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    drawWorld();
    drawMission();
    drawCars();
    drawNPCs();
    drawPlayer();
    drawBullets();
    drawParticles();

    ctx.restore();

    drawHud();
    if (player.damageFlash > 0) {
      ctx.fillStyle = 'rgba(255,60,60,' + clamp(player.damageFlash * 1.8, 0, .3) + ')';
      ctx.fillRect(0, 0, vw, vh);
    }
  }

  function drawWorld() {
    ctx.fillStyle = '#12171b';
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    // District tinting.
    ctx.fillStyle = '#161b20';
    ctx.fillRect(0, 0, 1400, 3200);
    ctx.fillStyle = '#151a1c';
    ctx.fillRect(1400, 0, 1400, 3200);
    ctx.fillStyle = '#17191d';
    ctx.fillRect(2800, 0, 1400, 3200);

    for (const r of roads) {
      ctx.fillStyle = '#252a30';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = 'rgba(255,255,255,.045)';
      if (r.w < r.h) {
        ctx.fillRect(r.x + r.w * .5 - 1, r.y, 2, r.h);
      } else {
        ctx.fillRect(r.x, r.y + r.h * .5 - 1, r.w, 2);
      }
    }

    for (const p of parks) {
      ctx.fillStyle = '#1c2825';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = 'rgba(165,220,176,.12)';
      ctx.strokeRect(p.x + 3, p.y + 3, p.w - 6, p.h - 6);
      for (let i = 0; i < p.trees; i++) {
        const tx = p.x + 20 + ((i * 53) % Math.max(40, p.w - 40));
        const ty = p.y + 20 + ((i * 91) % Math.max(40, p.h - 40));
        ctx.fillStyle = 'rgba(69,105,79,.8)';
        ctx.beginPath(); ctx.arc(tx, ty, 11, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(13,18,16,.45)';
        ctx.fillRect(tx - 3, ty + 8, 6, 9);
      }
    }

    for (const b of buildings) {
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(b.x + 8, b.y + 10, b.w, b.h);
      const palettes = [
        ['#424850','#2a3037'],
        ['#4e443f','#302a27'],
        ['#364951','#25343a'],
        ['#4a4a40','#303029']
      ][b.tone];
      ctx.fillStyle = palettes[0];
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(255,255,255,.08)';
      ctx.strokeRect(b.x + .5, b.y + .5, b.w - 1, b.h - 1);
      ctx.fillStyle = palettes[1];
      ctx.fillRect(b.x + 7, b.y + 7, b.w - 14, 11);
      for (let wx = b.x + 18; wx < b.x + b.w - 12; wx += 24) {
        for (let wy = b.y + 34; wy < b.y + b.h - 12; wy += 28) {
          const lit = ((Math.floor(wx) + Math.floor(wy) + b.tone) % 5 === 0);
          ctx.fillStyle = lit ? 'rgba(225,205,116,.32)' : 'rgba(185,196,207,.12)';
          ctx.fillRect(wx, wy, 8, 10);
        }
      }
      if (b.roof) {
        ctx.strokeStyle = 'rgba(0,0,0,.35)';
        ctx.strokeRect(b.x + 10, b.y + 25, b.w - 20, b.h - 35);
      }
    }

    for (const d of decals) {
      ctx.save();
      ctx.translate(d.x, d.y); ctx.rotate(d.rot);
      if (d.kind === 'lane') {
        ctx.fillStyle = 'rgba(235,240,244,' + d.alpha + ')';
        ctx.fillRect(-12, -2, 24, 4);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,' + d.alpha * .35 + ')';
        ctx.fillRect(-9, -3, 18, 6);
      }
      ctx.restore();
    }

    // Grid/sector lines.
    ctx.strokeStyle = 'rgba(255,255,255,.035)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD.w; x += 210) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,WORLD.h); ctx.stroke(); }
    for (let y = 0; y <= WORLD.h; y += 210) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(WORLD.w,y); ctx.stroke(); }
  }

  function drawMission() {
    if (mission.state === 'ready') {
      const s = worldToScreen(missionSpots[0].x, missionSpots[0].y);
      drawMarker(missionSpots[0].x, missionSpots[0].y, '#d7ff4a', 'JOB');
      return;
    }
    if (!mission.target) return;
    const x = mission.target.x, y = mission.target.y;
    const color = mission.index === 1 && mission.step === 0 ? '#ffbd58' : '#d7ff4a';
    drawMarker(x, y, color, mission.index === 2 ? 'RETURN' : 'GO');
  }

  function drawMarker(x, y, color, label) {
    const pulse = 10 + Math.sin(elapsed * 4) * 4;
    ctx.strokeStyle = color;
    ctx.globalAlpha = .9;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 24 + pulse, 0, TAU); ctx.stroke();
    ctx.globalAlpha = .22;
    ctx.beginPath(); ctx.arc(x, y, 40 + pulse * 1.8, 0, TAU); ctx.stroke();
    ctx.globalAlpha = .9;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = '800 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y - 32 - pulse * .3);
  }

  function drawCars() {
    for (const c of cars) {
      const alpha = c.health <= 0 ? .3 : 1;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      ctx.globalAlpha = alpha;

      // Shadow.
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(-c.length * .5 + 5, -c.width * .5 + 5, c.length, c.width);

      ctx.fillStyle = c.color;
      ctx.fillRect(-c.length * .5, -c.width * .5, c.length, c.width);
      ctx.strokeStyle = c.marked ? '#ffbe55' : 'rgba(255,255,255,.22)';
      ctx.lineWidth = c.marked ? 3 : 1;
      ctx.strokeRect(-c.length * .5 + .5, -c.width * .5 + .5, c.length - 1, c.width - 1);

      ctx.fillStyle = c.police ? '#20292f' : 'rgba(11,15,19,.78)';
      ctx.fillRect(-8, -c.width * .5 + 5, 20, c.width - 10);
      ctx.fillStyle = 'rgba(206,229,241,.22)';
      ctx.fillRect(10, -c.width * .5 + 6, 18, c.width - 12);

      ctx.fillStyle = '#121519';
      ctx.fillRect(-c.length * .5 + 6, -c.width * .5 - 1, 12, 4);
      ctx.fillRect(-c.length * .5 + 6, c.width * .5 - 3, 12, 4);

      if (c.police) {
        const blink = Math.sin(elapsed * 10 + c.sirenPhase) > 0;
        ctx.fillStyle = blink ? '#ff545c' : '#4f9eff';
        ctx.fillRect(-5, -3, 10, 6);
      }

      ctx.restore();
    }
  }

  function drawNPCs() {
    for (const n of npcs) {
      if (!n.alive) continue;
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.rotate(n.angle);
      ctx.globalAlpha = n.panic > 0 ? .82 : 1;

      ctx.fillStyle = n.kind === 'gang' ? '#d38c62' : n.kind === 'police' ? '#6ea7d8' : '#a8adb5';
      ctx.beginPath(); ctx.arc(0, 0, n.radius, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e9edf0';
      ctx.beginPath(); ctx.arc(4, -2, 2.4, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.fillRect(-4, 7, 8, 7);

      if (n.kind === 'gang' || n.kind === 'police') {
        ctx.strokeStyle = n.kind === 'gang' ? '#e36f5e' : '#6caaff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(15, 0); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawPlayer() {
    if (player.inCar) return;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);
    const flicker = player.invuln > 0 && Math.sin(elapsed * 30) > 0;
    if (!flicker) {
      ctx.fillStyle = '#d7ff4a';
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0d1114';
      ctx.fillRect(2, -3, 13, 6);
      ctx.fillStyle = '#eceff1';
      ctx.beginPath(); ctx.arc(-3, -4, 2.2, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawBullets() {
    for (const b of bullets) {
      ctx.fillStyle = b.owner === 'player' ? '#f7d77a' : '#8ebcff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, TAU);
      ctx.fill();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const f of floatingText) {
      ctx.globalAlpha = clamp(f.life / f.max, 0, 1);
      ctx.fillStyle = f.color;
      ctx.font = '900 13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    const pad = 18;
    ctx.textAlign = 'left';

    // Top-left HUD.
    ctx.fillStyle = 'rgba(6,8,10,.78)';
    ctx.fillRect(pad, pad, 270, 122);
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.strokeRect(pad + .5, pad + .5, 269, 121);

    ctx.fillStyle = '#f0f2f4';
    ctx.font = '900 14px system-ui';
    ctx.fillText('YTG2 / URBAN HEAT', pad + 14, pad + 22);

    ctx.fillStyle = '#777f89';
    ctx.font = '700 10px system-ui';
    ctx.fillText('HEALTH', pad + 14, pad + 42);
    drawBar(pad + 14, pad + 49, 116, 8, player.health / 100, '#d7ff4a');

    ctx.fillText('STAMINA', pad + 148, pad + 42);
    drawBar(pad + 148, pad + 49, 106, 8, player.stamina / 100, '#82b8ff');

    ctx.fillStyle = '#f0f2f4';
    ctx.font = '800 14px system-ui';
    ctx.fillText('$' + Math.floor(player.cash), pad + 14, pad + 84);
    ctx.fillStyle = '#777f89';
    ctx.font = '700 10px system-ui';
    ctx.fillText('SCORE ' + Math.floor(player.score), pad + 148, pad + 84);

    const stars = Math.ceil(player.wanted);
    ctx.fillStyle = '#ff646c';
    ctx.font = '900 19px system-ui';
    ctx.fillText('★'.repeat(stars) + '☆'.repeat(5 - stars), pad + 14, pad + 108);

    // Mission.
    const missionX = pad + 18;
    const missionY = 164;
    ctx.fillStyle = 'rgba(6,8,10,.72)';
    ctx.fillRect(pad, missionY - 18, Math.min(390, vw - pad * 2), 58);
    ctx.strokeStyle = mission.state === 'active' ? 'rgba(215,255,74,.35)' : 'rgba(255,255,255,.1)';
    ctx.strokeRect(pad + .5, missionY - 17.5, Math.min(390, vw - pad * 2) - 1, 57);
    ctx.fillStyle = mission.state === 'active' ? '#d7ff4a' : '#a1a7af';
    ctx.font = '800 11px system-ui';
    ctx.fillText('MISSION ' + (mission.index + 1), missionX, missionY);
    ctx.fillStyle = '#eef1f4';
    ctx.font = '700 12px system-ui';
    ctx.fillText(mission.state === 'active' ? mission.text : mission.state === 'complete' ? 'MISSION COMPLETE' : 'E — START JOB AT SAFEHOUSE', missionX, missionY + 20);

    // Vehicle status.
    if (player.inCar) {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(6,8,10,.78)';
      ctx.fillRect(vw - 228 - pad, vh - 92, 228, 72);
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.strokeRect(vw - 228 - pad + .5, vh - 91.5, 227, 71);
      ctx.fillStyle = '#f0f2f4';
      ctx.font = '900 13px system-ui';
      ctx.fillText(player.inCar.police ? 'POLICE VEHICLE' : player.inCar.marked ? 'MARKED VEHICLE' : 'VEHICLE', vw - pad - 14, vh - 65);
      ctx.fillStyle = '#777f89';
      ctx.font = '700 10px system-ui';
      ctx.fillText('WASD / ARROWS • E EXIT', vw - pad - 14, vh - 45);
      drawBar(vw - pad - 186, vh - 30, 172, 8, player.inCar.health / 100, '#ff7b66');
    }

    drawMinimap();

    // Floating interaction prompt.
    const near = player.inCar ? null : nearestCar(62);
    if (near) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(6,8,10,.82)';
      ctx.fillRect(vw * .5 - 90, vh - 48, 180, 28);
      ctx.fillStyle = '#f0f2f4';
      ctx.font = '800 11px system-ui';
      ctx.fillText('E  ENTER VEHICLE', vw * .5, vh - 29);
    }

    if (mission.state === 'ready' && dist(player.x, player.y, missionSpots[0].x, missionSpots[0].y) < 95) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(6,8,10,.88)';
      ctx.fillRect(vw * .5 - 128, vh - 88, 256, 30);
      ctx.fillStyle = '#d7ff4a';
      ctx.font = '900 11px system-ui';
      ctx.fillText('E  TAKE MISSION', vw * .5, vh - 68);
    }
  }

  function drawBar(x, y, w, h, value, color) {
    ctx.fillStyle = 'rgba(255,255,255,.1)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp(value, 0, 1), h);
  }

  function drawMinimap() {
    const size = 170;
    const x = vw - size - 18;
    const y = 18;
    const scaleX = size / WORLD.w;
    const scaleY = size / WORLD.h;

    ctx.fillStyle = 'rgba(4,6,8,.84)';
    ctx.fillRect(x, y, size, size);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();

    ctx.fillStyle = '#1b2025';
    ctx.fillRect(x, y, size, size);
    for (const r of roads) {
      ctx.fillStyle = '#343a41';
      ctx.fillRect(x + r.x * scaleX, y + r.y * scaleY, Math.max(1, r.w * scaleX), Math.max(1, r.h * scaleY));
    }
    for (const b of buildings) {
      ctx.fillStyle = '#11151a';
      ctx.fillRect(x + b.x * scaleX, y + b.y * scaleY, Math.max(1, b.w * scaleX), Math.max(1, b.h * scaleY));
    }
    for (const c of cars) {
      if (!c.police) continue;
      ctx.fillStyle = '#ff5b65';
      ctx.fillRect(x + c.x * scaleX - 1, y + c.y * scaleY - 1, 3, 3);
    }
    ctx.fillStyle = '#d7ff4a';
    ctx.beginPath();
    ctx.arc(x + player.x * scaleX, y + player.y * scaleY, 4, 0, TAU);
    ctx.fill();

    if (mission.target) {
      ctx.strokeStyle = '#d7ff4a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x + mission.target.x * scaleX, y + mission.target.y * scaleY, 4, 0, TAU);
      ctx.stroke();
    }

    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.15)';
    ctx.strokeRect(x + .5, y + .5, size - 1, size - 1);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#7f8791';
    ctx.font = '800 9px system-ui';
    ctx.fillText('NORTH // CITY GRID', x + size - 7, y + size - 7);
  }

  function interact() {
    const dMission = dist(player.x, player.y, missionSpots[0].x, missionSpots[0].y);
    if (mission.state === 'ready' && dMission < 100) {
      startMission();
      return;
    }
    enterCar();
  }

  function saveGame() {
    const save = {
      x: player.x, y: player.y, health: player.health, cash: player.cash,
      score: player.score, missionIndex: mission.index, completed: mission.completed
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) {}
  }

  function loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      player.x = Number(s.x) || player.x;
      player.y = Number(s.y) || player.y;
      player.health = clamp(Number(s.health) || 100, 1, 100);
      player.cash = Number(s.cash) || player.cash;
      player.score = Number(s.score) || 0;
      mission.index = clamp(Number(s.missionIndex) || 0, 0, 2);
      mission.completed = Number(s.completed) || 0;
      return true;
    } catch (_) { return false; }
  }

  function startGame() {
    initAudio();
    generateCity();
    resetEntities();
    resetPlayer();
    loadGame();
    running = true;
    paused = false;
    menu.classList.remove('active');
    pauseOverlay.classList.remove('active');
    deathOverlay.classList.remove('active');
    lastTime = performance.now();
    tone(440, .08, .025);
    requestAnimationFrame(loop);
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    pauseOverlay.classList.toggle('active', paused);
    if (!paused) {
      lastTime = performance.now();
      requestAnimationFrame(loop);
    }
  }

  function loop(now) {
    if (!running) {
      draw();
      return;
    }
    if (paused) {
      draw();
      return;
    }
    const dt = Math.min(.033, Math.max(.001, (now - lastTime) / 1000));
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault();
    if (k === 'e') interact();
    if (k === 'escape') togglePause();
  });

  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  canvas.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  });
  canvas.addEventListener('pointerdown', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.down = true;
    mouse.active = true;
    initAudio();
  });
  window.addEventListener('pointerup', () => mouse.down = false);
  window.addEventListener('blur', () => {
    mouse.down = false;
    Object.keys(keys).forEach(k => keys[k] = false);
    if (running && !paused) togglePause();
  });

  startBtn.addEventListener('click', startGame);
  resumeBtn.addEventListener('click', togglePause);
  saveBtn.addEventListener('click', () => { saveGame(); tone(720, .1, .03); });
  respawnBtn.addEventListener('click', () => {
    resetEntities();
    resetPlayer();
    loadGame();
    running = true;
    deathOverlay.classList.remove('active');
    lastTime = performance.now();
    requestAnimationFrame(loop);
  });

  // Initial static scene before play.
  generateCity();
  resetEntities();
  camera.x = player.x;
  camera.y = player.y;
  draw();
})();