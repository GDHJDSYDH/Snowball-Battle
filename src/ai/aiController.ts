import {
  Enemy,
  Fighter,
  GAME_CONST,
  Obstacle,
  PickupItem,
  Snowball,
  TelegraphZone,
} from '../types';
import { sound } from '../audio/soundEngine';

export interface AiWorldAccess {
  mapWidth: number;
  mapHeight: number;
  obstacles: Obstacle[];
  fighters: Fighter[];
  enemies: Enemy[];
  snowballs: Snowball[];
  pickupItems: PickupItem[];
  telegraphs: TelegraphZone[];
  throwSnowball: (
    ownerId: string,
    team: number,
    x: number,
    y: number,
    angle: number,
    speed: number,
    damage: number,
    isGiant?: boolean,
    tint?: string
  ) => void;
  triggerDash: (fighter: Fighter, dx: number, dy: number) => boolean;
  triggerSkill: (fighter: Fighter) => boolean;
  spawnEnemy: (kind: 'snow_sprite' | 'yeti' | 'frost_mage', x: number, y: number) => void;
  spawnBurst: (x: number, y: number, z: number, color: string, count: number, speed?: number) => void;
  addFloatingText: (x: number, y: number, text: string, color: string, size?: number) => void;
}

/**
 * Steering helper that avoids nearby obstacles cleanly while moving toward (goalX, goalY).
 */
function steerWithAvoidance(
  x: number,
  y: number,
  goalX: number,
  goalY: number,
  obstacles: Obstacle[],
  ignoreObsId: number | null = null
): { dx: number; dy: number } {
  let vx = goalX - x;
  let vy = goalY - y;
  const dist = Math.hypot(vx, vy);
  if (dist > 1) {
    vx /= dist;
    vy /= dist;
  } else {
    return { dx: 0, dy: 0 };
  }

  for (const obs of obstacles) {
    if (!obs.blocksMovement || obs.id === ignoreObsId) continue;
    const ox = x - obs.x;
    const oy = y - obs.y;
    const d = Math.hypot(ox, oy);
    const avoidR = Math.max(obs.radiusX, obs.radiusY) + 46;
    if (d < avoidR && d > 0.1) {
      const push = (avoidR - d) / avoidR;
      vx += (ox / d) * push * 2.1;
      vy += (oy / d) * push * 2.1;
    }
  }

  const len = Math.hypot(vx, vy);
  if (len > 0.01) {
    return { dx: vx / len, dy: vy / len };
  }
  return { dx: 0, dy: 0 };
}

function hasLineOfSight(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  obstacles: Obstacle[]
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1) return true;
  for (const obs of obstacles) {
    if (!obs.blocksSnowball) continue;
    const t = Math.max(0, Math.min(1, ((obs.x - x1) * dx + (obs.y - y1) * dy) / lenSq));
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    const dist = Math.hypot(px - obs.x, py - obs.y);
    if (dist < Math.min(obs.radiusX, obs.radiusY) * 0.9) return false;
  }
  return true;
}

/**
 * Updates Adventure Mode enemies & the Frost Yeti King BOSS.
 */
