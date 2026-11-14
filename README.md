# SANDLINE — Dustline Yard

A round-based tactical FPS in the browser, built on three.js 0.187.0, for the
make.fun threejs-fps-02 bounty. Counter-Strike-style, never a copy: an
original dusk-desert map, original teams, weapons and sounds.

## The game

Two teams fight over the Pump House on Dustline Yard, a 56×40 m industrial
yard at dusk with three lanes: A Long (west), Mid (centre) and the B tunnel
(east flank). Vanguard attacks; Ember defends.

- **Rounds**: first to 5 (at most 9). A round ends by elimination, by the
  charge detonating, by a defuse, or on the clock (defenders win ties).
- **Objective**: the attacking team plants the charge at the Pump House
  (hold **E** at the site, 3 s). It blows 35 s later unless Ember defuses
  it (5 s channel). If the carrier falls, the charge drops and the nearest
  alive Vanguard bot picks it up.
- **Money**: $800 to start; a kill pays $300, a plant $300, a round win
  $3,250, a loss $1,900. The buy menu (**B**, buy phase) sells five guns,
  three grenades and a Kevlar vest.
- **Gunplay**: hitscan with headshots (×2), recoil and spread bloom that
  punish firing on the move, aim-down-sights, crouching, sprinting, jumping
  and AABB collision. Bots walk waypoint routes, hold angles, react to
  sight and sound, fight in bursts, and plant or defuse the charge.
- **Sound**: everything is synthesized with WebAudio — no audio files.

## Controls

| Key | Action |
| --- | --- |
| W A S D / Shift / Ctrl / Space | Move / sprint / crouch / jump |
| Mouse | Look (pointer lock) |
| Click / Right mouse | Fire / aim down sights |
| R | Reload |
| 1–5 | Weapons · 6–8 Grenades |
| B | Buy menu (buy phase) |
| E | Plant the charge (hold, at the site) |

## Layout

```
main.ts            entrypoint: copies game/ + screenshots/ to /output,
                   writes /output/dossier.json via vendor/makefun-threejs.ts
serve.ts           static dev server for game/ (http://localhost:8080)
game/index.html    HUD + import map (three -> ./vendor/three/three.module.min.js)
game/src/main.js   boot, fixed 60 Hz loop, ?shot= capture mode
game/src/sim.js    rounds, economy, bomb, shooting, damage, killfeed
game/src/world.js  Dustline Yard: map, colliders, waypoint graph, sky
game/src/player.js FPS body: accel, crouch, jump, armour
game/src/weapons.js  five guns, three grenades, view models, spread
game/src/bots.js   bot AI: routes, sight, hearing, bursts, plant/defuse
game/src/effects.js  tracers, sparks, explosions, smoke (blocks sight)
game/src/audio.js  synthesized WebAudio sound effects
game/src/hud.js    HUD, killfeed, buy menu, banners, overlays
game/src/palette.js  dusk palette + procedural canvas textures
game/vendor/three/  three.js 0.187.0, vendored byte for byte from the kit
screenshots/      1-cover, 2-buy, 3-site, 4-win — real renders of this code
```

## Play it

```sh
node serve.ts        # game/ on http://localhost:8080
```

Screenshots are taken headless (`?shot=<name>&seed=1` sets up a
deterministic frame, renders it twice, then sets `window.__shotReady`).

## License

MIT — see LICENSE.
