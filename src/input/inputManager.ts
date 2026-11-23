export interface InputState {
  moveX: number;
  moveY: number;
  aimWorldX: number;
  aimWorldY: number;
  hasMouseAim: boolean;
  touchAimActive: boolean;
  touchAimAngle: number;
  throwHeld: boolean;
  throwJustPressed: boolean;
  dashJustPressed: boolean;
  skillJustPressed: boolean;
  refillHeld: boolean;
  pauseJustPressed: boolean;
}

export class InputManager {
  private keys = new Set<string>();
  private mouseScreenX = 0;
  private mouseScreenY = 0;
  private mouseLeftHeld = false;
  private hasMouseMoved = false;

  // One-shot latches cleared each fixed step
  private pendingThrow = false;
  private pendingDash = false;
  private pendingSkill = false;
  private pendingPause = false;

  // Mobile virtual controls state
  public touchMode: boolean;
  private joyX = 0;
  private joyY = 0;
  private touchThrowHeld = false;
  private touchAimActive = false;
  private touchAimAngle = 0;
  private touchRefillHeld = false;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.touchMode =
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches;

    this.bindEvents();
  }

  public setTouchMode(enabled: boolean): void {
    this.touchMode = enabled;
  }

  public setJoystick(dx: number, dy: number): void {
    this.joyX = dx;
    this.joyY = dy;
  }

  public setTouchRefill(held: boolean): void {
    this.touchRefillHeld = held;
  }

  public triggerTouchDash(): void {
    this.pendingDash = true;
  }

  public triggerTouchSkill(): void {
    this.pendingSkill = true;
  }

  public setTouchThrowDrag(active: boolean, angle: number | null, fireNow = false): void {
    this.touchAimActive = active;
    this.touchThrowHeld = active && angle === null;
    if (angle !== null) {
      this.touchAimAngle = angle;
    }
    if (fireNow) {
      this.pendingThrow = true;
    }
  }

  public resetAll(): void {
    this.keys.clear();
    this.mouseLeftHeld = false;
    this.joyX = 0;
    this.joyY = 0;
    this.touchThrowHeld = false;
    this.touchAimActive = false;
    this.touchRefillHeld = false;
    this.pendingThrow = false;
    this.pendingDash = false;
    this.pendingSkill = false;
    this.pendingPause = false;
  }

  private bindEvents(): void {
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight' ||
        code === 'Space'
      ) {
        e.preventDefault();
      }
      if (!this.keys.has(code)) {
        if (code === 'KeyZ' || code === 'ShiftLeft') this.pendingDash = true;
        if (code === 'KeyX' || code === 'KeyE' || code === 'KeyQ' || code === 'Space') this.pendingSkill = true;
        if (code === 'KeyJ') this.pendingThrow = true;
        if (code === 'Escape' || code === 'KeyP') this.pendingPause = true;
      }
      this.keys.add(code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseLeftHeld = false;
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseScreenX = e.clientX - rect.left;
      this.mouseScreenY = e.clientY - rect.top;
      this.hasMouseMoved = true;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseScreenX = e.clientX - rect.left;
      this.mouseScreenY = e.clientY - rect.top;
      this.hasMouseMoved = true;
      if (e.button === 0) {
        this.mouseLeftHeld = true;
        this.pendingThrow = true;
      } else if (e.button === 2) {
        this.pendingSkill = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouseLeftHeld = false;
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }

  public sample(cameraX: number, cameraY: number, viewScale: number): InputState {
    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;

    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my);
      mx /= len;
      my /= len;
    } else if (Math.hypot(this.joyX, this.joyY) > 0.08) {
      mx = this.joyX;
      my = this.joyY;
    }

    const aimWorldX = cameraX + this.mouseScreenX / viewScale;
    const aimWorldY = cameraY + this.mouseScreenY / viewScale;

    const state: InputState = {
      moveX: mx,
      moveY: my,
      aimWorldX,
      aimWorldY,
      hasMouseAim: this.hasMouseMoved && !this.touchMode,
      touchAimActive: this.touchAimActive,
      touchAimAngle: this.touchAimAngle,
      throwHeld: this.mouseLeftHeld || this.keys.has('KeyJ') || this.touchThrowHeld,
      throwJustPressed: this.pendingThrow,
      dashJustPressed: this.pendingDash,
      skillJustPressed: this.pendingSkill,
      refillHeld: this.keys.has('KeyR') || this.touchRefillHeld,
      pauseJustPressed: this.pendingPause,
    };

    this.pendingThrow = false;
    this.pendingDash = false;
    this.pendingSkill = false;
    this.pendingPause = false;

    return state;
  }
}