export function updateEnemyAI(enemy: Enemy, dt: number, world: AiWorldAccess): void {
  const target = world.fighters.find((f) => f.isPlayer && f.alive);
  if (!target) {
    enemy.vx *= 0.85;
    enemy.vy *= 0.85;
    return;
  }

  enemy.animTimer += dt;
  if (enemy.attackCd > 0) enemy.attackCd = Math.max(0, enemy.attackCd - dt);
  if (enemy.hurtTimer > 0) {
    enemy.hurtTimer = Math.max(0, enemy.hurtTimer - dt);
    enemy.vx *= 0.86;
    enemy.vy *= 0.86;
    return;
  }

  const dx = target.x - enemy.x;
  const dy = target.y - enemy.y;
  const dist = Math.hypot(dx, dy);
  const angleToTarget = Math.atan2(dy, dx);
  enemy.facingLeft = dx < 0;

  if (enemy.kind === 'boss_frost_king') {
    updateBossAI(enemy, target, dx, dy, dist, angleToTarget, dt, world);
    return;
  }

  // Regular Adventure Enemies
  if (enemy.state === 'windup') {
    enemy.vx *= 0.82;
    enemy.vy *= 0.82;
    enemy.stateTimer -= dt;
    if (enemy.stateTimer <= 0) {
      enemy.state = 'attack';
      enemy.stateTimer = 0.25;
      if (enemy.kind === 'snow_sprite') {
        world.throwSnowball(enemy.id, 99, enemy.x, enemy.y, angleToTarget, 340, 1, false, '#cceeff');
        enemy.attackCd = 1.65 + Math.random() * 0.6;
      } else if (enemy.kind === 'yeti') {
        // Throws a heavy giant snowball!
        world.throwSnowball(enemy.id, 99, enemy.x, enemy.y, angleToTarget, 310, 1, true, '#b3e6ff');
        enemy.attackCd = 2.4 + Math.random() * 0.7;
      } else if (enemy.kind === 'frost_mage') {
        // 3-way fan spread of icy snowballs
        const spread = [-0.26, 0, 0.26];
        for (const off of spread) {
          world.throwSnowball(enemy.id, 99, enemy.x, enemy.y, angleToTarget + off, 355, 1, false, '#7ce8ff');
        }
        enemy.attackCd = 2.6 + Math.random() * 0.6;
      }
      sound.playThrow();
    }
    return;
  }

  if (enemy.state === 'attack') {
    enemy.stateTimer -= dt;
    enemy.vx *= 0.85;
    enemy.vy *= 0.85;
    if (enemy.stateTimer <= 0) enemy.state = 'move';
    return;
  }

  // Movement & distance keeping
  const desiredDist =
    enemy.kind === 'snow_sprite' ? 210 : enemy.kind === 'frost_mage' ? 320 : 165;
  const slowMult = enemy.slowTimer > 0 ? 0.5 : 1.0;
  const speed =
    (enemy.kind === 'snow_sprite' ? 128 : enemy.kind === 'frost_mage' ? 98 : 112) * slowMult;

  let goalX = target.x;
  let goalY = target.y;

  if (dist < desiredDist * 0.72) {
    // Back off slightly (especially frost mage / snow sprite)
    goalX = enemy.x - dx;
    goalY = enemy.y - dy;
  } else if (dist < desiredDist * 1.25) {
    // Orbit / strafe
    const perpX = -dy / Math.max(1, dist);
    const perpY = dx / Math.max(1, dist);
    const sign = enemy.id.charCodeAt(enemy.id.length - 1) % 2 === 0 ? 1 : -1;
    goalX = enemy.x + perpX * sign * 120;
    goalY = enemy.y + perpY * sign * 120;
  }

  const steer = steerWithAvoidance(enemy.x, enemy.y, goalX, goalY, world.obstacles);
  enemy.vx += (steer.dx * speed - enemy.vx) * Math.min(1, dt * 8);
  enemy.vy += (steer.dy * speed - enemy.vy) * Math.min(1, dt * 8);
  enemy.state = 'move';

  // Trigger attack if in range & clear line of sight
  const maxRange = enemy.kind === 'frost_mage' ? 490 : enemy.kind === 'yeti' ? 390 : 360;
  if (enemy.attackCd <= 0 && dist < maxRange && hasLineOfSight(enemy.x, enemy.y, target.x, target.y, world.obstacles)) {
    enemy.state = 'windup';
    enemy.stateTimer = enemy.kind === 'yeti' ? 0.55 : enemy.kind === 'frost_mage' ? 0.5 : 0.34;
  }
}

