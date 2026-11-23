export type CharacterId = 'unianna' | 'kuki' | 'miyako' | 'tessel';
export type GameMode = 'adventure' | 'brawl';
export type BrawlSubMode = 'elimination' | 'score';
export type GameScreen = 'menu' | 'playing' | 'paused' | 'victory' | 'gameover';

export type ObstacleKind =
  | 'tree_large'
  | 'tree_small'
  | 'rock_large'
  | 'rock_medium'
  | 'snow_pile'
  | 'snow_fort'
  | 'fallen_log'
  | 'stump_crystal';

export type EnemyKind = 'snow_sprite' | 'yeti' | 'frost_mage' | 'boss_frost_king';

export type MagicBookKind =
  | 'book_spread'
  | 'book_infinite'
  | 'book_slow'
  | 'book_crit'
  | 'book_pierce';

export type ItemKind = 'bandage' | 'ice_cream' | 'hot_cocoa' | MagicBookKind;

export interface ItemDef {
  id: ItemKind;
  nameZh: string;
  shortLabel: string;
  icon: string;
  desc: string;
  color: string;
  duration: number; // 0 for instant consumables
  isBook: boolean;
}

export interface PickupItem {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  bobPhase: number;
}

export interface ActiveBuffInfo {
  id: string;
  icon: string;
  label: string;
  remaining: number;
  maxDuration: number;
  color: string;
}

export interface CharacterDef {
  id: CharacterId;
  nameZh: string;
  nameEn: string;
  skillName: string;
  skillIcon: string;
  skillDesc: string;
  skillCd: number; // seconds (for Tessel, 10s when 3 hits in 5s)
  skillDuration: number; // seconds (0 if instant/melee)
  themeColor: string;
  accentColor: string;
  spritePath: string;
}

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number; // ground center X
  y: number; // ground anchor Y (used for 2.5D Y-sort)
  radiusX: number; // elliptical/circle foot collision half-width
  radiusY: number; // elliptical foot collision half-height
  blocksMovement: boolean;
  blocksSnowball: boolean;
  isSnowPile: boolean;
  canopyHeight: number; // > 0 means tall canopy that fades when player walks behind
  drawWidth: number;
  drawHeight: number;
}

export interface IcePatch {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rotation: number;
}

export interface Fighter {
  id: string;
  charId: CharacterId;
  isPlayer: boolean;
  name: string;
  team: number; // 0 = player in adventure; in brawl each fighter has unique team 0..3
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  snowballs: number;
  maxSnowballs: number;
  alive: boolean;
  respawnTimer: number;
  kills: number;
  deaths: number;

  // Facing & animation
  aimAngle: number;
  facingDir: 'down' | 'up' | 'side';
  facingLeft: boolean;
  animTimer: number;
  actionState: 'idle' | 'walk' | 'throw' | 'dash' | 'refill' | 'skill' | 'hurt';
  actionTimer: number;

  // Combat timers
  invincibleFrames: number; // exact 30 frames on hit!
  throwCooldown: number;

  // Dash (3s CD, invincible during dash)
  dashTimer: number;
  dashCd: number;
  dashDirX: number;
  dashDirY: number;

  // Snow refill (hold 1.5s near snow pile)
  refillTimer: number;
  isRefilling: boolean;
  nearSnowPileId: number | null;

  // Character special skill state
  skillCd: number;
  skillActiveTimer: number;
  iceShieldTimer: number; // Miyako 5s immunity
  // Tessel Iaido 5s / 3-hit tracker
  iaidoWindowTimer: number;
  iaidoHitCount: number;
  iaidoSwingCd: number;

  // Pickup item buffs & debuffs
  speedBoostTimer: number; // Ice Cream speed boost
  slowTimer: number; // Slowed by enemy/rival Purple Book
  activeBook: MagicBookKind | null;
  bookTimer: number;
  fullHpNotifyCd: number;

  // AI memory
  aiState: 'fight' | 'refill' | 'retreat' | 'chase';
  aiTimer: number;
  aiStrafeDir: number;
  aiTargetId: string | null;
  aiGoalX: number;
  aiGoalY: number;
}

export interface Enemy {
  id: string;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  facingLeft: boolean;
  animTimer: number;
  state: 'idle' | 'move' | 'windup' | 'attack' | 'charge' | 'hurt' | 'enrage';
  stateTimer: number;
  attackCd: number;
  hurtTimer: number;
  invincibleFrames: number;
  slowTimer: number;
  // Boss specifics
  phase: 1 | 2;
  bossPattern: number;
  chargeDirX: number;
  chargeDirY: number;
}

export interface Snowball {
  id: number;
  ownerId: string;
  team: number;
  x: number;
  y: number;
  z: number; // 2.5D elevation above ground
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  damage: number;
  isGiant: boolean;
  tint: string;
  life: number;
  maxLife: number;
  // Unianna time freeze stasis
  frozenByTimeStop: boolean;
  freezeDelay: number; // brief 0.04s travel out of hand before snapping into stasis
  storedVx: number;
  storedVy: number;
  storedVz: number;
  // Magic book modifiers
  appliesSlow?: boolean;
  isCrit?: boolean;
  pierceLeft?: number;
  hitIds?: string[];
}

