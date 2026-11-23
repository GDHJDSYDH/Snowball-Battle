import { GameAssets } from '../assets/assetLoader';
import { CHARACTERS, CHARACTER_LIST } from '../data/characters';
import { ITEM_KINDS, ITEMS, LICENSE_INFO, OC_CREDITS } from '../data/items';
import { GameEngine } from '../game/gameEngine';
import { BrawlSubMode, CharacterId, GameMode, GameScreen, HudSnapshot } from '../types';

export class UIManager {
  private root: HTMLElement;
  private engine: GameEngine;
  private assets: GameAssets;

  private lastScreen: GameScreen | null = null;
  private lastTouchEnabled: boolean | null = null;
  private selectedChar: CharacterId = 'unianna';
  private selectedMode: GameMode = 'adventure';
  private selectedBrawlSub: BrawlSubMode = 'elimination';

  // Cached dynamic HUD nodes (avoids full DOM rebuild every 50ms -> rock solid mobile touch!)
  private heartsEl: HTMLElement | null = null;
  private snowballsEl: HTMLElement | null = null;
  private buffsEl: HTMLElement | null = null;
  private stagePillEl: HTMLElement | null = null;
  private bossBarEl: HTMLElement | null = null;
  private bossFillEl: HTMLElement | null = null;
  private bossLabelEl: HTMLElement | null = null;
  private bannerEl: HTMLElement | null = null;
  private muteBtnEl: HTMLElement | null = null;
  private touchToggleBtnEl: HTMLElement | null = null;

  // PC ability slots
  private pcDashCdEl: HTMLElement | null = null;
  private pcSkillCdEl: HTMLElement | null = null;
  private pcSkillSlotEl: HTMLElement | null = null;
  private pcSkillNameEl: HTMLElement | null = null;
  private pcRefillSlotEl: HTMLElement | null = null;
  private pcRefillCdEl: HTMLElement | null = null;

  // Mobile touch buttons
  private touchDashCdEl: HTMLElement | null = null;
  private touchSkillCdEl: HTMLElement | null = null;
  private touchSkillIconEl: HTMLElement | null = null;
  private touchRefillBtnEl: HTMLElement | null = null;
  private touchRefillPctEl: HTMLElement | null = null;

  private previewAnimId = 0;

  constructor(root: HTMLElement, engine: GameEngine, assets: GameAssets) {
    this.root = root;
    this.engine = engine;
    this.assets = assets;
  }

  public update(snap: HudSnapshot): void {
    const screenChanged = snap.screen !== this.lastScreen;
    const touchChanged = snap.touchEnabled !== this.lastTouchEnabled;

    if (screenChanged || (snap.screen === 'playing' && touchChanged)) {
      this.lastScreen = snap.screen;
      this.lastTouchEnabled = snap.touchEnabled;
      this.cancelPreviewAnim();

      if (snap.screen === 'menu') {
        this.renderMenu();
      } else if (snap.screen === 'playing') {
        this.renderPlayingHud(snap);
      } else if (snap.screen === 'paused') {
        this.renderModal(
          '游戏暂停',
          ['随时可以继续战斗，或返回主菜单更换角色与模式。'],
          [
            { label: '继续游玩', cls: 'gold', onClick: () => this.engine.togglePause() },
            { label: '重新开始', cls: '', onClick: () => this.engine.restartCurrent() },
            { label: '返回主菜单', cls: 'secondary', onClick: () => this.engine.returnToMenu() },
          ]
        );
      } else if (snap.screen === 'victory' || snap.screen === 'gameover') {
        this.renderModal(
          snap.resultTitle,
          snap.resultSummary,
          [
            { label: '再来一局', cls: 'gold', onClick: () => this.engine.restartCurrent() },
            { label: '返回选人', cls: 'secondary', onClick: () => this.engine.returnToMenu() },
          ]
        );
      }
    }

    if (snap.screen === 'playing') {
      this.patchPlayingHud(snap);
    }
  }

  private cancelPreviewAnim(): void {
    if (this.previewAnimId) {
      cancelAnimationFrame(this.previewAnimId);
      this.previewAnimId = 0;
    }
  }

