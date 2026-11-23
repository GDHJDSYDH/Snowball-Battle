import { IcePatch, Obstacle, ObstacleKind } from '../types';

export interface GeneratedMap {
  width: number;
  height: number;
  obstacles: Obstacle[];
  icePatches: IcePatch[];
  spawnPoints: Array<{ x: number; y: number }>;
  groundPatternCanvas: HTMLCanvasElement;
}

interface PropSpec {
  radiusX: number;
  radiusY: number;
  blocksMovement: boolean;
  blocksSnowball: boolean;
  isSnowPile: boolean;
  canopyHeight: number;
  drawWidth: number;
  drawHeight: number;
}

export const PROP_SPECS: Record<ObstacleKind, PropSpec> = {
  tree_large: {
    radiusX: 20,
    radiusY: 14,
    blocksMovement: true,
    blocksSnowball: true,
    isSnowPile: false,
    canopyHeight: 112,
    drawWidth: 84,
    drawHeight: 156,
  },
  tree_small: {
    radiusX: 17,
    radiusY: 12,
    blocksMovement: true,
    blocksSnowball: true,
    isSnowPile: false,
    canopyHeight: 74,
    drawWidth: 74,
    drawHeight: 104,
  },
  rock_large: {
    radiusX: 36,
    radiusY: 22,
    blocksMovement: true,
    blocksSnowball: true,
    isSnowPile: false,
    canopyHeight: 0,
    drawWidth: 86,
    drawHeight: 106,
  },
  rock_medium: {
    radiusX: 34,
    radiusY: 20,
    blocksMovement: true,
    blocksSnowball: true,
    isSnowPile: false,
    canopyHeight: 0,
    drawWidth: 86,
    drawHeight: 74,
  },
  snow_pile: {
    radiusX: 34,
    radiusY: 22,
    blocksMovement: true,
    blocksSnowball: true,
    isSnowPile: true,
    canopyHeight: 0,
    drawWidth: 86,
    drawHeight: 78,
  },
  snow_fort: {
    radiusX: 36,
    radiusY: 22,
    blocksMovement: true,
    blocksSnowball: true,
    isSnowPile: true,
    canopyHeight: 0,
    drawWidth: 88,
    drawHeight: 72,
  },
  fallen_log: {
    // Low 2.5D obstacle: blocks walking, snowballs fly cleanly OVER it!
    radiusX: 40,
    radiusY: 18,
    blocksMovement: true,
    blocksSnowball: false,
    isSnowPile: false,
    canopyHeight: 0,
    drawWidth: 96,
    drawHeight: 74,
  },
  stump_crystal: {
    radiusX: 28,
    radiusY: 18,
    blocksMovement: true,
    blocksSnowball: true,
    isSnowPile: false,
    canopyHeight: 0,
    drawWidth: 76,
    drawHeight: 66,
  },
};

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Generates a tileable crisp 256x256 pixel-art snowfield ground texture.
 */
function createSnowGroundTile(seed: number): HTMLCanvasElement {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const rand = seededRandom(seed + 919);

  // Base crisp snow blue-white tone
  ctx.fillStyle = '#e5f2fc';
  ctx.fillRect(0, 0, size, size);

  // Soft snowdrift undulations (pixelated 4px blocks)
  for (let i = 0; i < 24; i++) {
    const x = Math.floor(rand() * 64) * 4;
    const y = Math.floor(rand() * 64) * 4;
    const w = (4 + Math.floor(rand() * 9)) * 4;
    const h = (2 + Math.floor(rand() * 5)) * 4;
    ctx.fillStyle = i % 2 === 0 ? '#eef7ff' : '#d8eaf8';
    ctx.fillRect(x, y, w, h);
    // Tile wrap
    if (x + w > size) ctx.fillRect(x - size, y, w, h);
    if (y + h > size) ctx.fillRect(x, y - size, w, h);
  }

  // Subtle pixel snow sparkles & tiny pebbles
  for (let i = 0; i < 65; i++) {
    const x = Math.floor(rand() * 64) * 4;
    const y = Math.floor(rand() * 64) * 4;
    const r = rand();
    if (r < 0.5) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, 4, 4);
    } else if (r < 0.85) {
      ctx.fillStyle = '#c8dff2';
      ctx.fillRect(x, y, 4, 4);
    } else {
      ctx.fillStyle = '#b7d2e8';
      ctx.fillRect(x, y, 8, 4);
    }
  }

  return c;
}

