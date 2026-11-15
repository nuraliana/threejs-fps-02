// The simulation: one state object, one fixed step, everything a round is.
//
// Phases: menu -> buy (15 s, shop, frozen) -> round (100 s) -> roundEnd
// (4 s) -> buy ... -> matchEnd (first to 5 rounds, at most 9). The bomb
// starts with the player; if the player falls, the nearest alive Vanguard
// bot picks it up and carries it to the site. Defenders win on the clock;
// attackers win by elimination or by detonation. Money pays for the buy
// menu; a kill pays $300, a round win $3,250, a loss $1,900.
import * as THREE from 'three';
import { SITE, SPAWNS, WAYPOINTS } from './world.js';
import { createBot, stepBot, buyBot, findPath } from './bots.js';
import { WEAPONS, GRENADES, ARMOUR_PRICE, ARMOUR_VALUE, chooseLoadout } from './weapons.js';

const BUY_SECONDS = 15;
const ROUND_SECONDS = 100;
const BOMB_FUSE = 35;
const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 5;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 9;
const KILL_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1900;

export function createSim({ scene, world, player, arsenal, effects, audio, hud, camera }) {
  const raycaster = new THREE.Raycaster();
  const tmpDir = new THREE.Vector3();
  const tmpOrigin = new THREE.Vector3();
  const tmpPoint = new THREE.Vector3();
  const muzzleVec = new THREE.Vector3();

  const state = {
    phase: 'menu',
    round: 1,
    wins: { vanguard: 0, ember: 0 },
    money: 800,
    timer: 0,
    kills: 0,
    deaths: 0,
    bomb: { holder: 'player', planted: false, fuse: BOMB_FUSE, channel: 0, dropPos: null },
    prevFiring: false,
    lastBeepSecond: -1,
    deadShown: false,
    auto: false, // autoplay: the player is driven by autoDrive, for headless balance tests
    roundWinners: [],
    roundReasons: [],
    autoBought: false,
    autoNades: {},
  };

  const owned = {
    weapons: new Set(['pistol']),
    grenades: {},
    armour: 0,
  };

  // The player's hitboxes: transparent meshes the bots' rays can hit.
  const hitMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, colorWrite: false,
  });
  const playerHead = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), hitMat);
  const playerBody = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.95, 0.36), hitMat);
  scene.add(playerHead, playerBody);

  const playerFighter = {
    isPlayer: true,
    team: 'vanguard',
    name: 'You',
    get position() { return player.state.position; },
    get alive() { return player.state.alive; },
  };
  playerHead.userData = { fighter: playerFighter, part: 'head' };
  playerBody.userData = { fighter: playerFighter, part: 'body' };

  const botHandles = [];
  const botByFighter = new Map();
  // Shot counters for balance tuning: how many shots the bots and the
  // player fire, and how many of them land. Read via sim.debug.
  const debug = { botShots: 0, botHits: 0, playerShots: 0, playerHits: 0, killsBy: {}, auto: { keys: [], target: null, path: [] } };
  SPAWNS.vanguard.slice(1).forEach((spawn, i) => {
    const h = createBot(scene, 'vanguard', i, spawn, world.colliders);
    botHandles.push(h);
    botByFighter.set(h.bot, h);
  });
  SPAWNS.ember.forEach((spawn, i) => {
    const h = createBot(scene, 'ember', i, spawn, world.colliders);
    botHandles.push(h);
    botByFighter.set(h.bot, h);
  });
  const fighters = [playerFighter, ...botHandles.map((h) => h.bot)];

  function aliveCount(team) {
    return fighters.filter((f) => f.team === team && f.alive).length;
  }

  function lineOfSight(a, b) {
    tmpOrigin.set(a.x, 1.5, a.z);
    tmpPoint.set(b.x, 1.2, b.z);
    tmpDir.copy(tmpPoint).sub(tmpOrigin);
    const dist = tmpDir.length();
    tmpDir.normalize();
    raycaster.set(tmpOrigin, tmpDir);
    raycaster.far = dist;
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    if (hit) return false;
    return !effects.blockedBySmoke(tmpOrigin, tmpPoint);
  }

  function noise(pos, radius) {
    for (const h of botHandles) {
      const b = h.bot;
      if (!b.alive || b.enemy) continue;
      const d = Math.hypot(b.position.x - pos.x, b.position.z - pos.z);
      if (d < radius) b.hearPos = pos.clone();
    }
  }

  function muzzleWorld(out) {
    camera.localToWorld(out.set(0.24, -0.16, -0.9));
    return out;
  }

  // Raycast a shot. Returns the first fighter hit, the wall point, or null.
  function shootRay(origin, direction, maxDist) {
    raycaster.set(origin, direction);
    raycaster.far = maxDist;
    const targets = [];
    for (const f of fighters) {
      if (!f.alive) continue;
      if (f.isPlayer) targets.push(playerHead, playerBody);
      else targets.push(f.head, f.torso);
    }
    const hits = raycaster.intersectObjects([...world.shootables, ...targets], false);
    if (hits.length === 0) return null;
    const hit = hits[0];
    if (hit.object.userData.fighter) {
      return { fighter: hit.object.userData.fighter, part: hit.object.userData.part, point: hit.point, dist: hit.distance };
    }
    if (hit.object.userData.bot) {
      return { fighter: hit.object.userData.bot, part: hit.object.userData.part, point: hit.point, dist: hit.distance };
    }
    return { wall: true, point: hit.point, dist: hit.distance };
  }

  function dropBombAt(pos) {
    state.bomb.holder = null;
    state.bomb.dropPos = pos.clone();
    state.bomb.channel = 0;
  }

  function damage(fighter, amount, part, attacker) {
    if (!fighter.alive) return;
    const dealt = amount * (part === 'head' ? 2 : 1);
    let killed = false;
    if (fighter.isPlayer) {
      killed = player.damage(dealt);
      hud.damageFlash();
      if (killed) {
        state.deaths += 1;
        if (state.bomb.holder === 'player' && !state.bomb.planted) {
          dropBombAt(fighter.position);
        }
      }
    } else {
      const handle = botByFighter.get(fighter);
      killed = handle.damage(dealt);
      fighter.channel = 0; // damage interrupts a plant or a defuse
      if (killed && state.bomb.holder === fighter) dropBombAt(fighter.position);
    }
    if (killed) {
      debug.killsBy[attacker.name] = (debug.killsBy[attacker.name] ?? 0) + 1;
      hud.killfeed(attacker.name, fighter.name, attacker.isPlayer ? arsenal.def().name : (WEAPONS[attacker.weapon]?.name ?? 'VK-47'), part === 'head');
      if (attacker.isPlayer) {
        state.money += KILL_REWARD;
        state.kills += 1;
        hud.setMoney(state.money);
        audio.kill();
      } else if (attacker.money !== undefined) {
        attacker.money += KILL_REWARD; // a bot's kill pays its own purse
      }
      checkRoundEnd();
    }
  }

  function checkRoundEnd() {
    if (state.phase !== 'round') return;
    const v = aliveCount('vanguard');
    const e = aliveCount('ember');
    if (e === 0) endRound('vanguard', 'Ember eliminated');
    else if (v === 0 && !state.bomb.planted) endRound('ember', 'Vanguard eliminated');
  }

  function endRound(winner, reason) {
    if (state.phase !== 'round') return;
    state.phase = 'roundEnd';
    state.timer = 4;
    state.wins[winner] += 1;
    state.roundWinners.push(winner);
    state.roundReasons.push(reason);
    const playerWon = winner === 'vanguard';
    state.money += playerWon ? WIN_REWARD : LOSS_REWARD;
    for (const h of botHandles) h.bot.money += h.bot.team === winner ? WIN_REWARD : LOSS_REWARD;
    hud.setMoney(state.money);
    hud.setScore(state.wins.vanguard, state.wins.ember);
    hud.banner(`Round ${state.round} — ${playerWon ? 'Vanguard' : 'Ember'} wins`, reason);
    if (playerWon) audio.roundWin();
    else audio.roundLose();
  }

  function endMatch() {
    state.phase = 'matchEnd';
    const win = state.wins.vanguard > state.wins.ember;
    hud.showOverlay('end', { win, v: state.wins.vanguard, e: state.wins.ember });
    if (state.auto) {
      // headless balance runs read this from the page
      window.__autoResult = {
        wins: { ...state.wins },
        rounds: state.roundWinners.slice(),
        reasons: state.roundReasons.slice(),
        kills: state.kills,
        deaths: state.deaths,
        money: state.money,
        killsBy: { ...debug.killsBy },
      };
    }
  }

  function resetFighters() {
    state.deadShown = false;
    player.reset(SPAWNS.vanguard[0]);
    SPAWNS.vanguard.slice(1).forEach((spawn, i) => botHandles[i].reset(spawn));
    SPAWNS.ember.forEach((spawn, i) => botHandles[4 + i].reset(spawn));
    arsenal.refill();
  }

  function startBuyPhase(round) {
    state.round = round;
    state.phase = 'buy';
    state.timer = BUY_SECONDS;
    state.bomb.holder = 'player';
    state.bomb.planted = false;
    state.bomb.fuse = BOMB_FUSE;
    state.bomb.channel = 0;
    state.bomb.dropPos = null;
    state.lastBeepSecond = -1;
    state.autoBought = false;
    state.autoNades = {};
    auto.path = [];
    resetFighters();
    for (const h of botHandles) buyBot(h.bot); // the bots shop with their own money
    hud.setScore(state.wins.vanguard, state.wins.ember);
    hud.setMoney(state.money);
    hud.setObjective('Buy phase — press B to shop');
    hud.setBomb('Charge with you');
    hud.setPlant(null);
    hud.openBuy(state.money, owned);
    hud.banner(`Round ${round}`, 'Buy phase — spend your money, then fight');
  }

  function startRound() {
    state.phase = 'round';
    state.timer = ROUND_SECONDS;
    hud.closeBuy();
    hud.setObjective('Plant the charge at the Pump House (hold E at the site)');
    hud.banner(`Round ${state.round}`, 'Plant the charge — or eliminate Ember');
  }

  function startMatch() {
    state.wins = { vanguard: 0, ember: 0 };
    state.money = 800;
    state.kills = 0;
    state.deaths = 0;
    state.roundWinners = [];
    state.roundReasons = [];
    state.autoBought = false;
    state.autoNades = {};
    for (const h of botHandles) {
      h.bot.money = 800;
      h.bot.weapon = 'pistol';
      h.bot.weaponDamage = WEAPONS.pistol.damage;
    }
    owned.weapons = new Set(['pistol']);
    owned.grenades = {};
    owned.armour = 0;
    arsenal.equip('pistol');
    hud.setMoney(state.money);
    startBuyPhase(1);
  }

  function botShoot(bot, target, error, aimY) {
    debug.botShots += 1;
    tmpOrigin.set(bot.position.x, bot.position.y + 1.5, bot.position.z);
    tmpPoint.set(
      target.position.x + (Math.random() * 2 - 1) * error * 20,
      target.position.y + aimY + (Math.random() * 2 - 1) * error * 8,
      target.position.z + (Math.random() * 2 - 1) * error * 20,
    );
    tmpDir.copy(tmpPoint).sub(tmpOrigin).normalize();
    const dist = tmpOrigin.distanceTo(tmpPoint);
    const hit = shootRay(tmpOrigin, tmpDir, 60);
    muzzleWorld(tmpPoint.set(0, 0, 0)); // reuse: tracer start at the bot's gun
    tmpPoint.set(bot.position.x, bot.position.y + 1.25, bot.position.z);
    if (hit && hit.fighter) {
      effects.tracer(tmpPoint, hit.point);
      const falloff = Math.max(0.4, 1 - dist / 80);
      debug.botHits += 1;
      damage(hit.fighter, bot.weaponDamage * falloff, hit.part, bot);
    } else if (hit) {
      effects.tracer(tmpPoint, hit.point);
      effects.impact(hit.point);
    } else {
      effects.tracer(tmpPoint, tmpOrigin.clone().addScaledVector(tmpDir, 60));
    }
    audio.shot('rifle', dist);
    noise(bot.position, 30);
  }

  function playerShoot() {
    const def = arsenal.def();
    const pellets = arsenal.fire();
    if (pellets === 0) {
      audio.dryFire();
      return;
    }
    debug.playerShots += pellets;
    camera.getWorldDirection(tmpDir);
    const speed = player.groundSpeed();
    const spread = arsenal.spread(speed, speed > 0.5, player.state.aiming, player.state.crouching);
    for (let i = 0; i < pellets; i += 1) {
      // one reused direction per pellet: no allocation in the hot loop
      tmpPoint.copy(tmpDir);
      tmpPoint.x += (Math.random() * 2 - 1) * spread;
      tmpPoint.y += (Math.random() * 2 - 1) * spread;
      tmpPoint.z += (Math.random() * 2 - 1) * spread;
      tmpPoint.normalize();
      const hit = shootRay(camera.position, tmpPoint, def.range);
      const muzzle = muzzleWorld(muzzleVec);
      if (hit && hit.fighter) {
        effects.tracer(muzzle, hit.point);
        debug.playerHits += 1;
        damage(hit.fighter, def.damage, hit.part, playerFighter);
        hud.hitmarker(!hit.fighter.alive);
        audio.hit();
      } else if (hit) {
        effects.tracer(muzzle, hit.point);
        effects.impact(hit.point);
      } else {
        tmpOrigin.copy(camera.position).addScaledVector(tmpPoint, def.range);
        effects.tracer(muzzle, tmpOrigin);
      }
    }
    player.recoil(def.recoil + Math.random() * 0.004, (Math.random() * 2 - 1) * 0.004);
    audio.shot(def.id);
    noise(player.state.position, 30);
    hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, false);
  }

  function grenadeEvent(g) {
    const def = GRENADES[g.type];
    if (g.type === 'he') {
      effects.explosion(g.pos);
      audio.explosion();
      for (const f of fighters) {
        if (!f.alive) continue;
        const d = Math.hypot(f.position.x - g.pos.x, f.position.z - g.pos.z)
          + Math.abs(f.position.y - g.pos.y) * 0.5;
        if (d < def.radius) {
          damage(f, def.damage * (1 - d / def.radius) + 20, 'body', g.by ?? playerFighter);
        }
      }
      noise(g.pos, 25);
    } else if (g.type === 'smoke') {
      effects.smoke(g.pos, def.duration);
    } else if (g.type === 'flash') {
      // blind the player if they face it, blind bots that face it
      camera.getWorldDirection(tmpDir);
      tmpPoint.copy(g.pos).sub(camera.position);
      const dist = tmpPoint.length();
      tmpPoint.normalize();
      if (dist < def.radius && tmpDir.dot(tmpPoint) > 0.2 && lineOfSight(camera.position, g.pos)) {
        hud.flashWhite();
      }
      for (const h of botHandles) {
        const b = h.bot;
        if (!b.alive) continue;
        const d = Math.hypot(b.position.x - g.pos.x, b.position.z - g.pos.z);
        if (d < def.radius) {
          b.enemyVisible = false;
          b.enemy = null;
          b.reactLeft = 2;
        }
      }
      noise(g.pos, 20);
    }
  }

  function buy(kind, id) {
    if (state.phase !== 'buy') return;
    if (kind === 'weapon') {
      const def = WEAPONS[id];
      if (!def || owned.weapons.has(id)) return;
      if (state.money < def.price) return;
      state.money -= def.price;
      owned.weapons.add(id);
      arsenal.buyWeapon(id);
      audio.buy();
    } else if (kind === 'grenade') {
      const def = GRENADES[id];
      if (!def || (owned.grenades[id] ?? 0) >= 2) return;
      if (state.money < def.price) return;
      state.money -= def.price;
      owned.grenades[id] = (owned.grenades[id] ?? 0) + 1;
      arsenal.buyGrenade(id);
      audio.buy();
    } else if (kind === 'armour') {
      if (owned.armour >= 100 || state.money < ARMOUR_PRICE) return;
      state.money -= ARMOUR_PRICE;
      owned.armour = ARMOUR_VALUE;
      player.state.armour = ARMOUR_VALUE;
      audio.buy();
    }
    hud.setMoney(state.money);
    hud.setHealth(player.state.health, player.state.armour);
    hud.openBuy(state.money, owned);
  }

  const ctx = {
    fighters,
    lineOfSight,
    damage,
    bomb: state.bomb,
    get playerSpeed() {
      return player.groundSpeed();
    },
    botShoot,
    // A bot's throw: lobs the grenade toward `target` with a small arc so
    // the fuse lands it near the target, and spends the bot's grenade.
    throwGrenade(bot, type, target) {
      const origin = new THREE.Vector3(bot.position.x, bot.position.y + 1.4, bot.position.z);
      const dir = new THREE.Vector3(target.x - origin.x, 0, target.z - origin.z);
      const dist = dir.length() || 1;
      dir.normalize();
      dir.y = Math.min(0.55, 2.2 / Math.max(6, dist));
      dir.normalize();
      arsenal.throwAny(type, origin, dir, bot);
      bot.grenades[type] -= 1;
      bot.grenadeCooldown = 10;
      audio.click();
    },
    plantDone(bot) {
      state.bomb.planted = true;
      state.bomb.fuse = BOMB_FUSE;
      state.bomb.holder = null;
      hud.setBomb('Charge planted — defend it');
      hud.banner('Charge planted', 'Hold the site until it blows');
      audio.plantBeep();
      state.money += KILL_REWARD;
      hud.setMoney(state.money);
    },
    defuseDone() {
      state.bomb.planted = false;
      endRound('ember', 'Charge defused');
    },
  };

  // --- autoplay: a stand-in human, for headless balance tests only
  // (?autoplay=1). It buys the best loadout it can afford, pushes the site
  // along the waypoint graph, plants when it gets there, and shoots the
  // nearest visible enemy with a strafing aim — good enough to measure
  // whether Vanguard or Ember wins the economy, not a showcase of skill.
  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function turnToward(cur, want, maxStep) {
    const d = angleDiff(want, cur);
    if (Math.abs(d) <= maxStep) return want;
    return cur + Math.sign(d) * maxStep;
  }

  const auto = { strafeDir: 1, strafeTimer: 0, path: [] };

  function autoDrive(dt, input) {
    const keys = input.state.keys;
    keys.clear();
    input.state.firing = false;
    debug.auto.keys = [];
    debug.auto.target = null;
    debug.auto.path = auto.path.slice();
    if (!player.state.alive) return;
    // nearest visible enemy, inside the same 26 m a bot will fight at:
    // further out the autopilot pushes the site instead of sniping
    let target = null;
    let td = Infinity;
    for (const f of fighters) {
      if (!f.alive || f.team === 'vanguard') continue;
      const d = Math.hypot(f.position.x - player.state.position.x, f.position.z - player.state.position.z);
      if (d < td && d < 26 && lineOfSight(player.state.position, f.position)) { target = f; td = d; }
    }
    if (target) {
      debug.auto.target = target.name;
      const dx = target.position.x - player.state.position.x;
      const dz = target.position.z - player.state.position.z;
      const wantYaw = Math.atan2(-dx, -dz);
      player.state.yaw = turnToward(player.state.yaw, wantYaw, dt * 6);
      const dy = (target.position.y + 1.35) - (player.state.position.y + player.state.eye);
      const wantPitch = Math.asin(Math.max(-1, Math.min(1, dy / Math.max(1, td))));
      player.state.pitch = turnToward(player.state.pitch, wantPitch, dt * 6);
      if (td > 10 && td < 25 && !state.autoNades.flash && (owned.grenades.flash ?? 0) > 0) {
        arsenal.selectGrenade('flash');
        camera.getWorldDirection(tmpDir);
        if (arsenal.throwGrenade(camera.position, tmpDir)) state.autoNades.flash = true;
      }
      if (Math.abs(angleDiff(wantYaw, player.state.yaw)) < 0.06) {
        if (arsenal.state.mag === 0) arsenal.reload();
        else input.state.firing = true;
      }
      auto.strafeTimer -= dt;
      if (auto.strafeTimer <= 0) { auto.strafeDir = -auto.strafeDir; auto.strafeTimer = 0.7 + Math.random() * 0.5; }
      if (td > 20) keys.add('KeyW');
      keys.add(auto.strafeDir > 0 ? 'KeyD' : 'KeyA');
      debug.auto.keys = [...keys];
      return;
    }
    // no enemy: push the site along the waypoint graph, plant on arrival
    if (auto.path.length === 0) auto.path = findPath(player.state.position, 6);
    if (auto.path.length === 0) {
      // already standing on the site node: hold here, plant if carrying
      if (!state.bomb.planted && state.bomb.holder === 'player') {
        const dSite = Math.hypot(player.state.position.x - SITE.x, player.state.position.z - SITE.z);
        if (dSite < SITE.radius) keys.add('KeyE');
      }
      debug.auto.keys = [...keys];
      return;
    }
    const [nx, nz] = WAYPOINTS.nodes[auto.path[0]];
    const dx = nx - player.state.position.x;
    const dz = nz - player.state.position.z;
    if (Math.hypot(dx, dz) < 0.6) {
      auto.path.shift();
      return;
    }
    const wantYaw = Math.atan2(-dx, -dz);
    player.state.yaw = turnToward(player.state.yaw, wantYaw, dt * 6);
    if (Math.abs(angleDiff(wantYaw, player.state.yaw)) < 0.5) keys.add('KeyW');
    if (!state.bomb.planted && state.bomb.holder === 'player') {
      const dSite = Math.hypot(player.state.position.x - SITE.x, player.state.position.z - SITE.z);
      if (dSite < SITE.radius) keys.add('KeyE');
    }
    debug.auto.keys = [...keys];
  }

  function autoBuy() {
    const loadout = chooseLoadout(state.money, arsenal.state.weapon);
    if (!owned.weapons.has(loadout.weapon)) buy('weapon', loadout.weapon);
    if (loadout.armour) buy('armour', 'armour');
    for (const [type, count] of Object.entries(loadout.grenades)) {
      for (let i = 0; i < count; i += 1) buy('grenade', type);
    }
    arsenal.equip(loadout.weapon);
  }

  function step(dt, input) {
    // hitbox meshes track the player every step
    playerHead.position.set(player.state.position.x, player.state.position.y + 1.55, player.state.position.z);
    playerBody.position.set(player.state.position.x, player.state.position.y + 0.95, player.state.position.z);

    if (state.phase === 'menu' || state.phase === 'matchEnd') return;
    world.update(dt);
    effects.step(dt);
    arsenal.step(dt);

    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.auto && !state.autoBought) {
        state.autoBought = true;
        autoBuy();
      }
      if (input.state.pressed.has('KeyB')) {
        if (hud.isBuyOpen()) hud.closeBuy();
        else hud.openBuy(state.money, owned);
      }
      if (input.state.pressed.has('Digit1')) buy('weapon', 'pistol');
      if (input.state.pressed.has('Digit2')) buy('weapon', 'rifle');
      if (input.state.pressed.has('Digit3')) buy('weapon', 'smg');
      if (input.state.pressed.has('Digit4')) buy('weapon', 'shotgun');
      if (input.state.pressed.has('Digit5')) buy('weapon', 'sniper');
      if (input.state.pressed.has('Digit6')) buy('grenade', 'he');
      if (input.state.pressed.has('Digit7')) buy('grenade', 'smoke');
      if (input.state.pressed.has('Digit8')) buy('grenade', 'flash');
      if (input.state.pressed.has('Digit9')) buy('armour', 'armour');
      hud.setTimer(state.timer, state.timer < 5);
      if (state.timer <= 0) startRound();
      return;
    }

    if (state.phase === 'roundEnd') {
      state.timer -= dt;
      hud.setTimer(0, false);
      if (state.timer <= 0) {
        if (state.wins.vanguard >= WIN_ROUNDS || state.wins.ember >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
          endMatch();
        } else {
          startBuyPhase(state.round + 1);
        }
      }
      return;
    }

    // --- round
    state.timer -= dt;
    if (state.bomb.planted) {
      state.bomb.fuse -= dt;
      const second = Math.ceil(state.bomb.fuse);
      if (second !== state.lastBeepSecond && second <= 10) {
        state.lastBeepSecond = second;
        audio.bombBeep();
      }
      hud.setTimer(state.bomb.fuse, true);
      hud.setBomb(`Charge blows in ${Math.max(0, Math.ceil(state.bomb.fuse))}s`);
      if (state.bomb.fuse <= 0) {
        effects.explosion(new THREE.Vector3(SITE.x, 1, SITE.z));
        audio.explosion();
        for (const f of fighters) {
          if (!f.alive) continue;
          const d = Math.hypot(f.position.x - SITE.x, f.position.z - SITE.z);
          if (d < 14) damage(f, 220 * (1 - d / 14) + 30, 'body', playerFighter);
        }
        endRound('vanguard', 'Charge detonated');
        return;
      }
    } else {
      hud.setTimer(state.timer, state.timer < 15);
      if (state.timer <= 0) {
        endRound('ember', 'Time expired — the charge never went off');
        return;
      }
    }

    // player movement (frozen while the buy menu is up is handled by phase)
    if (state.auto) autoDrive(dt, input);
    if (player.state.alive) {
      player.step(dt, input.state.keys, input.state.aiming);
      const def = arsenal.def();
      const firing = input.state.firing;
      const rising = firing && !state.prevFiring;
      state.prevFiring = firing;
      if (arsenal.state.selectedGrenade) {
        if (rising) {
          camera.getWorldDirection(tmpDir);
          const type = arsenal.throwGrenade(camera.position, tmpDir);
          if (type) audio.click();
        }
      } else {
        if (firing && arsenal.ready() && (def.auto || rising)) playerShoot();
        if (input.state.pressed.has('KeyR')) {
          arsenal.reload();
          audio.reload();
        }
      }
      if (input.state.pressed.has('Digit1') && owned.weapons.has('pistol')) arsenal.equip('pistol');
      if (input.state.pressed.has('Digit2') && owned.weapons.has('rifle')) arsenal.equip('rifle');
      if (input.state.pressed.has('Digit3') && owned.weapons.has('smg')) arsenal.equip('smg');
      if (input.state.pressed.has('Digit4') && owned.weapons.has('shotgun')) arsenal.equip('shotgun');
      if (input.state.pressed.has('Digit5') && owned.weapons.has('sniper')) arsenal.equip('sniper');
      if (input.state.pressed.has('Digit6')) arsenal.selectGrenade('he');
      if (input.state.pressed.has('Digit7')) arsenal.selectGrenade('smoke');
      if (input.state.pressed.has('Digit8')) arsenal.selectGrenade('flash');

      // planting: hold E inside the site ring
      if (!state.bomb.planted && state.bomb.holder === 'player') {
        const d = Math.hypot(player.state.position.x - SITE.x, player.state.position.z - SITE.z);
        if (d < SITE.radius && input.state.keys.has('KeyE')) {
          state.bomb.channel += dt / PLANT_SECONDS;
          hud.setPlant(state.bomb.channel);
          if (state.bomb.channel >= 1) {
            state.bomb.planted = true;
            state.bomb.fuse = BOMB_FUSE;
            state.bomb.holder = null;
            hud.setPlant(null);
            hud.setBomb('Charge planted — defend it');
            hud.banner('Charge planted', 'Hold the site until it blows');
            audio.plantBeep();
            state.money += KILL_REWARD;
            hud.setMoney(state.money);
          }
        } else {
          state.bomb.channel = Math.max(0, state.bomb.channel - dt / PLANT_SECONDS);
          hud.setPlant(state.bomb.channel > 0 ? state.bomb.channel : null);
        }
      }

      hud.setHealth(player.state.health, player.state.armour);
      hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, arsenal.state.reloadLeft > 0);
      hud.setSpread(arsenal.spread(player.groundSpeed(), player.groundSpeed() > 0.5, player.state.aiming, player.state.crouching) * 900);
    } else if (state.bomb.holder === 'player' && !state.bomb.planted) {
      dropBombAt(player.state.position);
    }

    // the dropped charge: the nearest alive Vanguard bot picks it up
    if (!state.bomb.planted && state.bomb.holder === null && state.bomb.dropPos) {
      for (const h of botHandles) {
        const b = h.bot;
        if (!b.alive || b.team !== 'vanguard') continue;
        const d = Math.hypot(b.position.x - state.bomb.dropPos.x, b.position.z - state.bomb.dropPos.z);
        if (d < 1.6) {
          state.bomb.holder = b;
          state.bomb.dropPos = null;
          b.channel = 0;
          hud.setBomb(`${b.name} carries the charge`);
          break;
        }
      }
    }
    // carrier routing needs the bomb object to name the bot
    ctx.bomb.carrier = state.bomb.holder !== 'player' ? state.bomb.holder : null;

    arsenal.stepGrenades(dt, world.colliders, grenadeEvent);

    for (const h of botHandles) stepBot(h, dt, ctx);

    hud.setAlive(aliveCount('vanguard'), aliveCount('ember'));
    if (!player.state.alive && state.phase === 'round' && !state.deadShown) {
      state.deadShown = true;
      hud.showOverlay('dead');
    }
  }

  // Deterministic scene setups for screenshots (?shot=...). Places the
  // fighters, sets the phase and the HUD, then main.js settles a few steps
  // and freezes the frame.
  function setupShot(name) {
    if (name === 'buy') {
      state.money = 3200;
      state.wins = { vanguard: 1, ember: 0 };
      startBuyPhase(2);
      state.timer = 12;
      hud.setScore(1, 0);
      return;
    }
    if (name === 'site') {
      startBuyPhase(3);
      state.wins = { vanguard: 2, ember: 1 };
      startRound();
      state.timer = 62;
      state.bomb.planted = true;
      state.bomb.fuse = 18;
      state.bomb.holder = null;
      state.money = 2400;
      player.state.position.set(2, 0, -14);
      player.state.yaw = Math.atan2(-(SITE.x + 1.5 - 2), -(SITE.z + 1 + 14));
      player.state.pitch = -0.05;
      const defuser = botHandles[5];
      defuser.bot.position.set(SITE.x + 1.5, 0, SITE.z + 1);
      defuser.bot.state = 'defuse';
      defuser.bot.channel = 0.45;
      const guard = botHandles[6];
      guard.bot.position.set(-12, 0, -6);
      // the guard smokes the east approach as the defuser works the pump
      guard.bot.grenades.smoke = 1;
      ctx.throwGrenade(guard.bot, 'smoke', { x: -10, y: 0, z: -12 });
      // the smoke itself is staged outright: the thrown grenade's fuse is
      // 1.2 s, longer than the frame's settle, so a real throw would show
      // no smoke yet. The guard's throw is still live (it pops behind
      // the frame) and the cloud is the same effects.smoke it would make.
      effects.smoke(new THREE.Vector3(-10, 1, -12), 14);
      // the other defenders hold their posts, facing the site — and the
      // player wears Kevlar for the shot, because a staged frame is no
      // excuse for the bots to stop shooting during the settle
      const holds = [[4, -14, -15], [7, 12, -12], [8, -6, -11]];
      for (const [i, x, z] of holds) {
        const h = botHandles[i];
        h.bot.position.set(x, 0, z);
        h.bot.yaw = Math.atan2(-(SITE.x - x), -(SITE.z - z));
      }
      player.state.armour = 100;
      hud.setScore(2, 1);
      hud.setMoney(2400);
      hud.setBomb('Charge blows in 18s');
      hud.setObjective('Defend the planted charge');
      return;
    }
    if (name === 'win') {
      startBuyPhase(4);
      hud.closeBuy();
      state.wins = { vanguard: 3, ember: 1 };
      state.phase = 'roundEnd';
      state.timer = 3;
      state.money = 2400;
      hud.setScore(3, 1);
      hud.setMoney(2400);
      hud.banner('Round 4 — Vanguard wins', 'Charge detonated');
      player.state.position.set(-2, 0, 8);
      player.state.yaw = 0.67;
      return;
    }
    // cover: mid-round firefight on the mid lane
    startBuyPhase(3);
    state.wins = { vanguard: 2, ember: 1 };
    startRound();
    state.timer = 78;
    state.money = 2400;
    arsenal.equip('rifle');
    player.state.position.set(0, 0, 12);
    player.state.yaw = 0.35;
    player.state.pitch = 0.02;
    const e1 = botHandles[5];
    e1.bot.position.set(-4, 0, 3);
    e1.bot.yaw = Math.PI;
    const e2 = botHandles[7];
    e2.bot.position.set(6.5, 0, 0);
    e2.bot.yaw = Math.PI;
    const ally = botHandles[0];
    ally.bot.position.set(-6, 0, 9);
    ally.bot.yaw = 0;
    hud.setScore(2, 1);
    hud.setMoney(2400);
    hud.setObjective('Plant the charge at the Pump House (hold E at the site)');
  }

  // Debug helper for screenshot captures: aim at the nearest Ember bot and
  // fire one round, so the frame shows a tracer and muzzle flash. Only used
  // from ?shot= mode; never in live play.
  function debugFire() {
    // A bot standing at the pump is the story of the site shot; otherwise
    // the nearest Ember bot. (A bot's state is the AI's to change, so aim by
    // position, not by state.)
    let best = null;
    let bestD = Infinity;
    for (const handle of botHandles) {
      const bot = handle.bot;
      if (!bot.alive || bot.team !== 'ember') continue;
      const dSite = Math.hypot(bot.position.x - SITE.x, bot.position.z - SITE.z);
      if (dSite < 3) { best = bot; break; }
      const d = Math.hypot(
        bot.position.x - player.state.position.x,
        bot.position.z - player.state.position.z,
      );
      if (d < bestD) { bestD = d; best = bot; }
    }
    if (!best) return;
    const dx = best.position.x - player.state.position.x;
    const dy = (best.position.y + 1.3) - (player.state.position.y + player.state.eye);
    const dz = best.position.z - player.state.position.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    player.state.yaw = Math.atan2(-dx, -dz);
    player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
    camera.position.set(
      player.state.position.x,
      player.state.position.y + player.state.eye,
      player.state.position.z,
    );
    camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
    playerShoot();
  }

  // Autoplay entry: the player is driven by autoDrive from here on.
  function enableAutoplay() {
    state.auto = true;
    startMatch();
  }

  return {
    state,
    owned,
    debug,
    step,
    buy,
    startMatch,
    setupShot,
    debugFire,
    enableAutoplay,
    fighters,
    playerFighter,
  };
}
