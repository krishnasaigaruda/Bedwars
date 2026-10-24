// Keyboard and mouse state with pointer lock and double-tap detection.

const DOUBLE_TAP_MS = 300;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.doubles = new Set();
    this.lastDown = new Map();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false, wheel: 0 };
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
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.keys.clear(); this.mouse.left = this.mouse.right = false; }
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
    if (p?.catch) p.catch(() => this.canvas.requestPointerLock());
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
