// Bots: one class, two teams, three jobs.
//
// Every bot walks a waypoint graph (BFS over world.js's nodes), sees with a
// raycast, hears gunfire, and fights in bursts with a reaction delay and an
// aim error that grows with distance and target speed — so a still target
// dies and a moving one lives. Attackers push lanes to the site and plant;
// defenders hold angles and defuse. A bot is a few boxes in its team's
// colour; its head and torso meshes are its hitboxes.
import * as THREE from 'three';
import { WAYPOINTS, SITE } from './world.js';
import { PALETTE } from './palette.js';

const BOT_SPEED = 3.4;
const BOT_COMBAT_SPEED = 2.2;
const BOT_HEIGHT = 1.72;
const BOT_RADIUS = 0.34;
const REACT_MIN = 0.25;
const REACT_MAX = 0.5;
const SIGHT_RANGE = 42;

const NAMES = {
  vanguard: ['Rook', 'Heron', 'Sable', 'Ivy'],
  ember: ['Cinder', 'Ash', 'Flint', 'Onyx', 'Rust'],
};

// Lane assignments, as waypoint node paths from each spawn.
const LANES = {
  vanguard: [
    [3, 4, 5, 6], // A Long
    [7, 8, 9, 13], // Mid
    [10, 11, 12, 13], // B tunnel flank
    [16, 3, 4, 5, 6], // Mid-west to A
  ],
  ember: [
    [14], [18], [13], [19], [9], // hold positions around the site and lanes
  ],
};

const TEAM_COLOR = { vanguard: PALETTE.teal, ember: PALETTE.rust };

function nearestNode(pos) {
  let best = 0;
  let bestDist = Infinity;
  WAYPOINTS.nodes.forEach(([x, z], i) => {
    const d = (x - pos.x) ** 2 + (z - pos.z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

// Breadth-first path over the waypoint graph, from the node nearest `from`
// to `to`. Returns node indices, first step first.
export function findPath(from, to) {
  const start = nearestNode(from);
  const prev = new Map([[start, -1]]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === to) break;
    for (const [a, b] of WAYPOINTS.edges) {
      const next = a === node ? b : b === node ? a : -1;
      if (next >= 0 && !prev.has(next)) {
        prev.set(next, node);
        queue.push(next);
      }
    }
  }
  if (!prev.has(to)) return [to];
  const path = [];
  let node = to;
  while (node !== start && node >= 0) {
    path.unshift(node);
    node = prev.get(node);
  }
  return path;
}

function buildMesh(team) {
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(TEAM_COLOR[team]), roughness: 0.8, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x23262b), roughness: 0.7, metalness: 0.2 });
  const visor = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x0e1113), roughness: 0.25, metalness: 0.6 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, 0.18), dark);
  legL.position.set(-0.11, 0.4, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), cloth);
  torso.position.y = 1.11;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.3), cloth);
  head.position.y = 1.58;
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.02), visor);
  face.position.set(0, 1.58, 0.16);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), dark);
  gun.position.set(0.2, 1.25, -0.3);
  group.add(legL, legR, torso, head, face, gun);
  group.traverse((m) => {
    m.castShadow = true;
  });
  return { group, head, torso };
}

