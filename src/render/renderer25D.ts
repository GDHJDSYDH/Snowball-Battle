import { GameAssets } from '../assets/assetLoader';
import { CHARACTERS } from '../data/characters';
import { ITEMS } from '../data/items';
import {
  Afterimage,
  Enemy,
  Fighter,
  FloatingText,
  Footprint,
  GAME_CONST,
  IcePatch,
  Obstacle,
  Particle,
  PickupItem,
  SlashArc,
  Snowball,
  SnowflakeBg,
  TelegraphZone,
} from '../types';

export interface RenderState {
  mapWidth: number;
  mapHeight: number;
  groundPatternCanvas: HTMLCanvasElement;
  obstacles: Obstacle[];
  icePatches: IcePatch[];
  fighters: Fighter[];
  enemies: Enemy[];
  snowballs: Snowball[];
  pickupItems: PickupItem[];
  slashArcs: SlashArc[];
  telegraphs: TelegraphZone[];
  particles: Particle[];
  afterimages: Afterimage[];
  footprints: Footprint[];
  floatingTexts: FloatingText[];
  snowflakes: SnowflakeBg[];
  cameraX: number;
  cameraY: number;
  viewScale: number;
  shakeOffsetX: number;
  shakeOffsetY: number;
  time: number;
  timeFreezeTimer: number;
  timeFreezeOwnerId: string | null;
  timeFreezeRipple: number;
  aimPreviewAngle: number | null;
}

/**
 * Resolves exact (col, row, flipX) on the 4x4 character sprite sheet.
 * Row 0: Front (idle1, idle2, walk1, walk2)
 * Row 1: Side-Right (idle, walk1, walk2, side-throw)
 * Row 2: Back (idle, walk1, walk2) + Col 3: Refill crouch
 * Row 3: Front Throw, Dash (facing right), Skill Pose, Hurt
 */
export function getFighterSpriteFrame(f: Fighter): { col: number; row: number; flipX: boolean } {
  if (f.actionState === 'hurt') {
    return { col: 3, row: 3, flipX: f.facingLeft };
  }
  if (f.dashTimer > 0 || f.actionState === 'dash') {
    return { col: 1, row: 3, flipX: f.dashDirX < -0.1 || (Math.abs(f.dashDirX) <= 0.1 && f.facingLeft) };
  }
  if (f.actionState === 'skill') {
    return { col: 2, row: 3, flipX: f.facingLeft };
  }
  if (f.isRefilling || f.actionState === 'refill') {
    return { col: 3, row: 2, flipX: f.facingLeft };
  }
  if (f.actionState === 'throw') {
    if (f.facingDir === 'side') {
      return { col: 3, row: 1, flipX: f.facingLeft };
    }
    return { col: 0, row: 3, flipX: f.facingLeft };
  }

  const moving = Math.hypot(f.vx, f.vy) > 16;
  const walkStep = Math.floor(f.animTimer * 7.5) % 2;
  const idleStep = Math.floor(f.animTimer * 2.4) % 2;

  if (f.facingDir === 'up') {
    return { col: moving ? 1 + walkStep : 0, row: 2, flipX: false };
  }
  if (f.facingDir === 'side') {
    return { col: moving ? 1 + walkStep : 0, row: 1, flipX: f.facingLeft };
  }
  // Default front-down
  return { col: moving ? 2 + walkStep : idleStep, row: 0, flipX: false };
}

export class Renderer25D {
  private groundPattern: CanvasPattern | null = null;
  private lastGroundCanvas: HTMLCanvasElement | null = null;

  public render(ctx: CanvasRenderingContext2D, width: number, height: number, state: RenderState, assets: GameAssets): void {
    ctx.imageSmoothingEnabled = false;
    ctx.save();

    // Fill outer background (deep winter night pine tone outside map borders)
    ctx.fillStyle = '#18304a';
    ctx.fillRect(0, 0, width, height);

    const scale = state.viewScale;
    const camX = Math.round(state.cameraX + state.shakeOffsetX);
    const camY = Math.round(state.cameraY + state.shakeOffsetY);

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-camX, -camY);

    // 1. Tiled snowy ground
    if (this.lastGroundCanvas !== state.groundPatternCanvas) {
      this.groundPattern = ctx.createPattern(state.groundPatternCanvas, 'repeat');
      this.lastGroundCanvas = state.groundPatternCanvas;
    }
    if (this.groundPattern) {
      ctx.fillStyle = this.groundPattern;
      ctx.fillRect(0, 0, state.mapWidth, state.mapHeight);
    } else {
      ctx.fillStyle = '#e5f2fc';
      ctx.fillRect(0, 0, state.mapWidth, state.mapHeight);
    }