function updateBossAI(
  boss: Enemy,
  target: Fighter,
  dx: number,
  dy: number,
  dist: number,
  angleToTarget: number,
  dt: number,
  world: AiWorldAccess
): void {
  // Check Phase 2 transition at <= 50% HP
  if (boss.phase === 1 && boss.hp <= boss.maxHp * 0.5) {
    boss.phase = 2;
    boss.state = 'enrage';
    boss.stateTimer = 1.1;
    boss.vx = 0;
    boss.vy = 0;
    sound.playBossSlam();
    world.spawnBurst(boss.x, boss.y, 40, '#6ce5ff', 36, 240);
    world.addFloatingText(boss.x, boss.y - 88, '❄️ 极寒霜王·暴走二阶段! ❄️', '#7ce8ff', 17);
    // Summon 2 helper Snow Sprites
    const aliveHelpers = world.enemies.filter((e) => e.alive && e.kind !== 'boss_frost_king').length;
    if (aliveHelpers < 3) {
      world.spawnEnemy('snow_sprite', Math.max(150, boss.x - 140), Math.min(world.mapHeight - 150, boss.y + 40));
      world.spawnEnemy('snow_sprite', Math.min(world.mapWidth - 150, boss.x + 140), Math.min(world.mapHeight - 150, boss.y + 40));
    }
    return;
  }

  if (boss.state === 'enrage') {
    boss.stateTimer -= dt;
    boss.vx *= 0.85;
    boss.vy *= 0.85;
    if (boss.stateTimer <= 0) {
      boss.state = 'move';
      boss.attackCd = 0.7;
    }
    return;
  }

  if (boss.state === 'charge') {
    boss.stateTimer -= dt;
    const slowMult = boss.slowTimer > 0 ? 0.68 : 1.0;
    const spd = (boss.phase === 2 ? 360 : 300) * slowMult;
    boss.vx = boss.chargeDirX * spd;
    boss.vy = boss.chargeDirY * spd;
    if (boss.stateTimer <= 0) {
      boss.state = 'move';
      boss.attackCd = boss.phase === 2 ? 1.1 : 1.5;
      // Ground slam burst at end of charge
      world.spawnBurst(boss.x, boss.y, 14, '#b8eeff', 16, 170);
      sound.playBossSlam();
    }
    return;
  }

  if (boss.state === 'windup') {
    boss.vx *= 0.8;
    boss.vy *= 0.8;
    boss.stateTimer -= dt;
    if (boss.stateTimer <= 0) {
      boss.state = 'attack';
      boss.stateTimer = 0.45;
      const pattern = boss.bossPattern;

      if (pattern === 0) {
        // Giant Snowball Fan Volley (3 in Phase 1, 5 in Phase 2)
        const count = boss.phase === 2 ? 5 : 3;
        const spread = 0.24;
        for (let i = 0; i < count; i++) {
          const offset = (i - (count - 1) / 2) * spread;
          world.throwSnowball(boss.id, 99, boss.x, boss.y, angleToTarget + offset, 340, 1, true, '#9be8ff');
        }
        sound.playThrow();
      } else if (pattern === 1) {
        // Telegraphed Frost Slam Zones around target!
        const zones = boss.phase === 2 ? 3 : 2;
        for (let i = 0; i < zones; i++) {
          const jitterX = i === 0 ? 0 : (Math.random() - 0.5) * 210;
          const jitterY = i === 0 ? 0 : (Math.random() - 0.5) * 180;
          world.telegraphs.push({
            x: Math.max(130, Math.min(world.mapWidth - 130, target.x + jitterX)),
            y: Math.max(130, Math.min(world.mapHeight - 130, target.y + jitterY)),
            radius: 78,
            elapsed: 0,
            duration: boss.phase === 2 ? 0.92 : 1.1,
            damage: 1,
            ownerTeam: 99,
            ownerId: boss.id,
            kind: 'slam',
          });
        }
        sound.playBossSlam();
      } else if (pattern === 2) {
        // Charging Lunge
        boss.state = 'charge';
        boss.stateTimer = 0.65;
        boss.chargeDirX = Math.cos(angleToTarget);
        boss.chargeDirY = Math.sin(angleToTarget);
        world.addFloatingText(boss.x, boss.y - 78, '冲锋!', '#ff8c66', 15);
        return;
      } else {
        // Phase 2 Blizzard Radial Ring Barrage (10 snowballs!)
        const count = 10;
        const baseA = boss.animTimer * 1.4;
        for (let i = 0; i < count; i++) {
          const a = baseA + (i / count) * Math.PI * 2;
          world.throwSnowball(boss.id, 99, boss.x, boss.y, a, 285, 1, false, '#6ce5ff');
        }
        sound.playBossSlam();
      }

      boss.attackCd = boss.phase === 2 ? 1.35 : 1.85;
    }
    return;
  }

  if (boss.state === 'attack') {
    boss.stateTimer -= dt;
    boss.vx *= 0.84;
    boss.vy *= 0.84;
    if (boss.stateTimer <= 0) boss.state = 'move';
    return;
  }

  // Move toward player
  const slowMult = boss.slowTimer > 0 ? 0.68 : 1.0;
  const speed = (boss.phase === 2 ? 132 : 104) * slowMult;
  const steer = steerWithAvoidance(boss.x, boss.y, target.x, target.y, world.obstacles);
  boss.vx += (steer.dx * speed - boss.vx) * Math.min(1, dt * 6);
  boss.vy += (steer.dy * speed - boss.vy) * Math.min(1, dt * 6);
  boss.state = 'move';

  if (boss.attackCd <= 0 && dist < 680) {
    const patternCount = boss.phase === 2 ? 4 : 3;
    boss.bossPattern = (boss.bossPattern + 1) % patternCount;
    boss.state = 'windup';
    boss.stateTimer = boss.phase === 2 ? 0.52 : 0.68;
  }
}

