// Bots: one class, two teams, three jobs.
//
// Every bot walks a waypoint graph (BFS over world.js's nodes), sees with a
// raycast, hears gunfire, and fights in bursts with a reaction delay and an
// aim error that grows with distance and target speed — so a still target
// dies and a moving one lives. Attackers push lanes to the site and plant;
// defenders hold angles and defuse. A bot buys its own loadout each round
// (rifle, Kevlar, grenades — the sniper stays player-only), throws
// flash/smoke/HE where they change the round, and fights with the gun it
// bought. Its head and torso meshes are its hitboxes; the helmet, pads,
// pack and limbs are decoration the bullets ignore.
import * as THREE from 'three';
import { WAYPOINTS, SITE } from './world.js';
import { PALETTE } from './palette.js';
import { WEAPONS, ARMOUR_VALUE, chooseLoadout } from './weapons.js';

const BOT_SPEED = 3.4;
const BOT_COMBAT_SPEED = 2.2;
const BOT_HEIGHT = 1.72;
const BOT_RADIUS = 0.34;
const REACT_MIN = 0.25;
const REACT_MAX = 0.5;
// Defenders hold prepared angles: they react clearly faster and shoot
// straighter than attackers pushing into them. Without an edge the
// attackers' local numbers at the site — five pushing against three
// holding — win the deathmatch almost every round, and the bomb never
// matters. Attackers keep the initiative; defenders keep the angles.
const TEAM_EDGE = {
  vanguard: { reactMin: REACT_MIN, reactMax: REACT_MAX, errorMul: 1 },
  ember: { reactMin: 0.15, reactMax: 0.3, errorMul: 0.8 },
};
// A bot only picks a fight it can actually take: beyond this range the
// aim error makes a duel a staring contest, and combat outranks routing —
// so without a cap the attackers never push and the defenders never hold.
const ENGAGE_RANGE = 26;

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

// What a bot's gun does in a fight: damage, burst length and the gap
// between shots, by the weapon it bought. Shotguns stay close: a bot only
// engages inside 16 m with one. Damage comes from the weapon table, so a
// balance change to a gun reaches the bots too.
const BOT_GUNS = {
  pistol: { damage: WEAPONS.pistol.damage, burst: 3, gap: 0.16, range: 42 },
  rifle: { damage: WEAPONS.rifle.damage, burst: 4, gap: 0.10, range: 42 },
  smg: { damage: WEAPONS.smg.damage, burst: 6, gap: 0.07, range: 30 },
  shotgun: { damage: 44, burst: 1, gap: 0.85, range: 16 },
};

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

// One set of geometries and materials for all nine bots: the meshes are
// cheap clones of shared parts, so nine fighters cost little more than one.
let SHARED = null;
function sharedAssets() {
  if (SHARED) return SHARED;
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const legGeo = box(0.16, 0.8, 0.18);
  legGeo.translate(0, -0.4, 0); // pivot at the hip, so the leg swings
  const armUpperGeo = box(0.13, 0.34, 0.15);
  armUpperGeo.translate(0, -0.17, 0); // pivot at the shoulder
  const armForeGeo = box(0.11, 0.32, 0.13);
  armForeGeo.translate(0, -0.16, 0); // pivot at the elbow
  SHARED = {
    geo: {
      leg: legGeo,
      boot: box(0.18, 0.1, 0.32),
      torso: box(0.52, 0.62, 0.3),
      vest: box(0.56, 0.42, 0.1),
      pad: box(0.2, 0.12, 0.32),
      head: box(0.3, 0.28, 0.3),
      helmet: box(0.34, 0.12, 0.34),
      crest: box(0.05, 0.12, 0.3),
      brim: box(0.38, 0.04, 0.38),
      visor: box(0.24, 0.1, 0.02),
      armUpper: armUpperGeo,
      armFore: armForeGeo,
      pack: box(0.34, 0.42, 0.16),
      tank: new THREE.CylinderGeometry(0.09, 0.09, 0.42, 10),
      gun: box(0.07, 0.09, 0.55),
      grip: box(0.06, 0.16, 0.06),
    },
    mat: {
      dark: new THREE.MeshStandardMaterial({ color: new THREE.Color(0x23262b), roughness: 0.7, metalness: 0.2 }),
      visor: new THREE.MeshStandardMaterial({ color: new THREE.Color(0x0e1113), roughness: 0.25, metalness: 0.6 }),
      cloth: {
        vanguard: new THREE.MeshStandardMaterial({ color: new THREE.Color(TEAM_COLOR.vanguard), roughness: 0.8, metalness: 0.05 }),
        ember: new THREE.MeshStandardMaterial({ color: new THREE.Color(TEAM_COLOR.ember), roughness: 0.8, metalness: 0.05 }),
      },
    },
  };
  return SHARED;
}

