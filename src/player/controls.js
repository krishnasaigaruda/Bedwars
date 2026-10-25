// Keyboard and mouse state with pointer lock and double-tap detection.

const DOUBLE_TAP_MS = 300;

export const IS_WINDOWS = /win/i.test(navigator.userAgentData?.platform || navigator.platform || '');

// 'KeyF' -> 'F', 'CapsLock' -> 'Caps Lock'.
export function keyName(code) {
  if (!code) return 'None';
  return code.replace(/^Key|^Digit/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.doubles = new Set();
    this.lastDown = new Map();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false, wheel: 0 };
    // Attack and place can also be keys (for touchpads, where Windows ignores
    // taps while a key is held). Each button remembers whether the mouse or
    // the key is holding it.
    this.binds = { attack: null, place: null };
    this.holds = { left: [false, false], right: [false, false] };
    this.raw = true;
    this.locked = false;
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || (this.locked && (e.code === 'Space' || e.ctrlKey))) e.preventDefault();
      if (e.repeat) return;
      const now = performance.now();
      if (now - (this.lastDown.get(e.code) ?? -1e9) < DOUBLE_TAP_MS) {
        this.doubles.add(e.code);
        this.lastDown.set(e.code, -1e9);
      } else this.lastDown.set(e.code, now);
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (this.locked && e.code === this.binds.attack) this.press('left', 1);
      if (this.locked && e.code === this.binds.place) this.press('right', 1);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === this.binds.attack) this.release('left', 1);
      if (e.code === this.binds.place) this.release('right', 1);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.releaseAll(); });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.press('left', 0);
      if (e.button === 2) this.press('right', 0);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.release('left', 0);
      if (e.button === 2) this.release('right', 0);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.keys.clear(); this.releaseAll(); }
      this.onLockChange?.(this.locked);
    });
  }

  // which: 'left' | 'right'; src: 0 mouse, 1 key.
  press(which, src) {
    this.holds[which][src] = true;
    this.mouse[which] = true;
    this.mouse[`${which}Pressed`] = true;
  }
  release(which, src) {
    this.holds[which][src] = false;
    this.mouse[which] = this.holds[which][0] || this.holds[which][1];
  }
  releaseAll() {
    for (const h of Object.values(this.holds)) h[0] = h[1] = false;
    this.mouse.left = this.mouse.right = false;
  }

  // Raw input skips the system's pointer acceleration. Good for a mouse, but
  // a Windows touchpad needs that acceleration to be usable.
  lock() {
    const p = this.canvas.requestPointerLock?.(this.raw ? { unadjustedMovement: true } : undefined);
    p?.catch?.(() => { if (this.raw) this.canvas.requestPointerLock()?.catch?.(() => {}); });
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.locked && this.keys.has(code); }
  tapped(code) { return this.pressed.has(code); }
  doubleTapped(code) { return this.locked && this.doubles.has(code); }

  endFrame() {
    this.pressed.clear();
    this.doubles.clear();
    this.mouse.dx = this.mouse.dy = 0;
    this.mouse.leftPressed = this.mouse.rightPressed = false;
    this.mouse.wheel = 0;
  }
}
