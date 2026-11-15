// Weapons: five guns, three grenades, one vest.
//
// Every gun is data in WEAPONS; the code below only reads the table, so
// balancing a gun is editing one line, never a branch. Spread is the
// accuracy tax: still and crouched is a laser, sprinting or spraying is a
// garden hose, and aiming down sights buys back half of it. Grenades are
// thrown entities with a fuse; their effects are events the sim consumes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 26, headMult: 2,
    fireGap: 0.16, auto: false, mag: 12, reserve: 36, reload: 1.4,
    spreadStill: 0.003, spreadMove: 0.02, recoil: 0.008, range: 60,
    kick: 0.03, barrel: 0.22, length: 0.3, scope: false,
  },
  rifle: {
    id: 'rifle', name: 'VK-47', price: 2700, damage: 34, headMult: 2,
    fireGap: 0.096, auto: true, mag: 30, reserve: 90, reload: 1.9,
    spreadStill: 0.0022, spreadMove: 0.028, recoil: 0.011, range: 80,
    kick: 0.05, barrel: 0.42, length: 0.55, scope: false,
  },
  smg: {
    id: 'smg', name: 'Hornet-9', price: 1500, damage: 22, headMult: 2,
    fireGap: 0.07, auto: true, mag: 32, reserve: 96, reload: 1.6,
    spreadStill: 0.004, spreadMove: 0.034, recoil: 0.007, range: 45,
    kick: 0.035, barrel: 0.3, length: 0.42, scope: false,
  },
  shotgun: {
    id: 'shotgun', name: 'Breacher-12', price: 1100, damage: 14, headMult: 2,
    pellets: 8, fireGap: 0.8, auto: false, mag: 7, reserve: 21, reload: 2.4,
    spreadStill: 0.02, spreadMove: 0.05, recoil: 0.035, range: 22,
    kick: 0.12, barrel: 0.5, length: 0.6, scope: false,
  },
  sniper: {
    id: 'sniper', name: 'Longshot .50', price: 4750, damage: 100, headMult: 2,
    fireGap: 1.2, auto: false, mag: 5, reserve: 15, reload: 2.8,
    spreadStill: 0.0004, spreadMove: 0.05, recoil: 0.06, range: 120,
    kick: 0.16, barrel: 0.72, length: 0.85, scope: true, zoom: 2.6,
  },
};

export const GRENADES = {
  he: { id: 'he', name: 'Frag Grenade', price: 300, fuse: 1.4, radius: 7, damage: 110 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300, fuse: 1.2, radius: 5, duration: 14 },
  flash: { id: 'flash', name: 'Flashbang', price: 200, fuse: 1.1, radius: 14 },
};

export const ARMOUR_PRICE = 650;
export const ARMOUR_VALUE = 100;

// Bot loadout: what a bot buys with its money in the buy phase. Rifle
// first, then SMG, then shotgun; Kevlar and grenades with what's left.
// Guns are owned for the match, like the player's: `owned` is the gun the
// bot already has, and it only pays for an upgrade over it.
// The sniper is player-only: a bot that one-taps would wreck the balance.
export function chooseLoadout(money, owned = 'pistol') {
  const tiers = { pistol: 0, shotgun: 1, smg: 2, rifle: 3 };
  const out = { weapon: owned, armour: false, grenades: {} };
  let left = money;
  const best = left >= WEAPONS.rifle.price + 300 ? 'rifle'
    : left >= WEAPONS.smg.price + 300 ? 'smg'
    : left >= WEAPONS.shotgun.price + 300 ? 'shotgun' : 'pistol';
  if (tiers[best] > tiers[owned]) { out.weapon = best; left -= WEAPONS[best].price; }
  if (left >= ARMOUR_PRICE + 300) { out.armour = true; left -= ARMOUR_PRICE; }
  if (left >= GRENADES.flash.price + 300) { out.grenades.flash = 1; left -= GRENADES.flash.price; }
  if (left >= GRENADES.smoke.price + 300) { out.grenades.smoke = 1; left -= GRENADES.smoke.price; }
  if (left >= GRENADES.he.price) { out.grenades.he = 1; left -= GRENADES.he.price; }
  out.spent = money - left;
  return out;
}

const MUZZLE_TIME = 0.06;

function buildViewModel(def) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.55, metalness: 0.45 });
  const darker = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x23262b), roughness: 0.7, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), roughness: 0.5, metalness: 0.3 });
  const group = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, def.length), dark);
  group.add(receiver);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, def.barrel), darker);
  barrel.position.set(0, 0.02, -def.length / 2 - def.barrel / 2 + 0.05);
  group.add(barrel);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.012, def.length * 0.5), accent);
  stripe.position.set(0, 0.045, 0);
  group.add(stripe);
  if (def.scope) {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.15, 10), darker);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.075, -0.05);
    group.add(scope);
  }
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.11, 0.07), darker);
  grip.position.set(0, -0.085, 0.12);
  grip.rotation.x = 0.25;
  group.add(grip);
  group.scale.setScalar(0.8);
  group.position.set(0.26, -0.23, -0.45);
  return group;
}