// A bot reads as its team at a glance. Vanguard (teal) wears an angular
// helmet with a crest fin and a flat pack; Ember (rust) a brimmed helmet
// and a tank on its back. Both carry their gun across the body with both
// hands. The head and torso meshes are the hitboxes, exactly as before —
// the helmet, pads, pack and limbs are decoration the bullets ignore.
// Forward is -z: the visor and the gun point there, and the group turns
// with bot.yaw (main.js syncs it every step).
function buildMesh(team) {
  const { geo, mat } = sharedAssets();
  const cloth = mat.cloth[team];
  const group = new THREE.Group();
  const legL = new THREE.Mesh(geo.leg, mat.dark);
  legL.position.set(-0.11, 0.8, 0);
  const bootL = new THREE.Mesh(geo.boot, mat.dark);
  bootL.position.set(0, -0.76, 0.05);
  legL.add(bootL);
  const legR = legL.clone();
  legR.position.x = 0.11;
  const torso = new THREE.Mesh(geo.torso, cloth);
  torso.position.y = 1.11;
  const vest = new THREE.Mesh(geo.vest, mat.dark);
  vest.position.set(0, 0.06, 0.14);
  torso.add(vest);
  const padL = new THREE.Mesh(geo.pad, cloth);
  padL.position.set(-0.32, 0.28, 0);
  torso.add(padL);
  const padR = padL.clone();
  padR.position.x = 0.32;
  torso.add(padR);
  const pack = new THREE.Mesh(geo.pack, mat.dark);
  pack.position.set(0, 0.05, -0.23);
  torso.add(pack);
  if (team === 'ember') {
    const tank = new THREE.Mesh(geo.tank, mat.dark);
    tank.position.set(0, 0.05, -0.32);
    torso.add(tank);
  }
  const head = new THREE.Mesh(geo.head, cloth);
  head.position.y = 1.58;
  const helmet = new THREE.Mesh(geo.helmet, mat.dark);
  helmet.position.y = 0.18;
  head.add(helmet);
  if (team === 'vanguard') {
    const crest = new THREE.Mesh(geo.crest, cloth);
    crest.position.y = 0.28;
    head.add(crest);
  } else {
    const brim = new THREE.Mesh(geo.brim, mat.dark);
    brim.position.y = 0.1;
    head.add(brim);
  }
  const face = new THREE.Mesh(geo.visor, mat.visor);
  face.position.set(0, 0, -0.16);
  head.add(face);
  // Arms hang from shoulder pivots and reach forward to the gun; the walk
  // cycle swings them from these base poses in main.js.
  const armL = new THREE.Group();
  armL.position.set(-0.31, 1.38, 0);
  armL.add(new THREE.Mesh(geo.armUpper, cloth));
  const foreL = new THREE.Group();
  foreL.position.set(0, -0.34, 0);
  foreL.add(new THREE.Mesh(geo.armFore, cloth));
  armL.add(foreL);
  const armR = new THREE.Group();
  armR.position.set(0.31, 1.38, 0);
  armR.add(new THREE.Mesh(geo.armUpper, cloth));
  const foreR = new THREE.Group();
  foreR.position.set(0, -0.34, 0);
  foreR.add(new THREE.Mesh(geo.armFore, cloth));
  armR.add(foreR);
  armL.rotation.x = 0.9;
  armR.rotation.x = 1.1;
  foreL.rotation.x = 0.35;
  foreR.rotation.x = 0.25;
  const gun = new THREE.Mesh(geo.gun, mat.dark);
  gun.position.set(0.2, 1.25, -0.3);
  const grip = new THREE.Mesh(geo.grip, mat.dark);
  grip.position.set(0.2, 1.16, -0.18);
  group.add(legL, legR, torso, head, armL, armR, gun, grip);
  group.traverse((m) => {
    m.castShadow = true;
  });
  return { group, head, torso, legL, legR, armL, armR };
}

export function createBot(scene, team, index, spawn, colliders) {
  const { group, head, torso, legL, legR, armL, armR } = buildMesh(team);
  group.position.set(spawn[0], 0, spawn[1]);
  scene.add(group);
  const bot = {
    id: `${team}-${index}`,
    name: NAMES[team][index],
    team,
    group,
    head,
    torso,
    limbs: { legL, legR, armL, armR, armLBase: 0.9, armRBase: 1.1 },
    position: group.position,
    yaw: team === 'vanguard' ? 0 : Math.PI,
    health: 100,
    armour: 0,
    alive: true,
    isPlayer: false,
    money: 800, // a bot's own purse: it buys like the player does
    weapon: 'pistol',
    weaponDamage: WEAPONS.pistol.damage,
    grenades: { he: 0, smoke: 0, flash: 0 },
    grenadeCooldown: 0,
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
    if (bot.path.length === 0) return true; // already standing on the node
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
    bot.grenades = { he: 0, smoke: 0, flash: 0 }; // re-bought every round
    bot.grenadeCooldown = 0;
    bot.burstLeft = 0;
  }

  return { bot, moveToward, routeTo, damage, reset };
}

