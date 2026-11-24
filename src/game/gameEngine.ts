import { updateBrawlFighterAI, updateEnemyAI } from '../ai/aiController';
import { GameAssets } from '../assets/assetLoader';
import { sound } from '../audio/soundEngine';
import { ADVENTURE_STAGES, CHARACTERS, CHARACTER_LIST } from '../data/characters';
import { ITEMS, pickWeightedRandomItem } from '../data/items';
import { CrashContextSnapshot, crashReporter } from '../debug/crashReporter';
import { InputManager, InputState } from '../input/inputManager';
import { getFighterSpriteFrame, Renderer25D } from '../render/renderer25D';
import { SkillContext, tryActivateSkill } from '../skills/skillSystem';
import {
  ActiveBuffInfo,
  Afterimage,
  BrawlSubMode,
  CharacterId,
  Enemy,
  EnemyKind,
  Fighter,
  FloatingText,
  Footprint,
  GAME_CONST,
  GameMode,
  GameScreen,
  HudSnapshot,
  IcePatch,
  ItemKind,
  Obstacle,
  Particle,
  PickupItem,
  SlashArc,
  Snowball,
  SnowflakeBg,
  TelegraphZone,
} from '../types';
import { GeneratedMap, generateSnowfieldMap } from '../world/mapGenerator';

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private assets: GameAssets;
  public input: InputManager;
  private renderer = new Renderer25D();
  private onHudUpdate: (snap: HudSnapshot) => void;

  private rafId = 0;
  private lastTimestamp = 0;
  private accumulator = 0;
  private hudThrottle = 0;
  private viewWidth = window.innerWidth;
  private viewHeight = window.innerHeight;
  private viewScale = 1;

  // Game selection & state
  public screen: GameScreen = 'menu';
  public selectedChar: CharacterId = 'unianna';
  public selectedMode: GameMode = 'adventure';
  public selectedBrawlSubMode: BrawlSubMode = 'elimination';

  // World entities
  private map!: GeneratedMap;
  private fighters: Fighter[] = [];
  private enemies: Enemy[] = [];
  private snowballs: Snowball[] = [];
  private pickupItems: PickupItem[] = [];
  private slashArcs: SlashArc[] = [];
  private telegraphs: TelegraphZone[] = [];
  private particles: Particle[] = [];
  private afterimages: Afterimage[] = [];
  private footprints: Footprint[] = [];
  private floatingTexts: FloatingText[] = [];
  private snowflakes: SnowflakeBg[] = [];

  // Counters & timers
  private nextSnowballId = 1;
  private nextEnemyId = 1;
  private nextItemId = 1;
  private itemSpawnTimer = 6;
  private time = 0;
  private hitStopTimer = 0;
  private screenShake = 0;
  private cameraX = 0;
  private cameraY = 0;

  // Unianna Time Freeze global state
  private timeFreezeTimer = 0;
  private timeFreezeOwnerId: string | null = null;
  private timeFreezeRipple = 0;

  // Adventure Mode progression
  private stageIndex = 0;
  private waveIndex = 0;
  private stageClearDelay = 0;
  private totalKills = 0;
  private elapsedMatchSeconds = 0;

  // Brawl Mode state
  private brawlTimer = 120; // 2 minutes for score mode

  // UI Banners & Results
  private bannerText = '';
  private bannerSub = '';
  private bannerTimer = 0;
  private resultTitle = '';
  private resultSummary: string[] = [];
  private aimPreviewAngle: number | null = null;
  private mobileSnowPileHoldLock = false;
  private loopHaltedByError = false;

  constructor(
    canvas: HTMLCanvasElement,
    assets: GameAssets,
    onHudUpdate: (snap: HudSnapshot) => void
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.assets = assets;
    this.onHudUpdate = onHudUpdate;
    this.input = new InputManager(canvas);

    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());

    this.initSnowflakes(1.2);
    this.setupMenuBackdrop();
    this.emitHud();
  }

  public startLoop(): void {
    this.loopHaltedByError = false;
    this.lastTimestamp = performance.now();
    const tick = (now: number) => {
      if (this.loopHaltedByError) return;
      try {
        const rawDt = Math.min(0.05, Math.max(0, (now - this.lastTimestamp) / 1000));
        this.lastTimestamp = now;

        this.accumulator += rawDt;
        let steps = 0;
        while (this.accumulator >= GAME_CONST.FIXED_DT && steps < 5) {
          this.fixedUpdate(GAME_CONST.FIXED_DT);
          this.accumulator -= GAME_CONST.FIXED_DT;
          steps++;
        }
        if (steps >= 5) this.accumulator = 0;

        this.render();

        this.hudThrottle += rawDt;
        if (this.hudThrottle >= 0.05) {
          this.hudThrottle = 0;
          this.emitHud();
        }
      } catch (err) {
        this.loopHaltedByError = true;
        crashReporter.report('gameLoop', err);
        return;
      }

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public pauseForCrash(): void {
    this.loopHaltedByError = true;
    cancelAnimationFrame(this.rafId);
  }

  public resumeAfterCrash(): void {
    if (!this.loopHaltedByError) return;
    this.accumulator = 0;
    this.startLoop();
  }

  public getCrashContext(): CrashContextSnapshot {
    const p = this.fighters.find((f) => f.isPlayer);
    return {
      screen: this.screen,
      mode: `${this.selectedMode}${this.selectedMode === 'brawl' ? `/${this.selectedBrawlSubMode}` : ''}`,
      stage: `${this.stageIndex + 1} (wave ${this.waveIndex + 1})`,
      charId: p?.charId ?? this.selectedChar,
      hp: p ? `${p.hp}/${p.maxHp} (alive=${p.alive})` : 'none',
      snowballs: p ? `${p.snowballs}/${p.maxSnowballs} book=${p.activeBook ?? 'none'}` : 'none',
      skillState: p
        ? `cd=${p.skillCd.toFixed(1)} active=${p.skillActiveTimer.toFixed(1)} shield=${p.iceShieldTimer.toFixed(1)} timeFreeze=${this.timeFreezeTimer.toFixed(1)}`
        : 'none',
      entities: `fighters=${this.fighters.length} enemies=${this.enemies.length} snowballs=${this.snowballs.length} items=${this.pickupItems.length} particles=${this.particles.length}`,
    };
  }

  public destroy(): void {
    cancelAnimationFrame(this.rafId);
    sound.stopBgm();
  }

  private handleResize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewWidth = Math.max(1, window.innerWidth || 1);
    this.viewHeight = Math.max(1, window.innerHeight || 1);
    this.canvas.width = Math.round(this.viewWidth * dpr);
    this.canvas.height = Math.round(this.viewHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Responsive zoom scale so mobile phones get a crisp readable field of view
    const minSide = Math.min(this.viewWidth, this.viewHeight);
    this.viewScale = minSide < 520 ? 0.8 : minSide < 740 ? 0.92 : 1.05;
  }

  private initSnowflakes(intensity: number): void {
    const count = Math.round(68 * intensity);
    this.snowflakes = [];
    for (let i = 0; i < count; i++) {
      const layer = (i % 3) as 0 | 1 | 2;
      this.snowflakes.push({
        x: Math.random() * this.viewWidth,
        y: Math.random() * this.viewHeight,
        layer,
        speedY: 28 + layer * 26 + Math.random() * 18,
        speedX: -12 - layer * 10 - Math.random() * 12,
        size: layer === 2 ? 4 : layer === 1 ? 3 : 2,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  private setupMenuBackdrop(): void {
    this.map = generateSnowfieldMap(1800, 1300, 2026, {
      isBossStage: false,
      hasIcePatches: true,
      isBrawl: true,
    });
    this.fighters = [];
    this.enemies = [];
    this.snowballs = [];
    this.particles = [];
    this.cameraX = this.map.width * 0.5 - this.viewWidth / (2 * this.viewScale);
    this.cameraY = this.map.height * 0.5 - this.viewHeight / (2 * this.viewScale);
  }

  public startNewGame(charId: CharacterId, mode: GameMode, brawlSubMode: BrawlSubMode): void {
    crashReporter.logEvent(`StartGame char=${charId} mode=${mode}/${brawlSubMode}`);
    sound.unlock();
    sound.startBgm();
    this.selectedChar = charId;
    this.selectedMode = mode;
    this.selectedBrawlSubMode = brawlSubMode;
    this.input.resetAll();

    this.totalKills = 0;
    this.elapsedMatchSeconds = 0;
    this.timeFreezeTimer = 0;
    this.timeFreezeOwnerId = null;
    this.hitStopTimer = 0;
    this.screenShake = 0;

    if (mode === 'adventure') {
      this.stageIndex = 0;
      this.loadAdventureStage(0, true);
    } else {
      this.loadBrawlMatch();
    }

    this.screen = 'playing';
    this.emitHud();
  }

  public restartCurrent(): void {
    this.startNewGame(this.selectedChar, this.selectedMode, this.selectedBrawlSubMode);
  }

  public returnToMenu(): void {
    this.screen = 'menu';
    this.input.resetAll();
    this.timeFreezeTimer = 0;
    this.timeFreezeOwnerId = null;
    this.setupMenuBackdrop();
    this.emitHud();
  }

  public togglePause(): void {
    if (this.screen === 'playing') {
      this.screen = 'paused';
      this.emitHud();
    } else if (this.screen === 'paused') {
      this.screen = 'playing';
      this.emitHud();
    }
  }

  public toggleMute(): void {
    sound.toggleMute();
    this.emitHud();
  }

  public toggleTouchControls(): void {
    this.input.setTouchMode(!this.input.touchMode);
    this.emitHud();
  }

  private createFighter(id: string, charId: CharacterId, isPlayer: boolean, team: number, x: number, y: number): Fighter {
    const def = CHARACTERS[charId];
    return {
      id,
      charId,
      isPlayer,
      name: def.nameZh,
      team,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: 19,
      hp: GAME_CONST.PLAYER_MAX_HP,
      maxHp: GAME_CONST.PLAYER_MAX_HP,
      snowballs: GAME_CONST.PLAYER_MAX_SNOWBALLS,
      maxSnowballs: GAME_CONST.PLAYER_MAX_SNOWBALLS,
      alive: true,
      respawnTimer: 0,
      kills: 0,
      deaths: 0,
      aimAngle: 0,
      facingDir: 'down',
      facingLeft: false,
      animTimer: Math.random() * 4,
      actionState: 'idle',
      actionTimer: 0,
      invincibleFrames: 0,
      throwCooldown: 0,
      dashTimer: 0,
      dashCd: 0,
      dashDirX: 1,
      dashDirY: 0,
      refillTimer: 0,
      isRefilling: false,
      nearSnowPileId: null,
      skillCd: 0,
      skillActiveTimer: 0,
      iceShieldTimer: 0,
      iaidoWindowTimer: 0,
      iaidoHitCount: 0,
      iaidoSwingCd: 0,
      speedBoostTimer: 0,
      slowTimer: 0,
      activeBook: null,
      bookTimer: 0,
      fullHpNotifyCd: 0,
      aiState: 'fight',
      aiTimer: 0.4,
      aiStrafeDir: Math.random() > 0.5 ? 1 : -1,
      aiTargetId: null,
      aiGoalX: x,
      aiGoalY: y,
    };
  }

  private loadAdventureStage(idx: number, freshPlayer: boolean): void {
    const cfg = ADVENTURE_STAGES[idx];
    this.stageIndex = idx;
    this.waveIndex = 0;
    this.stageClearDelay = 0;

    this.map = generateSnowfieldMap(cfg.mapWidth, cfg.mapHeight, 1001 + idx * 777, {
      isBossStage: cfg.isBossStage,
      hasIcePatches: cfg.hasIcePatches,
      isBrawl: false,
    });
    this.initSnowflakes(cfg.snowIntensity);

    const sp = this.map.spawnPoints[0];
    const prevPlayer = this.fighters.find((f) => f.isPlayer);
    const player = this.createFighter('player', this.selectedChar, true, 0, sp.x, sp.y);
    if (!freshPlayer && prevPlayer) {
      // Carry HP forward + bonus +2 hearts recovery between stages!
      player.hp = Math.min(GAME_CONST.PLAYER_MAX_HP, prevPlayer.hp + 2);
      player.kills = prevPlayer.kills;
    }

    this.fighters = [player];
    this.enemies = [];
    this.snowballs = [];
    this.pickupItems = [];
    this.itemSpawnTimer = 7.5;
    this.slashArcs = [];
    this.telegraphs = [];
    this.particles = [];
    this.afterimages = [];
    this.footprints = [];
    this.floatingTexts = [];
    this.timeFreezeTimer = 0;
    this.timeFreezeOwnerId = null;

    this.snapCameraTo(player.x, player.y);
    this.spawnAdventureWave(0);
    // Spawn 2 initial winter pickup items so players immediately discover power-ups!
    this.spawnRandomMapItem();
    this.spawnRandomMapItem();
    this.showBanner(cfg.title, cfg.subtitle, 3.2);
  }

  private spawnAdventureWave(wIdx: number): void {
    const cfg = ADVENTURE_STAGES[this.stageIndex];
    const wave = cfg.waves[wIdx];
    if (!wave) return;

    const player = this.fighters[0];
    const pickSafeSpot = (minDistFromPlayer: number): { x: number; y: number } => {
      for (let tries = 0; tries < 50; tries++) {
        const x = 140 + Math.random() * (this.map.width - 280);
        const y = 140 + Math.random() * (this.map.height - 280);
        if (Math.hypot(x - player.x, y - player.y) < minDistFromPlayer) continue;
        let blocked = false;
        for (const obs of this.map.obstacles) {
          if (Math.hypot(x - obs.x, y - obs.y) < Math.max(obs.radiusX, obs.radiusY) + 42) {
            blocked = true;
            break;
          }
        }
        if (!blocked) return { x, y };
      }
      return { x: this.map.width * 0.5, y: 200 };
    };

    for (let i = 0; i < wave.snowSprites; i++) {
      const p = pickSafeSpot(320);
      this.spawnEnemy('snow_sprite', p.x, p.y);
    }
    for (let i = 0; i < wave.yetis; i++) {
      const p = pickSafeSpot(360);
      this.spawnEnemy('yeti', p.x, p.y);
    }
    for (let i = 0; i < wave.frostMages; i++) {
      const p = pickSafeSpot(390);
      this.spawnEnemy('frost_mage', p.x, p.y);
    }
    if (wave.boss) {
      this.spawnEnemy('boss_frost_king', this.map.width * 0.5, this.map.height * 0.28);
    }
  }

  private spawnEnemy(kind: EnemyKind, x: number, y: number): void {
    const isBoss = kind === 'boss_frost_king';
    const maxHp =
      kind === 'boss_frost_king'
        ? 26
        : kind === 'yeti'
          ? 4
          : kind === 'frost_mage'
            ? 3
            : 2;
    const radius = isBoss ? 48 : kind === 'yeti' ? 28 : 20;

    this.enemies.push({
      id: `enemy_${this.nextEnemyId++}`,
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      radius,
      hp: maxHp,
      maxHp,
      alive: true,
      facingLeft: false,
      animTimer: Math.random() * 3,
      state: 'move',
      stateTimer: 0,
      attackCd: 0.9 + Math.random() * 1.0,
      hurtTimer: 0,
      invincibleFrames: 0,
      slowTimer: 0,
      phase: 1,
      bossPattern: 0,
      chargeDirX: 0,
      chargeDirY: 1,
    });
    this.spawnBurst(x, y, 22, '#9be8ff', isBoss ? 28 : 10, isBoss ? 180 : 90);
  }

  private loadBrawlMatch(): void {
    this.map = generateSnowfieldMap(1900, 1450, Math.floor(Math.random() * 99999) + 1, {
      isBossStage: false,
      hasIcePatches: true,
      isBrawl: true,
    });
    this.initSnowflakes(1.3);

    this.fighters = [];
    this.enemies = [];
    this.snowballs = [];
    this.pickupItems = [];
    this.itemSpawnTimer = 6.5;
    this.slashArcs = [];
    this.telegraphs = [];
    this.particles = [];
    this.afterimages = [];
    this.footprints = [];
    this.floatingTexts = [];
    this.brawlTimer = 120;

    // Put player first at spawn 0, then the other 3 characters as AI rivals at spawns 1..3
    const others = CHARACTER_LIST.filter((c) => c.id !== this.selectedChar);
    const ordered: CharacterId[] = [this.selectedChar, ...others.map((c) => c.id)];

    ordered.forEach((cid, i) => {
      const sp = this.map.spawnPoints[i % this.map.spawnPoints.length];
      const f = this.createFighter(
        i === 0 ? 'player' : `ai_${cid}`,
        cid,
        i === 0,
        i, // Unique team per fighter => Free-For-All!
        sp.x,
        sp.y
      );
      // Opening grace cooldown for AI skills so players aren't frozen on frame 1 of Brawl
      if (i > 0) {
        f.skillCd = 4.5 + Math.random() * 3.5;
      }
      this.fighters.push(f);
    });

    const player = this.fighters[0];
    this.snapCameraTo(player.x, player.y);
    // Spawn 3 opening items across the Brawl snowfield for contested pickups!
    this.spawnRandomMapItem();
    this.spawnRandomMapItem();
    this.spawnRandomMapItem();
    this.showBanner(
      this.selectedBrawlSubMode === 'elimination' ? '雪地大混战 · 生存淘汰' : '雪地大混战 · 2分钟积分赛',
      '四位主角各自为战！善用雪堆装填与专属技能夺冠！',
      3.0
    );
  }

  private showBanner(title: string, sub: string, duration = 2.6): void {
    this.bannerText = title;
    this.bannerSub = sub;
    this.bannerTimer = duration;
  }

  private snapCameraTo(x: number, y: number): void {
    const viewW = this.viewWidth / this.viewScale;
    const viewH = this.viewHeight / this.viewScale;
    this.cameraX = Math.max(0, Math.min(Math.max(0, this.map.width - viewW), x - viewW * 0.5));
    this.cameraY = Math.max(0, Math.min(Math.max(0, this.map.height - viewH), y - viewH * 0.5));
  }

  private fixedUpdate(dt: number): void {
    this.time += dt;

    // Gentle snow & camera drift on Menu
    if (this.screen === 'menu') {
      this.updateSnowflakes(dt, false);
      const viewW = this.viewWidth / this.viewScale;
      const viewH = this.viewHeight / this.viewScale;
      const cx = this.map.width * 0.5 + Math.cos(this.time * 0.16) * 240;
      const cy = this.map.height * 0.5 + Math.sin(this.time * 0.13) * 180;
      this.cameraX = Math.max(0, Math.min(Math.max(0, this.map.width - viewW), cx - viewW * 0.5));
      this.cameraY = Math.max(0, Math.min(Math.max(0, this.map.height - viewH), cy - viewH * 0.5));
      return;
    }

    const inputState = this.input.sample(this.cameraX, this.cameraY, this.viewScale);
    if (inputState.pauseJustPressed && (this.screen === 'playing' || this.screen === 'paused')) {
      this.togglePause();
      return;
    }

    if (this.screen !== 'playing') {
      this.updateSnowflakes(dt, false);
      return;
    }

    // Brief hit-stop freeze for juicy impact feel
    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - dt);
      return;
    }

    this.elapsedMatchSeconds += dt;
    if (this.bannerTimer > 0) this.bannerTimer = Math.max(0, this.bannerTimer - dt);
    if (this.screenShake > 0) this.screenShake = Math.max(0, this.screenShake - dt * 28);

    // Update Unianna Time Freeze timer & thaw trigger!
    const isTimeFrozen = this.timeFreezeTimer > 0;
    if (isTimeFrozen) {
      this.timeFreezeTimer = Math.max(0, this.timeFreezeTimer - dt);
      this.timeFreezeRipple = Math.min(1.5, this.timeFreezeRipple + dt * 2.2);
      if (this.timeFreezeTimer <= 0) {
        this.releaseFrozenSnowballs();
        this.timeFreezeOwnerId = null;
        this.timeFreezeRipple = 0;
      }
    }

    this.updateSnowflakes(dt, this.timeFreezeTimer > 0);

    // Update all Fighters (Player + Brawl AI)
    for (const f of this.fighters) {
      const frozenOut = this.timeFreezeTimer > 0 && f.id !== this.timeFreezeOwnerId;
      if (frozenOut) continue;

      if (!f.alive) {
        if (this.selectedMode === 'brawl' && this.selectedBrawlSubMode === 'score') {
          f.respawnTimer -= dt;
          if (f.respawnTimer <= 0) {
            const sp = this.map.spawnPoints[Math.floor(Math.random() * this.map.spawnPoints.length)];
            f.x = sp.x + (Math.random() - 0.5) * 40;
            f.y = sp.y + (Math.random() - 0.5) * 40;
            f.hp = f.maxHp;
            f.snowballs = f.maxSnowballs;
            f.alive = true;
            f.invincibleFrames = 60;
            this.spawnBurst(f.x, f.y, 20, CHARACTERS[f.charId].themeColor, 18, 150);
          }
        }
        continue;
      }

      if (f.isPlayer) {
        this.updatePlayerFighter(f, inputState, dt);
      } else {
        this.updateAiFighter(f, dt);
      }
    }

    // Update Adventure Enemies (frozen during Time Freeze!)
    if (this.timeFreezeTimer <= 0) {
      const aiWorld = this.createAiWorldAccess();
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (e.invincibleFrames > 0) e.invincibleFrames--;
        if (e.slowTimer > 0) e.slowTimer = Math.max(0, e.slowTimer - dt);
        updateEnemyAI(e, dt, aiWorld);
        this.integrateActorMovement(e, dt, false);
        // Contact damage if Yeti / Boss charges into player
        const player = this.fighters[0];
        if (player && player.alive) {
          const dist = Math.hypot(player.x - e.x, player.y - e.y);
          if (dist < player.radius + e.radius - 4) {
            const nx = dist > 0.1 ? (player.x - e.x) / dist : 1;
            const ny = dist > 0.1 ? (player.y - e.y) / dist : 0;
            this.damageFighter(player, 1, nx * 260, ny * 260, e.id);
          }
        }
      }
    }

    // Update Snowballs
    this.updateSnowballs(dt);

    // Update Pickup Items (spawning, bobbing, collection)
    this.updatePickupItems(dt);

    // Update Boss Telegraph Danger Zones (paused during Time Freeze!)
    if (this.timeFreezeTimer <= 0) {
      for (let i = this.telegraphs.length - 1; i >= 0; i--) {
        const tz = this.telegraphs[i];
        tz.elapsed += dt;
        if (tz.elapsed >= tz.duration) {
          this.detonateTelegraph(tz);
          this.telegraphs.splice(i, 1);
        }
      }
    }

    // Update VFX (slash arcs, particles, afterimages, footprints, floating texts)
    this.updateEffects(dt);

    // Smooth camera follow player:
    // - On mobile touch mode: zero aim look-ahead so tapping anywhere NEVER jolts or oscillates the camera!
    // - On PC: gentle deadzoned look-ahead toward mouse aim.
    const player = this.fighters.find((f) => f.isPlayer);
    if (player) {
      const viewW = this.viewWidth / this.viewScale;
      const viewH = this.viewHeight / this.viewScale;
      let lookX = 0;
      let lookY = 0;
      if (!this.input.touchMode && player.alive && inputState.hasAimPoint) {
        const aimDist = Math.hypot(inputState.aimWorldX - player.x, inputState.aimWorldY - player.y);
        if (aimDist > 85) {
          const factor = Math.min(1, (aimDist - 85) / 220);
          lookX = Math.cos(player.aimAngle) * 24 * factor;
          lookY = Math.sin(player.aimAngle) * 18 * factor;
        }
      }
      const targetCamX = Math.max(0, Math.min(Math.max(0, this.map.width - viewW), player.x + lookX - viewW * 0.5));
      const targetCamY = Math.max(0, Math.min(Math.max(0, this.map.height - viewH), player.y + lookY - viewH * 0.5));
      this.cameraX += (targetCamX - this.cameraX) * Math.min(1, dt * 8.5);
      this.cameraY += (targetCamY - this.cameraY) * Math.min(1, dt * 8.5);
    }

    // Mode Win / Loss & Stage Progression checks
    if (this.selectedMode === 'adventure') {
      this.checkAdventureProgress(dt);
    } else {
      this.checkBrawlProgress(dt);
    }
  }

  private updatePlayerFighter(f: Fighter, input: InputState, dt: number): void {
    this.tickFighterTimers(f, dt);

    // Release snow-pile hold lock once finger is lifted from canvas
    if (!input.touchCanvasHeld && !input.touchCanvasJustDown) {
      this.mobileSnowPileHoldLock = false;
    }

    // Mobile special feature: holding directly on a nearby snow pile on screen refills snowballs!
    let holdingSnowPileOnScreen = false;
    if (this.input.touchMode && (input.touchCanvasHeld || input.touchCanvasJustDown)) {
      if (this.isTouchingNearbySnowPile(f, input.aimWorldX, input.aimWorldY)) {
        if (f.snowballs < f.maxSnowballs || this.mobileSnowPileHoldLock) {
          holdingSnowPileOnScreen = true;
          this.mobileSnowPileHoldLock = true;
        }
      }
    }

    // Compute aim angle:
    // - PC mouse hover OR Mobile tap-anywhere on screen -> aim directly at that exact world point!
    this.aimPreviewAngle = null;
    if (input.tapMarkerWorld && !holdingSnowPileOnScreen) {
      // Crisp visual ripple right where the player tapped on mobile!
      this.particles.push({
        x: input.tapMarkerWorld.x,
        y: input.tapMarkerWorld.y,
        z: 2,
        vx: 0,
        vy: 0,
        vz: 0,
        size: 16,
        color: '#6ce5ff',
        alpha: 0.9,
        life: 0.22,
        maxLife: 0.22,
        gravity: 0,
        shape: 'ring',
      });
    }

    if (input.hasAimPoint && !holdingSnowPileOnScreen) {
      f.aimAngle = Math.atan2(input.aimWorldY - (f.y - 14), input.aimWorldX - f.x);
    } else if (Math.hypot(input.moveX, input.moveY) > 0.15) {
      f.aimAngle = Math.atan2(input.moveY, input.moveX);
    }

    this.updateFighterFacing(f, input.moveX, input.moveY);

    // Dash (Z / Mobile Dash)
    if (input.dashJustPressed) {
      const dx = Math.hypot(input.moveX, input.moveY) > 0.1 ? input.moveX : Math.cos(f.aimAngle);
      const dy = Math.hypot(input.moveX, input.moveY) > 0.1 ? input.moveY : Math.sin(f.aimAngle);
      this.triggerDash(f, dx, dy);
    }

    // Special Skill (X / E / Right-Click / Mobile Skill)
    if (input.skillJustPressed) {
      if (tryActivateSkill(f, this.createSkillContext())) {
        crashReporter.logEvent(`PlayerSkill char=${f.charId}`);
      }
    }

    // Snow Refill (Hold R / Mobile Refill button / Hold snow pile directly on screen for 1.0s)
    this.updateSnowRefill(f, input.refillHeld || holdingSnowPileOnScreen, dt);

    // Movement (disabled while actively holding snow refill, overridden during dash)
    this.applyFighterVelocity(f, f.isRefilling ? 0 : input.moveX, f.isRefilling ? 0 : input.moveY, dt);

    // Throw Snowball (suppressed while holding a snow pile on screen until finger lifts!)
    if (
      (input.throwJustPressed || input.throwHeld) &&
      !holdingSnowPileOnScreen &&
      !this.mobileSnowPileHoldLock &&
      !f.isRefilling &&
      f.dashTimer <= 0
    ) {
      this.tryFighterThrow(f);
    }
  }

  private isTouchingNearbySnowPile(f: Fighter, worldX: number, worldY: number): boolean {
    for (const obs of this.map.obstacles) {
      if (!obs.isSnowPile) continue;
      // Player must be within refill range of this snow pile
      if (Math.hypot(f.x - obs.x, f.y - obs.y) > GAME_CONST.REFILL_RADIUS) continue;
      // Finger world position hits the visual snow pile sprite (generous thumb hitbox)
      const dx = worldX - obs.x;
      const dy = worldY - (obs.y - 22);
      if (Math.hypot(dx, dy) <= 68) {
        return true;
      }
    }
    return false;
  }

  private updateAiFighter(ai: Fighter, dt: number): void {
    this.tickFighterTimers(ai, dt);
    const decision = updateBrawlFighterAI(ai, dt, this.createAiWorldAccess());

    this.updateFighterFacing(ai, decision.moveX, decision.moveY);

    if (decision.wantDash) {
      this.triggerDash(ai, decision.moveX || Math.cos(ai.aimAngle), decision.moveY || Math.sin(ai.aimAngle));
    }
    if (decision.wantSkill) {
      if (tryActivateSkill(ai, this.createSkillContext())) {
        crashReporter.logEvent(`AISkill char=${ai.charId}`);
      }
    }
    this.updateSnowRefill(ai, decision.wantRefill, dt);
    this.applyFighterVelocity(ai, ai.isRefilling ? 0 : decision.moveX, ai.isRefilling ? 0 : decision.moveY, dt);

    if (decision.wantThrow && !ai.isRefilling && ai.dashTimer <= 0) {
      this.tryFighterThrow(ai);
    }
  }

  private tickFighterTimers(f: Fighter, dt: number): void {
    f.animTimer += dt;
    if (f.invincibleFrames > 0) f.invincibleFrames--; // Exact 1 frame per 60Hz tick!
    if (f.throwCooldown > 0) f.throwCooldown = Math.max(0, f.throwCooldown - dt);
    if (f.dashCd > 0) f.dashCd = Math.max(0, f.dashCd - dt);
    if (f.skillCd > 0) f.skillCd = Math.max(0, f.skillCd - dt);
    if (f.skillActiveTimer > 0) f.skillActiveTimer = Math.max(0, f.skillActiveTimer - dt);
    if (f.iceShieldTimer > 0) f.iceShieldTimer = Math.max(0, f.iceShieldTimer - dt);
    if (f.iaidoSwingCd > 0) f.iaidoSwingCd = Math.max(0, f.iaidoSwingCd - dt);
    if (f.speedBoostTimer > 0) f.speedBoostTimer = Math.max(0, f.speedBoostTimer - dt);
    if (f.slowTimer > 0) f.slowTimer = Math.max(0, f.slowTimer - dt);
    if (f.fullHpNotifyCd > 0) f.fullHpNotifyCd = Math.max(0, f.fullHpNotifyCd - dt);
    if (f.bookTimer > 0) {
      f.bookTimer = Math.max(0, f.bookTimer - dt);
      if (f.bookTimer <= 0) {
        f.activeBook = null;
      }
    }

    // Tessel 5s rolling window reset if 3 hits not reached
    if (f.iaidoWindowTimer > 0) {
      f.iaidoWindowTimer = Math.max(0, f.iaidoWindowTimer - dt);
      if (f.iaidoWindowTimer <= 0) {
        f.iaidoHitCount = 0;
      }
    }

    if (f.actionTimer > 0) {
      f.actionTimer = Math.max(0, f.actionTimer - dt);
      if (f.actionTimer <= 0 && !f.isRefilling && f.dashTimer <= 0) {
        f.actionState = Math.hypot(f.vx, f.vy) > 16 ? 'walk' : 'idle';
      }
    }
  }

  private updateFighterFacing(f: Fighter, moveX: number, moveY: number): void {
    const refAngle = Math.hypot(moveX, moveY) > 0.15 && f.actionTimer <= 0 ? Math.atan2(moveY, moveX) : f.aimAngle;
    const cos = Math.cos(refAngle);
    const sin = Math.sin(refAngle);
    if (Math.abs(cos) >= Math.abs(sin) * 0.85) {
      f.facingDir = 'side';
      f.facingLeft = cos < 0;
    } else if (sin < 0) {
      f.facingDir = 'up';
    } else {
      f.facingDir = 'down';
    }
  }

  private triggerDash(f: Fighter, dx: number, dy: number): boolean {
    if (!f.alive || f.dashCd > 0 || f.dashTimer > 0) return false;
    const len = Math.hypot(dx, dy) || 1;
    f.dashDirX = dx / len;
    f.dashDirY = dy / len;
    f.dashTimer = GAME_CONST.DASH_DURATION;
    f.dashCd = GAME_CONST.DASH_CD; // Exact 3s CD
    f.isRefilling = false;
    f.refillTimer = 0;
    f.actionState = 'dash';
    f.actionTimer = GAME_CONST.DASH_DURATION;
    sound.playDash();
    this.spawnBurst(f.x, f.y, 8, '#ffffff', 10, 120);
    return true;
  }

  private updateSnowRefill(f: Fighter, holdInput: boolean, dt: number): void {
    // Check nearest snow pile within REFILL_RADIUS
    let nearestPile: Obstacle | null = null;
    let minDist: number = GAME_CONST.REFILL_RADIUS;
    for (const obs of this.map.obstacles) {
      if (!obs.isSnowPile) continue;
      const d = Math.hypot(f.x - obs.x, f.y - obs.y);
      if (d <= minDist) {
        minDist = d;
        nearestPile = obs;
      }
    }
    f.nearSnowPileId = nearestPile ? nearestPile.id : null;

    if (holdInput && nearestPile && f.snowballs < f.maxSnowballs && f.dashTimer <= 0) {
      const prevStep = Math.floor(f.refillTimer * 4);
      f.isRefilling = true;
      f.actionState = 'refill';
      f.refillTimer += dt;
      const currStep = Math.floor(f.refillTimer * 4);
      if (currStep > prevStep) {
        if (f.isPlayer) sound.playRefillTick();
        this.spawnBurst(f.x, f.y, 8, '#e8f7ff', 4, 65);
      }

      if (f.refillTimer >= GAME_CONST.REFILL_HOLD_SECONDS) {
        f.snowballs = f.maxSnowballs;
        f.refillTimer = 0;
        f.isRefilling = false;
        f.actionState = 'idle';
        if (f.isPlayer) sound.playRefillDone();
        this.spawnBurst(f.x, f.y, 16, '#8ce6ff', 16, 130);
        this.floatingTexts.push({
          x: f.x,
          y: f.y - 48,
          text: `❄️ 雪球已补满 (${f.maxSnowballs}/${f.maxSnowballs})`,
          color: '#8ce6ff',
          life: 1.0,
          maxLife: 1.0,
          size: 13,
        });
      }
    } else {
      if (f.isRefilling) {
        f.isRefilling = false;
        f.refillTimer = 0;
        if (f.actionTimer <= 0) f.actionState = 'idle';
      }
    }
  }

  private applyFighterVelocity(f: Fighter, moveX: number, moveY: number, dt: number): void {
    const onIce = this.isPointOnIce(f.x, f.y);

    if (f.dashTimer > 0) {
      f.dashTimer = Math.max(0, f.dashTimer - dt);
      f.vx = f.dashDirX * GAME_CONST.DASH_SPEED;
      f.vy = f.dashDirY * GAME_CONST.DASH_SPEED;
      // Spawn dash afterimages every 2 frames
      if (Math.floor(this.time * 60) % 2 === 0) {
        const frame = getFighterSpriteFrame(f);
        this.afterimages.push({
          charId: f.charId,
          x: f.x,
          y: f.y,
          col: frame.col,
          row: frame.row,
          flipX: frame.flipX,
          tint: CHARACTERS[f.charId].themeColor,
          life: 0.2,
          maxLife: 0.2,
        });
      }
    } else {
      const boostMult = f.speedBoostTimer > 0 ? GAME_CONST.ICE_CREAM_SPEED_MULT : 1.0;
      const slowMult = f.slowTimer > 0 ? 0.55 : 1.0;
      const speed = GAME_CONST.MOVE_SPEED * boostMult * slowMult;
      const targetVx = moveX * speed;
      const targetVy = moveY * speed;
      const accel = onIce ? 4.2 : 16.0; // Slippery inertia on ice patches!
      f.vx += (targetVx - f.vx) * Math.min(1, dt * accel);
      f.vy += (targetVy - f.vy) * Math.min(1, dt * accel);
      if (f.actionTimer <= 0 && !f.isRefilling) {
        f.actionState = Math.hypot(f.vx, f.vy) > 16 ? 'walk' : 'idle';
      }
      // Ice cream speed-boost breeze sparkles!
      if (f.speedBoostTimer > 0 && Math.hypot(f.vx, f.vy) > 40 && Math.random() < 0.38) {
        this.particles.push({
          x: f.x + (Math.random() - 0.5) * 18,
          y: f.y + (Math.random() - 0.5) * 10,
          z: 6 + Math.random() * 14,
          vx: -f.vx * 0.2,
          vy: -f.vy * 0.2,
          vz: 15,
          size: 4,
          color: '#70e4ff',
          alpha: 0.85,
          life: 0.24,
          maxLife: 0.24,
          gravity: 10,
          shape: 'square',
        });
      }
    }

    const oldX = f.x;
    const oldY = f.y;
    this.integrateActorMovement(f, dt, true);

    // Leave footprints in snow while moving (capped to prevent unbounded growth)
    const moved = Math.hypot(f.x - oldX, f.y - oldY);
    if (moved > 1.2 && !onIce && Math.random() < 0.22 && this.footprints.length < 140) {
      this.footprints.push({
        x: f.x + (Math.random() - 0.5) * 8,
        y: f.y + 3,
        angle: Math.atan2(f.vy, f.vx),
        life: 3.4,
        maxLife: 3.4,
      });
    }
  }

  private integrateActorMovement(
    actor: { x: number; y: number; vx: number; vy: number; radius: number },
    dt: number,
    isFighter: boolean
  ): void {
    actor.x += actor.vx * dt;
    actor.y += actor.vy * dt;

    // Keep inside map snowbank borders
    const margin = 76;
    actor.x = Math.max(margin, Math.min(this.map.width - margin, actor.x));
    actor.y = Math.max(margin + 24, Math.min(this.map.height - margin + 12, actor.y));

    // Resolve smooth elliptical collision against all movement-blocking obstacles
    for (const obs of this.map.obstacles) {
      if (!obs.blocksMovement) continue;
      const rx = obs.radiusX + actor.radius;
      const ry = obs.radiusY + actor.radius * 0.72;
      const dx = actor.x - obs.x;
      const dy = actor.y - obs.y;
      const nx = dx / rx;
      const ny = dy / ry;
      const distSq = nx * nx + ny * ny;
      if (distSq < 1 && distSq > 0.00001) {
        const dist = Math.sqrt(distSq);
        const push = (1 - dist) / dist;
        actor.x += dx * push;
        actor.y += dy * push;
      }
    }

    // Soft separation between fighters in Brawl
    if (isFighter) {
      for (const other of this.fighters) {
        if (!other.alive || (other as unknown) === actor) continue;
        const dx = actor.x - other.x;
        const dy = actor.y - other.y;
        const d = Math.hypot(dx, dy);
        const minD = actor.radius + other.radius;
        if (d < minD && d > 0.1) {
          const push = (minD - d) * 0.5;
          actor.x += (dx / d) * push;
          actor.y += (dy / d) * push;
        }
      }
    }
  }

  private isPointOnIce(x: number, y: number): boolean {
    for (const p of this.map.icePatches) {
      const dx = x - p.x;
      const dy = y - p.y;
      const c = Math.cos(-p.rotation);
      const s = Math.sin(-p.rotation);
      const lx = dx * c - dy * s;
      const ly = dx * s + dy * c;
      if ((lx * lx) / (p.rx * p.rx) + (ly * ly) / (p.ry * p.ry) <= 1) return true;
    }
    return false;
  }

  private tryFighterThrow(f: Fighter): void {
    if (f.throwCooldown > 0) return;
    const book = f.bookTimer > 0 ? f.activeBook : null;
    const isInfinite = book === 'book_infinite';

    if (!isInfinite && f.snowballs <= 0) {
      f.throwCooldown = 0.35;
      if (f.isPlayer) {
        sound.playEmptyClick();
        this.floatingTexts.push({
          x: f.x,
          y: f.y - 46,
          text: this.input.touchMode ? '没雪球啦! 去雪堆长按装填' : '没雪球啦! 去雪堆按住R补球',
          color: '#ffd166',
          life: 1.0,
          maxLife: 1.0,
          size: 12,
        });
      }
      return;
    }

    if (!isInfinite) {
      f.snowballs--;
    }
    f.throwCooldown = isInfinite ? GAME_CONST.THROW_CD * 0.65 : GAME_CONST.THROW_CD;
    f.actionState = 'throw';
    f.actionTimer = 0.2;
    this.updateFighterFacing(f, 0, 0);

    const isTimeFreezeShot = CHARACTERS[f.charId].id === 'unianna' && this.timeFreezeTimer > 0;

    if (book === 'book_spread') {
      // 绯红魔典：五发散弹！
      const offsets = [-0.32, -0.16, 0, 0.16, 0.32];
      for (const off of offsets) {
        this.spawnSnowball(
          f.id,
          f.team,
          f.x,
          f.y,
          f.aimAngle + off,
          GAME_CONST.SNOWBALL_SPEED * 0.96,
          GAME_CONST.SNOWBALL_DAMAGE,
          false,
          '#ffb3b3'
        );
      }
    } else if (book === 'book_infinite') {
      // 蔚蓝魔典：无限雪球连射！
      this.spawnSnowball(f.id, f.team, f.x, f.y, f.aimAngle, GAME_CONST.SNOWBALL_SPEED * 1.06, GAME_CONST.SNOWBALL_DAMAGE, false, '#9be8ff');
    } else if (book === 'book_slow') {
      // 紫晶魔典：极寒减速雪球！
      this.spawnSnowball(f.id, f.team, f.x, f.y, f.aimAngle, GAME_CONST.SNOWBALL_SPEED, GAME_CONST.SNOWBALL_DAMAGE, false, '#d8b4fe', {
        appliesSlow: true,
      });
    } else if (book === 'book_crit') {
      // 鎏金魔典：45% 概率 2 心暴击雪球！
      const crit = Math.random() < GAME_CONST.BOOK_CRIT_CHANCE;
      this.spawnSnowball(
        f.id,
        f.team,
        f.x,
        f.y,
        f.aimAngle,
        GAME_CONST.SNOWBALL_SPEED * (crit ? 1.16 : 1.02),
        crit ? 2 : GAME_CONST.SNOWBALL_DAMAGE,
        false,
        crit ? '#ffe066' : '#fef3c7',
        { isCrit: crit }
      );
    } else if (book === 'book_pierce') {
      // 翠绿魔典：疾风穿透雪球（可穿透 3 个目标）！
      this.spawnSnowball(f.id, f.team, f.x, f.y, f.aimAngle, GAME_CONST.SNOWBALL_SPEED * 1.35, GAME_CONST.SNOWBALL_DAMAGE, false, '#86efac', {
        pierceLeft: 3,
      });
    } else {
      const tint = isTimeFreezeShot ? '#fff2a8' : '#eef8ff';
      this.spawnSnowball(f.id, f.team, f.x, f.y, f.aimAngle, GAME_CONST.SNOWBALL_SPEED, GAME_CONST.SNOWBALL_DAMAGE, false, tint);
    }
    sound.playThrow();
  }

  private spawnSnowball(
    ownerId: string,
    team: number,
    x: number,
    y: number,
    angle: number,
    speed: number,
    damage: number,
    isGiant = false,
    tint = '#eef8ff',
    extras?: { appliesSlow?: boolean; isCrit?: boolean; pierceLeft?: number }
  ): void {
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const vz = isGiant ? 32 : 24;
    const startOffset = isGiant ? 28 : 20;

    // If thrown by Unianna during her Time Freeze, freeze in mid-air after emerging from her hand!
    const freezeOnLaunch = this.timeFreezeTimer > 0 && ownerId === this.timeFreezeOwnerId;

    this.snowballs.push({
      id: this.nextSnowballId++,
      ownerId,
      team,
      x: x + Math.cos(angle) * startOffset,
      y: y + Math.sin(angle) * startOffset,
      z: isGiant ? 26 : 18,
      vx,
      vy,
      vz,
      radius: isGiant ? 16 : extras?.isCrit ? 12 : 9,
      damage,
      isGiant,
      tint,
      life: 0,
      maxLife: isGiant ? 1.65 : extras?.pierceLeft ? 1.55 : 1.3,
      frozenByTimeStop: false,
      freezeDelay: freezeOnLaunch ? 0.045 : -1,
      storedVx: vx,
      storedVy: vy,
      storedVz: vz,
      appliesSlow: extras?.appliesSlow,
      isCrit: extras?.isCrit,
      pierceLeft: extras?.pierceLeft,
      hitIds: extras?.pierceLeft ? [] : undefined,
    });
  }

  private releaseFrozenSnowballs(): void {
    let releasedCount = 0;
    for (const sb of this.snowballs) {
      if (sb.frozenByTimeStop) {
        sb.frozenByTimeStop = false;
        sb.freezeDelay = -1;
        // Dramatic high-speed burst upon thaw!
        sb.vx = sb.storedVx * 1.25;
        sb.vy = sb.storedVy * 1.25;
        sb.vz = sb.storedVz;
        sb.life = 0;
        releasedCount++;
        this.spawnBurst(sb.x, sb.y, sb.z, '#ffe066', 8, 120);
      }
    }
    sound.playTimeResume();
    if (releasedCount > 0) {
      this.screenShake = Math.max(this.screenShake, 6);
    }
  }

  private updateSnowballs(dt: number): void {
    for (let i = this.snowballs.length - 1; i >= 0; i--) {
      const sb = this.snowballs[i];

      // Handle Unianna Time Freeze:
      // - Enemy/other snowballs freeze immediately while timeFreezeTimer > 0
      // - Unianna's own newly thrown snowballs fly ~20px out then lock into mid-air stasis until thaw!
      if (this.timeFreezeTimer > 0) {
        if (sb.ownerId !== this.timeFreezeOwnerId) {
          continue; // Frozen completely!
        }
        if (sb.frozenByTimeStop) {
          continue; // Hovering in place waiting for thaw!
        }
        if (sb.freezeDelay >= 0) {
          sb.freezeDelay -= dt;
          if (sb.freezeDelay <= 0) {
            sb.frozenByTimeStop = true;
            sb.vx = 0;
            sb.vy = 0;
            sb.vz = 0;
            this.spawnBurst(sb.x, sb.y, sb.z, '#ffe066', 5, 60);
            continue;
          }
        }
      }

      sb.life += dt;
      sb.x += sb.vx * dt;
      sb.y += sb.vy * dt;
      sb.z += sb.vz * dt;
      sb.vz -= 64 * dt; // Gentle 2.5D gravity arc

      // Trail snow particles
      if (Math.random() < 0.45) {
        this.particles.push({
          x: sb.x,
          y: sb.y,
          z: sb.z,
          vx: (Math.random() - 0.5) * 20,
          vy: (Math.random() - 0.5) * 20,
          vz: 10,
          size: sb.isGiant ? 5 : 3,
          color: sb.tint,
          alpha: 0.75,
          life: 0.18,
          maxLife: 0.18,
          gravity: 30,
          shape: 'square',
        });
      }

      // Hit ground or map boundary or expired
      if (
        sb.z <= 2 ||
        sb.life >= sb.maxLife ||
        sb.x < 40 ||
        sb.x > this.map.width - 40 ||
        sb.y < 40 ||
        sb.y > this.map.height - 40
      ) {
        this.spawnBurst(sb.x, sb.y, Math.max(4, sb.z), '#ffffff', sb.isGiant ? 12 : 6, 90);
        this.snowballs.splice(i, 1);
        continue;
      }

      // Obstacle collision (NOTE: fallen_log has blocksSnowball=false so snowballs fly right over it!)
      let hitObs = false;
      for (const obs of this.map.obstacles) {
        if (!obs.blocksSnowball) continue;
        const rx = obs.radiusX + sb.radius * 0.65;
        const ry = obs.radiusY + sb.radius * 0.65;
        const dx = sb.x - obs.x;
        const dy = sb.y - obs.y;
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
          hitObs = true;
          break;
        }
      }
      if (hitObs) {
        this.spawnBurst(sb.x, sb.y, sb.z, '#e8f7ff', sb.isGiant ? 14 : 8, 115);
        sound.playSnowHit();
        this.snowballs.splice(i, 1);
        continue;
      }

      // Hit Fighters
      let consumed = false;
      for (const f of this.fighters) {
        if (!f.alive || f.team === sb.team) continue;
        if (sb.hitIds && sb.hitIds.includes(f.id)) continue;
        const dist = Math.hypot(sb.x - f.x, sb.y - f.y);
        if (dist <= f.radius + sb.radius) {
          // If Miyako has Ice Shield active -> Deflect with ice crystals!
          if (f.iceShieldTimer > 0) {
            sound.playShieldDeflect();
            this.spawnBurst(sb.x, sb.y, sb.z, '#8ce6ff', 14, 160);
            this.floatingTexts.push({
              x: f.x,
              y: f.y - 46,
              text: '❄️ 免疫!',
              color: '#8ce6ff',
              life: 0.65,
              maxLife: 0.65,
              size: 13,
            });
            consumed = true;
            break;
          }
          // Skip hit if fighter is dashing (invincible during dash!) or in 30-frame i-frames
          if (f.dashTimer > 0 || f.invincibleFrames > 0) {
            continue;
          }
          const spd = Math.hypot(sb.vx, sb.vy) || 1;
          const hitOk = this.damageFighter(f, sb.damage, (sb.vx / spd) * 180, (sb.vy / spd) * 180, sb.ownerId, sb.isCrit);
          if (hitOk && sb.appliesSlow) {
            f.slowTimer = Math.max(f.slowTimer, GAME_CONST.BOOK_SLOW_EFFECT_SECONDS);
            sound.playSlowFreeze();
            this.spawnBurst(f.x, f.y, 18, '#c084fc', 12, 130);
            this.floatingTexts.push({ x: f.x, y: f.y - 62, text: '❄️ 减速!', color: '#d8b4fe', life: 0.9, maxLife: 0.9, size: 13 });
          }
          this.spawnBurst(sb.x, sb.y, sb.z, sb.isCrit ? '#ffe066' : sb.tint, sb.isCrit ? 18 : sb.isGiant ? 16 : 10, sb.isCrit ? 190 : 140);
          if (sb.pierceLeft && sb.pierceLeft > 1 && sb.hitIds) {
            sb.pierceLeft--;
            sb.hitIds.push(f.id);
          } else {
            consumed = true;
            break;
          }
        }
      }
      if (consumed) {
        this.snowballs.splice(i, 1);
        continue;
      }

      // Hit Adventure Enemies
      for (const e of this.enemies) {
        if (!e.alive || sb.team === 99) continue;
        if (sb.hitIds && sb.hitIds.includes(e.id)) continue;
        const dist = Math.hypot(sb.x - e.x, sb.y - e.y);
        if (dist <= e.radius + sb.radius) {
          const spd = Math.hypot(sb.vx, sb.vy) || 1;
          const hitOk = this.damageEnemy(e, sb.damage, (sb.vx / spd) * 165, (sb.vy / spd) * 165, sb.ownerId, sb.isCrit);
          if (hitOk && sb.appliesSlow) {
            e.slowTimer = Math.max(e.slowTimer, GAME_CONST.BOOK_SLOW_EFFECT_SECONDS);
            sound.playSlowFreeze();
            this.spawnBurst(e.x, e.y, 18, '#c084fc', 12, 130);
            this.floatingTexts.push({ x: e.x, y: e.y - 62, text: '❄️ 减速!', color: '#d8b4fe', life: 0.9, maxLife: 0.9, size: 13 });
          }
          this.spawnBurst(sb.x, sb.y, sb.z, sb.isCrit ? '#ffe066' : sb.tint, sb.isCrit ? 18 : 11, sb.isCrit ? 190 : 130);
          if (sb.pierceLeft && sb.pierceLeft > 1 && sb.hitIds) {
            sb.pierceLeft--;
            sb.hitIds.push(e.id);
          } else {
            consumed = true;
            break;
          }
        }
      }
      if (consumed) {
        this.snowballs.splice(i, 1);
      }
    }
  }

  private spawnRandomMapItem(): void {
    const player = this.fighters.find((f) => f.isPlayer);
    const preferHeal = !!player && player.hp <= 3;
    const kind = pickWeightedRandomItem(preferHeal);

    for (let tries = 0; tries < 40; tries++) {
      const x = 150 + Math.random() * (this.map.width - 300);
      const y = 150 + Math.random() * (this.map.height - 300);
      let blocked = false;
      for (const obs of this.map.obstacles) {
        if (Math.hypot(x - obs.x, y - obs.y) < Math.max(obs.radiusX, obs.radiusY) + 38) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        this.spawnItemAt(kind, x, y);
        return;
      }
    }
  }

  private spawnItemAt(kind: ItemKind, x: number, y: number): void {
    if (this.pickupItems.length >= 6) return;
    this.pickupItems.push({
      id: this.nextItemId++,
      kind,
      x,
      y,
      life: GAME_CONST.ITEM_LIFETIME,
      maxLife: GAME_CONST.ITEM_LIFETIME,
      bobPhase: Math.random() * Math.PI * 2,
    });
    this.spawnBurst(x, y, 16, ITEMS[kind].color, 10, 95);
  }

  private updatePickupItems(dt: number): void {
    // Periodic map item drops (paused during Time Freeze)
    if (this.timeFreezeTimer <= 0) {
      this.itemSpawnTimer -= dt;
      if (this.itemSpawnTimer <= 0) {
        this.itemSpawnTimer = this.selectedMode === 'brawl' ? 9.5 : 11.5;
        if (this.pickupItems.length < 5) {
          this.spawnRandomMapItem();
        }
      }
    }

    for (let i = this.pickupItems.length - 1; i >= 0; i--) {
      const item = this.pickupItems[i];
      if (this.timeFreezeTimer <= 0) {
        item.life -= dt;
        if (item.life <= 0) {
          this.pickupItems.splice(i, 1);
          continue;
        }
      }

      // Check fighter pickup
      let picked = false;
      for (const f of this.fighters) {
        if (!f.alive) continue;
        if (this.timeFreezeTimer > 0 && f.id !== this.timeFreezeOwnerId) continue;
        const dist = Math.hypot(f.x - item.x, f.y - item.y);
        if (dist <= f.radius + GAME_CONST.ITEM_PICKUP_RADIUS * 0.65) {
          if (this.applyItemPickup(f, item)) {
            picked = true;
            break;
          }
        }
      }
      if (picked) {
        this.pickupItems.splice(i, 1);
      }
    }
  }

  private applyItemPickup(f: Fighter, item: PickupItem): boolean {
    const def = ITEMS[item.kind];

    if (item.kind === 'bandage') {
      if (f.hp >= f.maxHp) {
        if (f.isPlayer && f.fullHpNotifyCd <= 0) {
          f.fullHpNotifyCd = 1.4;
          this.floatingTexts.push({
            x: item.x,
            y: item.y - 34,
            text: '🩹 血量已满',
            color: '#ffd166',
            life: 0.85,
            maxLife: 0.85,
            size: 12,
          });
        }
        return false; // Don't waste bandage at full HP!
      }
      f.hp = Math.min(f.maxHp, f.hp + 1);
      sound.playItemPickup(false);
      this.spawnBurst(f.x, f.y, 18, def.color, 16, 130);
      this.floatingTexts.push({
        x: f.x,
        y: f.y - 52,
        text: '🩹 绷带 +1 ♥',
        color: '#ff85a1',
        life: 1.2,
        maxLife: 1.2,
        size: 15,
      });
      return true;
    }

    if (item.kind === 'ice_cream') {
      f.speedBoostTimer = GAME_CONST.ICE_CREAM_DURATION;
      sound.playItemPickup(false);
      this.spawnBurst(f.x, f.y, 18, def.color, 18, 150);
      this.floatingTexts.push({
        x: f.x,
        y: f.y - 52,
        text: '🍦 冰淇淋·疾速 7s!',
        color: '#70e4ff',
        life: 1.3,
        maxLife: 1.3,
        size: 15,
      });
      return true;
    }

    if (item.kind === 'hot_cocoa') {
      f.snowballs = f.maxSnowballs;
      f.skillCd *= 0.5;
      f.dashCd *= 0.5;
      sound.playItemPickup(false);
      this.spawnBurst(f.x, f.y, 18, def.color, 18, 140);
      this.floatingTexts.push({
        x: f.x,
        y: f.y - 52,
        text: '☕ 热可可·满球&冷却减半!',
        color: '#ffbe76',
        life: 1.35,
        maxLife: 1.35,
        size: 14,
      });
      return true;
    }

    // 5 Color-Coded Magic Books!
    f.activeBook = item.kind;
    f.bookTimer = def.duration;
    if (item.kind === 'book_infinite' && f.snowballs < 1) {
      f.snowballs = f.maxSnowballs;
    }
    sound.playItemPickup(true);
    this.spawnBurst(f.x, f.y, 22, def.color, 22, 175);
    this.floatingTexts.push({
      x: f.x,
      y: f.y - 56,
      text: `${def.icon} ${def.nameZh}!`,
      color: def.color,
      life: 1.45,
      maxLife: 1.45,
      size: 15,
    });
    return true;
  }

  private detonateTelegraph(tz: TelegraphZone): void {
    sound.playBossSlam();
    this.screenShake = Math.max(this.screenShake, 9);
    this.spawnBurst(tz.x, tz.y, 12, '#8ce6ff', 26, 220);
    this.particles.push({
      x: tz.x,
      y: tz.y,
      z: 4,
      vx: 0,
      vy: 0,
      vz: 0,
      size: tz.radius,
      color: '#9be8ff',
      alpha: 0.9,
      life: 0.25,
      maxLife: 0.25,
      gravity: 0,
      shape: 'ring',
    });

    for (const f of this.fighters) {
      if (!f.alive || f.team === tz.ownerTeam) continue;
      const dist = Math.hypot(f.x - tz.x, f.y - tz.y);
      if (dist <= tz.radius + f.radius * 0.6) {
        const nx = dist > 0.1 ? (f.x - tz.x) / dist : 0;
        const ny = dist > 0.1 ? (f.y - tz.y) / dist : 1;
        this.damageFighter(f, tz.damage, nx * 240, ny * 240, tz.ownerId);
      }
    }
  }

  public damageFighter(target: Fighter, amount: number, knockX: number, knockY: number, attackerId: string, isCrit = false): boolean {
    if (!target.alive) return false;
    // Invincible during dash, 30-frame hit invincibility, or Miyako 5s Ice Shield!
    if (target.dashTimer > 0 || target.invincibleFrames > 0) return false;
    if (target.iceShieldTimer > 0) {
      sound.playShieldDeflect();
      this.spawnBurst(target.x, target.y, 20, '#8ce6ff', 14, 150);
      this.floatingTexts.push({
        x: target.x,
        y: target.y - 46,
        text: '❄️ 护盾免疫!',
        color: '#8ce6ff',
        life: 0.65,
        maxLife: 0.65,
        size: 13,
      });
      return false;
    }

    target.hp = Math.max(0, target.hp - amount);
    target.invincibleFrames = GAME_CONST.HIT_INVINCIBLE_FRAMES; // Exact 30 frames!
    target.isRefilling = false;
    target.refillTimer = 0;
    target.actionState = 'hurt';
    target.actionTimer = 0.28;
    target.vx += knockX;
    target.vy += knockY;

    if (isCrit) {
      sound.playCritHit();
      this.screenShake = Math.max(this.screenShake, 9);
    } else {
      sound.playPlayerHurt();
    }
    if (target.isPlayer) {
      this.screenShake = Math.max(this.screenShake, 8);
      this.hitStopTimer = 0.035;
    }

    this.floatingTexts.push({
      x: target.x,
      y: target.y - 46,
      text: isCrit ? `💥 暴击 -${amount} ♥` : `-${amount} ♥`,
      color: isCrit ? '#ffe066' : '#ff5b6e',
      life: 0.95,
      maxLife: 0.95,
      size: isCrit ? 17 : 15,
    });

    if (target.hp <= 0) {
      target.alive = false;
      target.deaths++;
      target.respawnTimer = 3.0;
      this.spawnBurst(target.x, target.y, 20, CHARACTERS[target.charId].themeColor, 26, 200);
      this.floatingTexts.push({
        x: target.x,
        y: target.y - 54,
        text: `${target.name} 退场!`,
        color: '#ffd166',
        life: 1.4,
        maxLife: 1.4,
        size: 15,
      });

      const attacker = this.fighters.find((f) => f.id === attackerId);
      if (attacker) {
        attacker.kills++;
        if (attacker.isPlayer) this.totalKills++;
      }
    }
    return true;
  }

  public damageEnemy(enemy: Enemy, amount: number, knockX: number, knockY: number, attackerId: string, isCrit = false): boolean {
    if (!enemy.alive || enemy.invincibleFrames > 0) return false;
    enemy.hp = Math.max(0, enemy.hp - amount);
    enemy.hurtTimer = enemy.kind === 'boss_frost_king' ? 0.08 : 0.22;
    enemy.invincibleFrames = 6;
    const kbScale = enemy.kind === 'boss_frost_king' ? 0.15 : enemy.kind === 'yeti' ? 0.5 : 1.0;
    enemy.vx += knockX * kbScale;
    enemy.vy += knockY * kbScale;

    if (isCrit) {
      sound.playCritHit();
      this.screenShake = Math.max(this.screenShake, 6);
    } else {
      sound.playSnowHit();
    }
    this.floatingTexts.push({
      x: enemy.x,
      y: enemy.y - (enemy.kind === 'boss_frost_king' ? 92 : 44),
      text: isCrit ? `💥 暴击 -${amount}!` : `-${amount}`,
      color: isCrit ? '#ffd93d' : '#ffe066',
      life: isCrit ? 0.9 : 0.65,
      maxLife: isCrit ? 0.9 : 0.65,
      size: isCrit ? 18 : enemy.kind === 'boss_frost_king' ? 17 : 14,
    });

    if (enemy.hp <= 0) {
      enemy.alive = false;
      this.totalKills++;
      const attacker = this.fighters.find((f) => f.id === attackerId);
      if (attacker) attacker.kills++;
      this.spawnBurst(enemy.x, enemy.y, 20, '#b8eeff', enemy.kind === 'boss_frost_king' ? 48 : 18, 190);
      // Chance to drop a winter pickup item on enemy defeat!
      if (enemy.kind !== 'boss_frost_king') {
        const dropChance = enemy.kind === 'snow_sprite' ? 0.24 : 0.48;
        if (Math.random() < dropChance) {
          const player = this.fighters.find((f) => f.isPlayer);
          this.spawnItemAt(pickWeightedRandomItem(!!player && player.hp <= 3), enemy.x, enemy.y);
        }
      }
      if (enemy.kind === 'boss_frost_king') {
        this.screenShake = 14;
        this.hitStopTimer = 0.09;
        sound.playVictory();
      }
    }
    return true;
  }

  private findNearestHostile(from: Fighter, maxDist: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bd = maxDist;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - from.x, e.y - from.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    for (const f of this.fighters) {
      if (!f.alive || f.id === from.id || f.team === from.team) continue;
      const d = Math.hypot(f.x - from.x, f.y - from.y);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  private checkAdventureProgress(dt: number): void {
    const player = this.fighters[0];
    if (!player || !player.alive) {
      this.screen = 'gameover';
      sound.playDefeat();
      this.resultTitle = '挑战失败';
      this.resultSummary = [
        `操控角色：${CHARACTERS[this.selectedChar].nameZh}`,
        `抵达关卡：${ADVENTURE_STAGES[this.stageIndex].title}`,
        `累计击败雪怪/精灵：${this.totalKills}`,
        `坚持时间：${Math.floor(this.elapsedMatchSeconds)} 秒`,
      ];
      this.emitHud();
      return;
    }

    const aliveEnemies = this.enemies.filter((e) => e.alive).length;
    if (aliveEnemies === 0) {
      const cfg = ADVENTURE_STAGES[this.stageIndex];
      if (this.waveIndex + 1 < cfg.waves.length) {
        this.waveIndex++;
        this.spawnAdventureWave(this.waveIndex);
        this.showBanner('新一波敌人来袭!', `第 ${this.waveIndex + 1} / ${cfg.waves.length} 波`, 2.0);
      } else {
        this.stageClearDelay += dt;
        if (this.stageClearDelay === dt) {
          sound.playVictory();
          this.showBanner(
            this.stageIndex === ADVENTURE_STAGES.length - 1 ? '🏆 极寒霜王已被击败!' : '✨ 关卡清空!',
            this.stageIndex === ADVENTURE_STAGES.length - 1 ? '雪地恢复了宁静！' : '准备前往下一片雪原 (+2 ♥)...',
            2.2
          );
        }
        if (this.stageClearDelay >= 2.2) {
          if (this.stageIndex + 1 < ADVENTURE_STAGES.length) {
            this.loadAdventureStage(this.stageIndex + 1, false);
          } else {
            this.screen = 'victory';
            this.resultTitle = '🎉 冒险通关胜利!';
            this.resultSummary = [
              `通关角色：${CHARACTERS[this.selectedChar].nameZh} (${CHARACTERS[this.selectedChar].nameEn})`,
              `击败敌人总数：${this.totalKills}`,
              `总耗时：${Math.floor(this.elapsedMatchSeconds)} 秒`,
              `剩余生命：${player.hp} / ${player.maxHp} ♥`,
            ];
            this.emitHud();
          }
        }
      }
    }
  }

  private checkBrawlProgress(dt: number): void {
    const player = this.fighters.find((f) => f.isPlayer);
    if (!player) return;

    if (this.selectedBrawlSubMode === 'elimination') {
      const aliveFighters = this.fighters.filter((f) => f.alive);
      if (!player.alive) {
        this.screen = 'gameover';
        sound.playDefeat();
        this.resultTitle = '混战落败';
        this.resultSummary = [
          `操控角色：${player.name}`,
          `本局淘汰人数：${player.kills}`,
          `剩余存活者：${aliveFighters.map((f) => f.name).join('、') || '无'}`,
        ];
        this.emitHud();
        return;
      }
      if (aliveFighters.length <= 1) {
        this.screen = 'victory';
        sound.playVictory();
        this.resultTitle = '👑 雪地混战冠军!';
        this.resultSummary = [
          `最终胜者：${player.name} (${CHARACTERS[player.charId].nameEn})`,
          `淘汰对手：${player.kills}`,
          `剩余生命：${player.hp} / ${player.maxHp} ♥`,
          `用时：${Math.floor(this.elapsedMatchSeconds)} 秒`,
        ];
        this.emitHud();
      }
    } else {
      // 2-minute Score Brawl
      this.brawlTimer = Math.max(0, this.brawlTimer - dt);
      if (this.brawlTimer <= 0) {
        const sorted = [...this.fighters].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
        const winner = sorted[0];
        const playerWon = winner.id === player.id;
        this.screen = playerWon ? 'victory' : 'gameover';
        if (playerWon) sound.playVictory();
        else sound.playDefeat();
        this.resultTitle = playerWon ? '👑 积分混战夺冠!' : `🏆 冠军：${winner.name}`;
        this.resultSummary = sorted.map(
          (f, i) => `#${i + 1} ${f.name}${f.isPlayer ? ' (你)' : ''} — 击倒 ${f.kills} / 退场 ${f.deaths}`
        );
        this.emitHud();
      }
    }
  }

  private updateSnowflakes(dt: number, frozen: boolean): void {
    if (frozen) return;
    for (const s of this.snowflakes) {
      s.y += s.speedY * dt;
      s.x += (s.speedX + Math.sin(this.time * 1.6 + s.phase) * 14) * dt;
      if (s.y > this.viewHeight + 8) {
        s.y = -6;
        s.x = Math.random() * this.viewWidth;
      }
      if (s.x < -8) s.x = this.viewWidth + 6;
      if (s.x > this.viewWidth + 8) s.x = -6;
    }
  }

  private updateEffects(dt: number): void {
    for (let i = this.slashArcs.length - 1; i >= 0; i--) {
      this.slashArcs[i].life -= dt;
      if (this.slashArcs[i].life <= 0) this.slashArcs.splice(i, 1);
    }

    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      this.afterimages[i].life -= dt;
      if (this.afterimages[i].life <= 0) this.afterimages.splice(i, 1);
    }

    for (let i = this.footprints.length - 1; i >= 0; i--) {
      this.footprints[i].life -= dt;
      if (this.footprints[i].life <= 0) this.footprints.splice(i, 1);
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life -= dt;
      ft.y -= 28 * dt;
      if (ft.life <= 0) this.floatingTexts.splice(i, 1);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z = Math.max(0, p.z + p.vz * dt);
      p.vz -= p.gravity * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  public spawnBurst(x: number, y: number, z: number, color: string, count: number, speed = 130): void {
    // Hard cap particles so rapid skill/book combos never exhaust mobile memory
    const maxParticles = 320;
    const room = Math.max(0, maxParticles - this.particles.length);
    const actualCount = Math.min(count, room);
    for (let i = 0; i < actualCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = speed * (0.35 + Math.random() * 0.75);
      this.particles.push({
        x,
        y,
        z,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        vz: 40 + Math.random() * 90,
        size: 3 + Math.random() * 4,
        color,
        alpha: 1,
        life: 0.25 + Math.random() * 0.3,
        maxLife: 0.55,
        gravity: 240,
        shape: Math.random() > 0.4 ? 'square' : 'circle',
      });
    }
  }

  private createSkillContext(): SkillContext {
    const self = this;
    return {
      fighters: this.fighters,
      enemies: this.enemies,
      snowballs: this.snowballs,
      slashArcs: this.slashArcs,
      particles: this.particles,
      floatingTexts: this.floatingTexts,
      get timeFreezeTimer() {
        return self.timeFreezeTimer;
      },
      set timeFreezeTimer(v: number) {
        self.timeFreezeTimer = v;
      },
      get timeFreezeOwnerId() {
        return self.timeFreezeOwnerId;
      },
      set timeFreezeOwnerId(v: string | null) {
        self.timeFreezeOwnerId = v;
      },
      get timeFreezeRipple() {
        return self.timeFreezeRipple;
      },
      set timeFreezeRipple(v: number) {
        self.timeFreezeRipple = v;
      },
      get screenShake() {
        return self.screenShake;
      },
      set screenShake(v: number) {
        self.screenShake = v;
      },
      damageFighter: (t, a, kx, ky, id) => this.damageFighter(t, a, kx, ky, id),
      damageEnemy: (t, a, kx, ky, id) => this.damageEnemy(t, a, kx, ky, id),
      spawnBurst: (x, y, z, c, n, s) => this.spawnBurst(x, y, z, c, n, s),
    };
  }

  private createAiWorldAccess() {
    return {
      mapWidth: this.map.width,
      mapHeight: this.map.height,
      obstacles: this.map.obstacles,
      fighters: this.fighters,
      enemies: this.enemies,
      snowballs: this.snowballs,
      pickupItems: this.pickupItems,
      telegraphs: this.telegraphs,
      throwSnowball: (
        ownerId: string,
        team: number,
        x: number,
        y: number,
        angle: number,
        speed: number,
        damage: number,
        isGiant = false,
        tint = '#eef8ff'
      ) => this.spawnSnowball(ownerId, team, x, y, angle, speed, damage, isGiant, tint),
      triggerDash: (f: Fighter, dx: number, dy: number) => this.triggerDash(f, dx, dy),
      triggerSkill: (f: Fighter) => tryActivateSkill(f, this.createSkillContext()),
      spawnEnemy: (kind: 'snow_sprite' | 'yeti' | 'frost_mage', x: number, y: number) => this.spawnEnemy(kind, x, y),
      spawnBurst: (x: number, y: number, z: number, color: string, count: number, speed?: number) =>
        this.spawnBurst(x, y, z, color, count, speed),
      addFloatingText: (x: number, y: number, text: string, color: string, size = 14) => {
        this.floatingTexts.push({ x, y, text, color, life: 1.2, maxLife: 1.2, size });
      },
    };
  }

  private render(): void {
    const shakeX = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake * 1.8 : 0;
    const shakeY = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake * 1.8 : 0;

    this.renderer.render(
      this.ctx,
      this.viewWidth,
      this.viewHeight,
      {
        mapWidth: this.map.width,
        mapHeight: this.map.height,
        groundPatternCanvas: this.map.groundPatternCanvas,
        obstacles: this.map.obstacles,
        icePatches: this.map.icePatches,
        fighters: this.fighters,
        enemies: this.enemies,
        snowballs: this.snowballs,
        pickupItems: this.pickupItems,
        slashArcs: this.slashArcs,
        telegraphs: this.telegraphs,
        particles: this.particles,
        afterimages: this.afterimages,
        footprints: this.footprints,
        floatingTexts: this.floatingTexts,
        snowflakes: this.snowflakes,
        cameraX: this.cameraX,
        cameraY: this.cameraY,
        viewScale: this.viewScale,
        shakeOffsetX: shakeX,
        shakeOffsetY: shakeY,
        time: this.time,
        timeFreezeTimer: this.timeFreezeTimer,
        timeFreezeOwnerId: this.timeFreezeOwnerId,
        timeFreezeRipple: this.timeFreezeRipple,
        aimPreviewAngle: this.aimPreviewAngle,
      },
      this.assets
    );
  }

  private emitHud(): void {
    const p = this.fighters.find((f) => f.isPlayer);
    const charDef = CHARACTERS[p ? p.charId : this.selectedChar];
    const bossEntity = this.enemies.find((e) => e.alive && e.kind === 'boss_frost_king');
    const stageCfg = ADVENTURE_STAGES[this.stageIndex] ?? ADVENTURE_STAGES[0];

    const buffs: ActiveBuffInfo[] = [];
    if (p) {
      if (p.speedBoostTimer > 0) {
        buffs.push({
          id: 'ice_cream',
          icon: ITEMS.ice_cream.icon,
          label: ITEMS.ice_cream.shortLabel,
          remaining: p.speedBoostTimer,
          maxDuration: ITEMS.ice_cream.duration,
          color: ITEMS.ice_cream.color,
        });
      }
      if (p.activeBook && p.bookTimer > 0) {
        const bdef = ITEMS[p.activeBook];
        buffs.push({
          id: p.activeBook,
          icon: bdef.icon,
          label: bdef.shortLabel,
          remaining: p.bookTimer,
          maxDuration: bdef.duration,
          color: bdef.color,
        });
      }
      if (p.slowTimer > 0) {
        buffs.push({
          id: 'slow_debuff',
          icon: '❄️',
          label: '减速中',
          remaining: p.slowTimer,
          maxDuration: GAME_CONST.BOOK_SLOW_EFFECT_SECONDS,
          color: '#c084fc',
        });
      }
    }

    this.onHudUpdate({
      screen: this.screen,
      mode: this.selectedMode,
      brawlSubMode: this.selectedBrawlSubMode,
      player: {
        charId: p ? p.charId : this.selectedChar,
        hp: p ? p.hp : GAME_CONST.PLAYER_MAX_HP,
        maxHp: p ? p.maxHp : GAME_CONST.PLAYER_MAX_HP,
        snowballs: p ? p.snowballs : GAME_CONST.PLAYER_MAX_SNOWBALLS,
        maxSnowballs: p ? p.maxSnowballs : GAME_CONST.PLAYER_MAX_SNOWBALLS,
        dashCd: p ? p.dashCd : 0,
        dashMaxCd: GAME_CONST.DASH_CD,
        skillCd: p ? p.skillCd : 0,
        skillMaxCd: charDef.skillCd,
        skillActiveTimer: p ? p.skillActiveTimer : 0,
        skillDuration: charDef.skillDuration,
        iaidoHitCount: p ? p.iaidoHitCount : 0,
        iaidoWindowTimer: p ? p.iaidoWindowTimer : 0,
        nearSnowPile: p ? p.nearSnowPileId !== null : false,
        refillProgress: p ? Math.min(1, p.refillTimer / GAME_CONST.REFILL_HOLD_SECONDS) : 0,
        alive: p ? p.alive : true,
        respawnTimer: p ? p.respawnTimer : 0,
        buffs,
      },
      stageNum: this.stageIndex + 1,
      stageTotal: ADVENTURE_STAGES.length,
      stageTitle: stageCfg.title,
      enemiesRemaining: this.enemies.filter((e) => e.alive).length,
      boss: bossEntity
        ? {
            name: bossEntity.phase === 2 ? '极寒霜王 · 暴走' : '极寒霜王',
            hp: bossEntity.hp,
            maxHp: bossEntity.maxHp,
            phase: bossEntity.phase,
          }
        : null,
      brawlTimer: this.brawlTimer,
      brawlBoard: this.fighters.map((f) => ({
        charId: f.charId,
        name: f.name,
        hp: f.hp,
        maxHp: f.maxHp,
        alive: f.alive,
        kills: f.kills,
        isPlayer: f.isPlayer,
      })),
      bannerText: this.bannerTimer > 0 ? this.bannerText : '',
      bannerSub: this.bannerTimer > 0 ? this.bannerSub : '',
      resultTitle: this.resultTitle,
      resultSummary: this.resultSummary,
      timeFreezeActive: this.timeFreezeTimer > 0,
      muted: sound.isMuted(),
      touchEnabled: this.input.touchMode,
    });
  }
}
