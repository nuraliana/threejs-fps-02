// Dustline Yard: the map of SANDLINE.
//
// A desert industrial yard at dusk, 56 by 40 metres, three lanes between the
// spawns and one bombsite. South (z +) is Vanguard's spawn, north (z -) is
// Ember's. Site A, the Pump House, sits north-west; the east lane is a roofed
// tunnel that flanks into the site from behind. Every wall is a box; every
// box is both a mesh the eye sees and a Box3 the movement and the bullets
// collide with, so the map the player walks is the map the code reads.
import * as THREE from 'three';
import { PALETTE, makeTextures, makeSkyMaterial } from './palette.js';

// [x, z, width, depth, height, material, top?] — top lifts a box off the
// ground (a roof, a stacked container). y is always the ground unless top.
const WALLS = [
  // perimeter
  [0, -20, 57, 1, 4, 'concrete'],
  [0, 20, 57, 1, 4, 'concrete'],
  [-28, 0, 1, 41, 4, 'concrete'],
  [28, 0, 1, 41, 4, 'concrete'],
  // Pump House: site A, a U open to the south-east around the pump. The
  // south wall stops short of the east side on purpose: the gap between
  // its east end and the site is the attackers' way in, and a wall across
  // the whole south side would trap anyone routing to the site against it.
  [-23.5, -13, 1, 9, 3.6, 'concrete'],
  [-14.5, -17, 10, 1, 3.6, 'concrete'],
  [-21.5, -8.5, 4, 1, 3.6, 'concrete'],
  // mid: two stacked containers make the courtyard's spine. The gap
  // between them is 1.0 m on purpose: a fighter is 0.68 m wide, so a
  // narrower gap would wedge anyone routing straight down mid.
  [-3.6, -2, 6.2, 2.6, 2.6, 'rust'],
  [3.6, -2, 6.2, 2.6, 2.6, 'rust'],
  [-3.6, -2, 6.2, 2.6, 2.6, 'rust', 2.6],
  // A Long cover
  [-22, 2, 2.4, 2.4, 1.3, 'concrete'],
  [-22, -6, 3.2, 1.2, 1.3, 'concrete'],
  [-12, -14, 2.4, 2.4, 1.3, 'rust'],
  // mid lane blocks: staggered, so no sightline runs the whole map
  [-9, 6, 8, 1, 2.6, 'concrete'],
  [9, -6, 8, 1, 2.6, 'concrete'],
  [0, 9, 2.4, 2.4, 1.3, 'concrete'],
  // B tunnel: roofed corridor on the east flank
  [21.5, 1, 1, 20, 3.4, 'concrete'],
  [26.5, 1, 1, 20, 3.4, 'concrete'],
  [24, 1, 6, 20, 0.4, 'metal', 3.4],
  // east cover and south blocks
  [16, -12, 2.4, 2.4, 1.3, 'concrete'],
  [14, 6, 3.2, 1.2, 1.3, 'rust'],
  [-8, 12, 2.4, 2.4, 1.3, 'concrete'],
  [8, 14, 2.4, 2.4, 1.3, 'concrete'],
  [-16, 10, 3.2, 1.2, 1.3, 'concrete'],
];

export const SITE = { x: -19, z: -13, radius: 3.2 };

export const SPAWNS = {
  vanguard: [
    [0, 16.5], [-3, 16], [3, 16], [-6, 15], [6, 15],
  ],
  ember: [
    [0, -16.5], [-3, -16], [3, -16], [-6, -15], [6, -15],
  ],
};

// Waypoint graph: [x, z] nodes, edges by index. Bots path with BFS over it.
// Attackers push from the south; defenders hold the site and the lanes.
// Every node is open ground a fighter can stand on, and every edge is a
// straight line a fighter can walk or slide along — a node inside a box,
// or an edge through a wall a fighter cannot slide around, strands the
// bots against the wall forever (verified by harness/navcheck.py).
export const WAYPOINTS = {
  nodes: [
    [0, 16], // 0 vanguard spawn
    [-8, 9], // 1 A entry, south of the (-8,12) block
    [8, 12], // 2
    [-16, 8], // 3 A entry
    [-19.5, 2], // 4 A long, east of the (-22,2) block
    [-19.5, -6], // 5 A long north, east of the (-22,-6) block
    [-17, -12], // 6 site A, east of the pump
    [2, 6], // 7 mid south, east of the (0,9) block
    [0, 0], // 8 mid court
    [-6, -11], // 9 site south-east hold: four defenders hold the site,
    // one covers the east. A mid hold here left the site 3-vs-5 and the
    // attackers won the first contact before help could rotate in.
    [16, 8], // 10 B entry
    [24, 12], // 11 tunnel south mouth (the tunnel is entered from the south)
    [24, -8], // 12 tunnel exit
    [-10, -12], // 13 site east
    [-14, -15], // 14 site west hold
    [0, -16], // 15 ember spawn
    [-8, -2], // 16 mid west
    [8, -2], // 17 mid east
    [-22, -14], // 18 A corner hold
    [12, -12], // 19 east hold
  ],
  edges: [
    [0, 1], [0, 2], [0, 7], [1, 3], [1, 7], [2, 7], [2, 10], [3, 4],
    [4, 5], [5, 6], [5, 18], [6, 13], [6, 14], [6, 18], [7, 8], [8, 9],
    [8, 16], [8, 17], [9, 13], [9, 15], [9, 19], [10, 11], [11, 12],
    [12, 13], [12, 19], [13, 14], [14, 15], [15, 19], [16, 3], [17, 10],
  ],
};