export function generateSnowfieldMap(
  width: number,
  height: number,
  seed: number,
  options: { isBossStage: boolean; hasIcePatches: boolean; isBrawl: boolean }
): GeneratedMap {
  const rand = seededRandom(seed);
  const obstacles: Obstacle[] = [];
  const icePatches: IcePatch[] = [];
  let nextId = 1;

  const cx = width * 0.5;
  const cy = height * 0.5;

  // Protected spawn zones (no obstacles placed inside these)
  const spawnPoints: Array<{ x: number; y: number }> = options.isBrawl
    ? [
        { x: width * 0.25, y: height * 0.28 },
        { x: width * 0.75, y: height * 0.28 },
        { x: width * 0.25, y: height * 0.72 },
        { x: width * 0.75, y: height * 0.72 },
      ]
    : [{ x: cx, y: options.isBossStage ? height * 0.74 : cy }];

  const canPlace = (x: number, y: number, rx: number, ry: number, minGap = 54): boolean => {
    const margin = 110;
    if (x < margin || x > width - margin || y < margin || y > height - margin) return false;

    for (const sp of spawnPoints) {
      if (Math.hypot(x - sp.x, y - sp.y) < 135) return false;
    }
    if (options.isBossStage && Math.hypot(x - cx, y - height * 0.3) < 175) {
      return false; // Keep Boss spawn arena clear
    }

    for (const obs of obstacles) {
      const dx = x - obs.x;
      const dy = y - obs.y;
      const dist = Math.hypot(dx, dy);
      const minD = Math.max(rx, ry) + Math.max(obs.radiusX, obs.radiusY) + minGap;
      if (dist < minD) return false;
    }
    return true;
  };

  const addObs = (kind: ObstacleKind, x: number, y: number) => {
    const spec = PROP_SPECS[kind];
    obstacles.push({
      id: nextId++,
      kind,
      x,
      y,
      ...spec,
    });
  };

  // 1. Perimeter snow-pine forest framing for cozy 2.5D snowfield edge feel
  const borderSpacing = 125;
  for (let x = 70; x <= width - 70; x += borderSpacing) {
    const jitterY = (rand() - 0.5) * 28;
    addObs(rand() > 0.35 ? 'tree_large' : 'tree_small', x + (rand() - 0.5) * 24, 62 + jitterY);
    addObs(rand() > 0.35 ? 'tree_large' : 'tree_small', x + (rand() - 0.5) * 24, height - 38 + jitterY * 0.4);
  }
  for (let y = 175; y <= height - 150; y += borderSpacing) {
    addObs(rand() > 0.4 ? 'tree_large' : 'tree_small', 56 + (rand() - 0.5) * 20, y);
    addObs(rand() > 0.4 ? 'tree_large' : 'tree_small', width - 56 + (rand() - 0.5) * 20, y);
  }

  // 2. Strategic evenly-spaced Snow Piles (雪堆) so player & AI always have tactical refill points
  if (options.isBossStage) {
    // 4 reliable corner snow piles + 2 mid-flank piles
    const bossPiles = [
      { x: width * 0.22, y: height * 0.28 },
      { x: width * 0.78, y: height * 0.28 },
      { x: width * 0.22, y: height * 0.74 },
      { x: width * 0.78, y: height * 0.74 },
      { x: width * 0.5, y: height * 0.56 },
    ];
    for (const p of bossPiles) {
      addObs(rand() > 0.4 ? 'snow_pile' : 'snow_fort', p.x, p.y);
    }
    // Tactical cover rocks & logs around the boss arena
    const bossCover: Array<{ kind: ObstacleKind; x: number; y: number }> = [
      { kind: 'rock_large', x: width * 0.33, y: height * 0.42 },
      { kind: 'rock_large', x: width * 0.67, y: height * 0.42 },
      { kind: 'fallen_log', x: width * 0.35, y: height * 0.64 },
      { kind: 'fallen_log', x: width * 0.65, y: height * 0.64 },
      { kind: 'stump_crystal', x: width * 0.5, y: height * 0.82 },
    ];
    for (const c of bossCover) {
      addObs(c.kind, c.x, c.y);
    }
  } else {
    // Sector grid placement for snow piles (ensures no dead zones without snow)
    const cols = 4;
    const rows = 3;
    const cellW = (width - 280) / cols;
    const cellH = (height - 280) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Place ~10 snow piles across the 12 sectors
        if ((r + c) % 5 === 2 && !options.isBrawl) continue;
        for (let attempt = 0; attempt < 25; attempt++) {
          const px = 140 + c * cellW + (0.2 + rand() * 0.6) * cellW;
          const py = 140 + r * cellH + (0.2 + rand() * 0.6) * cellH;
          const kind: ObstacleKind = rand() > 0.35 ? 'snow_pile' : 'snow_fort';
          const spec = PROP_SPECS[kind];
          if (canPlace(px, py, spec.radiusX, spec.radiusY, 70)) {
            addObs(kind, px, py);
            break;
          }
        }
      }
    }

    // 3. Rich mix of winter obstacles: trees, big rocks, medium rocks, fallen logs, crystal stumps
    const targetCount = options.isBrawl ? 36 : 46;
    const pool: ObstacleKind[] = [
      'tree_large',
      'tree_large',
      'tree_small',
      'tree_small',
      'rock_large',
      'rock_large',
      'rock_medium',
      'fallen_log',
      'fallen_log',
      'fallen_log',
      'stump_crystal',
    ];
    let tries = 0;
    let placed = 0;
    while (placed < targetCount && tries < 700) {
      tries++;
      const kind = pool[Math.floor(rand() * pool.length)];
      const spec = PROP_SPECS[kind];
      const px = 150 + rand() * (width - 300);
      const py = 150 + rand() * (height - 300);
      if (canPlace(px, py, spec.radiusX, spec.radiusY, 64)) {
        addObs(kind, px, py);
        placed++;
      }
    }
  }

  // 4. Optional slippery ice patches (Stage 3+ & Brawl)
  if (options.hasIcePatches) {
    const patchCount = options.isBossStage ? 4 : 7;
    for (let i = 0; i < patchCount; i++) {
      icePatches.push({
        x: 240 + rand() * (width - 480),
        y: 220 + rand() * (height - 440),
        rx: 75 + rand() * 55,
        ry: 45 + rand() * 35,
        rotation: (rand() - 0.5) * 0.5,
      });
    }
  }

  return {
    width,
    height,
    obstacles,
    icePatches,
    spawnPoints,
    groundPatternCanvas: createSnowGroundTile(seed),
  };
}