export function createArsenal(camera, scene) {
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.hazard), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.16, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.hazard), 0, 6);
  flashLight.position.set(0.24, -0.14, -0.6);
  camera.add(flashLight);

  const models = {};
  for (const def of Object.values(WEAPONS)) {
    models[def.id] = buildViewModel(def);
    models[def.id].visible = false;
    camera.add(models[def.id]);
  }
  // a grenade in hand: a small dark sphere with a pin ring
  const grenadeModel = new THREE.Group();
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 12, 10),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2f4a2a), roughness: 0.5, metalness: 0.4 }),
  );
  grenadeModel.add(ball);
  grenadeModel.position.set(0.24, -0.2, -0.42);
  grenadeModel.visible = false;
  camera.add(grenadeModel);

  const state = {
    weapon: 'rifle',
    mag: WEAPONS.rifle.mag,
    reserve: WEAPONS.rifle.reserve,
    cooldown: 0,
    reloadLeft: 0,
    switchLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
    grenades: { he: 0, smoke: 0, flash: 0 },
    selectedGrenade: null, // 'he' | 'smoke' | 'flash' when a grenade is in hand
  };
  let thrown = []; // live grenade entities: { type, pos, vel, fuse, by, mesh }

  // A thrown grenade is a visible body, not just a fuse: one small sphere
  // per live grenade, reused from a pool of six.
  const grenadeGeo = new THREE.SphereGeometry(0.07, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2f4a2a), roughness: 0.5, metalness: 0.4 });
  const grenadeMeshes = [];
  for (let i = 0; i < 6; i += 1) {
    const m = new THREE.Mesh(grenadeGeo, grenadeMat);
    m.visible = false;
    scene.add(m);
    grenadeMeshes.push(m);
  }

  function showModel() {
    for (const [id, model] of Object.entries(models)) model.visible = id === state.weapon && !state.selectedGrenade;
    grenadeModel.visible = state.selectedGrenade !== null;
  }
  showModel();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.switchLeft = Math.max(0, state.switchLeft - dt);
    state.bloom = Math.max(0, state.bloom - dt * 2.2);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.weapon];
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = WEAPONS[state.weapon];
      model.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  // Grenades fly as small ballistic bodies and report their effects back.
  function stepGrenades(dt, colliders, onEvent) {
    const gravity = 12;
    for (const g of thrown) {
      g.fuse -= dt;
      g.vel.y -= gravity * dt;
      g.pos.addScaledVector(g.vel, dt);
      for (const c of colliders) {
        if (g.pos.x > c.min.x - 0.1 && g.pos.x < c.max.x + 0.1
          && g.pos.y > c.min.y - 0.1 && g.pos.y < c.max.y + 0.1
          && g.pos.z > c.min.z - 0.1 && g.pos.z < c.max.z + 0.1) {
          g.vel.multiplyScalar(-0.35);
          g.pos.addScaledVector(g.vel, dt);
        }
      }
      if (g.pos.y < 0.1) {
        g.pos.y = 0.1;
        g.vel.y = Math.abs(g.vel.y) * 0.35;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      if (g.mesh) g.mesh.position.copy(g.pos);
      if (g.fuse <= 0) {
        if (g.mesh) { g.mesh.visible = false; g.mesh = null; }
        onEvent(g);
      }
    }
    thrown = thrown.filter((g) => g.fuse > 0);
  }

  return {
    state,
    step,
    stepGrenades,
    def() {
      return WEAPONS[state.weapon];
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0 && state.switchLeft === 0;
    },
    spread(speed, moving, aiming, crouching) {
      const def = WEAPONS[state.weapon];
      let s = def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove;
      if (moving) s *= 1.25;
      if (aiming) s *= 0.45;
      if (crouching) s *= 0.8;
      return s * (1 + state.bloom);
    },
    fire() {
      if (state.mag <= 0) return 0;
      state.mag -= 1;
      state.cooldown = WEAPONS[state.weapon].fireGap;
      state.flash = MUZZLE_TIME;
      state.kick = WEAPONS[state.weapon].kick;
      state.bloom = Math.min(1, state.bloom + 0.3);
      return WEAPONS[state.weapon].pellets ?? 1;
    },
    reload() {
      const def = WEAPONS[state.weapon];
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return;
      state.reloadLeft = def.reload;
    },
    equip(id) {
      if (!WEAPONS[id] || id === state.weapon) return;
      state.weapon = id;
      state.selectedGrenade = null;
      const def = WEAPONS[id];
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.reloadLeft = 0;
      state.switchLeft = 0.35;
      showModel();
    },
    // Buying keeps the magazine the round started with; the sim owns money.
    buyWeapon(id) {
      this.equip(id);
    },
    selectGrenade(type) {
      if ((state.grenades[type] ?? 0) <= 0) return false;
      state.selectedGrenade = type;
      showModel();
      return true;
    },
    buyGrenade(type) {
      state.grenades[type] = (state.grenades[type] ?? 0) + 1;
    },
    throwGrenade(origin, direction) {
      const type = state.selectedGrenade;
      if (!type || (state.grenades[type] ?? 0) <= 0) return null;
      state.grenades[type] -= 1;
      this.throwAny(type, origin, direction, null);
      if (state.grenades[type] === 0) {
        state.selectedGrenade = null;
        showModel();
      }
      return type;
    },
    // A throw that is not the player's: bots throw through this, with the
    // thrower attached so the killfeed can name them.
    throwAny(type, origin, direction, by) {
      const g = {
        type,
        pos: origin.clone(),
        vel: direction.clone().multiplyScalar(13).add(new THREE.Vector3(0, 3.5, 0)),
        fuse: GRENADES[type].fuse,
        by: by ?? null,
        mesh: null,
      };
      const free = grenadeMeshes.find((m) => !m.visible);
      if (free) { g.mesh = free; free.visible = true; free.position.copy(g.pos); }
      thrown.push(g);
      return type;
    },
    refill() {
      const def = WEAPONS[state.weapon];
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
      thrown = [];
      for (const m of grenadeMeshes) m.visible = false;
    },
  };
}