// The buy phase, for one bot: spend its purse on the best gun it can
// afford (only paying for an upgrade over the gun it already owns), then
// Kevlar, then grenades. Called by the sim each buy phase.
export function buyBot(bot) {
  const loadout = chooseLoadout(bot.money, bot.weapon);
  bot.money -= loadout.spent;
  bot.weapon = loadout.weapon;
  bot.weaponDamage = WEAPONS[loadout.weapon].damage;
  bot.armour = loadout.armour ? ARMOUR_VALUE : 0;
  bot.grenades = {
    he: loadout.grenades.he ?? 0,
    smoke: loadout.grenades.smoke ?? 0,
    flash: loadout.grenades.flash ?? 0,
  };
  bot.grenadeCooldown = 0;
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
    const range = Math.min(BOT_GUNS[bot.weapon].range, ENGAGE_RANGE);
    for (const f of ctx.fighters) {
      if (!f.alive || f.team === bot.team) continue;
      const d = Math.hypot(f.position.x - bot.position.x, f.position.z - bot.position.z);
      if (d < nearestDist && d < range) {
        nearest = f;
        nearestDist = d;
      }
    }
    if (nearest && ctx.lineOfSight(bot.position, nearest.position)) {
      // A new target costs a reaction delay; a target already being
      // tracked does not re-roll it every sighting, or the bot would
      // never fire at all.
      if (bot.enemy !== nearest) {
        const edge = TEAM_EDGE[bot.team];
        bot.reactLeft = edge.reactMin + Math.random() * (edge.reactMax - edge.reactMin);
      }
      bot.enemy = nearest;
      bot.enemyVisible = true;
    } else {
      // No target in range with a sightline: the fight is over for now,
      // and the bot goes back to routing or holding.
      if (!nearest) bot.enemy = null;
      else if (bot.enemy && !ctx.lineOfSight(bot.position, bot.enemy.position)) bot.enemy = null;
    }
  }
  if (bot.hearPos && !bot.enemy) {
    const d = Math.hypot(bot.hearPos.x - bot.position.x, bot.hearPos.z - bot.position.z);
    if (d < 1.5) bot.hearPos = null;
  }

  // --- grenades: spend them where they change the round. This runs before
  // the bomb duties, so a carrier can flash the site before pushing in and
  // a defender can smoke the site while the bomb ticks. One throw per bot
  // per ~10 s keeps the round from becoming a grenade spam.
  bot.grenadeCooldown = Math.max(0, bot.grenadeCooldown - dt);
  if (bot.grenadeCooldown === 0) {
    const toSite = Math.hypot(SITE.x - bot.position.x, SITE.z - bot.position.z);
    if (bot.team === 'vanguard' && ctx.bomb.carrier === bot && !ctx.bomb.planted && toSite < 18 && bot.grenades.flash > 0 && Math.random() < 0.6) {
      ctx.throwGrenade(bot, 'flash', { x: SITE.x, y: 0, z: SITE.z });
    } else if (bot.team === 'vanguard' && ctx.bomb.carrier === bot && !ctx.bomb.planted && toSite < 14 && bot.grenades.smoke > 0) {
      ctx.throwGrenade(bot, 'smoke', { x: SITE.x, y: 0, z: SITE.z });
    } else if (bot.team === 'ember' && ctx.bomb.planted && toSite < 15 && bot.grenades.smoke > 0) {
      ctx.throwGrenade(bot, 'smoke', { x: SITE.x, y: 0, z: SITE.z });
    } else if (bot.enemyVisible && bot.enemy?.alive && bot.grenades.flash > 0) {
      const d = Math.hypot(bot.enemy.position.x - bot.position.x, bot.enemy.position.z - bot.position.z);
      if (d > 8 && d < 26 && Math.random() < 0.5) ctx.throwGrenade(bot, 'flash', bot.enemy.position);
    } else if (bot.enemyVisible && bot.enemy?.alive && bot.grenades.he > 0) {
      const d = Math.hypot(bot.enemy.position.x - bot.position.x, bot.enemy.position.z - bot.position.z);
      if (d > 6 && d < 16 && Math.random() < 0.4) ctx.throwGrenade(bot, 'he', bot.enemy.position);
    }
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
      bot.position.x + (px / len) * 1.2 + dx * 0.08,
      bot.position.z + (pz / len) * 1.2 + dz * 0.08,
      dt, BOT_COMBAT_SPEED,
    );
    if (bot.reactLeft <= 0 && bot.shotCooldown === 0) {
      const gun = BOT_GUNS[bot.weapon];
      if (bot.burstLeft === 0) bot.burstLeft = gun.burst + ((Math.random() * 2) | 0);
      bot.burstLeft -= 1;
      bot.shotCooldown = bot.burstLeft > 0 ? gun.gap : 0.55 + Math.random() * 0.5;
      const dist = Math.hypot(dx, dz);
      const targetSpeed = e.isPlayer ? ctx.playerSpeed : BOT_SPEED;
      // A moving target is harder to hit, but not that much harder: at
      // 0.004 a strafing player is nearly unhittable and carries every
      // round. At 0.002 the bots track a strafe and the player has to
      // use cover, not just wiggle.
      const error = (0.018 + dist * 0.0009 + targetSpeed * 0.002) * TEAM_EDGE[bot.team].errorMul;
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
