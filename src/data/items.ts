import { GAME_CONST, ItemDef, ItemKind } from '../types';

export const ITEMS: Record<ItemKind, ItemDef> = {
  bandage: {
    id: 'bandage',
    nameZh: '急救绷带',
    shortLabel: '回血+1',
    icon: '🩹',
    desc: '立即恢复 1 颗心生命值',
    color: '#ff6b81',
    duration: 0,
    isBook: false,
  },
  ice_cream: {
    id: 'ice_cream',
    nameZh: '冬日冰淇淋',
    shortLabel: '疾速',
    icon: '🍦',
    desc: '7 秒内移动速度提升 42%',
    color: '#70e4ff',
    duration: GAME_CONST.ICE_CREAM_DURATION,
    isBook: false,
  },
  hot_cocoa: {
    id: 'hot_cocoa',
    nameZh: '热可可',
    shortLabel: '满球减CD',
    icon: '☕',
    desc: '立即补满雪球，并将技能与冲刺冷却缩减 50%',
    color: '#ffbe76',
    duration: 0,
    isBook: false,
  },
  book_spread: {
    id: 'book_spread',
    nameZh: '绯红魔典·散弹',
    shortLabel: '五发散弹',
    icon: '📕',
    desc: '8 秒内每次投掷齐射 5 颗扇形雪球（仅消耗 1 颗）',
    color: '#ff5252',
    duration: GAME_CONST.BOOK_SPREAD_DURATION,
    isBook: true,
  },
  book_infinite: {
    id: 'book_infinite',
    nameZh: '蔚蓝魔典·永雪',
    shortLabel: '无限雪球',
    icon: '📘',
    desc: '8 秒内投掷不消耗雪球且射速加快',
    color: '#38bdf8',
    duration: GAME_CONST.BOOK_INFINITE_DURATION,
    isBook: true,
  },
  book_slow: {
    id: 'book_slow',
    nameZh: '紫晶魔典·寒滞',
    shortLabel: '寒霜减速',
    icon: '🟪',
    desc: '9 秒内雪球命中目标附加 4 秒 50% 移动减速',
    color: '#c084fc',
    duration: GAME_CONST.BOOK_SLOW_DURATION,
    isBook: true,
  },
  book_crit: {
    id: 'book_crit',
    nameZh: '鎏金魔典·暴击',
    shortLabel: '幸运暴击',
    icon: '📙',
    desc: '9 秒内雪球 45% 概率暴击，造成 2 颗心伤害',
    color: '#ffd93d',
    duration: GAME_CONST.BOOK_CRIT_DURATION,
    isBook: true,
  },
  book_pierce: {
    id: 'book_pierce',
    nameZh: '翠绿魔典·穿透',
    shortLabel: '疾风穿透',
    icon: '📗',
    desc: '8 秒内雪球更迅猛且可连续穿透多名敌人',
    color: '#4ade80',
    duration: GAME_CONST.BOOK_PIERCE_DURATION,
    isBook: true,
  },
};

export const ITEM_KINDS: ItemKind[] = Object.keys(ITEMS) as ItemKind[];

export function pickWeightedRandomItem(preferHeal = false): ItemKind {
  const weights: Array<{ kind: ItemKind; w: number }> = [
    { kind: 'bandage', w: preferHeal ? 26 : 16 },
    { kind: 'ice_cream', w: 16 },
    { kind: 'hot_cocoa', w: 12 },
    { kind: 'book_spread', w: 12 },
    { kind: 'book_infinite', w: 12 },
    { kind: 'book_slow', w: 11 },
    { kind: 'book_crit', w: 11 },
    { kind: 'book_pierce', w: 10 },
  ];
  const total = weights.reduce((acc, it) => acc + it.w, 0);
  let r = Math.random() * total;
  for (const it of weights) {
    r -= it.w;
    if (r <= 0) return it.kind;
  }
  return 'ice_cream';
}

export const LICENSE_INFO = {
  name: 'CC BY-NC-ND 4.0',
  fullName: '知识共享 署名-非商业性使用-禁止演绎 4.0 国际许可协议',
  url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
} as const;

export const OC_CREDITS = [
  { name: '尤妮安娜 (Unianna)', url: 'https://github.com/GDHJDSYDH', platform: 'GitHub' },
  { name: '白雪喵都 (Miyako)', url: 'https://space.bilibili.com/323578640', platform: 'Bilibili' },
  { name: '小苏 (Tessel)', url: 'https://space.bilibili.com/167151070', platform: 'Bilibili' },
  { name: '苏米 (Kuki)', url: 'https://space.bilibili.com/2056346691', platform: 'Bilibili' },
] as const;
