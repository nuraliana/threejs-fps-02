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
- `game/src/` — main.js (boot, fixed 60 Hz loop, `?shot=` capture mode,
  `?autoplay=1&seed=N` headless autoplay for balance testing), sim.js
  (rounds, economy, bomb, shooting, damage, killfeed, bot economy), world.js
  (Dustline Yard: map, colliders, waypoint graph, sky), player.js (FPS body,
  armour), weapons.js (five guns, three grenades, view models, spread,
  `chooseLoadout` — the loadout picker bots and autoplay share), bots.js
  (bot AI: shared-geometry articulated meshes, per-team helmets, buy phase,
  grenade tactics), effects.js (tracers, sparks, explosions, smoke that
  blocks sight), audio.js (synthesized WebAudio SFX), hud.js (HUD, killfeed,
  buy menu, banners, overlays), input.js, palette.js (dusk palette +
  procedural canvas textures).
- `game/vendor/three/` — three.js 0.187.0, vendored byte for byte from the
  kit (`three.module.min.js` + `three.core.min.js` + LICENSE).
- `screenshots/` — 1-cover.jpg (mid-round firefight), 2-buy.jpg (buy menu),
  3-site.jpg (charge planted at the Pump House, smoke on the east approach),
  4-win.jpg (round win). All 1280×720, real renders of this code, taken
  headless with `?shot=<name>&seed=1` (deterministic frame, rendered twice,
  frozen).
- `serve.ts` — static dev server for `game/` (`node serve.ts`, then
  http://localhost:8080).
- `harness/` (outside the entry, not submitted) — puppeteer headless
  harness: `balance.js` (autoplay matches, seeds 1–12), `shots.js` (retakes
  the 4 screenshots and counts errors/failed/external requests),
  `navcheck.py` (every waypoint node/edge against the wall boxes).

## Verified locally (headless Chromium, SwiftShader WebGL)

- All 4 screenshots: 0 console errors, 0 failed requests, 0 requests to any
  host other than localhost (no network, no CDN).
- Live menu mode (no `?shot=`): boots to the SANDLINE start overlay, 0
  console errors over 5 s.
- `main.ts` run twice into separate output dirs: outputs byte-identical
  (`cmp` clean on dossier.json).
- Caps: `game/` 2,257,352 bytes / 15 files (≤48 MiB, ≤993); `index.html`
  10,949 bytes (≤1 MiB); `dossier.json` 392,914 bytes (≤1.5 MiB); dossier
  text 123,690 bytes (≤163,840); screenshots 42–55 KiB each (≤256 KiB).
- Vendored three.js hashes match the kit exactly.
- All game JS parses (`node --check` as ESM).

## Polish round (15 Nov 2026, after the first submission)

The entry shipped with the AI not actually fighting: the bots' reaction
timer was re-rolled on every sighting so it never fired, combat outranked
routing at 42 m so nobody ever pushed, the combat strafe moved the bot
*away* from its enemy, and four waypoint nodes sat inside wall boxes with
three routes to the site impassable — as shipped, the game could not be
played to the site. All fixed and verified by probe, not by reading: bots
fire ~76 shots/round at ~33% hits once the bugs are out.

Bots now look like fighters, not boxes: shared-geometry articulated meshes
(helmet + crest fin for Vanguard, brimmed helmet + back tank for Ember),
hip-pivoted legs and shoulder-pivoted arms that swing with the walk cycle,
guns in hand, visor facing forward. Bots run their own economy (kill $300,
round win/loss $3,250/$1,900) and buy each round from the same loadout
picker the player uses — rifle first, then Kevlar, then flash/smoke/HE —
and spend their grenades tactically: the carrier flashes or smokes the
site on the push, Ember smokes a planted site and flashes or lobs HE at
visible enemies, ~10 s cooldown each.

Balance was measured, not guessed, with 12 seeded headless autoplay
matches (a precise-aiming, strafing autopilot playing the human's role).
Before the AI fixes Ember won 5–0 with the player on 0 kills; after the
fixes and a defender skill edge (faster reactions, tighter aim, wider
hearing) plus a fourth defender holding the site, Vanguard wins 57 of 82
rounds (70%) — the autopilot is a near-perfect mechanical player, so a
typical human lands around 55–65%. Rounds are still mostly decided by
elimination; the bomb matters when the fight is close (detonations and a
full Ember match win both appear in the 12-seed set).

## Known limits

- Bot meshes are articulated low-poly figures, not modelled characters.
- No multiplayer: single-player vs bots only, as the bounty asks.
- Balance was measured against a headless autopilot, not human players;
  bot difficulty is fixed.
