// HUD: every DOM write the game makes lives here, behind one cache, so
// the sim can call setHealth sixty times a second and the browser only
// repaints when a value actually changed. The buy menu is built from the
// weapon and grenade tables, never hard-coded.
import { WEAPONS, GRENADES, ARMOUR_PRICE } from './weapons.js';

export function createHud() {
  const el = (id) => document.getElementById(id);
  const cache = new Map();
  function text(id, value) {
    if (cache.get(id) !== value) {
      cache.set(id, value);
      el(id).textContent = value;
    }
  }
  function style(id, prop, value) {
    const key = `${id}.${prop}`;
    if (cache.get(key) !== value) {
      cache.set(key, value);
      el(id).style[prop] = value;
    }
  }

  let onBuy = () => {};
  let hitTimer = null;
  let bannerTimer = null;

  const crosshair = el('crosshair');

  function setHealth(hp, armour) {
    text('health-num', String(Math.ceil(hp)));
    style('health-fill', 'width', `${Math.max(0, hp)}%`);
    text('armour-num', String(Math.ceil(armour)));
    el('health').classList.toggle('low', hp <= 30);
  }

  function setAmmo(mag, reserve, reloading) {
    text('ammo-mag', String(mag));
    text('ammo-reserve', `/ ${reserve}`);
    el('ammo').classList.toggle('empty', mag === 0);
    el('ammo').classList.toggle('reloading', reloading);
  }

  function setMoney(n) {
    text('money', `$${n}`);
  }

  function setTimer(seconds, danger) {
    const s = Math.max(0, Math.ceil(seconds));
    text('timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    el('timer').classList.toggle('danger', danger);
  }

  function setScore(vanguard, ember) {
    text('score-v', String(vanguard));
    text('score-e', String(ember));
  }

  function setAlive(vanguard, ember) {
    text('alive', `Vanguard ${vanguard}  ·  Ember ${ember}`);
  }

  function setObjective(value) {
    text('objective-text', value);
  }

  function setBomb(value) {
    text('bomb-status', value);
  }

  function setPlant(frac) {
    const bar = el('plant-progress');
    if (frac === null) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    style('plant-fill', 'width', `${Math.round(frac * 100)}%`);
  }

  function killfeed(killer, victim, weapon, headshot) {
    const feed = el('killfeed');
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML = '';
    const k = document.createElement('b');
    k.textContent = killer;
    const w = document.createElement('span');
    w.textContent = ` ${headshot ? '◉ ' : ''}[${weapon}] `;
    const v = document.createElement('b');
    v.textContent = victim;
    row.append(k, w, v);
    feed.prepend(row);
    while (feed.children.length > 5) feed.lastChild.remove();
    window.setTimeout(() => row.remove(), 6000);
  }

  function hitmarker(kill) {
    const m = el('hitmarker');
    m.classList.toggle('kill', kill);
    m.classList.add('on');
    if (hitTimer) window.clearTimeout(hitTimer);
    hitTimer = window.setTimeout(() => m.classList.remove('on'), 110);
  }

  function damageFlash() {
    const d = el('damage');
    d.classList.remove('show');
    void d.offsetWidth; // restart the animation
    d.classList.add('show');
  }

  function flashWhite() {
    const f = el('flash-overlay');
    f.classList.remove('show');
    void f.offsetWidth;
    f.classList.add('show');
  }

  function setSpread(px) {
    const gap = Math.round(3 + px);
    crosshair.style.setProperty('--gap', `${gap}px`);
  }

  function banner(title, sub) {
    text('banner-title', title);
    text('banner-sub', sub ?? '');
    const b = el('banner');
    b.classList.add('show');
    if (bannerTimer) window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => b.classList.remove('show'), 3200);
  }

  // Hide the banner at once (screenshot captures: the game, not the notice).
  function hideBanner() {
    if (bannerTimer) window.clearTimeout(bannerTimer);
    el('banner').classList.remove('show');
  }

  function showOverlay(kind, data = {}) {
    const overlay = el('overlay');
    const title = el('overlay-title');
    const copy = el('overlay-copy');
    const play = el('play');
    overlay.hidden = false;
    if (kind === 'start') {
      title.textContent = 'SANDLINE';
      copy.textContent = 'Dustline Yard — plant the charge at the Pump House, or stop Ember from defusing it. First to 5 rounds takes the yard.';
      play.textContent = 'Click to play';
    } else if (kind === 'paused') {
      title.textContent = 'Paused';
      copy.textContent = 'Click to return to the yard.';
      play.textContent = 'Resume';
    } else if (kind === 'dead') {
      title.textContent = 'You are down';
      copy.textContent = 'Your squad fights on. The round ends when one team is gone or the charge blows.';
      play.textContent = 'Spectate';
    } else if (kind === 'end') {
      title.textContent = data.win ? 'Vanguard takes the yard' : 'Ember holds the yard';
      copy.textContent = `Final score — Vanguard ${data.v} · Ember ${data.e}. ${data.win ? 'The Pump House is yours.' : 'The charge never went off.'}`;
      play.textContent = 'Play again';
    }
    el('overlay').dataset.kind = kind;
  }

  function hideOverlay() {
    el('overlay').hidden = true;
  }

  function openBuy(money, owned) {
    document.body.classList.add('shopping');
    const menu = el('buy-menu');
    menu.hidden = false;
    const items = el('buy-items');
    items.innerHTML = '';
    const rows = [];
    for (const def of Object.values(WEAPONS)) {
      rows.push({
        id: def.id, kind: 'weapon', name: def.name, price: def.price,
        desc: `${def.damage} dmg · ${def.mag}/${def.reserve} · ${def.auto ? 'auto' : 'semi'}`,
        owned: owned.weapons.has(def.id),
      });
    }
    for (const def of Object.values(GRENADES)) {
      rows.push({
        id: def.id, kind: 'grenade', name: def.name, price: def.price,
        desc: `carried: ${owned.grenades[def.id] ?? 0} (max 2)`,
        owned: (owned.grenades[def.id] ?? 0) >= 2,
      });
    }
    rows.push({
      id: 'armour', kind: 'armour', name: 'Kevlar Vest', price: ARMOUR_PRICE,
      desc: 'absorbs half of every hit (100 armour)',
      owned: owned.armour >= 100,
    });
    rows.forEach((row, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buy-row';
      button.disabled = row.owned || row.price > money;
      button.innerHTML = '';
      const key = document.createElement('kbd');
      key.textContent = String(i + 1);
      const name = document.createElement('span');
      name.className = 'buy-name';
      name.textContent = row.name;
      const desc = document.createElement('span');
      desc.className = 'buy-desc';
      desc.textContent = row.desc;
      const price = document.createElement('span');
      price.className = 'buy-price';
      price.textContent = row.owned ? 'Owned' : `$${row.price}`;
      button.append(key, name, desc, price);
      button.addEventListener('click', () => onBuy(row.kind, row.id));
      items.appendChild(button);
    });
    text('buy-money', `$${money}`);
  }

  function closeBuy() {
    document.body.classList.remove('shopping');
    el('buy-menu').hidden = true;
  }

  function isBuyOpen() {
    return !el('buy-menu').hidden;
  }

  return {
    setHealth,
    setAmmo,
    setMoney,
    setTimer,
    setScore,
    setAlive,
    setObjective,
    setBomb,
    setPlant,
    killfeed,
    hitmarker,
    damageFlash,
    flashWhite,
    setSpread,
    banner,
    hideBanner,
    showOverlay,
    hideOverlay,
    openBuy,
    closeBuy,
    isBuyOpen,
    onBuyClick(fn) {
      onBuy = fn;
    },
  };
}