    // Map border snowbank rim
    ctx.strokeStyle = '#9fc5e3';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, state.mapWidth - 8, state.mapHeight - 8);

    // 2. Slippery Ice Patches (ground decal layer)
    for (const patch of state.icePatches) {
      ctx.save();
      ctx.translate(patch.x, patch.y);
      ctx.rotate(patch.rotation);
      ctx.fillStyle = 'rgba(130, 214, 255, 0.45)';
      ctx.beginPath();
      ctx.ellipse(0, 0, patch.rx, patch.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(215, 245, 255, 0.85)';
      ctx.lineWidth = 3;
      ctx.stroke();
      // Diagonal ice shine streaks
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-patch.rx * 0.45, -patch.ry * 0.2);
      ctx.lineTo(patch.rx * 0.1, -patch.ry * 0.55);
      ctx.moveTo(-patch.rx * 0.1, patch.ry * 0.4);
      ctx.lineTo(patch.rx * 0.45, -patch.ry * 0.05);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Fading snow footprints
    for (const fp of state.footprints) {
      const a = Math.max(0, fp.life / fp.maxLife) * 0.45;
      ctx.save();
      ctx.translate(fp.x, fp.y);
      ctx.rotate(fp.angle);
      ctx.fillStyle = `rgba(148, 186, 218, ${a.toFixed(3)})`;
      ctx.fillRect(-3, -2, 6, 4);
      ctx.restore();
    }

    // 4. Snow Pile highlight rings when player is nearby
    const player = state.fighters.find((f) => f.isPlayer && f.alive);
    for (const obs of state.obstacles) {
      if (!obs.isSnowPile) continue;
      const isNear = player && player.nearSnowPileId === obs.id;
      const pulse = 0.5 + 0.5 * Math.sin(state.time * 5 + obs.id);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(obs.x, obs.y + 4, GAME_CONST.REFILL_RADIUS * 0.82, GAME_CONST.REFILL_RADIUS * 0.54, 0, 0, Math.PI * 2);
      ctx.strokeStyle = isNear
        ? `rgba(255, 232, 102, ${0.65 + pulse * 0.35})`
        : `rgba(108, 212, 255, ${0.18 + pulse * 0.16})`;
      ctx.lineWidth = isNear ? 3 : 2;
      ctx.setLineDash(isNear ? [8, 5] : [6, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 5. Boss / Hazard Telegraph Warning Zones (on snow ground)
    for (const tz of state.telegraphs) {
      const p = Math.min(1, tz.elapsed / tz.duration);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(tz.x, tz.y, tz.radius, tz.radius * 0.72, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 58, 92, ${0.14 + p * 0.22})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 75, 105, ${0.65 + p * 0.35})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      // Expanding inner fill showing exact impact moment
      ctx.beginPath();
      ctx.ellipse(tz.x, tz.y, tz.radius * p, tz.radius * 0.72 * p, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 92, 118, ${0.28 + p * 0.3})`;
      ctx.fill();
      ctx.restore();
    }

    // 6. Dash Afterimages
    for (const ghost of state.afterimages) {
      const img = assets.characters[ghost.charId];
      const cell = img.width / 4;
      const alpha = (ghost.life / ghost.maxLife) * 0.5;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(Math.round(ghost.x), Math.round(ghost.y));
      if (ghost.flipX) ctx.scale(-1, 1);
      ctx.drawImage(img, ghost.col * cell, ghost.row * cell, cell, cell, -38, -68, 76, 76);
      ctx.restore();
    }

    // 7. 2.5D Y-SORTED RENDER QUEUE
    const viewMinX = camX - 180;
    const viewMaxX = camX + width / scale + 180;
    const viewMinY = camY - 220;
    const viewMaxY = camY + height / scale + 220;

    type DrawItem = { sortY: number; draw: () => void };
    const drawList: DrawItem[] = [];

    // Obstacles
    for (const obs of state.obstacles) {
      if (obs.x < viewMinX || obs.x > viewMaxX || obs.y < viewMinY || obs.y > viewMaxY) continue;
      drawList.push({
        sortY: obs.y,
        draw: () => {
          const img = assets.props[obs.kind];
          // Elliptical ground shadow
          ctx.fillStyle = 'rgba(28, 56, 88, 0.24)';
          ctx.beginPath();
          ctx.ellipse(obs.x, obs.y + 4, obs.radiusX * 1.18, obs.radiusY * 0.9, 0, 0, Math.PI * 2);
          ctx.fill();

          // Auto-fade tall pine canopy if player is walking behind it!
          let alpha = 1;
          if (obs.canopyHeight > 0 && player) {
            const behindY = player.y < obs.y && player.y > obs.y - obs.canopyHeight;
            const behindX = Math.abs(player.x - obs.x) < obs.drawWidth * 0.48;
            if (behindY && behindX) alpha = 0.45;
          }

          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.drawImage(
            img,
            Math.round(obs.x - obs.drawWidth * 0.5),
            Math.round(obs.y - obs.drawHeight + obs.radiusY * 0.85),
            obs.drawWidth,
            obs.drawHeight
          );
          ctx.restore();

          // Prompt tag on nearest snow pile
          if (obs.isSnowPile && player && player.nearSnowPileId === obs.id && !player.isRefilling && player.snowballs < player.maxSnowballs) {
            ctx.save();
            ctx.font = 'bold 12px "Microsoft YaHei", monospace';
            ctx.textAlign = 'center';
            const label = '长按 R / 按住雪堆 (1s)';
            const tw = ctx.measureText(label).width + 12;
            ctx.fillStyle = 'rgba(10, 24, 42, 0.82)';
            ctx.fillRect(obs.x - tw * 0.5, obs.y - obs.drawHeight - 16, tw, 20);
            ctx.strokeStyle = '#ffe066';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(obs.x - tw * 0.5, obs.y - obs.drawHeight - 16, tw, 20);
            ctx.fillStyle = '#ffe066';
            ctx.fillText(label, obs.x, obs.y - obs.drawHeight - 2);
            ctx.restore();
          }
        },
      });
    }

    // Fighters (Player + Brawl AI)
    for (const f of state.fighters) {
      if (!f.alive) continue;
      drawList.push({
        sortY: f.y,
        draw: () => this.drawFighter(ctx, f, state, assets),
      });
    }

    // Adventure Enemies & Boss
    for (const e of state.enemies) {
      if (!e.alive) continue;
      if (e.x < viewMinX || e.x > viewMaxX || e.y < viewMinY || e.y > viewMaxY) continue;
      drawList.push({
        sortY: e.y,
        draw: () => this.drawEnemy(ctx, e, state, assets),
      });
    }

    // Pickup Items (2.5D bobbing with glowing aura & ground shadow)
    for (const item of state.pickupItems) {
      if (item.x < viewMinX || item.x > viewMaxX || item.y < viewMinY || item.y > viewMaxY) continue;
      drawList.push({
        sortY: item.y,
        draw: () => this.drawPickupItem(ctx, item, state, assets, player),
      });
    }

    // Snowballs (2.5D: ground shadow at y, snowball sprite elevated at y - z!)
    for (const sb of state.snowballs) {
      if (sb.x < viewMinX || sb.x > viewMaxX || sb.y < viewMinY || sb.y > viewMaxY) continue;
      drawList.push({
        sortY: sb.y,
        draw: () => this.drawSnowball(ctx, sb, state.time),
      });
    }

    drawList.sort((a, b) => a.sortY - b.sortY);
    for (const item of drawList) {
      item.draw();
    }

    // 8. Tessel Iaido Crescent Moon Slash Arcs
    for (const arc of state.slashArcs) {
      const p = arc.life / arc.maxLife;
      ctx.save();
      ctx.translate(arc.x, arc.y);
      ctx.rotate(arc.angle);
      ctx.globalAlpha = Math.min(1, p * 1.4);
      // Outer golden crescent
      ctx.beginPath();
      ctx.arc(0, 0, arc.radius, -arc.arcSpread * 0.5, arc.arcSpread * 0.5);
      ctx.strokeStyle = arc.color;
      ctx.lineWidth = 14 * p + 4;
      ctx.lineCap = 'round';
      ctx.stroke();
      // Inner white blade gleam
      ctx.beginPath();
      ctx.arc(0, 0, arc.radius - 7, -arc.arcSpread * 0.44, arc.arcSpread * 0.44);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6 * p + 2;
      ctx.stroke();
      ctx.restore();
    }

    // 9. Aim Trajectory Preview (Mobile drag-aim OR Time-Freeze aiming!)
    if (player && (state.aimPreviewAngle !== null || (state.timeFreezeTimer > 0 && state.timeFreezeOwnerId === player.id))) {
      const angle = state.aimPreviewAngle !== null ? state.aimPreviewAngle : player.aimAngle;
      ctx.save();
      ctx.strokeStyle = state.timeFreezeTimer > 0 ? 'rgba(255, 224, 102, 0.72)' : 'rgba(108, 229, 255, 0.75)';
      ctx.lineWidth = 3;
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      ctx.moveTo(player.x + Math.cos(angle) * 24, player.y - 14 + Math.sin(angle) * 24);
      ctx.lineTo(player.x + Math.cos(angle) * 165, player.y - 14 + Math.sin(angle) * 165);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 10. 2.5D Particles
    for (const p of state.particles) {
      const a = Math.max(0, (p.life / p.maxLife) * p.alpha);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const py = p.y - p.z;
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, py, p.size * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, py, p.size, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillRect(Math.round(p.x - p.size * 0.5), Math.round(py - p.size * 0.5), Math.round(p.size), Math.round(p.size));
      }
      ctx.restore();
    }

    // 11. Floating Combat Texts
    for (const ft of state.floatingTexts) {
      const a = Math.min(1, (ft.life / ft.maxLife) * 1.6);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `900 ${ft.size}px "Microsoft YaHei", monospace`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#091526';
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    // 12. Time-Freeze World Ripple Wave (world space)
    if (state.timeFreezeTimer > 0 && state.timeFreezeOwnerId) {
      const caster = state.fighters.find((f) => f.id === state.timeFreezeOwnerId);
      if (caster && state.timeFreezeRipple > 0 && state.timeFreezeRipple < 1.2) {
        ctx.save();
        const r = state.timeFreezeRipple * 1100;
        ctx.beginPath();
        ctx.arc(caster.x, caster.y - 16, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 224, 102, ${Math.max(0, 1 - state.timeFreezeRipple)})`;
        ctx.lineWidth = 8;
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore(); // End camera world transform

    // 13. Screen-Space Time Freeze Atmospheric Tint & Clock Vignette
    if (state.timeFreezeTimer > 0) {
      ctx.save();
      const pulse = 0.5 + 0.5 * Math.sin(state.time * 6);
      const grad = ctx.createRadialGradient(width * 0.5, height * 0.5, Math.min(width, height) * 0.25, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
      grad.addColorStop(0, 'rgba(30, 58, 118, 0.08)');
      grad.addColorStop(1, `rgba(18, 32, 74, ${0.44 + pulse * 0.08})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Subtle golden clock tick ring in screen center
      ctx.strokeStyle = 'rgba(255, 224, 102, 0.25)';
      ctx.lineWidth = 3;
      const cr = Math.min(width, height) * 0.36;
      ctx.beginPath();
      ctx.arc(width * 0.5, height * 0.5, cr, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(width * 0.5 + Math.cos(a) * (cr - 10), height * 0.5 + Math.sin(a) * (cr - 10));
        ctx.lineTo(width * 0.5 + Math.cos(a) * (cr + 4), height * 0.5 + Math.sin(a) * (cr + 4));
        ctx.stroke();
      }
      ctx.restore();
    }

    // 14. Multi-Layer Parallax Falling Snowflakes (Screen Space)
    for (const flake of state.snowflakes) {
      ctx.fillStyle = flake.layer === 2 ? 'rgba(255,255,255,0.85)' : flake.layer === 1 ? 'rgba(225,244,255,0.65)' : 'rgba(205,232,255,0.45)';
      ctx.fillRect(Math.round(flake.x), Math.round(flake.y), flake.size, flake.size);
    }

    // 15. Offscreen Enemy / Rival Direction Arrows & Compact Pixel Minimap
    if (player) {
      this.drawOffscreenIndicators(ctx, width, height, state, player);
      this.drawMinimap(ctx, width, height, state, player);
    }

    ctx.restore();
  }

  private drawFighter(ctx: CanvasRenderingContext2D, f: Fighter, state: RenderState, assets: GameAssets): void {
    const img = assets.characters[f.charId];
    const cell = img.width / 4;
    const frame = getFighterSpriteFrame(f);
    const charDef = CHARACTERS[f.charId];

    // Blink during 30-frame invincibility
    if (f.invincibleFrames > 0 && Math.floor(f.invincibleFrames / 3) % 2 === 0) {
      ctx.save();
      ctx.globalAlpha = 0.42;
    } else {
      ctx.save();
    }

    // Ground shadow
    ctx.fillStyle = 'rgba(24, 52, 84, 0.34)';
    ctx.beginPath();
    ctx.ellipse(f.x, f.y + 4, 21, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // Player ground indicator ring (crisp readability on mobile & brawl)
    if (f.isPlayer) {
      ctx.strokeStyle = charDef.themeColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y + 4, 24, 11, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw sprite anchored bottom-center at (f.x, f.y + 6)
    const drawSize = 78;
    ctx.save();
    ctx.translate(Math.round(f.x), Math.round(f.y + 6));
    if (frame.flipX) ctx.scale(-1, 1);
    ctx.drawImage(
      img,
      frame.col * cell,
      frame.row * cell,
      cell,
      cell,
      -drawSize * 0.5,
      -drawSize + 4,
      drawSize,
      drawSize
    );
    ctx.restore();

    ctx.restore();

    // Active Magic Book orbiting aura ring around fighter
    if (f.activeBook && f.bookTimer > 0) {
      const bColor = ITEMS[f.activeBook].color;
      ctx.save();
      ctx.strokeStyle = bColor;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.ellipse(f.x, f.y + 4, 29, 13, 0, state.time * 2.5, state.time * 2.5 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Slowed frost crystal ring around fighter
    if (f.slowTimer > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.85)';
      ctx.fillStyle = 'rgba(168, 85, 247, 0.16)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y + 4, 27, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Miyako Ice Shield (5s crystalline dome + rotating hexagonal barrier)
    if (f.iceShieldTimer > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(state.time * 10);
      ctx.save();
      ctx.translate(f.x, f.y - 26);
      // Translucent frost sphere
      const grad = ctx.createRadialGradient(0, -6, 6, 0, 0, 44);
      grad.addColorStop(0, 'rgba(220, 250, 255, 0.14)');
      grad.addColorStop(0.75, 'rgba(105, 224, 255, 0.28)');
      grad.addColorStop(1, 'rgba(180, 246, 255, 0.72)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, 42 + pulse * 2, 0, Math.PI * 2);
      ctx.fill();

      // Rotating crystalline hexagon
      ctx.rotate(state.time * 1.4);
      ctx.strokeStyle = 'rgba(225, 252, 255, 0.92)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const px = Math.cos(a) * 41;
        const py = Math.sin(a) * 41;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();

      // 3 orbiting frost crystal diamonds
      for (let i = 0; i < 3; i++) {
        const a = state.time * 2.6 + (i * Math.PI * 2) / 3;
        const cx = Math.cos(a) * 44;
        const cy = Math.sin(a) * 32;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx - 3, cy - 3, 6, 6);
      }
      ctx.restore();
    }

    // Tessel Iaido 5s Hit-Window Pips (shows 1/3, 2/3 hits clearly above head!)
    if (f.charId === 'tessel' && f.iaidoHitCount > 0 && f.iaidoWindowTimer > 0) {
      ctx.save();
      const baseY = f.y - 76;
      for (let i = 0; i < 3; i++) {
        const px = f.x + (i - 1) * 14;
        ctx.fillStyle = i < f.iaidoHitCount ? '#ffe066' : 'rgba(255,255,255,0.25)';
        ctx.strokeStyle = '#182438';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, baseY, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // Mini window countdown bar
      const ratio = f.iaidoWindowTimer / GAME_CONST.TESSEL_IAIDO_WINDOW;
      ctx.fillStyle = 'rgba(10,20,38,0.75)';
      ctx.fillRect(f.x - 20, baseY + 8, 40, 4);
      ctx.fillStyle = '#ffe066';
      ctx.fillRect(f.x - 20, baseY + 8, 40 * ratio, 4);
      ctx.restore();
    }

    // 1.5s Snow Refill Progress Ring around fighter
    if (f.isRefilling && f.refillTimer > 0) {
      const ratio = Math.min(1, f.refillTimer / GAME_CONST.REFILL_HOLD_SECONDS);
      ctx.save();
      ctx.translate(f.x, f.y - (f.isPlayer ? 76 : 96));
      ctx.fillStyle = 'rgba(10, 24, 42, 0.85)';
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#6ce5ff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, 13, -Math.PI * 0.5, -Math.PI * 0.5 + ratio * Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(ratio * 100)}%`, 0, 4);
      ctx.restore();
    }

    // Overhead Name & Mini HP Hearts for AI Brawl Fighters
    if (!f.isPlayer) {
      ctx.save();
      ctx.font = 'bold 11px "Microsoft YaHei", monospace';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#091526';
      ctx.lineWidth = 3;
      ctx.strokeText(f.name, f.x, f.y - 72);
      ctx.fillStyle = charDef.themeColor;
      ctx.fillText(f.name, f.x, f.y - 72);

      // Compact HP pips
      const barW = 46;
      const startX = f.x - barW * 0.5;
      const barY = f.y - 66;
      for (let i = 0; i < f.maxHp; i++) {
        ctx.fillStyle = i < f.hp ? '#ff5b6e' : 'rgba(20, 32, 48, 0.7)';
        ctx.fillRect(startX + i * 9.5, barY, 7.5, 5);
      }
      ctx.restore();
    }
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, state: RenderState, assets: GameAssets): void {
    const img = assets.enemies[e.kind];
    const isBoss = e.kind === 'boss_frost_king';
    const frozen = state.timeFreezeTimer > 0;

    // Ground shadow
    ctx.fillStyle = 'rgba(24, 52, 84, 0.34)';
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + 5, isBoss ? 52 : e.kind === 'yeti' ? 30 : 21, isBoss ? 19 : 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Boss windup danger ring
    if (isBoss && (e.state === 'windup' || e.state === 'charge')) {
      ctx.save();
      ctx.strokeStyle = e.phase === 2 ? '#6ce5ff' : '#ff6b7a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + 4, 62, 24, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(Math.round(e.x), Math.round(e.y + 6));
    if (e.facingLeft) ctx.scale(-1, 1);

    if (isBoss) {
      // 2x2 grid (192x192 per frame)
      const cell = img.width / 2;
      let col = 0;
      let row = 0;
      if (e.state === 'enrage') {
        col = 1;
        row = 1;
      } else if (e.state === 'attack' || e.state === 'windup') {
        col = 0;
        row = 1;
      } else if (e.state === 'charge' || Math.floor(e.animTimer * 4) % 2 === 1) {
        col = 1;
        row = 0;
      }
      const drawSize = 156;
      ctx.drawImage(img, col * cell, row * cell, cell, cell, -drawSize * 0.5, -drawSize + 8, drawSize, drawSize);
    } else {
      // 4x1 strip: [0]=idle, [1]=move, [2]=attack/windup, [3]=hurt
      const cellW = img.width / 4;
      const cellH = img.height;
      let idx = 0;
      if (e.hurtTimer > 0) idx = 3;
      else if (e.state === 'windup' || e.state === 'attack') idx = 2;
      else if (Math.hypot(e.vx, e.vy) > 12) idx = Math.floor(e.animTimer * 6) % 2;

      const drawSize = e.kind === 'yeti' ? 96 : e.kind === 'frost_mage' ? 78 : 66;
      ctx.drawImage(img, idx * cellW, 0, cellW, cellH, -drawSize * 0.5, -drawSize + 6, drawSize, drawSize);
    }
    ctx.restore();

    // Slowed purple-frost shimmer indicator on enemies
    if (e.slowTimer > 0 && !frozen) {
      ctx.save();
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.9)';
      ctx.fillStyle = 'rgba(168, 85, 247, 0.16)';
      ctx.lineWidth = 2;
      const rx = isBoss ? 56 : e.kind === 'yeti' ? 32 : 24;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + 5, rx, rx * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Ice-cube frozen tint indicator when Unianna Time Freeze is active
    if (frozen) {
      ctx.save();
      ctx.strokeStyle = 'rgba(130, 230, 255, 0.78)';
      ctx.fillStyle = 'rgba(110, 215, 255, 0.16)';
      ctx.lineWidth = 2;
      const bw = isBoss ? 105 : 44;
      const bh = isBoss ? 128 : 56;
      ctx.fillRect(e.x - bw * 0.5, e.y - bh, bw, bh);
      ctx.strokeRect(e.x - bw * 0.5, e.y - bh, bw, bh);
      ctx.restore();
    }

    // Mini HP bar for regular enemies
    if (!isBoss && e.hp < e.maxHp) {
      const bw = 38;
      const by = e.y - (e.kind === 'yeti' ? 78 : 62);
      ctx.fillStyle = 'rgba(10, 22, 38, 0.8)';
      ctx.fillRect(e.x - bw * 0.5 - 1, by - 1, bw + 2, 7);
      ctx.fillStyle = '#ff5b6e';
      ctx.fillRect(e.x - bw * 0.5, by, bw * (e.hp / e.maxHp), 5);
    }
  }

  private drawPickupItem(
    ctx: CanvasRenderingContext2D,
    item: PickupItem,
    state: RenderState,
    assets: GameAssets,
    player: Fighter | undefined
  ): void {
    // Blink warning in final 4 seconds before despawn
    if (item.life < 4 && Math.floor(state.time * 10) % 2 === 0) return;

    const def = ITEMS[item.kind];
    const img = assets.items[item.kind];
    const bob = Math.sin(state.time * 4.4 + item.bobPhase) * 5;
    const pulse = 0.5 + 0.5 * Math.sin(state.time * 6 + item.bobPhase);

    // Glowing floor aura ring
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(item.x, item.y + 3, 21 + pulse * 4, 10 + pulse * 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = `${def.color}33`;
    ctx.fill();
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Ground shadow
    ctx.fillStyle = 'rgba(24, 52, 84, 0.28)';
    ctx.beginPath();
    ctx.ellipse(item.x, item.y + 3, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Crisp pixel icon bobbing in 2.5D
    const size = 44;
    ctx.drawImage(img, Math.round(item.x - size * 0.5), Math.round(item.y - size - 4 + bob), size, size);

    // Show crisp item label when player is within 170px
    if (player && Math.hypot(player.x - item.x, player.y - item.y) < 170) {
      ctx.save();
      ctx.font = 'bold 11px "Microsoft YaHei", monospace';
      ctx.textAlign = 'center';
      const label = def.nameZh;
      const tw = ctx.measureText(label).width + 10;
      const ly = item.y - size - 14 + bob;
      ctx.fillStyle = 'rgba(10, 22, 38, 0.84)';
      ctx.fillRect(item.x - tw * 0.5, ly - 13, tw, 17);
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(item.x - tw * 0.5, ly - 13, tw, 17);
      ctx.fillStyle = def.color;
      ctx.fillText(label, item.x, ly);
      ctx.restore();
    }
  }

  private drawSnowball(ctx: CanvasRenderingContext2D, sb: Snowball, time: number): void {
    // 2.5D Ground shadow directly below (x, y)
    const shadowScale = Math.max(0.45, 1 - sb.z / 75);
    ctx.fillStyle = 'rgba(24, 52, 84, 0.28)';
    ctx.beginPath();
    ctx.ellipse(sb.x, sb.y + 2, sb.radius * shadowScale * 1.05, sb.radius * shadowScale * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    const drawY = sb.y - sb.z;

    // Unianna frozen-in-time snowball ring + launch trajectory preview!
    if (sb.frozenByTimeStop) {
      const angle = Math.atan2(sb.storedVy, sb.storedVx);
      const pulse = 0.5 + 0.5 * Math.sin(time * 12 + sb.id);
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 224, 102, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sb.x, drawY, sb.radius + 5 + pulse * 2.5, 0, Math.PI * 2);
      ctx.stroke();

      // Direction arrow showing exact thaw trajectory
      const ax = sb.x + Math.cos(angle) * (sb.radius + 20);
      const ay = drawY + Math.sin(angle) * (sb.radius + 20);
      ctx.beginPath();
      ctx.moveTo(sb.x + Math.cos(angle) * (sb.radius + 6), drawY + Math.sin(angle) * (sb.radius + 6));
      ctx.lineTo(ax, ay);
      ctx.stroke();
      ctx.restore();
    }

    // Glowing aura for Crit / Pierce / Slow enchanted snowballs
    if (sb.isCrit || sb.pierceLeft || sb.appliesSlow) {
      ctx.save();
      ctx.fillStyle = sb.isCrit
        ? 'rgba(255, 217, 61, 0.42)'
        : sb.pierceLeft
          ? 'rgba(74, 222, 128, 0.36)'
          : 'rgba(192, 132, 252, 0.38)';
      ctx.beginPath();
      ctx.arc(sb.x, drawY, sb.radius + 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Crisp pixel-art snowball body
    ctx.save();
    ctx.fillStyle = '#244b73';
    ctx.beginPath();
    ctx.arc(sb.x, drawY, sb.radius + 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = sb.tint || '#eaf7ff';
    ctx.beginPath();
    ctx.arc(sb.x, drawY, sb.radius, 0, Math.PI * 2);
    ctx.fill();

    // Bright top-left snow highlight
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sb.x - sb.radius * 0.3, drawY - sb.radius * 0.3, sb.radius * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawOffscreenIndicators(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: RenderState,
    player: Fighter
  ): void {
    const scale = state.viewScale;
    const targets: Array<{ x: number; y: number; color: string; r: number }> = [];
    for (const e of state.enemies) {
      if (e.alive) targets.push({ x: e.x, y: e.y, color: e.kind === 'boss_frost_king' ? '#ff477e' : '#ff7b54', r: e.kind === 'boss_frost_king' ? 9 : 6 });
    }
    for (const f of state.fighters) {
      if (f.alive && !f.isPlayer) targets.push({ x: f.x, y: f.y, color: CHARACTERS[f.charId].themeColor, r: 7 });
    }
    // If low on snowballs, point to nearest snow pile!
    if (player.snowballs <= 1) {
      let best: Obstacle | null = null;
      let bd = Infinity;
      for (const obs of state.obstacles) {
        if (!obs.isSnowPile) continue;
        const d = Math.hypot(obs.x - player.x, obs.y - player.y);
        if (d < bd) {
          bd = d;
          best = obs;
        }
      }
      if (best) targets.push({ x: best.x, y: best.y, color: '#6ce5ff', r: 7 });
    }

    const pad = 34;
    for (const t of targets) {
      const sx = (t.x - state.cameraX) * scale;
      const sy = (t.y - state.cameraY) * scale;
      if (sx >= 24 && sx <= width - 24 && sy >= 24 && sy <= height - 24) continue;

      const angle = Math.atan2(sy - height * 0.5, sx - width * 0.5);
      const ix = Math.max(pad, Math.min(width - pad, width * 0.5 + Math.cos(angle) * (width * 0.46)));
      const iy = Math.max(70, Math.min(height - 70, height * 0.5 + Math.sin(angle) * (height * 0.42)));

      ctx.save();
      ctx.translate(ix, iy);
      ctx.rotate(angle);
      ctx.fillStyle = t.color;
      ctx.strokeStyle = '#091526';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t.r + 4, 0);
      ctx.lineTo(-t.r, -t.r * 0.8);
      ctx.lineTo(-t.r, t.r * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawMinimap(
    ctx: CanvasRenderingContext2D,
    width: number,
    _height: number,
    state: RenderState,
    player: Fighter
  ): void {
    const isNarrow = width < 680;
    const mmW = isNarrow ? 74 : 132;
    const mmH = Math.round((mmW * state.mapHeight) / state.mapWidth);
    const x0 = width - mmW - 10;
    const y0 = isNarrow ? 122 : 60;

    ctx.save();
    ctx.fillStyle = 'rgba(10, 22, 38, 0.72)';
    ctx.strokeStyle = '#7fd4ff';
    ctx.lineWidth = 2;
    ctx.fillRect(x0, y0, mmW, mmH);
    ctx.strokeRect(x0, y0, mmW, mmH);

    const sx = mmW / state.mapWidth;
    const sy = mmH / state.mapHeight;

    // Snow piles (cyan squares)
    for (const obs of state.obstacles) {
      if (obs.isSnowPile) {
        ctx.fillStyle = '#6ce5ff';
        ctx.fillRect(x0 + obs.x * sx - 2, y0 + obs.y * sy - 2, 4, 4);
      } else if (obs.kind === 'rock_large' || obs.kind === 'tree_large') {
        ctx.fillStyle = 'rgba(160, 195, 225, 0.35)';
        ctx.fillRect(x0 + obs.x * sx - 1, y0 + obs.y * sy - 1, 2, 2);
      }
    }

    // Pickup Items (twinkling gold diamonds on minimap)
    for (const item of state.pickupItems) {
      ctx.fillStyle = ITEMS[item.kind].color;
      ctx.fillRect(x0 + item.x * sx - 2, y0 + item.y * sy - 2, 4, 4);
    }

    // Enemies
    for (const e of state.enemies) {
      if (!e.alive) continue;
      ctx.fillStyle = e.kind === 'boss_frost_king' ? '#ff3366' : '#ff7b54';
      const r = e.kind === 'boss_frost_king' ? 4 : 2.5;
      ctx.beginPath();
      ctx.arc(x0 + e.x * sx, y0 + e.y * sy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Brawl AI fighters
    for (const f of state.fighters) {
      if (!f.alive || f.isPlayer) continue;
      ctx.fillStyle = CHARACTERS[f.charId].themeColor;
      ctx.beginPath();
      ctx.arc(x0 + f.x * sx, y0 + f.y * sy, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player (bright gold dot)
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.arc(x0 + player.x * sx, y0 + player.y * sy, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