export function createBot(scene, team, index, spawn, colliders) {
  const { group, head, torso } = buildMesh(team);
  group.position.set(spawn[0], 0, spawn[1]);
  scene.add(group);
  const bot = {
    id: `${team}-${index}`,
    name: NAMES[team][index],
    team,
    group,
    head,
    torso,
    position: group.position,
    yaw: team === 'vanguard' ? 0 : Math.PI,
    health: 100,
    armour: 0,
    alive: true,
    isPlayer: false,
    lane: LANES[team][index % LANES[team].length],
    laneStep: 0,
    path: [],
    pathTarget: -1,
    holdNode: LANES[team][index % LANES[team].length][0],
    state: 'route', // route | hold | combat | plant | defuse | investigate
    enemy: null,
    enemyVisible: false,
    reactLeft: 0,
    burstLeft: 0,
    shotCooldown: 0,
    losCooldown: 0,
    strafeDir: 1,
    strafeLeft: 0,
    channel: 0, // plant/defuse progress 0..1
    hearPos: null,
    speed: BOT_SPEED,
    walkPhase: 0,
  };
  head.userData = { bot, part: 'head' };
  torso.userData = { bot, part: 'body' };
  const probe = new THREE.Box3();

  function overlaps(x, y, z) {
    probe.min.set(x - BOT_RADIUS, y + 0.04, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, y + BOT_HEIGHT - 0.04, z + BOT_RADIUS);
    for (const c of colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function moveToward(tx, tz, dt, speed) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.25) return true;
    const vx = (dx / dist) * speed;
    const vz = (dz / dist) * speed;
    const nx = bot.position.x + vx * dt;
    if (!overlaps(nx, bot.position.y, bot.position.z)) bot.position.x = nx;
    const nz = bot.position.z + vz * dt;
    if (!overlaps(bot.position.x, bot.position.y, nz)) bot.position.z = nz;
    bot.yaw = Math.atan2(-dx, -dz);
    bot.walkPhase += dt * speed * 2.2;
    return false;
  }

  function routeTo(node, dt) {
    if (bot.pathTarget !== node || bot.path.length === 0) {
      bot.path = findPath(bot.position, node);
      bot.pathTarget = node;
    }
    const [nx, nz] = WAYPOINTS.nodes[bot.path[0]];
    if (moveToward(nx, nz, dt, bot.speed)) bot.path.shift();
    return bot.path.length === 0;
  }

  function damage(amount) {
    let rest = amount;
    if (bot.armour > 0) {
      const soaked = Math.min(bot.armour, rest * 0.5);
      bot.armour -= soaked;
      rest -= soaked;
    }
    bot.health -= rest;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.group.rotation.x = -Math.PI / 2;
      bot.group.position.y = 0.25;
      return true;
    }
    return false;
  }

  function reset(spawnPoint) {
    bot.position.set(spawnPoint[0], 0, spawnPoint[1]);
    bot.group.rotation.set(0, 0, 0);
    bot.yaw = bot.team === 'vanguard' ? 0 : Math.PI;
    bot.health = 100;
    bot.armour = 0;
    bot.alive = true;
    bot.laneStep = 0;
    bot.path = [];
    bot.pathTarget = -1;
    bot.state = 'route';
    bot.enemy = null;
    bot.channel = 0;
    bot.hearPos = null;
  }

  return { bot, moveToward, routeTo, damage, reset };
}

