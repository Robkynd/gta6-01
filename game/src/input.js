// Keyboard and mouse input for Neon Bay: WASD/arrows to move or drive, mouse drag to
// orbit the camera, E to enter or exit a car, Space to brake, P or Escape to pause.
// The input state is polled once per frame; edge-triggered actions are consumed with
// takeActions() so a single key press never fires twice.

export const ACTION_CONFIRM = 1 << 0;
export const ACTION_PAUSE = 1 << 1;
export const ACTION_ENTER_CAR = 1 << 2;
export const ACTION_BRAKE = 1 << 3;

const KEY_MAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'brake',
};

export function createInput(canvas) {
  const held = { up: false, down: false, left: false, right: false, brake: false };
  let actions = 0;
  // Camera orbit deltas accumulate from mouse drags and are consumed by the loop.
  let dragX = 0;
  let dragY = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  window.addEventListener('keydown', (event) => {
    const dir = KEY_MAP[event.code];
    if (dir) {
      held[dir] = true;
      event.preventDefault();
      return;
    }
    if (event.code === 'KeyE' && !event.repeat) actions |= ACTION_ENTER_CAR;
    if ((event.code === 'KeyP' || event.code === 'Escape') && !event.repeat) actions |= ACTION_PAUSE;
    if ((event.code === 'Space' || event.code === 'Enter') && !event.repeat) actions |= ACTION_CONFIRM;
  });

  window.addEventListener('keyup', (event) => {
    const dir = KEY_MAP[event.code];
    if (dir) held[dir] = false;
  });

  window.addEventListener('blur', () => {
    for (const key of Object.keys(held)) held[key] = false;
    dragging = false;
  });

  canvas.addEventListener('mousedown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
  });

  window.addEventListener('mousemove', (event) => {
    if (!dragging) return;
    dragX += event.clientX - lastX;
    dragY += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
  });

  window.addEventListener('mouseup', () => { dragging = false; });

  canvas.addEventListener('touchstart', (event) => {
    dragging = true;
    lastX = event.touches[0].clientX;
    lastY = event.touches[0].clientY;
  }, { passive: true });

  canvas.addEventListener('touchmove', (event) => {
    if (!dragging) return;
    dragX += event.touches[0].clientX - lastX;
    dragY += event.touches[0].clientY - lastY;
    lastX = event.touches[0].clientX;
    lastY = event.touches[0].clientY;
  }, { passive: true });

  canvas.addEventListener('touchend', () => { dragging = false; });

  return {
    // -1/0/1 along the camera-relative forward and right axes.
    move() {
      return {
        forward: (held.up ? 1 : 0) - (held.down ? 1 : 0),
        strafe: (held.right ? 1 : 0) - (held.left ? 1 : 0),
      };
    },
    braking() { return held.brake; },
    // Consumes the accumulated mouse drag since the last call (pixels).
    takeDrag() {
      const out = { x: dragX, y: dragY };
      dragX = 0;
      dragY = 0;
      return out;
    },
    takeActions() {
      const out = actions;
      actions = 0;
      return out;
    },
  };
}