/**
 * Smart Character-Specific AI for Brawl Mode (remaining 3 characters fight each other & player).
 */
export function updateBrawlFighterAI(
  ai: Fighter,
  dt: number,
  world: AiWorldAccess
): { moveX: number; moveY: number; wantThrow: boolean; wantRefill: boolean; wantDash: boolean; wantSkill: boolean } {
  let moveX = 0;
  let moveY = 0;
  let wantThrow = false;
  let wantRefill = false;
  let wantDash = false;
  let wantSkill = false;

  if (!ai.alive) {
    return { moveX, moveY, wantThrow, wantRefill, wantDash, wantSkill };
  }

  ai.aiTimer -= dt;
  if (ai.aiTimer <= 0) {
    ai.aiTimer = 0.65 + Math.random() * 0.75;
    ai.aiStrafeDir = Math.random() > 0.5 ? 1 : -1;
  }

  // Find nearest alive opponent
  let target: Fighter | null = null;
  let bestDist = Infinity;
  for (const f of world.fighters) {
    if (!f.alive || f.id === ai.id || f.team === ai.team) continue;
    const d = Math.hypot(f.x - ai.x, f.y - ai.y);
    if (d < bestDist) {
      bestDist = d;
      target = f;
    }
  }

  // 1. Incoming snowball threat detection -> Dash dodge or Miyako Ice Shield!
  let dangerBall: Snowball | null = null;
  let dangerDist = 140;
  for (const sb of world.snowballs) {
    if (sb.team === ai.team || sb.frozenByTimeStop) continue;
    const dx = ai.x - sb.x;
    const dy = ai.y - sb.y;
    const d = Math.hypot(dx, dy);
    if (d < dangerDist) {
      // Check if heading roughly toward AI
      const dot = dx * sb.vx + dy * sb.vy;
      if (dot > 0) {
        dangerDist = d;
        dangerBall = sb;
      }
    }
  }

  if (dangerBall && !ai.isRefilling) {
    if (ai.charId === 'miyako' && ai.skillCd <= 0 && ai.iceShieldTimer <= 0) {
      wantSkill = true;
    } else if (ai.dashCd <= 0) {
      // Dash perpendicular to incoming snowball
      const spd = Math.hypot(dangerBall.vx, dangerBall.vy) || 1;
      moveX = -dangerBall.vy / spd * ai.aiStrafeDir;
      moveY = dangerBall.vx / spd * ai.aiStrafeDir;
      wantDash = true;
      return { moveX, moveY, wantThrow, wantRefill, wantDash, wantSkill };
    }
  }

  // 2. Character-specific skill AI logic
  if (ai.skillCd <= 0 && target) {
    if (ai.charId === 'kuki' && ai.hp <= 3) {
      wantSkill = true;
    } else if (ai.charId === 'unianna' && ai.snowballs >= 3 && bestDist < 420) {
      wantSkill = true;
    } else if (ai.charId === 'miyako' && bestDist < 260 && ai.hp <= 4) {
      wantSkill = true;
    } else if (ai.charId === 'tessel' && bestDist <= GAME_CONST.TESSEL_IAIDO_RANGE + 12 && ai.iaidoSwingCd <= 0) {
      ai.aimAngle = Math.atan2(target.y - ai.y, target.x - ai.x);
      wantSkill = true;
    }
  }

  // 3. Snowball Refill Logic: seek nearest snow pile when empty (skip if Infinite Snowball Book is active!)
  const hasInfiniteBook = ai.activeBook === 'book_infinite' && ai.bookTimer > 0;
  const needsRefill =
    !hasInfiniteBook &&
    (ai.snowballs === 0 || (ai.isRefilling && ai.snowballs < ai.maxSnowballs && (!dangerBall || dangerDist > 90)));

  if (needsRefill && !(ai.charId === 'tessel' && ai.skillCd <= 0 && bestDist < 170)) {
    let bestPile: Obstacle | null = null;
    let pileDist = Infinity;
    for (const obs of world.obstacles) {
      if (!obs.isSnowPile) continue;
      const d = Math.hypot(obs.x - ai.x, obs.y - ai.y);
      if (d < pileDist) {
        pileDist = d;
        bestPile = obs;
      }
    }

    if (bestPile) {
      if (pileDist <= GAME_CONST.REFILL_RADIUS - 4) {
        wantRefill = true;
        return { moveX: 0, moveY: 0, wantThrow: false, wantRefill, wantDash: false, wantSkill };
      } else {
        const steer = steerWithAvoidance(ai.x, ai.y, bestPile.x, bestPile.y, world.obstacles, bestPile.id);
        moveX = steer.dx;
        moveY = steer.dy;
        ai.aimAngle = Math.atan2(moveY, moveX);
        return { moveX, moveY, wantThrow: false, wantRefill: false, wantDash: false, wantSkill };
      }
    }
  }

  // 3.5 Opportunistically grab nearby pickup items (Bandage when injured, or nearby Magic Books / Ice Cream)
  if (!ai.isRefilling && world.pickupItems.length > 0) {
    let bestItem: PickupItem | null = null;
    let bestScore = Infinity;
    for (const item of world.pickupItems) {
      if (item.kind === 'bandage' && ai.hp >= ai.maxHp) continue;
      const d = Math.hypot(item.x - ai.x, item.y - ai.y);
      const maxSearch = item.kind === 'bandage' && ai.hp <= 3 ? 340 : 230;
      if (d < maxSearch) {
        const score = item.kind === 'bandage' && ai.hp <= 3 ? d * 0.55 : d;
        if (score < bestScore) {
          bestScore = score;
          bestItem = item;
        }
      }
    }
    if (bestItem) {
      const steer = steerWithAvoidance(ai.x, ai.y, bestItem.x, bestItem.y, world.obstacles);
      moveX = steer.dx;
      moveY = steer.dy;
      if (target) {
        ai.aimAngle = Math.atan2(target.y - ai.y, target.x - ai.x);
        if ((ai.snowballs > 0 || hasInfiniteBook) && ai.throwCooldown <= 0 && bestDist < 420 && hasLineOfSight(ai.x, ai.y, target.x, target.y, world.obstacles)) {
          wantThrow = true;
        }
      }
      return { moveX, moveY, wantThrow, wantRefill: false, wantDash: false, wantSkill };
    }
  }

  // 4. Combat positioning & aiming
  if (target) {
    const dx = target.x - ai.x;
    const dy = target.y - ai.y;
    const leadT = Math.min(0.45, bestDist / GAME_CONST.SNOWBALL_SPEED);
    const predX = target.x + target.vx * leadT * 0.65;
    const predY = target.y + target.vy * leadT * 0.65;
    ai.aimAngle = Math.atan2(predY - ai.y, predX - ai.x);

    // Tessel prefers closing distance when Iaido is ready!
    const preferredDist =
      ai.charId === 'tessel' && ai.skillCd <= 0
        ? 68
        : ai.charId === 'kuki' && ai.hp <= 2
          ? 340
          : 245;

    let goalX = target.x;
    let goalY = target.y;
    if (bestDist < preferredDist * 0.72) {
      goalX = ai.x - dx;
      goalY = ai.y - dy;
    } else if (bestDist < preferredDist * 1.25) {
      const perpX = -dy / Math.max(1, bestDist);
      const perpY = dx / Math.max(1, bestDist);
      goalX = ai.x + perpX * ai.aiStrafeDir * 150;
      goalY = ai.y + perpY * ai.aiStrafeDir * 150;
    }

    const steer = steerWithAvoidance(ai.x, ai.y, goalX, goalY, world.obstacles);
    moveX = steer.dx;
    moveY = steer.dy;

    // Throw snowball when in range and clear sightline
    if (
      (ai.snowballs > 0 || hasInfiniteBook) &&
      ai.throwCooldown <= 0 &&
      bestDist < 480 &&
      hasLineOfSight(ai.x, ai.y, target.x, target.y, world.obstacles)
    ) {
      // Small human-like aim jitter
      ai.aimAngle += (Math.random() - 0.5) * 0.14;
      wantThrow = true;
    }
  }

  return { moveX, moveY, wantThrow, wantRefill, wantDash, wantSkill };
}
