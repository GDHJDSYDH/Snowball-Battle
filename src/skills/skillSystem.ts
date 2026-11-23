import {
  Enemy,
  Fighter,
  FloatingText,
  GAME_CONST,
  Particle,
  SlashArc,
  Snowball,
} from '../types';
import { sound } from '../audio/soundEngine';

export interface SkillContext {
  fighters: Fighter[];
  enemies: Enemy[];
  snowballs: Snowball[];
  slashArcs: SlashArc[];
  particles: Particle[];
  floatingTexts: FloatingText[];
  timeFreezeTimer: number;
  timeFreezeOwnerId: string | null;
  timeFreezeRipple: number;
  screenShake: number;
  damageFighter: (target: Fighter, amount: number, knockX: number, knockY: number, attackerId: string) => boolean;
  damageEnemy: (target: Enemy, amount: number, knockX: number, knockY: number, attackerId: string) => boolean;
  spawnBurst: (x: number, y: number, z: number, color: string, count: number, speed?: number) => void;
}

export function tryActivateSkill(fighter: Fighter, ctx: SkillContext): boolean {
  if (!fighter.alive || fighter.dashTimer > 0) return false;
  if (fighter.skillCd > 0) return false;

  // Cancel refill if casting skill
  fighter.isRefilling = false;
  fighter.refillTimer = 0;

  switch (fighter.charId) {
    case 'unianna': {
      // 时间冻结: 5s duration, 20s CD
      ctx.timeFreezeTimer = GAME_CONST.UNIANNA_FREEZE_DURATION;
      ctx.timeFreezeOwnerId = fighter.id;
      ctx.timeFreezeRipple = 0.001;
      fighter.skillActiveTimer = GAME_CONST.UNIANNA_FREEZE_DURATION;
      fighter.skillCd = GAME_CONST.UNIANNA_FREEZE_CD;
      fighter.actionState = 'skill';
      fighter.actionTimer = 0.45;
      ctx.screenShake = Math.max(ctx.screenShake, 7);
      sound.playTimeFreeze();

      ctx.floatingTexts.push({
        x: fighter.x,
        y: fighter.y - 54,
        text: '⏳ 时间冻结!',
        color: '#ffe066',
        life: 1.4,
        maxLife: 1.4,
        size: 16,
      });
      ctx.spawnBurst(fighter.x, fighter.y, 24, '#ffe066', 22, 190);
      ctx.spawnBurst(fighter.x, fighter.y, 20, '#5ee6ff', 18, 140);
      return true;
    }

    case 'kuki': {
      // 曲奇饼干: Heal 1 heart, 8s CD
      if (fighter.hp >= fighter.maxHp) {
        if (fighter.isPlayer) {
          ctx.floatingTexts.push({
            x: fighter.x,
            y: fighter.y - 46,
            text: '满血啦!',
            color: '#ffd166',
            life: 0.9,
            maxLife: 0.9,
            size: 13,
          });
        }
        return false;
      }
      fighter.hp = Math.min(fighter.maxHp, fighter.hp + 1);
      fighter.skillCd = GAME_CONST.KUKI_COOKIE_CD;
      fighter.actionState = 'skill';
      fighter.actionTimer = 0.48;
      sound.playCookieHeal();

      ctx.floatingTexts.push({
        x: fighter.x,
        y: fighter.y - 50,
        text: '🍪 +1 ♥',
        color: '#ff9ec4',
        life: 1.2,
        maxLife: 1.2,
        size: 16,
      });
      ctx.spawnBurst(fighter.x, fighter.y, 18, '#ffd166', 16, 130);
      ctx.spawnBurst(fighter.x, fighter.y, 24, '#ff8fb8', 14, 100);
      return true;
    }

    case 'miyako': {
      // 寒冰护盾: 5s immunity, 20s CD
      fighter.iceShieldTimer = GAME_CONST.MIYAKO_SHIELD_DURATION;
      fighter.skillActiveTimer = GAME_CONST.MIYAKO_SHIELD_DURATION;
      fighter.skillCd = GAME_CONST.MIYAKO_SHIELD_CD;
      fighter.actionState = 'skill';
      fighter.actionTimer = 0.42;
      sound.playIceShield();

      ctx.floatingTexts.push({
        x: fighter.x,
        y: fighter.y - 52,
        text: '❄️ 寒冰护盾!',
        color: '#8ce6ff',
        life: 1.2,
        maxLife: 1.2,
        size: 15,
      });
      ctx.spawnBurst(fighter.x, fighter.y, 20, '#8ce6ff', 22, 160);
      return true;
    }

    case 'tessel': {
      // 拔刀斩: Melee katana slash, 1 heart damage; hitting 3 times within 5s triggers 10s CD
      if (fighter.iaidoSwingCd > 0) return false;
      fighter.iaidoSwingCd = GAME_CONST.TESSEL_IAIDO_SWING_CD;
      fighter.actionState = 'skill';
      fighter.actionTimer = 0.28;
      sound.playIaidoSlash();

      const slashAngle = fighter.aimAngle;
      const range = GAME_CONST.TESSEL_IAIDO_RANGE;
      const halfArc = GAME_CONST.TESSEL_IAIDO_ARC * 0.5;

      // Slight forward lunge for snappy katana feel
      fighter.vx += Math.cos(slashAngle) * 145;
      fighter.vy += Math.sin(slashAngle) * 145;

      ctx.slashArcs.push({
        x: fighter.x,
        y: fighter.y - 12,
        angle: slashAngle,
        radius: range,
        arcSpread: GAME_CONST.TESSEL_IAIDO_ARC,
        life: 0.22,
        maxLife: 0.22,
        color: '#ffe680',
      });

      // Slice enemy snowballs caught inside the blade arc!
      for (let i = ctx.snowballs.length - 1; i >= 0; i--) {
        const sb = ctx.snowballs[i];
        if (sb.team === fighter.team) continue;
        const dx = sb.x - fighter.x;
        const dy = sb.y - fighter.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= range + sb.radius) {
          const diff = normalizeAngle(Math.atan2(dy, dx) - slashAngle);
          if (Math.abs(diff) <= halfArc + 0.15) {
            ctx.spawnBurst(sb.x, sb.y, sb.z, '#ffffff', 8, 120);
            ctx.snowballs.splice(i, 1);
          }
        }
      }

      let hitsThisSlash = 0;

      // Check Adventure enemies
      for (const enemy of ctx.enemies) {
        if (!enemy.alive) continue;
        const dx = enemy.x - fighter.x;
        const dy = enemy.y - fighter.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= range + enemy.radius) {
          const diff = normalizeAngle(Math.atan2(dy, dx) - slashAngle);
          if (Math.abs(diff) <= halfArc || dist < 34) {
            const nx = dist > 0.01 ? dx / dist : Math.cos(slashAngle);
            const ny = dist > 0.01 ? dy / dist : Math.sin(slashAngle);
            if (ctx.damageEnemy(enemy, 1, nx * 240, ny * 240, fighter.id)) {
              hitsThisSlash++;
              ctx.spawnBurst(enemy.x, enemy.y, 18, '#ffe680', 12, 160);
            }
          }
        }
      }

      // Check Brawl rival fighters
      for (const rival of ctx.fighters) {
        if (!rival.alive || rival.id === fighter.id || rival.team === fighter.team) continue;
        const dx = rival.x - fighter.x;
        const dy = rival.y - fighter.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= range + rival.radius) {
          const diff = normalizeAngle(Math.atan2(dy, dx) - slashAngle);
          if (Math.abs(diff) <= halfArc || dist < 34) {
            const nx = dist > 0.01 ? dx / dist : Math.cos(slashAngle);
            const ny = dist > 0.01 ? dy / dist : Math.sin(slashAngle);
            if (ctx.damageFighter(rival, 1, nx * 250, ny * 250, fighter.id)) {
              hitsThisSlash++;
              ctx.spawnBurst(rival.x, rival.y, 18, '#ffe680', 12, 160);
            }
          }
        }
      }

      // Exact 5s / 3-hit cooldown tracker
      if (hitsThisSlash > 0) {
        ctx.screenShake = Math.max(ctx.screenShake, 5);
        for (let h = 0; h < hitsThisSlash; h++) {
          if (fighter.iaidoWindowTimer <= 0) {
            fighter.iaidoWindowTimer = GAME_CONST.TESSEL_IAIDO_WINDOW;
            fighter.iaidoHitCount = 1;
          } else {
            fighter.iaidoHitCount++;
          }
          if (fighter.iaidoHitCount >= GAME_CONST.TESSEL_IAIDO_MAX_HITS) {
            fighter.skillCd = GAME_CONST.TESSEL_IAIDO_CD;
            fighter.iaidoHitCount = 0;
            fighter.iaidoWindowTimer = 0;
            sound.playIaidoCooldown();
            ctx.floatingTexts.push({
              x: fighter.x,
              y: fighter.y - 52,
              text: '🌙 三连斩! 冷却10s',
              color: '#ffd166',
              life: 1.2,
              maxLife: 1.2,
              size: 14,
            });
            break;
          } else {
            ctx.floatingTexts.push({
              x: fighter.x,
              y: fighter.y - 46,
              text: `🌙 拔刀斩 (${fighter.iaidoHitCount}/3)`,
              color: '#fff2a8',
              life: 0.75,
              maxLife: 0.75,
              size: 13,
            });
          }
        }
      }
      return true;
    }
  }
}

export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