// One step of one bot's mind. `ctx` is the sim's view of the world:
// fighters (player wrapper + bots), lineOfSight(a, b), damage(f, amt, part, by),
// noise events, the bomb state, and hooks for tracers and sound.
export function stepBot(handle, dt, ctx) {
  const { bot } = handle;
  if (!bot.alive) return;
  bot.shotCooldown = Math.max(0, bot.shotCooldown - dt);
  bot.losCooldown = Math.max(0, bot.losCooldown - dt);
  bot.strafeLeft = Math.max(0, bot.strafeLeft - dt);

  // --- senses: nearest visible enemy, checked four times a second
  if (bot.losCooldown === 0) {
    bot.losCooldown = 0.25;
    bot.enemyVisible = false;
    let nearest = null;
    let nearestDist = Infinity;
    for (const f of ctx.fighters) {
      if (!f.alive || f.team === bot.team) continue;
      const d = Math.hypot(f.position.x - bot.position.x, f.position.z - bot.position.z);
      if (d < nearestDist && d < SIGHT_RANGE) {
        nearest = f;
        nearestDist = d;
      }
    }
    if (nearest && ctx.lineOfSight(bot.position, nearest.position)) {
      bot.enemy = nearest;
      bot.enemyVisible = true;
      bot.reactLeft = REACT_MIN + Math.random() * (REACT_MAX - REACT_MIN);
    } else if (bot.enemy && !ctx.lineOfSight(bot.position, bot.enemy.position)) {
      bot.enemy = null;
    }
  }
  if (bot.hearPos && !bot.enemy) {
    const d = Math.hypot(bot.hearPos.x - bot.position.x, bot.hearPos.z - bot.position.z);
    if (d < 1.5) bot.hearPos = null;
  }

  // --- bomb duties outrank routing, but combat always outranks the bomb:
  // a bot that can see an enemy fights first and plants or defuses after.
  const bomb = ctx.bomb;
  if (bot.team === 'ember' && bomb.planted && !bot.enemyVisible) {
    bot.state = 'route';
    bot.pathTarget = -1;
    handle.routeTo(6, dt);
    const d = Math.hypot(SITE.x - bot.position.x, SITE.z - bot.position.z);
    if (d < SITE.radius + 0.5 && !bot.enemyVisible) {
      bot.state = 'defuse';
      bot.channel += dt / 5;
      if (bot.channel >= 1) ctx.defuseDone(bot);
    }
    return;
  }
  if (bot.team === 'vanguard' && bomb.carrier === bot && !bomb.planted && !bot.enemyVisible) {
    handle.routeTo(6, dt);
    const d = Math.hypot(SITE.x - bot.position.x, SITE.z - bot.position.z);
    if (d < SITE.radius && !bot.enemyVisible) {
      bot.state = 'plant';
      bot.channel += dt / 3;
      if (bot.channel >= 1) ctx.plantDone(bot);
    } else {
      bot.state = 'route';
    }
    return;
  }

  // --- combat: face the enemy, strafe, fire in bursts once reacted
  if (bot.enemyVisible && bot.enemy?.alive) {
    bot.state = 'combat';
    const e = bot.enemy;
    const dx = e.position.x - bot.position.x;
    const dz = e.position.z - bot.position.z;
    bot.yaw = Math.atan2(-dx, -dz);
    bot.reactLeft -= dt;
    if (bot.strafeLeft === 0) {
      bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
      bot.strafeLeft = 0.5 + Math.random() * 0.8;
    }
    // strafe perpendicular to the enemy, slowly closing distance
    const px = -dz * bot.strafeDir;
    const pz = dx * bot.strafeDir;
    const len = Math.hypot(px, pz) || 1;
    handle.moveToward(
      bot.position.x + (px / len) * 1.2 - dx * 0.08,
      bot.position.z + (pz / len) * 1.2 - dz * 0.08,
      dt, BOT_COMBAT_SPEED,
    );
    if (bot.reactLeft <= 0 && bot.shotCooldown === 0) {
      if (bot.burstLeft === 0) bot.burstLeft = 3 + ((Math.random() * 3) | 0);
      bot.burstLeft -= 1;
      bot.shotCooldown = bot.burstLeft > 0 ? 0.11 : 0.55 + Math.random() * 0.5;
      const dist = Math.hypot(dx, dz);
      const targetSpeed = e.isPlayer ? ctx.playerSpeed : BOT_SPEED;
      const error = 0.018 + dist * 0.0009 + targetSpeed * 0.004;
      const aimY = 1.35 + (Math.random() * 2 - 1) * 0.3;
      ctx.botShoot(bot, e, error, aimY);
    }
    return;
  }

  // --- investigate a heard shot, then resume the lane
  if (bot.hearPos) {
    bot.state = 'investigate';
    if (handle.moveToward(bot.hearPos.x, bot.hearPos.z, dt, bot.speed)) bot.hearPos = null;
    return;
  }

  // --- route or hold
  if (bot.team === 'vanguard') {
    bot.state = 'route';
    const node = bot.lane[Math.min(bot.laneStep, bot.lane.length - 1)];
    if (handle.routeTo(node, dt)) bot.laneStep += 1;
  } else {
    bot.state = 'hold';
    if (bot.pathTarget !== bot.holdNode || bot.path.length > 0) {
      handle.routeTo(bot.holdNode, dt);
    }
  }
}
