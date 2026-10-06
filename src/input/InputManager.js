const STORAGE_KEY = 'gotdope-input-v1';
const DEADZONE = 0.22;
const CONFIRM_MAGNITUDE = 0.42;
const DEVICE_CONFIRM_MS = 120;

const DEFAULT_BINDINGS = Object.freeze({
  moveUp: ['KeyW', 'ArrowUp'],
  moveDown: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  interact: ['KeyE'],
  pause: ['Escape'],
  weather: ['KeyR'],
  fire: ['Space']
});

const PROMPTS = Object.freeze({
  keyboard: { move: 'WASD / ARROWS', aim: 'MOUSE', fire: 'SPACE / LMB', interact: 'E', pause: 'ESC', sprint: 'SHIFT' },
  mouse: { move: 'WASD / ARROWS', aim: 'MOUSE', fire: 'LMB / SPACE', interact: 'E', pause: 'ESC', sprint: 'SHIFT' },
  touch: { move: 'LEFT STICK', aim: 'RIGHT STICK', fire: 'FIRE', interact: 'ACTION', pause: 'MENU', sprint: 'SPRINT' },
  gamepad: { move: 'LEFT STICK', aim: 'RIGHT STICK', fire: 'RT', interact: 'A', pause: 'START', sprint: 'L3' }
});

function clampSigned(value) { return Math.max(-1, Math.min(1, value)); }
function applyDeadzone(value, zone = DEADZONE) {
  const magnitude = Math.abs(value);
  if (magnitude <= zone) return 0;
  return Math.sign(value) * ((magnitude - zone) / (1 - zone));
}
function normalizeVector(x, y) {
  const length = Math.hypot(x, y);
  if (length <= 0.0001) return { x: 0, y: 0, magnitude: 0 };
  const magnitude = Math.min(1, length);
  return { x: x / length * magnitude, y: y / length * magnitude, magnitude };
}
function cloneBindings(bindings) {
  return Object.fromEntries(Object.entries(bindings).map(([key, values]) => [key, [...values]]));
}
function loadBindings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    const result = cloneBindings(DEFAULT_BINDINGS);
    for (const action of Object.keys(result)) {
      if (Array.isArray(saved?.[action]) && saved[action].length) {
        result[action] = saved[action].filter((code) => typeof code === 'string').slice(0, 3);
      }
    }
    return result;
  } catch {
    return cloneBindings(DEFAULT_BINDINGS);
  }
}

export class InputManager extends EventTarget {
  constructor({ touchRoot = document } = {}) {
    super();
    this.bindings = loadBindings();
    this.keysDown = new Set();
    this.pointerButtons = new Set();
    this.pressedActions = new Set();
    this.touchFire = false;
    this.device = 'keyboard';
    this.deviceCandidate = null;
    this.deviceCandidateAt = 0;
    this.mouse = { x: innerWidth * 0.5, y: innerHeight * 0.5, active: false };
    this.touch = {
      left: { pointerId: null, x: 0, y: 0, magnitude: 0 },
      right: { pointerId: null, x: 0, y: 0, magnitude: 0 }
    };
    this.gamepad = {
      index: null, connected: false, axes: [0, 0, 0, 0], buttons: [], previousButtons: [], lastPoll: 0
    };
    this.rebindAction = null;
    this.disposed = false;
    this.touchCleanup = [];

    this.boundKeyDown = (event) => this.onKeyDown(event);
    this.boundKeyUp = (event) => this.onKeyUp(event);
    this.boundPointerMove = (event) => this.onPointerMove(event);
    this.boundPointerDown = (event) => this.onPointerDown(event);
    this.boundPointerUp = (event) => this.onPointerUp(event);
    this.boundPointerCancel = (event) => this.onPointerCancel(event);
    this.boundBlur = () => this.clearAll('blur');
    this.boundVisibility = () => { if (document.hidden) this.clearAll('hidden'); };
    this.boundGamepadConnected = (event) => this.onGamepadConnected(event);
    this.boundGamepadDisconnected = (event) => this.onGamepadDisconnected(event);

    window.addEventListener('keydown', this.boundKeyDown, { passive: false });
    window.addEventListener('keyup', this.boundKeyUp, { passive: false });
    window.addEventListener('pointermove', this.boundPointerMove, { passive: false });
    window.addEventListener('pointerdown', this.boundPointerDown, { passive: false });
    window.addEventListener('pointerup', this.boundPointerUp, { passive: false });
    window.addEventListener('pointercancel', this.boundPointerCancel, { passive: false });
    window.addEventListener('blur', this.boundBlur);
    document.addEventListener('visibilitychange', this.boundVisibility);
    window.addEventListener('gamepadconnected', this.boundGamepadConnected);
    window.addEventListener('gamepaddisconnected', this.boundGamepadDisconnected);

    this.bindTouchControls(touchRoot);
    this.refreshGamepadConnection();
  }