export function createWorld(scene) {
  const textures = makeTextures();
  const materials = {
    sand: new THREE.MeshStandardMaterial({ map: textures.sand, roughness: 1, metalness: 0 }),
    concrete: new THREE.MeshStandardMaterial({ map: textures.concrete, roughness: 0.95, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ map: textures.metal, roughness: 0.6, metalness: 0.5 }),
    rust: new THREE.MeshStandardMaterial({ map: textures.rustMetal, roughness: 0.75, metalness: 0.35 }),
    hazard: new THREE.MeshStandardMaterial({ map: textures.hazard, roughness: 0.9, metalness: 0 }),
  };

  // sky dome + lights: low warm sun from the west, cool sky fill
  const sky = new THREE.Mesh(new THREE.SphereGeometry(160, 24, 16), makeSkyMaterial());
  scene.add(sky);
  const sun = new THREE.DirectionalLight(0xffb066, 2.4);
  sun.position.set(-40, 26, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8a7bb8, 0x8a6a45, 0.85));
  const siteLight = new THREE.PointLight(0x2ec4b6, 12, 16, 1.6);
  siteLight.position.set(SITE.x, 4, SITE.z);
  scene.add(siteLight);

  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), materials.sand);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const colliders = [];
  const shootables = [];
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (const [x, z, w, d, h, mat, top = 0] of WALLS) {
    const mesh = new THREE.Mesh(box, materials[mat]);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, top + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - w / 2, top, z - d / 2),
      new THREE.Vector3(x + w / 2, top + h, z + d / 2),
    ));
    shootables.push(mesh);
  }

  // the pump: the objective itself, a rusted cylinder on a concrete plinth
  const pump = new THREE.Group();
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 2.6), materials.concrete);
  plinth.position.y = 0.25;
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 0.95, 2.2, 12),
    materials.rust,
  );
  tank.position.y = 1.6;
  tank.castShadow = true;
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.6, 8), materials.metal);
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(0, 2.4, 0);
  pipe.castShadow = true;
  pump.add(plinth, tank, pipe);
  pump.position.set(SITE.x, 0, SITE.z);
  scene.add(pump);
  colliders.push(new THREE.Box3(
    new THREE.Vector3(SITE.x - 1.3, 0, SITE.z - 1.3),
    new THREE.Vector3(SITE.x + 1.3, 2.7, SITE.z + 1.3),
  ));
  shootables.push(tank);

  // hazard ring on the floor around the pump: the plant zone, readable at a glance
  const ring = new THREE.Mesh(new THREE.RingGeometry(SITE.radius - 0.35, SITE.radius, 40), materials.hazard);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(SITE.x, 0.02, SITE.z);
  scene.add(ring);

  // site beacon: a soft teal column so the objective reads from across the map
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.9, 9, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x2ec4b6, transparent: true, opacity: 0.14,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }),
  );
  beacon.position.set(SITE.x, 4.5, SITE.z);
  scene.add(beacon);

  // drifting dust: one Points cloud, animated in update()
  const dustCount = 320;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i += 1) {
    dustPos[i * 3] = (Math.random() * 2 - 1) * 28;
    dustPos[i * 3 + 1] = 0.3 + Math.random() * 6;
    dustPos[i * 3 + 2] = (Math.random() * 2 - 1) * 20;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xd9b47e, size: 0.05, transparent: true, opacity: 0.35, depthWrite: false,
  }));
  scene.add(dust);

  let time = 0;
  return {
    colliders,
    shootables,
    update(dt) {
      time += dt;
      beacon.material.opacity = 0.11 + Math.sin(time * 1.4) * 0.04;
      siteLight.intensity = 11 + Math.sin(time * 1.4) * 2;
      const p = dust.geometry.attributes.position;
      for (let i = 0; i < dustCount; i += 1) {
        let x = p.getX(i) + dt * 0.35;
        if (x > 28) x = -28;
        p.setX(i, x);
        p.setY(i, p.getY(i) + Math.sin(time * 0.7 + i) * dt * 0.05);
      }
      p.needsUpdate = true;
    },
  };
}
