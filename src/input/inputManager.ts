export interface InputState {
  moveX: number;
  moveY: number;
  aimWorldX: number;
  aimWorldY: number;
  hasAimPoint: boolean;
  throwHeld: boolean;
  throwJustPressed: boolean;
  dashJustPressed: boolean;
  skillJustPressed: boolean;
  refillHeld: boolean;
  pauseJustPressed: boolean;
  tapMarkerWorld: { x: number; y: number } | null;
}

export class InputManager {
  private keys = new Set<string>();
  private mouseScreenX = 0;
  private mouseScreenY = 0;
  private mouseLeftHeld = false;
  private hasMouseMoved = false;

  // Multi-touch tap-anywhere shooting on canvas
  private activeTouchShootId: number | null = null;
  private touchShootScreenX = 0;
  private touchShootScreenY = 0;
  private touchShootHeld = false;
  private pendingTouchAim = false;
  private pendingTapMarker = false;

  // One-shot latches cleared each fixed step
  private pendingThrow = false;
  private pendingDash = false;
  private pendingSkill = false;
  private pendingPause = false;

  // Mobile virtual controls state (joystick + refill)
  public touchMode: boolean;
  private joyX = 0;
  private joyY = 0;
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

  public resetAll(): void {
    this.keys.clear();
    this.mouseLeftHeld = false;
    this.activeTouchShootId = null;
    this.touchShootHeld = false;
    this.pendingTouchAim = false;
    this.pendingTapMarker = false;
    this.joyX = 0;
    this.joyY = 0;
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
      this.activeTouchShootId = null;
      this.touchShootHeld = false;
    });

    // Unified Pointer Events on Canvas:
    // - Mouse: hover aims, left click shoots, right click triggers skill
    // - Touch (or mouse when touchMode is toggled on): tap/hold ANYWHERE on screen shoots straight toward that spot!
    this.canvas.addEventListener('pointerdown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (e.pointerType === 'mouse') {
        this.mouseScreenX = sx;
        this.mouseScreenY = sy;
        this.hasMouseMoved = true;
        if (e.button === 0) {
          this.mouseLeftHeld = true;
          this.pendingThrow = true;
          if (this.touchMode) {
            this.touchShootScreenX = sx;
            this.touchShootScreenY = sy;
            this.pendingTouchAim = true;
            this.pendingTapMarker = true;
          }
        } else if (e.button === 2) {
          this.pendingSkill = true;
        }
        return;
      }

      // Touch / Pen tap anywhere on the open game canvas -> aim & throw directly at tapped point!
      e.preventDefault();
      this.touchMode = true;
      this.activeTouchShootId = e.pointerId;
      this.touchShootScreenX = sx;
      this.touchShootScreenY = sy;
      this.touchShootHeld = true;
      this.pendingTouchAim = true;
      this.pendingTapMarker = true;
      this.pendingThrow = true;
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (e.pointerType === 'mouse') {
        this.mouseScreenX = sx;
        this.mouseScreenY = sy;
        this.hasMouseMoved = true;
        if (this.touchMode && this.mouseLeftHeld) {
          this.touchShootScreenX = sx;
          this.touchShootScreenY = sy;
        }
        return;
      }

      if (e.pointerId === this.activeTouchShootId) {
        e.preventDefault();
        this.touchShootScreenX = sx;
        this.touchShootScreenY = sy;
      }
    });

    const endCanvasPointer = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        if (e.button === 0) this.mouseLeftHeld = false;
        return;
      }
      if (e.pointerId === this.activeTouchShootId) {
        this.activeTouchShootId = null;
        this.touchShootHeld = false;
      }
    };

    window.addEventListener('pointerup', endCanvasPointer);
    window.addEventListener('pointercancel', endCanvasPointer);

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

    const useTouchAim = this.touchShootHeld || this.pendingTouchAim;
    const screenX = useTouchAim ? this.touchShootScreenX : this.mouseScreenX;
    const screenY = useTouchAim ? this.touchShootScreenY : this.mouseScreenY;
    const aimWorldX = cameraX + screenX / viewScale;
    const aimWorldY = cameraY + screenY / viewScale;
    const hasAimPoint = useTouchAim || (this.hasMouseMoved && !this.touchMode);

    const tapMarkerWorld = this.pendingTapMarker ? { x: aimWorldX, y: aimWorldY } : null;

    const state: InputState = {
      moveX: mx,
      moveY: my,
      aimWorldX,
      aimWorldY,
      hasAimPoint,
      throwHeld: this.mouseLeftHeld || this.keys.has('KeyJ') || this.touchShootHeld,
      throwJustPressed: this.pendingThrow,
      dashJustPressed: this.pendingDash,
      skillJustPressed: this.pendingSkill,
      refillHeld: this.keys.has('KeyR') || this.touchRefillHeld,
      pauseJustPressed: this.pendingPause,
      tapMarkerWorld,
    };

    this.pendingThrow = false;
    this.pendingDash = false;
    this.pendingSkill = false;
    this.pendingPause = false;
    this.pendingTouchAim = false;
    this.pendingTapMarker = false;

    return state;
  }
}