  onKeyDown(event) {
    if (this.disposed) return;

    if (this.rebindAction) {
      if (event.code === 'Escape' || event.code === 'Tab') { event.preventDefault(); return; }
      event.preventDefault();
      this.bindings[this.rebindAction] = [event.code];
      const action = this.rebindAction;
      this.rebindAction = null;
      this.persistBindings();
      this.dispatchEvent(new CustomEvent('bindingchange', { detail: { action, code: event.code } }));
      return;
    }

    this.markDevice('keyboard', true);
    this.keysDown.add(event.code);

    if (!event.repeat) {
      for (const action of Object.keys(this.bindings)) {
        if (this.bindings[action].includes(event.code)) this.pressedActions.add(action);
      }
    }

    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  }

  onKeyUp(event) { this.keysDown.delete(event.code); }

  onPointerMove(event) {
    if (event.pointerType === 'mouse') {
      this.markDevice('mouse', true);
      this.mouse.active = true;
      this.mouse.x = event.clientX;
      this.mouse.y = event.clientY;
    }
    if (event.pointerType === 'touch') this.markDevice('touch', true);
  }

  onPointerDown(event) {
    if (event.pointerType === 'mouse') {
      this.markDevice('mouse', true);
      this.mouse.active = true;
      this.mouse.x = event.clientX;
      this.mouse.y = event.clientY;
      this.pointerButtons.add(event.button);
      if (event.button === 0) this.pressedActions.add('fire');
    } else if (event.pointerType === 'touch') {
      this.markDevice('touch', true);
    }
  }

  onPointerUp(event) {
    if (event.pointerType === 'mouse') this.pointerButtons.delete(event.button);
  }

  onPointerCancel(event) {
    if (event.pointerType === 'touch') this.releaseTouchPointer(event.pointerId);
    if (event.pointerType === 'mouse') this.pointerButtons.delete(event.button);
  }

  bindTouchControls(root) {
    const left = root.querySelector('[data-stick="left"]');
    const right = root.querySelector('[data-stick="right"]');
    if (left) this.bindStick(left, this.touch.left);
    if (right) this.bindStick(right, this.touch.right);

    root.querySelectorAll('[data-action]').forEach((button) => {
      const action = button.dataset.action;
      const activate = (event) => {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
        event.preventDefault(); event.stopPropagation();
        this.markDevice('touch', true);
        try { button.setPointerCapture(event.pointerId); } catch {}
        button.classList.add('active');
        if (action === 'fire') this.touchFire = true;
        else this.pressedActions.add(action);
      };
      const deactivate = (event) => {
        event.preventDefault(); event.stopPropagation();
        button.classList.remove('active');
        if (action === 'fire') this.touchFire = false;
      };
      button.addEventListener('pointerdown', activate, { passive: false });
      button.addEventListener('pointerup', deactivate, { passive: false });
      button.addEventListener('pointercancel', deactivate, { passive: false });
      button.addEventListener('lostpointercapture', deactivate, { passive: false });
      this.touchCleanup.push(() => {
        button.removeEventListener('pointerdown', activate);
        button.removeEventListener('pointerup', deactivate);
        button.removeEventListener('pointercancel', deactivate);
        button.removeEventListener('lostpointercapture', deactivate);
      });
    });
  }