  private renderMenu(): void {
    this.root.innerHTML = `
      <div class="screen-overlay">
        <div class="title-banner">
          <h1>❄️ SNOWBALL BATTLE ❄️</h1>
          <div class="subtitle">2.5D 像素风打雪仗 · 冒险闯关 & 四人混战</div>
        </div>

        <div class="pixel-panel menu-container">
          <div>
            <div class="section-label">
              <span>1. 选择出战角色</span>
              <span style="color:#9ec1de;font-size:11px;">血量 5♥ · 雪球上限 6 · 补球 1s · 冲刺 CD 3s</span>
            </div>
            <div class="char-grid" id="char-grid">
              ${CHARACTER_LIST.map(
                (c) => `
                <div class="char-card ${c.id === this.selectedChar ? 'selected' : ''}" data-char="${c.id}">
                  <div class="char-preview-wrap">
                    <canvas class="char-preview-canvas" width="96" height="96" data-preview="${c.id}"></canvas>
                  </div>
                  <div class="char-name">${c.nameZh}</div>
                  <div class="char-en">${c.nameEn}</div>
                  <div class="char-skill-badge">${c.skillIcon} ${c.skillName}</div>
                  <div class="char-skill-desc">${c.skillDesc}</div>
                </div>
              `
              ).join('')}
            </div>
          </div>

          <div>
            <div class="section-label"><span>2. 选择游戏模式</span></div>
            <div class="mode-row">
              <div class="mode-card ${this.selectedMode === 'adventure' ? 'selected' : ''}" data-mode="adventure">
                <div class="mode-title">
                  <span>🏔️ 冒险模式 (5关 + BOSS战)</span>
                  <span style="color:#ffd966;font-size:11px;">PVE 闯关</span>
                </div>
                <div class="mode-desc">操控所选角色深入巨大雪原，迎战雪精灵、雪怪、冰霜术士，最终挑战双阶段 BOSS「极寒霜王」！</div>
              </div>
              <div class="mode-card ${this.selectedMode === 'brawl' ? 'selected' : ''}" data-mode="brawl">
                <div class="mode-title">
                  <span>⚔️ 混战模式 (4人AI大乱斗)</span>
                  <span style="color:#6ce5ff;font-size:11px;">1人 + 3AI</span>
                </div>
                <div class="mode-desc">四位主角同场雪地乱斗！其余三位由专属策略 AI 操控，会走位补雪、冲刺闪避并释放各自大招！</div>
                <div class="brawl-submodes">
                  <button class="mini-chip ${this.selectedBrawlSub === 'elimination' ? 'active' : ''}" data-sub="elimination">生存淘汰赛</button>
                  <button class="mini-chip ${this.selectedBrawlSub === 'score' ? 'active' : ''}" data-sub="score">2分钟积分赛</button>
                </div>
              </div>
            </div>
          </div>

          <div class="start-bar">
            <div class="controls-hint">
              <div><b>电脑：</b><kbd>WASD</kbd>/<kbd>方向键</kbd>移动 · <kbd>左键</kbd>瞄准投掷 · <kbd>Z</kbd>冲刺 · <kbd>R</kbd>雪堆旁长按1s补球 · <kbd>X</kbd>/<kbd>E</kbd>/<kbd>右键</kbd>技能</div>
              <div><b>手机：</b>左侧摇杆移动 · <b>点击/按住屏幕任意位置</b>直接朝该处发射雪球 · 右下角 冲刺 / 技能 / 雪堆旁长按1s装填</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <button class="pixel-btn secondary" id="btn-item-guide" style="font-size:13px;padding:10px 14px;">
                📖 道具图鉴
              </button>
              <button class="pixel-btn gold" id="btn-start-game" style="font-size:17px;padding:12px 26px;">
                ❄️ 开始打雪仗!
              </button>
            </div>
          </div>

          <div class="credits-footer">
            <div class="credits-links">
              <span style="color:#ffd966;font-weight:700;">OC 形象归属：</span>
              ${OC_CREDITS.map(
                (oc) => `<a href="${oc.url}" target="_blank" rel="noopener noreferrer">${oc.name}</a>`
              ).join(' · ')}
            </div>
            <div class="credits-links">
              <span>版权协议：</span>
              <a href="${LICENSE_INFO.url}" target="_blank" rel="noopener noreferrer">${LICENSE_INFO.name}</a>
            </div>
          </div>
        </div>
      </div>
      <div id="guide-modal-slot"></div>
    `;

    // Bind character selection
    this.root.querySelectorAll<HTMLElement>('.char-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.selectedChar = card.dataset.char as CharacterId;
        this.root.querySelectorAll('.char-card').forEach((el) => el.classList.remove('selected'));
        card.classList.add('selected');
      });
    });

    // Bind mode selection
    this.root.querySelectorAll<HTMLElement>('.mode-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.selectedMode = card.dataset.mode as GameMode;
        this.root.querySelectorAll('.mode-card').forEach((el) => el.classList.remove('selected'));
        card.classList.add('selected');
      });
    });

    // Bind Brawl submode chips
    this.root.querySelectorAll<HTMLElement>('.mini-chip').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedMode = 'brawl';
        this.selectedBrawlSub = chip.dataset.sub as BrawlSubMode;
        this.root.querySelectorAll('.mode-card').forEach((el) => {
          el.classList.toggle('selected', (el as HTMLElement).dataset.mode === 'brawl');
        });
        this.root.querySelectorAll('.mini-chip').forEach((el) => el.classList.remove('active'));
        chip.classList.add('active');
      });
    });

    // Start Game button
    const startBtn = this.root.querySelector('#btn-start-game');
    startBtn?.addEventListener('click', () => {
      this.engine.startNewGame(this.selectedChar, this.selectedMode, this.selectedBrawlSub);
    });

    // Item Guide & License Info Modal button
    const guideBtn = this.root.querySelector('#btn-item-guide');
    guideBtn?.addEventListener('click', () => this.openItemGuideModal());

    // Animate the 4 chibi pixel character previews live on the select cards!
    const previewCanvases = Array.from(this.root.querySelectorAll<HTMLCanvasElement>('.char-preview-canvas'));
    let tick = 0;
    const animatePreviews = () => {
      tick++;
      const frameCol = Math.floor(tick / 22) % 4;
      for (const c of previewCanvases) {
        const cid = c.dataset.preview as CharacterId;
        const img = this.assets.characters[cid];
        const ctx = c.getContext('2d');
        if (!ctx || !img) continue;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, c.width, c.height);
        const cell = img.width / 4;
        // Selected card shows skill/walk animation; others gently bounce idle!
        const isSel = cid === this.selectedChar;
        const row = isSel && frameCol === 3 ? 3 : 0;
        const col = isSel ? (row === 3 ? 2 : frameCol) : frameCol % 2;
        ctx.drawImage(img, col * cell, row * cell, cell, cell, 0, 0, c.width, c.height);
      }
      this.previewAnimId = requestAnimationFrame(animatePreviews);
    };
    this.previewAnimId = requestAnimationFrame(animatePreviews);
  }

  private renderPlayingHud(snap: HudSnapshot): void {
    const charDef = CHARACTERS[snap.player.charId];
    const touchHtml = snap.touchEnabled
      ? `
        <div class="touch-layer">
          <div class="joystick-zone" id="joy-zone">
            <div class="joystick-base"></div>
            <div class="joystick-knob" id="joy-knob"></div>
          </div>
          <div class="touch-actions">
            <button class="touch-btn touch-btn-skill" id="t-skill">
              <span id="t-skill-icon" style="font-size:20px;">${charDef.skillIcon}</span>
              <span>技能</span>
              <div class="touch-cd" id="t-skill-cd" style="display:none;"></div>
            </button>
            <button class="touch-btn touch-btn-dash" id="t-dash">
              <span style="font-size:18px;">💨</span>
              <span>冲刺</span>
              <div class="touch-cd" id="t-dash-cd" style="display:none;"></div>
            </button>
            <button class="touch-btn touch-btn-refill" id="t-refill">
              <span style="font-size:17px;">⛄</span>
              <span id="t-refill-pct">装填</span>
            </button>
          </div>
        </div>
      `
      : `
        <div class="pixel-panel pc-ability-bar">
          <div class="ability-slot ready">
            <span class="ability-key">左键</span>
            <span class="ability-icon">❄️</span>
            <span class="ability-name">雪球</span>
          </div>
          <div class="ability-slot ready" id="pc-dash-slot">
            <span class="ability-key">Z</span>
            <span class="ability-icon">💨</span>
            <span class="ability-name">冲刺</span>
            <div class="ability-cd-mask" id="pc-dash-cd" style="display:none;"></div>
          </div>
          <div class="ability-slot" id="pc-refill-slot">
            <span class="ability-key">长按R</span>
            <span class="ability-icon">⛄</span>
            <span class="ability-name">补球1s</span>
            <div class="ability-cd-mask" id="pc-refill-cd" style="display:none;"></div>
          </div>
          <div class="ability-slot ready" id="pc-skill-slot">
            <span class="ability-key">X/右键</span>
            <span class="ability-icon">${charDef.skillIcon}</span>
            <span class="ability-name" id="pc-skill-name">${charDef.skillName}</span>
            <div class="ability-cd-mask" id="pc-skill-cd" style="display:none;"></div>
          </div>
        </div>
      `;

    this.root.innerHTML = `
      <div class="hud-top">
        <div class="pixel-panel hud-player-box">
          <div class="hud-row" style="justify-content:space-between;">
            <span style="font-size:13px;font-weight:800;color:${charDef.themeColor};">${charDef.nameZh}</span>
            <span style="font-size:11px;color:#9ec1de;">${charDef.skillIcon} ${charDef.skillName}</span>
          </div>
          <div class="hud-row" id="hud-hearts"></div>
          <div class="hud-row" id="hud-snowballs"></div>
          <div class="buff-bar" id="hud-buffs"></div>
        </div>

        <div class="hud-center">
          <div class="pixel-panel stage-pill" id="hud-stage-pill"></div>
          <div class="pixel-panel boss-hp-bar" id="hud-boss-bar" style="display:none;">
            <div class="boss-hp-label" id="hud-boss-label"></div>
            <div class="boss-hp-track">
              <div class="boss-hp-fill" id="hud-boss-fill" style="width:100%;"></div>
            </div>
          </div>
        </div>

        <div class="hud-right-tools">
          <button class="pixel-btn secondary icon-btn" id="btn-touch-toggle" title="切换触屏/键鼠界面">📱</button>
          <button class="pixel-btn secondary icon-btn" id="btn-mute" title="开关音效">🔊</button>
          <button class="pixel-btn secondary icon-btn" id="btn-pause" title="暂停">⏸</button>
        </div>
      </div>

      <div class="center-banner pixel-panel" id="hud-banner" style="display:none;"></div>

      ${touchHtml}
    `;

    // Cache DOM refs
    this.heartsEl = this.root.querySelector('#hud-hearts');
    this.snowballsEl = this.root.querySelector('#hud-snowballs');
    this.buffsEl = this.root.querySelector('#hud-buffs');
    this.stagePillEl = this.root.querySelector('#hud-stage-pill');
    this.bossBarEl = this.root.querySelector('#hud-boss-bar');
    this.bossFillEl = this.root.querySelector('#hud-boss-fill');
    this.bossLabelEl = this.root.querySelector('#hud-boss-label');
    this.bannerEl = this.root.querySelector('#hud-banner');
    this.muteBtnEl = this.root.querySelector('#btn-mute');
    this.touchToggleBtnEl = this.root.querySelector('#btn-touch-toggle');

    this.pcDashCdEl = this.root.querySelector('#pc-dash-cd');
    this.pcSkillCdEl = this.root.querySelector('#pc-skill-cd');
    this.pcSkillSlotEl = this.root.querySelector('#pc-skill-slot');
    this.pcSkillNameEl = this.root.querySelector('#pc-skill-name');
    this.pcRefillSlotEl = this.root.querySelector('#pc-refill-slot');
    this.pcRefillCdEl = this.root.querySelector('#pc-refill-cd');

    this.touchDashCdEl = this.root.querySelector('#t-dash-cd');
    this.touchSkillCdEl = this.root.querySelector('#t-skill-cd');
    this.touchSkillIconEl = this.root.querySelector('#t-skill-icon');
    this.touchRefillBtnEl = this.root.querySelector('#t-refill');
    this.touchRefillPctEl = this.root.querySelector('#t-refill-pct');

    // Bind top toolbar buttons
    this.root.querySelector('#btn-pause')?.addEventListener('click', () => this.engine.togglePause());
    this.muteBtnEl?.addEventListener('click', () => this.engine.toggleMute());
    this.touchToggleBtnEl?.addEventListener('click', () => this.engine.toggleTouchControls());

    if (snap.touchEnabled) {
      this.bindMobileTouchEvents();
    }
  }

  private bindMobileTouchEvents(): void {
    // 1. Virtual Joystick (multi-touch pointer safe!)
    const joyZone = this.root.querySelector<HTMLElement>('#joy-zone');
    const joyKnob = this.root.querySelector<HTMLElement>('#joy-knob');
    let joyPointerId: number | null = null;
    const maxR = 46;

    const updateJoy = (clientX: number, clientY: number) => {
      if (!joyZone || !joyKnob) return;
      const rect = joyZone.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > maxR) {
        dx = (dx / d) * maxR;
        dy = (dy / d) * maxR;
      }
      joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.engine.input.setJoystick(dx / maxR, dy / maxR);
    };

    joyZone?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      joyPointerId = e.pointerId;
      joyZone.setPointerCapture(e.pointerId);
      updateJoy(e.clientX, e.clientY);
    });
    joyZone?.addEventListener('pointermove', (e) => {
      if (e.pointerId !== joyPointerId) return;
      e.preventDefault();
      updateJoy(e.clientX, e.clientY);
    });
    const endJoy = (e: PointerEvent) => {
      if (e.pointerId !== joyPointerId) return;
      joyPointerId = null;
      if (joyKnob) joyKnob.style.transform = 'translate(0px, 0px)';
      this.engine.input.setJoystick(0, 0);
    };
    joyZone?.addEventListener('pointerup', endJoy);
    joyZone?.addEventListener('pointercancel', endJoy);

    // 2. Dash Button (Throwing is now handled directly by tapping anywhere on the screen!)
    const dashBtn = this.root.querySelector<HTMLElement>('#t-dash');
    dashBtn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.engine.input.triggerTouchDash();
    });

    // 3. Special Skill Button
    const skillBtn = this.root.querySelector<HTMLElement>('#t-skill');
    skillBtn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.engine.input.triggerTouchSkill();
    });

    // 4. Hold-to-Refill Button (1.0s near snow pile!)
    const refillBtn = this.root.querySelector<HTMLElement>('#t-refill');
    refillBtn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      refillBtn.setPointerCapture(e.pointerId);
      refillBtn.classList.add('pressed');
      this.engine.input.setTouchRefill(true);
    });
    const endRefill = () => {
      refillBtn?.classList.remove('pressed');
      this.engine.input.setTouchRefill(false);
    };
    refillBtn?.addEventListener('pointerup', endRefill);
    refillBtn?.addEventListener('pointercancel', endRefill);
  }

  private patchPlayingHud(snap: HudSnapshot): void {
    const p = snap.player;
    const charDef = CHARACTERS[p.charId];

    // Hearts
    if (this.heartsEl) {
      let html = '';
      for (let i = 0; i < p.maxHp; i++) {
        html += `<span class="heart-icon ${i < p.hp ? '' : 'empty'}">❤️</span>`;
      }
      this.heartsEl.innerHTML = html;
    }

    // Snowballs (5 pips)
    if (this.snowballsEl) {
      let html = '';
      for (let i = 0; i < p.maxSnowballs; i++) {
        html += `<span class="snowball-pip ${i < p.snowballs ? '' : 'empty'}"></span>`;
      }
      const hasInf = p.buffs.some((b) => b.id === 'book_infinite');
      html += `<span style="font-size:11px;color:${hasInf ? '#70e4ff' : '#cde7ff'};margin-left:4px;">${hasInf ? '∞' : `${p.snowballs}/${p.maxSnowballs}`}</span>`;
      this.snowballsEl.innerHTML = html;
    }

    // Active Pickup Buffs (Ice Cream, 5 Magic Books, Slow debuff)
    if (this.buffsEl) {
      if (p.buffs.length === 0) {
        this.buffsEl.innerHTML = '';
      } else {
        this.buffsEl.innerHTML = p.buffs
          .map(
            (b) =>
              `<span class="buff-pill" style="border-color:${b.color};color:${b.color};">${b.icon} ${b.label} ${b.remaining.toFixed(1)}s</span>`
          )
          .join('');
      }
    }

    // Top Center Stage / Brawl Info
    if (this.stagePillEl) {
      if (snap.mode === 'adventure') {
        this.stagePillEl.textContent = `${snap.stageTitle}  |  剩余敌人: ${snap.enemiesRemaining}`;
      } else if (snap.brawlSubMode === 'elimination') {
        const aliveCount = snap.brawlBoard.filter((b) => b.alive).length;
        this.stagePillEl.innerHTML = `⚔️ 混战淘汰 · 存活 ${aliveCount}/4  ` +
          snap.brawlBoard
            .map((b) => `<span style="color:${b.alive ? CHARACTERS[b.charId].themeColor : '#667788'};margin-left:6px;font-size:11px;">${b.name}${b.alive ? `(${b.hp}♥)` : '✗'}</span>`)
            .join('');
      } else {
        const sec = Math.ceil(snap.brawlTimer);
        const mm = Math.floor(sec / 60);
        const ss = String(sec % 60).padStart(2, '0');
        this.stagePillEl.innerHTML = `⏱ ${mm}:${ss}  ` +
          snap.brawlBoard
            .map((b) => `<span style="color:${CHARACTERS[b.charId].themeColor};margin-left:6px;font-size:11px;">${b.name}:${b.kills}</span>`)
            .join('');
      }
    }

    // Boss HP Bar
    if (this.bossBarEl && this.bossFillEl && this.bossLabelEl) {
      if (snap.boss) {
        this.bossBarEl.style.display = 'block';
        this.bossLabelEl.innerHTML = `<span>👑 ${snap.boss.name}</span><span>${snap.boss.hp} / ${snap.boss.maxHp}</span>`;
        this.bossFillEl.style.width = `${Math.max(0, (snap.boss.hp / snap.boss.maxHp) * 100)}%`;
      } else {
        this.bossBarEl.style.display = 'none';
      }
    }

    // Center Banner
    if (this.bannerEl) {
      if (snap.bannerText) {
        this.bannerEl.style.display = 'block';
        this.bannerEl.innerHTML = `<div>${snap.bannerText}</div>${
          snap.bannerSub ? `<div style="font-size:13px;font-weight:500;color:#bce8ff;margin-top:4px;">${snap.bannerSub}</div>` : ''
        }`;
      } else {
        this.bannerEl.style.display = 'none';
      }
    }

    if (this.muteBtnEl) this.muteBtnEl.textContent = snap.muted ? '🔇' : '🔊';
    if (this.touchToggleBtnEl) this.touchToggleBtnEl.textContent = snap.touchEnabled ? '🖥️' : '📱';

    // Ability cooldowns (PC)
    if (this.pcDashCdEl) {
      if (p.dashCd > 0) {
        this.pcDashCdEl.style.display = 'flex';
        this.pcDashCdEl.textContent = `${p.dashCd.toFixed(1)}s`;
      } else {
        this.pcDashCdEl.style.display = 'none';
      }
    }

    if (this.pcRefillSlotEl && this.pcRefillCdEl) {
      this.pcRefillSlotEl.classList.toggle('highlight', p.nearSnowPile && p.snowballs < p.maxSnowballs);
      if (p.refillProgress > 0) {
        this.pcRefillCdEl.style.display = 'flex';
        this.pcRefillCdEl.textContent = `${Math.round(p.refillProgress * 100)}%`;
      } else {
        this.pcRefillCdEl.style.display = 'none';
      }
    }

    if (this.pcSkillCdEl && this.pcSkillSlotEl && this.pcSkillNameEl) {
      this.pcSkillSlotEl.classList.toggle('active', p.skillActiveTimer > 0);
      if (p.charId === 'tessel' && p.iaidoHitCount > 0 && p.skillCd <= 0) {
        this.pcSkillNameEl.textContent = `斩 ${p.iaidoHitCount}/3`;
      } else {
        this.pcSkillNameEl.textContent = charDef.skillName;
      }

      if (p.skillActiveTimer > 0) {
        this.pcSkillCdEl.style.display = 'flex';
        this.pcSkillCdEl.style.background = 'rgba(20, 72, 118, 0.55)';
        this.pcSkillCdEl.textContent = `${p.skillActiveTimer.toFixed(1)}s`;
      } else if (p.skillCd > 0) {
        this.pcSkillCdEl.style.display = 'flex';
        this.pcSkillCdEl.style.background = 'rgba(5, 11, 22, 0.78)';
        this.pcSkillCdEl.textContent = `${Math.ceil(p.skillCd)}s`;
      } else {
        this.pcSkillCdEl.style.display = 'none';
      }
    }

    // Ability cooldowns (Mobile Touch)
    if (this.touchDashCdEl) {
      if (p.dashCd > 0) {
        this.touchDashCdEl.style.display = 'flex';
        this.touchDashCdEl.textContent = `${p.dashCd.toFixed(1)}`;
      } else {
        this.touchDashCdEl.style.display = 'none';
      }
    }

    if (this.touchSkillCdEl) {
      if (p.skillActiveTimer > 0) {
        this.touchSkillCdEl.style.display = 'flex';
        this.touchSkillCdEl.style.background = 'rgba(20, 72, 118, 0.52)';
        this.touchSkillCdEl.textContent = `${p.skillActiveTimer.toFixed(1)}s`;
      } else if (p.skillCd > 0) {
        this.touchSkillCdEl.style.display = 'flex';
        this.touchSkillCdEl.style.background = 'rgba(8, 16, 30, 0.78)';
        this.touchSkillCdEl.textContent = `${Math.ceil(p.skillCd)}s`;
      } else {
        this.touchSkillCdEl.style.display = 'none';
      }
    }
    if (this.touchSkillIconEl && p.charId === 'tessel' && p.iaidoHitCount > 0 && p.skillCd <= 0) {
      this.touchSkillIconEl.textContent = `${p.iaidoHitCount}/3`;
    } else if (this.touchSkillIconEl) {
      this.touchSkillIconEl.textContent = charDef.skillIcon;
    }

    if (this.touchRefillBtnEl && this.touchRefillPctEl) {
      this.touchRefillBtnEl.classList.toggle('near-pile', p.nearSnowPile && p.snowballs < p.maxSnowballs);
      this.touchRefillPctEl.textContent = p.refillProgress > 0 ? `${Math.round(p.refillProgress * 100)}%` : '装填';
    }
  }

  private openItemGuideModal(): void {
    const slot = this.root.querySelector('#guide-modal-slot');
    if (!slot) return;
    slot.innerHTML = `
      <div class="screen-overlay" style="z-index:40;">
        <div class="pixel-panel modal-box" style="width:min(680px, 94vw);">
          <h2>📖 雪地道具与五色魔典图鉴</h2>
          <div class="item-guide-grid">
            ${ITEM_KINDS.map((k) => {
              const it = ITEMS[k];
              return `
                <div class="item-guide-row" style="border-color:${it.color}88;">
                  <img src="./assets/items/${it.id}.png" alt="${it.nameZh}" />
                  <div>
                    <div style="font-size:12px;font-weight:800;color:${it.color};">${it.nameZh}</div>
                    <div style="font-size:11px;color:#d6e9fa;line-height:1.35;margin-top:2px;">${it.desc}</div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          <div style="font-size:11px;color:#9ec1de;line-height:1.6;">
            <div>版权协议：<a href="${LICENSE_INFO.url}" target="_blank" rel="noopener noreferrer" style="color:#ffd966;">${LICENSE_INFO.name}（${LICENSE_INFO.fullName}）</a></div>
          </div>
          <div class="modal-actions">
            <button class="pixel-btn gold" id="btn-close-guide">知道了!</button>
          </div>
        </div>
      </div>
    `;
    slot.querySelector('#btn-close-guide')?.addEventListener('click', () => {
      slot.innerHTML = '';
    });
  }

  private renderModal(
    title: string,
    lines: string[],
    buttons: Array<{ label: string; cls: string; onClick: () => void }>
  ): void {
    this.root.innerHTML = `
      <div class="screen-overlay">
        <div class="pixel-panel modal-box">
          <h2>${title}</h2>
          <div class="modal-stats">
            ${lines.map((l) => `<div>${l}</div>`).join('')}
          </div>
          <div class="modal-actions" id="modal-actions"></div>
        </div>
      </div>
    `;
    const actionsEl = this.root.querySelector('#modal-actions')!;
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = `pixel-btn ${b.cls}`;
      btn.textContent = b.label;
      btn.addEventListener('click', b.onClick);
      actionsEl.appendChild(btn);
    }
  }
}
