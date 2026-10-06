import '../styles.css';
import { InputManager } from './input/InputManager.js';
import { Game } from './game/Game.js';

const el = (id) => document.getElementById(id);
const root = document.documentElement;

class UI {
  constructor() {
    this.launcher = el('launcher');
    this.settings = el('settings');
    this.pause = el('pause');
    this.busted = el('busted');
    this.touchControls = el('touchControls');
    this.deviceBadge = el('deviceBadge');
    this.promptMove = el('promptMove');
    this.promptAim = el('promptAim');
    this.promptFire = el('promptFire');
    this.promptInteract = el('promptInteract');
    this.health = el('health'); this.stamina = el('stamina'); this.money = el('money');
    this.wanted = el('wanted'); this.weather = el('weather'); this.clock = el('clock');
    this.missionNo = el('missionNo'); this.missionText = el('missionText'); this.hint = el('hint');
    this.bustedText = el('bustedText');
    this.minimap = el('mapCanvas'); this.map = this.minimap.getContext('2d');
    this.inputRows = [...document.querySelectorAll('[data-bind-action]')];
    this.notice = el('notice');

    this.inputRows.forEach((row) => {
      row.addEventListener('click', () => window.gotdopeInput?.startRebind(row.dataset.bindAction));
    });
  }

  showGame() {
    this.launcher.classList.add('hidden'); this.settings.classList.add('hidden');
    this.pause.classList.add('hidden'); this.busted.classList.add('hidden');
    root.classList.add('game-active');
  }

  showLauncher() {
    this.launcher.classList.remove('hidden'); root.classList.remove('game-active');
  }

  showSettings() { this.settings.classList.remove('hidden'); }
  hideSettings() { this.settings.classList.add('hidden'); }

  showPause(reason) {
    this.pause.classList.remove('hidden');
    el('pauseReason').textContent =
      reason === 'focus'
        ? 'Gameplay paused because the page lost focus. Resume when ready.'
        : 'Gameplay is paused.';
  }

  hidePause() { this.pause.classList.add('hidden'); }

  showBusted(data) {
    this.bustedText.textContent = 'Score ' + data.score + ' · Cash $' + data.money.toLocaleString('en-US');
    this.busted.classList.remove('hidden');
  }

  hideBusted() { this.busted.classList.add('hidden'); }

  setMission(data) {
    this.missionNo.textContent = 'MISSION ' + String(data.no).padStart(2, '0');
    this.missionText.textContent = data.text;
  }

  setInputDevice(device, input) {
    this.deviceBadge.textContent = device.toUpperCase();
    this.promptMove.textContent = input.prompt('move');
    this.promptAim.textContent = input.prompt('aim');
    this.promptFire.textContent = input.prompt('fire');
    this.promptInteract.textContent = input.prompt('interact');

    this.hint.textContent =
      device === 'gamepad'
        ? 'A = interact · START = pause'
        : device === 'touch'
          ? 'Two sticks can be used together · actions stay independent'
          : 'E = interact · ESC = pause';

    this.touchControls.classList.toggle(
      'active',
      device === 'touch' || (('ontouchstart' in window) && window.innerWidth < 900)
    );

    el('hudMove').textContent = input.prompt('move') + ' MOVE';
    el('hudAim').textContent = input.prompt('aim') + ' AIM';
    el('hudFire').textContent = input.prompt('fire') + ' FIRE';
  }

