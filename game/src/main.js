// SANDLINE boot and the one loop: a fixed 60 Hz simulation feeding a
// render at the display's rate. ?shot=cover|buy|site|win with &seed=N sets
// up a deterministic frame for a capture, settles it, renders it twice,
// then freezes it and sets window.__shotReady. ?autoplay=1&seed=N starts a
// headless match with the player driven by the sim's autopilot, for
// balance tests: window.__ff(n) steps the sim n frames, and
// window.__autoResult holds the match result when it ends.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createArsenal } from './weapons.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createSim } from './sim.js';
import { SPAWNS } from './world.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const autoplay = params.get('autoplay') === '1';
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);
if (shot || autoplay) Math.random = random; // deterministic captures and autoplay runs only; live play stays random

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.skyTop);
scene.fog = new THREE.Fog(new THREE.Color(0x8a5a44), 34, 110);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 220);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
const hud = createHud();
const player = createPlayer(world.colliders, SPAWNS.vanguard[0]);
const arsenal = createArsenal(camera, scene);
const sim = createSim({ scene, world, player, arsenal, effects, audio, hud, camera });
const input = createInput(renderer.domElement, onLockChange);

const body = player.state;
let fovTarget = 74;
let menuAngle = 0;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();

hud.setHealth(100, 0);
hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, false);
hud.setMoney(800);
hud.setScore(0, 0);
hud.setAlive(5, 5);
hud.setObjective('Click to play');
hud.setBomb('Charge with you');
hud.onBuyClick((kind, id) => {
  // the buy menu's clicks reach the sim's buy(): the one place money moves.
  sim.buy(kind, id);
});

hud.showOverlay('start');

document.getElementById('play').addEventListener('click', () => {
  audio.unlock();
  if (sim.state.phase === 'menu') {
    sim.startMatch();
    hud.hideOverlay();
    input.requestLock();
  } else if (sim.state.phase === 'matchEnd') {
    sim.startMatch();
    hud.hideOverlay();
    input.requestLock();
  } else if (sim.state.phase === 'round' && !player.state.alive) {
    hud.hideOverlay();
  } else {
    hud.hideOverlay();
    input.requestLock();
  }
});

function onLockChange(locked) {
  if (shot || autoplay) return;
  if (locked) {
    hud.hideOverlay();
  } else if ((sim.state.phase === 'round' || sim.state.phase === 'buy') && player.state.alive) {
    hud.showOverlay('paused');
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  const def = arsenal.def();
  const zoom = body.aiming && def.zoom ? def.zoom : body.aiming ? 1.25 : 1;
  fovTarget = 74 / zoom;
  if (Math.abs(camera.fov - fovTarget) > 0.1) {
    camera.fov += (fovTarget - camera.fov) * 0.2;
    camera.updateProjectionMatrix();
  }
}

function menuCamera(dt) {
  menuAngle += dt * 0.05;
  camera.position.set(Math.sin(menuAngle) * 30, 13, Math.cos(menuAngle) * 30);
  camera.lookAt(0, 1, -4);
}

function step(dt) {
  // The sim raycasts against the meshes' world matrices, and the renderer
  // is the thing that normally refreshes them — so a headless run that
  // steps without rendering would test every mesh at the origin. Refresh
  // them here instead; in live play the renderer does the same work again
  // for free at render time.
  scene.updateMatrixWorld();
  if (sim.state.phase === 'round' || sim.state.phase === 'buy') {
    const look = input.takeLook();
    if (input.state.locked || shot) player.look(look.x, look.y);
  }
  sim.step(dt, input);
  syncBots();
  input.endStep();
}

// The bots' meshes face where the bot faces, and their legs and arms
// swing with their walk: the group turns with bot.yaw, the legs with
// walkPhase, the arms from their ready poses.
function syncBots() {
  for (const f of sim.fighters) {
    if (f.isPlayer || !f.limbs) continue;
    const { legL, legR, armL, armR, armLBase, armRBase } = f.limbs;
    f.group.rotation.y = f.yaw;
    const swing = Math.sin(f.walkPhase) * 0.45;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = armLBase - swing * 0.25;
    armR.rotation.x = armRBase + swing * 0.25;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    if (sim.state.phase === 'menu') {
      menuCamera(dt);
      world.update(dt);
      effects.step(dt);
    } else {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
      syncCamera();
    }
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  sim.setupShot(name);
  // 30 steps (0.5 s) settles every shot: the site smoke is staged
  // outright in setupShot, so no long fuse wait is needed.
  settle(30);
  // Fire one aimed round for combat shots (tracer + muzzle flash in frame);
  // re-show the win banner, which a slow software render can outlast.
  if (name === 'cover' || name === 'site') sim.debugFire();
  if (name !== 'win') hud.hideBanner();
  hud.setHealth(player.state.health, player.state.armour);
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, false);
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    // Re-show the win banner right before each render: a slow software
    // render can outlast its 3.2 s timeout, so the banner is timed from
    // the last frame, not from the setup.
    if (name === 'win') hud.banner('Round 4 — Vanguard wins', 'Charge detonated');
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__game = { sim, player, arsenal, world, input };

// Headless balance runs: step the sim by hand instead of the render loop.
window.__ff = (n) => {
  for (let i = 0; i < n; i += 1) {
    if (sim.state.phase === 'matchEnd') break;
    step(FIXED_STEP);
    syncCamera();
  }
  return sim.state.phase;
};
window.__matchDone = () => sim.state.phase === 'matchEnd';

syncCamera();
if (shot) runShot(shot);
else if (autoplay) {
  hud.hideOverlay();
  sim.enableAutoplay();
} else requestAnimationFrame(frame);
