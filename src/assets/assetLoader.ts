import { CharacterId, EnemyKind, ObstacleKind } from '../types';

export interface GameAssets {
  characters: Record<CharacterId, HTMLImageElement>;
  enemies: Record<EnemyKind, HTMLImageElement>;
  props: Record<ObstacleKind, HTMLImageElement>;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error(`Failed to load image: ${src} (${String(err)})`));
    img.src = src;
  });
}

let cachedAssets: GameAssets | null = null;

export async function loadAllAssets(): Promise<GameAssets> {
  if (cachedAssets) return cachedAssets;

  const [
    unianna,
    kuki,
    miyako,
    tessel,
    snow_sprite,
    yeti,
    frost_mage,
    boss_frost_king,
    tree_large,
    tree_small,
    rock_large,
    rock_medium,
    snow_pile,
    snow_fort,
    fallen_log,
    stump_crystal,
  ] = await Promise.all([
    loadImage('./assets/sprites/unianna.png'),
    loadImage('./assets/sprites/kuki.png'),
    loadImage('./assets/sprites/miyako.png'),
    loadImage('./assets/sprites/tessel.png'),
    loadImage('./assets/enemies/snow_sprite.png'),
    loadImage('./assets/enemies/yeti.png'),
    loadImage('./assets/enemies/frost_mage.png'),
    loadImage('./assets/enemies/boss_frost_king.png'),
    loadImage('./assets/tiles/tree_large.png'),
    loadImage('./assets/tiles/tree_small.png'),
    loadImage('./assets/tiles/rock_large.png'),
    loadImage('./assets/tiles/rock_medium.png'),
    loadImage('./assets/tiles/snow_pile.png'),
    loadImage('./assets/tiles/snow_fort.png'),
    loadImage('./assets/tiles/fallen_log.png'),
    loadImage('./assets/tiles/stump_crystal.png'),
  ]);

  cachedAssets = {
    characters: { unianna, kuki, miyako, tessel },
    enemies: { snow_sprite, yeti, frost_mage, boss_frost_king },
    props: {
      tree_large,
      tree_small,
      rock_large,
      rock_medium,
      snow_pile,
      snow_fort,
      fallen_log,
      stump_crystal,
    },
  };

  return cachedAssets;
}
