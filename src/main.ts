import './style.css';
import { loadAllAssets } from './assets/assetLoader';
import { crashReporter } from './debug/crashReporter';
import { GameEngine } from './game/gameEngine';
import { UIManager } from './ui/uiManager';

async function bootstrap(): Promise<void> {
  // Install global crash guard immediately so NO error can silently freeze or blank the page!
  crashReporter.install({});
  crashReporter.logEvent('Bootstrap start');

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
    crashReporter.logEvent('Assets loaded');
    let ui: UIManager | null = null;
    const engine = new GameEngine(canvas, assets, (snap) => {
      try {
        ui?.update(snap);
      } catch (err) {
        crashReporter.report('ui.update', err);
      }
    });
    ui = new UIManager(uiRoot, engine, assets);

    crashReporter.install({
      getContext: () => engine.getCrashContext(),
      onPause: () => engine.pauseForCrash(),
      onResume: () => engine.resumeAfterCrash(),
      onReturnMenu: () => {
        engine.returnToMenu();
        engine.resumeAfterCrash();
      },
    });

    engine.startLoop();
  } catch (err) {
    crashReporter.report('bootstrap', err);
  }
}

bootstrap();
