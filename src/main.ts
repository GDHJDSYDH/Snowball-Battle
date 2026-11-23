import './style.css';
import { loadAllAssets } from './assets/assetLoader';
import { GameEngine } from './game/gameEngine';
import { UIManager } from './ui/uiManager';

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui-root') as HTMLElement;

  uiRoot.innerHTML = `
    <div class="screen-overlay">
      <div class="pixel-panel modal-box">
        <h2>❄️ 加载像素素材中...</h2>
        <div class="modal-stats">正在准备雪地场景与四位角色精灵表</div>
      </div>
    </div>
  `;

  try {
    const assets = await loadAllAssets();
    let ui: UIManager | null = null;
    const engine = new GameEngine(canvas, assets, (snap) => {
      ui?.update(snap);
    });
    ui = new UIManager(uiRoot, engine, assets);
    engine.startLoop();
  } catch (err) {
    uiRoot.innerHTML = `
      <div class="screen-overlay">
        <div class="pixel-panel modal-box">
          <h2>素材加载失败</h2>
          <div class="modal-stats">${String(err)}</div>
        </div>
      </div>
    `;
  }
}

bootstrap();