  setNotice(message) {
    this.notice.textContent = message; this.notice.classList.add('show');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.notice.classList.remove('show'), 1800);
  }

  updateBindings(input) {
    for (const row of this.inputRows) {
      const action = row.dataset.bindAction;
      const value = row.querySelector('[data-bind-value]');
      if (!value) continue;
      value.textContent = input.rebindAction === action ? 'PRESS KEY…' : input.getBindingLabel(action);
      row.classList.toggle('waiting', input.rebindAction === action);
    }
  }

  updateHUD(data) {
    this.health.style.width = Math.max(0, data.health) + '%';
    this.stamina.style.width = Math.max(0, data.stamina) + '%';
    this.money.textContent = '$' + Math.floor(data.money).toLocaleString('en-US');
    this.wanted.textContent = '★'.repeat(data.wanted) + '☆'.repeat(5 - data.wanted);
    this.weather.textContent = data.weather; this.clock.textContent = data.time;
    this.drawMinimap(data);
  }

  drawMinimap(data) {
    const ctx = this.map; const size = this.minimap.width;
    ctx.clearRect(0, 0, size, size); ctx.fillStyle = '#111'; ctx.fillRect(0, 0, size, size);
    const scale = size / (data.worldHalf * 2);

    ctx.fillStyle = '#303030';
    for (let value = -1200; value <= 1200; value += 300) {
      ctx.fillRect((value + data.worldHalf) * scale, 0, 5, size);
      ctx.fillRect(0, (value + data.worldHalf) * scale, size, 5);
    }

    ctx.fillStyle = '#090909';
    for (const box of data.colliders) {
      ctx.fillRect(
        (box.minX + data.worldHalf) * scale,
        (box.minZ + data.worldHalf) * scale,
        (box.maxX - box.minX) * scale,
        (box.maxZ - box.minZ) * scale
      );
    }

    ctx.fillStyle = '#bdbdbd';
    for (const car of data.police) {
      ctx.fillRect((car.x + data.worldHalf) * scale - 1.5, (car.z + data.worldHalf) * scale - 1.5, 3, 3);
    }

    ctx.strokeStyle = '#fff';
    for (const job of data.jobs) {
      ctx.strokeRect((job.x + data.worldHalf) * scale - 3, (job.z + data.worldHalf) * scale - 3, 6, 6);
    }

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc((data.playerX + data.worldHalf) * scale, (data.playerZ + data.worldHalf) * scale, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function showFatal(message) {
  document.body.innerHTML =
    '<main class="fatal"><div><span class="eyebrow">GOTDOPE / RUNTIME</span>' +
    '<h1>WEBGL 2 UNAVAILABLE</h1><p>' + message + '</p>' +
    '<p>Use a modern Firefox, Chrome or Edge browser with hardware acceleration enabled.</p>' +
    '</div></main>';
}

const ui = new UI();
const input = new InputManager({ touchRoot: document });
window.gotdopeInput = input;

input.addEventListener('devicechange', (event) => {
  ui.setInputDevice(event.detail.device, input);
  ui.setNotice('INPUT: ' + event.detail.device.toUpperCase());
});
input.addEventListener('bindingchange', () => { ui.updateBindings(input); ui.setNotice('Key binding saved'); });
input.addEventListener('bindingreset', () => { ui.updateBindings(input); ui.setNotice('Default bindings restored'); });
input.addEventListener('rebindstart', () => ui.updateBindings(input));
input.addEventListener('gamepad', (event) => ui.setNotice(event.detail.connected ? 'Gamepad connected' : 'Gamepad disconnected'));

ui.setInputDevice(input.device, input);
ui.updateBindings(input);

let game;
try {
  game = new Game({ canvas: document.getElementById('game'), input, ui });
  window.gotdopeGame = game;
} catch (error) {
  if (error?.message === 'WEBGL2_UNAVAILABLE') {
    showFatal('This game requires a browser and graphics device that support WebGL 2.');
    input.dispose();
  } else {
    showFatal('Game initialization failed. Check the browser console for the runtime error.');
  }
  throw error;
}

el('startButton').addEventListener('click', () => game.start());
el('openSettings').addEventListener('click', () => ui.showSettings());
el('closeSettings').addEventListener('click', () => ui.hideSettings());
el('resetBindings').addEventListener('click', () => input.resetBindings());
el('resumeButton').addEventListener('click', () => game.resume());
el('pauseSettings').addEventListener('click', () => { ui.hidePause(); ui.showSettings(); });
el('saveButton').addEventListener('click', () => { game.save(); ui.setNotice('Game saved'); });
el('respawnButton').addEventListener('click', () => game.respawn());
el('pauseClose').addEventListener('click', () => game.resume());
el('fullscreenButton').addEventListener('click', async () => { try { await document.documentElement.requestFullscreen?.(); } catch {} });

window.addEventListener('beforeunload', () => {
  game?.save();
  game?.dispose();
  input.dispose();
});

ui.showLauncher();
