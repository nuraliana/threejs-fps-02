# SANDLINE — Dustline Yard — dossier

A round-based tactical FPS for the make.fun threejs-fps-02 bounty, built on
three.js 0.187.0, vendored locally. The machine-readable dossier is
`/output/dossier.json`, written by `main.ts` (see README.md); this file is
the human-readable summary of the same entry.

## The game

Vanguard (teal, attacks) vs Ember (rust, defends) fight 5v5 over the Pump
House on Dustline Yard, a 56×40 m dusk-desert industrial yard with three
lanes: A Long west, Mid centre, B tunnel east. First to 5 rounds (at most 9);
a round ends by elimination, by the charge detonating, by a defuse, or on
the clock (defenders win ties). The charge is planted at the Pump House
(hold E at the site, 3 s) and blows 35 s later unless Ember defuses it (5 s
channel). If the carrier falls, the charge drops and the nearest alive
Vanguard bot picks it up.

Money carries between rounds: $800 to start; a kill pays $300, a plant $300,
a round win $3,250, a loss $1,900. The buy menu (B, buy phase) sells five
guns, three grenades and a Kevlar vest. Gunplay is hitscan with headshots
(×2), recoil and spread bloom that punish firing on the move, aim-down-sights,
crouching, sprinting, jumping and AABB collision. Bots walk waypoint routes,
hold angles, react to sight and sound, fight in bursts, and plant or defuse
the charge. All sound is synthesized with WebAudio — no audio files.

## Controls

W A S D move · Shift sprint · Ctrl crouch · Space jump · mouse look (pointer
lock) · click fire · right mouse aim · R reload · 1–5 weapons · 6–8 grenades ·
B buy menu (buy phase) · E plant the charge (hold, at the site).

## What is where

- `main.ts` — entrypoint: copies `game/` + `screenshots/` to `/output` and
  writes `/output/dossier.json` via `vendor/makefun-threejs.ts` (kit copy,
  unchanged).
- `game/index.html` — HUD + import map (`"three"` → `./vendor/three/three.module.min.js`).
- `game/src/` — main.js (boot, fixed 60 Hz loop, `?shot=` capture mode),
  sim.js (rounds, economy, bomb, shooting, damage, killfeed), world.js
  (Dustline Yard: map, colliders, waypoint graph, sky), player.js (FPS body,
  armour), weapons.js (five guns, three grenades, view models, spread),
  bots.js (bot AI), effects.js (tracers, sparks, explosions, smoke that
  blocks sight), audio.js (synthesized WebAudio SFX), hud.js (HUD, killfeed,
  buy menu, banners, overlays), input.js, palette.js (dusk palette +
  procedural canvas textures).
- `game/vendor/three/` — three.js 0.187.0, vendored byte for byte from the
  kit (`three.module.min.js` + `three.core.min.js` + LICENSE).
- `screenshots/` — 1-cover.jpg (mid-round firefight), 2-buy.jpg (buy menu),
  3-site.jpg (charge planted at the Pump House), 4-win.jpg (round win).
  All 1280×720, real renders of this code, taken headless with
  `?shot=<name>&seed=1` (deterministic frame, rendered twice, frozen).
- `serve.ts` — static dev server for `game/` (`node serve.ts`, then
  http://localhost:8080).

## Verified locally (headless Chromium, SwiftShader WebGL)

- All 4 screenshots: 0 console errors, 0 failed requests, 0 requests to any
  host other than localhost (no network, no CDN).
- Live menu mode (no `?shot=`): boots to the SANDLINE start overlay, 0
  console errors over 5 s.
- `main.ts` run twice into separate output dirs: outputs byte-identical
  (`diff -r` clean).
- Caps: `game/` 2,235,109 bytes / 15 files (≤48 MiB, ≤993); `index.html`
  10,949 bytes (≤1 MiB); `dossier.json` 380,849 bytes (≤1.5 MiB); dossier
  text 101,446 bytes (≤163,840); screenshots 37–63 KiB each (≤256 KiB).
- Vendored three.js hashes match the kit exactly.
- All game JS parses (`node --check` as ESM).

## Known limits

- Bot meshes are simple team-coloured boxes with a visor; the art is
  procedural geometry and canvas textures, not modelled characters.
- Bots do not use the grenades and do not buy; only the player shops.
- No multiplayer: single-player vs bots only, as the bounty asks.
- Balance is untested against human players; bot difficulty is fixed.
