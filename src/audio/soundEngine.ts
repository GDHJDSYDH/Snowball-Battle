/**
 * Procedural 8-bit/16-bit Web Audio Sound & Winter BGM Synthesizer
 * Hardened for mobile Safari / Android Chrome / WebViews:
 * - Single shared reusable noise AudioBuffer (eliminates repeated allocations & tab OOM crashes)
 * - Explicit node cleanup on `onended` + concurrent voice cap
 * - All audio calls wrapped in try/catch so suspended/interrupted AudioContext can NEVER crash the game!
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private activeVoices = 0;
  private readonly maxVoices = 14;
  private muted = false;
  private bgmTimer: number | null = null;
  private bgmStep = 0;
  private bgmPlaying = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopBgm();
    } else if (this.bgmPlaying) {
      this.startBgmLoop();
    }
    return this.muted;
  }

  public unlock(): void {
    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && (this.ctx.state === 'suspended' || (this.ctx.state as string) === 'interrupted')) {
        this.ctx.resume().catch(() => {});
      }
      if (this.ctx && !this.noiseBuffer) {
        const len = Math.max(1, Math.floor(this.ctx.sampleRate * 0.4));
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        this.noiseBuffer = buf;
      }
    } catch {
      // Never let audio initialization crash gameplay
    }
  }

  private getCtx(): AudioContext | null {
    if (this.muted) return null;
    this.unlock();
    if (!this.ctx || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private playTone(
    freq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType = 'square',
    volume = 0.12,
    delay = 0
  ): void {
    if (this.activeVoices >= this.maxVoices) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    try {
      const safeDur = Math.max(0.02, duration);
      const safeVol = Math.max(0.002, volume);
      const t = Math.max(ctx.currentTime, ctx.currentTime + Math.max(0, delay));
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), t);
      if (endFreq !== freq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + safeDur);
      }
      gain.gain.setValueAtTime(safeVol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + safeDur);
      osc.connect(gain);
      gain.connect(ctx.destination);

      this.activeVoices++;
      osc.onended = () => {
        this.activeVoices = Math.max(0, this.activeVoices - 1);
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      };

      osc.start(t);
      osc.stop(t + safeDur + 0.015);
    } catch {
      // Never propagate audio errors to game loop
    }
  }

  private playNoise(duration: number, volume = 0.12, highpass = 800, delay = 0): void {
    if (this.activeVoices >= this.maxVoices) return;
    const ctx = this.getCtx();
    if (!ctx || !this.noiseBuffer) return;
    try {
      const safeDur = Math.min(0.38, Math.max(0.02, duration));
      const safeVol = Math.max(0.002, volume);
      const t = Math.max(ctx.currentTime, ctx.currentTime + Math.max(0, delay));
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(Math.max(60, highpass), t);
      filter.Q.setValueAtTime(1.2, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(safeVol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + safeDur);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      this.activeVoices++;
      src.onended = () => {
        this.activeVoices = Math.max(0, this.activeVoices - 1);
        try {
          src.disconnect();
          filter.disconnect();
          gain.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      };

      src.start(t, 0, safeDur + 0.01);
    } catch {
      // Never propagate audio errors to game loop
    }
  }

  public playThrow(): void {
    this.playTone(460, 210, 0.09, 'triangle', 0.13);
    this.playNoise(0.06, 0.08, 1800);
  }

  public playSnowHit(): void {
    this.playNoise(0.11, 0.18, 900);
    this.playTone(220, 95, 0.1, 'square', 0.11);
  }

  public playPlayerHurt(): void {
    this.playTone(260, 90, 0.18, 'sawtooth', 0.16);
    this.playTone(170, 75, 0.2, 'square', 0.12, 0.05);
  }

  public playDash(): void {
    this.playNoise(0.14, 0.14, 2400);
    this.playTone(320, 680, 0.12, 'triangle', 0.12);
  }

  public playRefillTick(): void {
    this.playNoise(0.05, 0.07, 1300);
  }

  public playRefillDone(): void {
    this.playTone(523, 523, 0.08, 'square', 0.11, 0);
    this.playTone(659, 659, 0.08, 'square', 0.11, 0.07);
    this.playTone(784, 1046, 0.16, 'triangle', 0.14, 0.14);
  }

  public playEmptyClick(): void {
    this.playTone(180, 120, 0.06, 'square', 0.08);
  }

  // Unianna: Time Freeze bass drop + crystal chime
  public playTimeFreeze(): void {
    this.playTone(480, 65, 0.45, 'sawtooth', 0.16);
    this.playTone(960, 440, 0.35, 'sine', 0.14, 0.06);
    this.playTone(1320, 1320, 0.12, 'triangle', 0.1, 0.18);
  }

  public playTimeResume(): void {
    this.playTone(140, 880, 0.22, 'sawtooth', 0.15);
    this.playNoise(0.18, 0.15, 3200, 0.04);
  }

  // Kuki: Cookie crunch + heal chime
  public playCookieHeal(): void {
    this.playNoise(0.07, 0.13, 1500, 0);
    this.playNoise(0.06, 0.11, 1700, 0.09);
    this.playTone(587, 587, 0.1, 'triangle', 0.13, 0.12);
    this.playTone(784, 784, 0.1, 'triangle', 0.13, 0.2);
    this.playTone(1046, 1174, 0.22, 'sine', 0.15, 0.28);
  }

  // Miyako: Ice Shield crystallize
  public playIceShield(): void {
    this.playTone(660, 1320, 0.16, 'sine', 0.13, 0);
    this.playTone(880, 1760, 0.22, 'triangle', 0.11, 0.08);
    this.playNoise(0.16, 0.09, 4200, 0.05);
  }

  public playShieldDeflect(): void {
    this.playTone(1240, 1860, 0.12, 'sine', 0.14);
    this.playTone(920, 1480, 0.1, 'triangle', 0.1, 0.03);
  }

  // Tessel: Iaido katana draw slash
  public playIaidoSlash(): void {
    this.playNoise(0.11, 0.18, 3400);
    this.playTone(1480, 380, 0.12, 'sawtooth', 0.13);
    this.playTone(2100, 1200, 0.1, 'sine', 0.09, 0.02);
  }

  public playIaidoCooldown(): void {
    this.playTone(440, 220, 0.16, 'triangle', 0.12);
    this.playTone(330, 165, 0.18, 'triangle', 0.1, 0.1);
  }

  public playBossSlam(): void {
    this.playTone(140, 38, 0.35, 'sawtooth', 0.22);
    this.playNoise(0.28, 0.22, 420);
  }

  public playItemPickup(isBook: boolean): void {
    if (isBook) {
      this.playTone(523, 523, 0.08, 'triangle', 0.13, 0);
      this.playTone(659, 659, 0.08, 'triangle', 0.13, 0.06);
      this.playTone(784, 784, 0.09, 'triangle', 0.13, 0.12);
      this.playTone(1174, 1568, 0.2, 'sine', 0.15, 0.18);
    } else {
      this.playTone(587, 880, 0.1, 'triangle', 0.13, 0);
      this.playTone(880, 1174, 0.14, 'sine', 0.14, 0.08);
    }
  }

  public playCritHit(): void {
    this.playTone(880, 1760, 0.09, 'square', 0.14, 0);
    this.playTone(320, 110, 0.14, 'sawtooth', 0.16, 0.02);
    this.playNoise(0.12, 0.18, 2200);
  }

  public playSlowFreeze(): void {
    this.playTone(960, 420, 0.14, 'sine', 0.11);
    this.playNoise(0.08, 0.08, 3600);
  }

  public playVictory(): void {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => this.playTone(n, n, 0.16, 'square', 0.1, i * 0.11));
  }

  public playDefeat(): void {
    const notes = [392, 349, 311, 261];
    notes.forEach((n, i) => this.playTone(n, n * 0.94, 0.22, 'sawtooth', 0.11, i * 0.14));
  }

  public startBgm(): void {
    this.bgmPlaying = true;
    if (this.muted) return;
    this.startBgmLoop();
  }

  public stopBgm(): void {
    if (this.bgmTimer !== null) {
      window.clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  private startBgmLoop(): void {
    this.stopBgm();
    const melody = [
      659, 0, 784, 659, 880, 0, 784, 659,
      587, 0, 659, 587, 523, 0, 392, 0,
      523, 659, 784, 0, 880, 784, 659, 523,
      587, 659, 587, 493, 523, 0, 0, 0,
    ];
    const bass = [
      261, 0, 196, 0, 220, 0, 196, 0,
      174, 0, 196, 0, 130, 0, 196, 0,
      261, 0, 196, 0, 220, 0, 174, 0,
      146, 0, 196, 0, 130, 0, 196, 0,
    ];

    this.bgmTimer = window.setInterval(() => {
      if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
      const idx = this.bgmStep % melody.length;
      const m = melody[idx];
      const b = bass[idx];
      if (m > 0) this.playTone(m, m, 0.14, 'triangle', 0.032);
      if (b > 0) this.playTone(b, b, 0.18, 'square', 0.018);
      this.bgmStep++;
    }, 190);
  }
}

export const sound = new SoundEngine();