  bindStick(element, state) {
    const update = (event) => {
      const rect = element.getBoundingClientRect();
      const radius = Math.min(rect.width, rect.height) * 0.5;
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const vector = normalizeVector((event.clientX - cx) / radius, (event.clientY - cy) / radius);
      state.x = vector.x; state.y = vector.y; state.magnitude = vector.magnitude;
      element.classList.toggle('active', state.magnitude > 0.02);
      const knob = element.querySelector('.touch-stick__knob');
      if (knob) {
        const offset = radius * 0.56;
        knob.style.transform =
          'translate(calc(-50% + ' + state.x * offset + 'px), calc(-50% + ' + state.y * offset + 'px))';
      }
    };

    const reset = () => {
      state.pointerId = null; state.x = 0; state.y = 0; state.magnitude = 0;
      element.classList.remove('active');
      const knob = element.querySelector('.touch-stick__knob');
      if (knob) knob.style.transform = 'translate(-50%, -50%)';
    };

    const down = (event) => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      event.preventDefault(); event.stopPropagation();
      this.markDevice('touch', true);
      state.pointerId = event.pointerId;
      try { element.setPointerCapture(event.pointerId); } catch {}
      update(event);
    };
    const move = (event) => {
      if (state.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      update(event);
    };
    const end = (event) => {
      if (state.pointerId !== event.pointerId) return;
      event.preventDefault(); reset();
    };

    element.addEventListener('pointerdown', down, { passive: false });
    element.addEventListener('pointermove', move, { passive: false });
    element.addEventListener('pointerup', end, { passive: false });
    element.addEventListener('pointercancel', end, { passive: false });
    element.addEventListener('lostpointercapture', end, { passive: false });

    this.touchCleanup.push(() => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
      element.removeEventListener('pointercancel', end);
      element.removeEventListener('lostpointercapture', end);
    });
  }

  releaseTouchPointer(pointerId) {
    for (const state of [this.touch.left, this.touch.right]) {
      if (state.pointerId === pointerId) {
        state.pointerId = null; state.x = 0; state.y = 0; state.magnitude = 0;
      }
    }
  }

  pollGamepad(now = performance.now()) {
    if (this.disposed || !navigator.getGamepads || now - this.gamepad.lastPoll < 16) return;
    this.gamepad.lastPoll = now;

    const pads = navigator.getGamepads();
    let pad = this.gamepad.index == null ? null : pads?.[this.gamepad.index];
    if (!pad) {
      pad = [...pads].find(Boolean) || null;
      if (pad) this.gamepad.index = pad.index;
    }

    if (!pad) {
      this.gamepad.connected = false;
      this.gamepad.axes = [0, 0, 0, 0];
      this.gamepad.buttons = [];
      return;
    }

    this.gamepad.connected = true;

    const axes = Array.from(pad.axes || []);
    const ax0 = applyDeadzone(axes[0] || 0);
    const ax1 = applyDeadzone(axes[1] || 0);
    const ax2 = applyDeadzone(axes[2] || 0);
    const ax3 = applyDeadzone(axes[3] || 0);
    this.gamepad.axes = [ax0, ax1, ax2, ax3];

    const pressed = Array.from(pad.buttons || [], (button) => Boolean(button?.pressed));
    this.gamepad.buttons = pressed;

    const meaningfulAxis =
      Math.hypot(ax0, ax1) >= CONFIRM_MAGNITUDE ||
      Math.hypot(ax2, ax3) >= CONFIRM_MAGNITUDE;
    if (meaningfulAxis || pressed.some(Boolean)) this.confirmDevice('gamepad', now);

    pressed.forEach((isPressed, index) => {
      const wasPressed = Boolean(this.gamepad.previousButtons[index]);
      if (isPressed && !wasPressed) {
        if (index === 0) this.pressedActions.add('interact');
        if (index === 3) this.pressedActions.add('weather');
        if (index === 9) this.pressedActions.add('pause');
        if (index === 10) this.pressedActions.add('sprint');
      }
    });

    this.gamepad.previousButtons = pressed;
  }

  onGamepadConnected(event) {
    this.gamepad.index = event.gamepad.index;
    this.gamepad.connected = true;
    this.dispatchEvent(new CustomEvent('gamepad', { detail: { connected: true } }));
  }

  onGamepadDisconnected(event) {
    if (this.gamepad.index === event.gamepad.index) {
      this.gamepad.index = null; this.gamepad.connected = false;
      this.gamepad.axes = [0, 0, 0, 0];
      this.gamepad.buttons = [];
      this.gamepad.previousButtons = [];
    }
    this.dispatchEvent(new CustomEvent('gamepad', { detail: { connected: false } }));
  }

  refreshGamepadConnection() {
    if (!navigator.getGamepads) return;
    const pad = [...navigator.getGamepads()].find(Boolean);
    if (pad) { this.gamepad.index = pad.index; this.gamepad.connected = true; }
  }

  markDevice(device, immediate = false) {
    if (immediate) {
      if (this.device !== device) {
        this.device = device;
        this.dispatchEvent(new CustomEvent('devicechange', { detail: { device } }));
      }
      this.deviceCandidate = null;
      return;
    }
    this.confirmDevice(device, performance.now());
  }

  confirmDevice(device, now) {
    if (this.device === device) {
      this.deviceCandidate = null;
      return;
    }
    if (this.deviceCandidate !== device) {
      this.deviceCandidate = device;
      this.deviceCandidateAt = now;
      return;
    }
    if (now - this.deviceCandidateAt >= DEVICE_CONFIRM_MS) {
      this.device = device;
      this.deviceCandidate = null;
      this.dispatchEvent(new CustomEvent('devicechange', { detail: { device } }));
    }
  }

  isBoundDown(action) {
    return (this.bindings[action] || []).some((code) => this.keysDown.has(code));
  }

  isDown(action) {
    if (action === 'fire') return this.isBoundDown(action) || this.pointerButtons.has(0) || this.touchFire;
    return this.isBoundDown(action);
  }

  actionDown(action) {
    this.pollGamepad();
    if (action === 'fire') return this.gamepad.buttons[7] === true || this.isDown(action);
    if (action === 'sprint') return this.gamepad.buttons[10] === true || this.isDown(action);
    return this.isDown(action);
  }

  movement() {
    this.pollGamepad();
    let x = 0; let y = 0;

    if (this.isBoundDown('moveLeft')) x -= 1;
    if (this.isBoundDown('moveRight')) x += 1;
    if (this.isBoundDown('moveUp')) y -= 1;
    if (this.isBoundDown('moveDown')) y += 1;

    if (this.touch.left.magnitude > 0.02) {
      x = this.touch.left.x; y = this.touch.left.y;
    } else if (Math.hypot(this.gamepad.axes[0], this.gamepad.axes[1]) > DEADZONE) {
      x = this.gamepad.axes[0]; y = this.gamepad.axes[1];
    }

    return normalizeVector(clampSigned(x), clampSigned(y));
  }

  aim() {
    this.pollGamepad();

    if (this.touch.right.magnitude > 0.04) {
      return { type: 'vector', x: this.touch.right.x, y: this.touch.right.y, magnitude: this.touch.right.magnitude };
    }

    const gx = this.gamepad.axes[2]; const gy = this.gamepad.axes[3];
    if (Math.hypot(gx, gy) > DEADZONE) {
      return { type: 'vector', x: gx, y: gy, magnitude: Math.min(1, Math.hypot(gx, gy)) };
    }

    if (this.mouse.active) return { type: 'mouse', x: this.mouse.x, y: this.mouse.y };
    return { type: 'none', x: 0, y: 0, magnitude: 0 };
  }

  consume(action) {
    const had = this.pressedActions.has(action);
    this.pressedActions.delete(action);
    return had;
  }

  prompt(action) {
    return PROMPTS[this.device]?.[action] || PROMPTS.keyboard[action] || action.toUpperCase();
  }

  getBindingLabel(action) {
    return (this.bindings[action] || [])
      .map((code) => code.replace('Key', '').replace('Arrow', '').replace('Left', ' L').replace('Right', ' R'))
      .join(' / ');
  }

  startRebind(action) {
    if (!(action in this.bindings)) return;
    this.rebindAction = action;
    this.dispatchEvent(new CustomEvent('rebindstart', { detail: { action } }));
  }

  resetBindings() {
    this.bindings = cloneBindings(DEFAULT_BINDINGS);
    this.rebindAction = null;
    this.persistBindings();
    this.dispatchEvent(new CustomEvent('bindingreset'));
  }

  persistBindings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings)); } catch {}
  }

  clearAll(reason = 'manual') {
    this.keysDown.clear();
    this.pointerButtons.clear();
    this.pressedActions.clear();
    this.touchFire = false;
    for (const state of [this.touch.left, this.touch.right]) {
      state.pointerId = null; state.x = 0; state.y = 0; state.magnitude = 0;
    }
    document.querySelectorAll('.touch-stick.active,.touch-actions button.active').forEach((node) => node.classList.remove('active'));
    this.dispatchEvent(new CustomEvent('cleared', { detail: { reason } }));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('pointermove', this.boundPointerMove);
    window.removeEventListener('pointerdown', this.boundPointerDown);
    window.removeEventListener('pointerup', this.boundPointerUp);
    window.removeEventListener('pointercancel', this.boundPointerCancel);
    window.removeEventListener('blur', this.boundBlur);
    document.removeEventListener('visibilitychange', this.boundVisibility);
    window.removeEventListener('gamepadconnected', this.boundGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this.boundGamepadDisconnected);

    this.touchCleanup.forEach((cleanup) => cleanup());
    this.touchCleanup.length = 0;
    this.clearAll('dispose');
  }
}
