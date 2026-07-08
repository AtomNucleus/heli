export interface RawInput {
  collective: number;
  cyclicPitch: number;
  cyclicRoll: number;
  pedal: number;
  boost: boolean;
  autoLevel: boolean;
  pause: boolean;
  reset: boolean;
  camera: boolean;
  mode: boolean;
  help: boolean;
  pointerLocked: boolean;
}

export class Input {
  private keys = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  private mouseSens = 0.0022;
  private canvas: HTMLCanvasElement;
  pointerLocked = false;

  // Touch state
  private touchCollective = 0;
  private touchPedal = 0;
  private touchLookX = 0;
  private touchLookY = 0;
  private touchDragging = false;
  private lastTouchX = 0;
  private lastTouchY = 0;

  // Edge-triggered
  private prevPause = false;
  private prevReset = false;
  private prevCamera = false;
  private prevMode = false;
  private prevHelp = false;

  pausePressed = false;
  resetPressed = false;
  cameraPressed = false;
  modePressed = false;
  helpPressed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.bind();
  }

  private bind() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    this.canvas.addEventListener('click', () => {
      if (!this.pointerLocked) {
        this.canvas.requestPointerLock?.();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) {
        this.mouseX *= 0.3;
        this.mouseY *= 0.3;
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseX += e.movementX * this.mouseSens;
      this.mouseY += e.movementY * this.mouseSens;
      this.mouseX = Math.max(-1, Math.min(1, this.mouseX));
      this.mouseY = Math.max(-1, Math.min(1, this.mouseY));
    });

    // Touch look on canvas
    this.canvas.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 1) {
          this.touchDragging = true;
          this.lastTouchX = e.touches[0].clientX;
          this.lastTouchY = e.touches[0].clientY;
        }
      },
      { passive: true },
    );
    this.canvas.addEventListener(
      'touchmove',
      (e) => {
        if (!this.touchDragging || e.touches.length !== 1) return;
        const t = e.touches[0];
        const dx = t.clientX - this.lastTouchX;
        const dy = t.clientY - this.lastTouchY;
        this.lastTouchX = t.clientX;
        this.lastTouchY = t.clientY;
        this.touchLookX = Math.max(-1, Math.min(1, this.touchLookX + dx * 0.008));
        this.touchLookY = Math.max(-1, Math.min(1, this.touchLookY + dy * 0.008));
      },
      { passive: true },
    );
    this.canvas.addEventListener(
      'touchend',
      () => {
        this.touchDragging = false;
        this.touchLookX *= 0.5;
        this.touchLookY *= 0.5;
      },
      { passive: true },
    );

    this.bindTouchButtons();
  }

  private bindTouchButtons() {
    const hold = (id: string, on: () => void, off: () => void) => {
      const el = document.getElementById(id);
      if (!el) return;
      const start = (e: Event) => {
        e.preventDefault();
        on();
      };
      const end = (e: Event) => {
        e.preventDefault();
        off();
      };
      el.addEventListener('touchstart', start, { passive: false });
      el.addEventListener('touchend', end, { passive: false });
      el.addEventListener('touchcancel', end, { passive: false });
      el.addEventListener('mousedown', start);
      el.addEventListener('mouseup', end);
      el.addEventListener('mouseleave', end);
    };

    hold(
      'touch-up',
      () => (this.touchCollective = 1),
      () => (this.touchCollective = 0),
    );
    hold(
      'touch-down',
      () => (this.touchCollective = -1),
      () => (this.touchCollective = 0),
    );
    hold(
      'touch-left',
      () => (this.touchPedal = -1),
      () => (this.touchPedal = 0),
    );
    hold(
      'touch-right',
      () => (this.touchPedal = 1),
      () => (this.touchPedal = 0),
    );
  }

  requestPointerLock() {
    this.canvas.requestPointerLock?.();
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private readGamepad(): Partial<RawInput> | null {
    const pads = navigator.getGamepads?.() ?? [];
    const gp = pads[0] ?? pads[1];
    if (!gp) return null;

    const dead = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
    const lx = dead(gp.axes[0] ?? 0);
    const ly = dead(gp.axes[1] ?? 0);
    const rx = dead(gp.axes[2] ?? 0);
    const triggers = (gp.buttons[7]?.value ?? 0) - (gp.buttons[6]?.value ?? 0);
    const yaw =
      (gp.buttons[5]?.pressed ? 1 : 0) - (gp.buttons[4]?.pressed ? 1 : 0) || dead(rx);

    return {
      cyclicRoll: lx,
      cyclicPitch: ly,
      collective: triggers || -ly * 0, // triggers primary
      pedal: yaw,
      boost: gp.buttons[10]?.pressed ?? false,
      autoLevel: gp.buttons[0]?.pressed ?? false,
    };
  }

  sample(): RawInput {
    let collective =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    let pedal =
      (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);

    if (this.touchCollective) collective = this.touchCollective;
    if (this.touchPedal) pedal = this.touchPedal;

    let cyclicPitch = this.pointerLocked ? this.mouseY : this.touchLookY;
    let cyclicRoll = this.pointerLocked ? this.mouseX : this.touchLookX;

    // Keyboard fallback cyclic when unlocked
    if (!this.pointerLocked && !this.touchDragging) {
      if (this.keys.has('ArrowUp')) cyclicPitch = -0.6;
      if (this.keys.has('ArrowDown')) cyclicPitch = 0.6;
      if (this.keys.has('ArrowLeft')) cyclicRoll = -0.6;
      if (this.keys.has('ArrowRight')) cyclicRoll = 0.6;
    }

    // Decay mouse toward center slowly when not moving (spring)
    if (this.pointerLocked) {
      this.mouseX *= 0.985;
      this.mouseY *= 0.985;
    } else {
      this.touchLookX *= 0.92;
      this.touchLookY *= 0.92;
    }

    const gp = this.readGamepad();
    if (gp) {
      if (gp.cyclicPitch) cyclicPitch = gp.cyclicPitch;
      if (gp.cyclicRoll) cyclicRoll = gp.cyclicRoll;
      if (gp.collective) collective = gp.collective!;
      if (gp.pedal) pedal = gp.pedal;
    }

    const pause = this.keys.has('KeyP');
    const reset = this.keys.has('KeyR');
    const camera = this.keys.has('KeyC');
    const mode = this.keys.has('KeyV');
    const help = this.keys.has('KeyH') || this.keys.has('Escape');

    this.pausePressed = pause && !this.prevPause;
    this.resetPressed = reset && !this.prevReset;
    this.cameraPressed = camera && !this.prevCamera;
    this.modePressed = mode && !this.prevMode;
    this.helpPressed = help && !this.prevHelp;
    this.prevPause = pause;
    this.prevReset = reset;
    this.prevCamera = camera;
    this.prevMode = mode;
    this.prevHelp = help;

    return {
      collective,
      cyclicPitch,
      cyclicRoll,
      pedal,
      boost: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || !!(gp?.boost),
      autoLevel: this.keys.has('Space') || !!(gp?.autoLevel),
      pause,
      reset,
      camera,
      mode,
      help,
      pointerLocked: this.pointerLocked,
    };
  }
}
