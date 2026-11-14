// Input: keyboard, mouse and pointer lock, kept apart from the simulation.
// The sim reads `state` once per fixed step; `takeLook` drains the mouse
// deltas so a fast frame never applies the same turn twice.
export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    pressed: new Set(), // keys pressed since the last fixed step
    firing: false,
    aiming: false,
    locked: false,
  };
  let lookX = 0;
  let lookY = 0;

  function onKeyDown(event) {
    if (event.repeat) return;
    state.keys.add(event.code);
    state.pressed.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  }
  function onKeyUp(event) {
    state.keys.delete(event.code);
  }
  function onMouseMove(event) {
    if (!state.locked) return;
    lookX += event.movementX;
    lookY += event.movementY;
  }
  function onMouseDown(event) {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aiming = true;
  }
  function onMouseUp(event) {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  }
  function onLock() {
    state.locked = document.pointerLockElement === canvas;
    onLockChange(state.locked);
  }
  function onContext(event) {
    event.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLock);
  canvas.addEventListener('contextmenu', onContext);

  return {
    state,
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    endStep() {
      state.pressed.clear();
    },
    requestLock() {
      canvas.requestPointerLock();
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
  };
}