export interface SlashArc {
  x: number;
  y: number;
  angle: number;
  radius: number;
  arcSpread: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface TelegraphZone {
  x: number;
  y: number;
  radius: number;
  elapsed: number;
  duration: number;
  damage: number;
  ownerTeam: number;
  ownerId: string;
  kind: 'slam' | 'ice_ring';
}

export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  gravity: number;
  shape: 'square' | 'circle' | 'ring' | 'star';
}

export interface Afterimage {
  charId: CharacterId;
  x: number;
  y: number;
  col: number;
  row: number;
  flipX: boolean;
  tint: string;
  life: number;
  maxLife: number;
}

export interface Footprint {
  x: number;
  y: number;
  angle: number;
  life: number;
  maxLife: number;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

export interface SnowflakeBg {
  x: number;
  y: number;
  layer: 0 | 1 | 2;
  speedY: number;
  speedX: number;
  size: number;
  phase: number;
}

export interface StageConfig {
  stageNum: number;
  title: string;
  subtitle: string;
  mapWidth: number;
  mapHeight: number;
  isBossStage: boolean;
  hasIcePatches: boolean;
  snowIntensity: number;
  waves: Array<{
    snowSprites: number;
    yetis: number;
    frostMages: number;
    boss?: boolean;
  }>;
}

export interface HudSnapshot {
  screen: GameScreen;
  mode: GameMode;
  brawlSubMode: BrawlSubMode;
  player: {
    charId: CharacterId;
    hp: number;
    maxHp: number;
    snowballs: number;
    maxSnowballs: number;
    dashCd: number;
    dashMaxCd: number;
    skillCd: number;
    skillMaxCd: number;
    skillActiveTimer: number;
    skillDuration: number;
    iaidoHitCount: number;
    iaidoWindowTimer: number;
    nearSnowPile: boolean;
    refillProgress: number;
    alive: boolean;
    respawnTimer: number;
    buffs: ActiveBuffInfo[];
  };
  stageNum: number;
  stageTotal: number;
  stageTitle: string;
  enemiesRemaining: number;
  boss: { name: string; hp: number; maxHp: number; phase: 1 | 2 } | null;
  brawlTimer: number;
  brawlBoard: Array<{
    charId: CharacterId;
    name: string;
    hp: number;
    maxHp: number;
    alive: boolean;
    kills: number;
    isPlayer: boolean;
  }>;
  bannerText: string;
  bannerSub: string;
  resultTitle: string;
  resultSummary: string[];
  timeFreezeActive: boolean;
  muted: boolean;
  touchEnabled: boolean;
}

// Fixed gameplay constants matching user specification
export const GAME_CONST = {
  FIXED_DT: 1 / 60,
  PLAYER_MAX_HP: 5,
  PLAYER_MAX_SNOWBALLS: 5,
  SNOWBALL_DAMAGE: 1,
  HIT_INVINCIBLE_FRAMES: 30, // Exactly 30 frames!
  REFILL_HOLD_SECONDS: 1.5, // Hold R / button for 1.5s
  REFILL_RADIUS: 82,
  DASH_CD: 3.0, // 3s CD
  DASH_DURATION: 0.18,
  DASH_SPEED: 620,
  MOVE_SPEED: 205,
  SNOWBALL_SPEED: 490,
  THROW_CD: 0.24,
  UNIANNA_FREEZE_DURATION: 5.0,
  UNIANNA_FREEZE_CD: 20.0,
  KUKI_COOKIE_CD: 8.0,
  MIYAKO_SHIELD_DURATION: 5.0,
  MIYAKO_SHIELD_CD: 20.0,
  TESSEL_IAIDO_WINDOW: 5.0,
  TESSEL_IAIDO_MAX_HITS: 3,
  TESSEL_IAIDO_CD: 10.0,
  TESSEL_IAIDO_SWING_CD: 0.24,
  TESSEL_IAIDO_RANGE: 96,
  TESSEL_IAIDO_ARC: Math.PI * 0.78,
  // Pickup item durations & tuning
  ICE_CREAM_DURATION: 7.0,
  ICE_CREAM_SPEED_MULT: 1.42,
  BOOK_SPREAD_DURATION: 8.0,
  BOOK_INFINITE_DURATION: 8.0,
  BOOK_SLOW_DURATION: 9.0,
  BOOK_SLOW_EFFECT_SECONDS: 4.0,
  BOOK_CRIT_DURATION: 9.0,
  BOOK_CRIT_CHANCE: 0.45,
  BOOK_PIERCE_DURATION: 8.0,
  ITEM_LIFETIME: 24.0,
  ITEM_PICKUP_RADIUS: 34,
} as const;
