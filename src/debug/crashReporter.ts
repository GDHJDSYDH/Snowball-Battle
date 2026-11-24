export interface CrashContextSnapshot {
  screen?: string;
  mode?: string;
  stage?: string;
  charId?: string;
  hp?: string;
  snowballs?: string;
  skillState?: string;
  entities?: string;
}

class CrashReporter {
  private breadcrumbs: string[] = [];
  private maxBreadcrumbs = 16;
  private contextProvider: (() => CrashContextSnapshot) | null = null;
  private onPauseGame: (() => void) | null = null;
  private onResumeGame: (() => void) | null = null;
  private onReturnMenu: (() => void) | null = null;
  private overlayEl: HTMLElement | null = null;
  private isShowing = false;
  private installed = false;

  public install(options: {
    getContext?: () => CrashContextSnapshot;
    onPause?: () => void;
    onResume?: () => void;
    onReturnMenu?: () => void;
  }): void {
    if (options.getContext) this.contextProvider = options.getContext;
    if (options.onPause) this.onPauseGame = options.onPause;
    if (options.onResume) this.onResumeGame = options.onResume;
    if (options.onReturnMenu) this.onReturnMenu = options.onReturnMenu;

    if (this.installed) return;
    this.installed = true;

    window.addEventListener('error', (event) => {
      event.preventDefault();
      const err = event.error || new Error(event.message || 'Unknown window error');
      const loc = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : '';
      this.report('window.onerror', err, loc);
    });

    window.addEventListener('unhandledrejection', (event) => {
      event.preventDefault();
      const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      this.report('unhandledrejection', reason);
    });
  }

  public logEvent(msg: string): void {
    const now = new Date();
    const ts = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    this.breadcrumbs.push(`[${ts}] ${msg}`);
    if (this.breadcrumbs.length > this.maxBreadcrumbs) {
      this.breadcrumbs.shift();
    }
  }

  public report(phase: string, error: unknown, extraLocation = ''): void {
    const errObj = error instanceof Error ? error : new Error(String(error));
    const ctx = this.safeGetContext();

    const reportLines = [
      `=== Snowball-Battle Crash Report ===`,
      `Time: ${new Date().toISOString()}`,
      `Phase: ${phase}`,
      `Error: ${errObj.name}: ${errObj.message}`,
      extraLocation ? `Location: ${extraLocation}` : '',
      `Viewport: ${window.innerWidth}x${window.innerHeight} (DPR ${window.devicePixelRatio || 1})`,
      `UA: ${navigator.userAgent}`,
      ctx.screen ? `State: screen=${ctx.screen} mode=${ctx.mode} stage=${ctx.stage} char=${ctx.charId}` : '',
      ctx.hp ? `Player: hp=${ctx.hp} snowballs=${ctx.snowballs} skill=${ctx.skillState}` : '',
      ctx.entities ? `Entities: ${ctx.entities}` : '',
      `--- Recent Events ---`,
      ...(this.breadcrumbs.length ? this.breadcrumbs : ['(none)']),
      `--- Stack Trace ---`,
      errObj.stack || '(no stack trace)',
    ].filter(Boolean);

    const reportText = reportLines.join('\n');

    try {
      console.error(reportText);
      localStorage.setItem('snowball_last_crash', reportText);
    } catch {
      // Ignore storage quota errors
    }

    try {
      this.onPauseGame?.();
    } catch {
      // Ignore pause errors
    }

    this.showOverlay(errObj.name + ': ' + errObj.message, phase, reportText);
  }

  private safeGetContext(): CrashContextSnapshot {
    try {
      return this.contextProvider ? this.contextProvider() : {};
    } catch {
      return {};
    }
  }

  private showOverlay(summary: string, phase: string, reportText: string): void {
    if (this.isShowing && this.overlayEl) {
      const pre = this.overlayEl.querySelector<HTMLElement>('#crash-report-pre');
      if (pre) pre.textContent = reportText;
      return;
    }

    this.isShowing = true;
    const overlay = document.createElement('div');
    overlay.id = 'crash-guard-overlay';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:99999',
      'background:rgba(8,14,26,0.92)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:14px',
      'pointer-events:auto',
      'overflow:auto',
      'font-family:"Microsoft YaHei",monospace',
      'color:#f2f9ff',
    ].join(';');

    overlay.innerHTML = `
      <div class="pixel-panel" style="width:min(640px,96vw);max-height:90vh;display:flex;flex-direction:column;gap:10px;padding:16px;border-color:#ff5b6e;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <h2 style="font-size:18px;color:#ff6b81;margin:0;">⚠️ 游戏捕获到异常（已拦截防止退页）</h2>
          <span style="font-size:11px;color:#ffd166;background:#2a1724;padding:2px 8px;border-radius:4px;border:1px solid #ff5b6e;">${this.escapeHtml(phase)}</span>
        </div>
        <div style="font-size:13px;color:#ffe6e6;background:rgba(255,91,110,0.14);border:1px solid rgba(255,91,110,0.45);border-radius:6px;padding:8px 10px;word-break:break-word;">
          ${this.escapeHtml(summary)}
        </div>
        <div style="font-size:11px;color:#9ec1de;">
          请点击下方「复制错误信息」并将内容发给我，即可精准定位并秒修：
        </div>
        <pre id="crash-report-pre" style="margin:0;padding:10px;background:#07101d;border:1px solid #35587c;border-radius:6px;font-size:11px;line-height:1.45;color:#bfe6ff;overflow:auto;max-height:38vh;white-space:pre-wrap;word-break:break-all;user-select:text;-webkit-user-select:text;"></pre>
        <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;">
          <button class="pixel-btn gold" id="crash-btn-copy" style="font-size:13px;padding:8px 14px;">📋 复制错误信息</button>
          <button class="pixel-btn" id="crash-btn-resume" style="font-size:13px;padding:8px 14px;">🔄 尝试继续</button>
          <button class="pixel-btn secondary" id="crash-btn-menu" style="font-size:13px;padding:8px 14px;">🏠 返回主菜单</button>
          <button class="pixel-btn secondary" id="crash-btn-reload" style="font-size:13px;padding:8px 14px;">🔁 刷新页面</button>
        </div>
      </div>
    `;

    const pre = overlay.querySelector<HTMLElement>('#crash-report-pre');
    if (pre) pre.textContent = reportText;

    const copyBtn = overlay.querySelector<HTMLButtonElement>('#crash-btn-copy');
    copyBtn?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(reportText);
        copyBtn.textContent = '✅ 已复制到剪贴板!';
      } catch {
        // Fallback selection copy for older mobile WebViews
        const ta = document.createElement('textarea');
        ta.value = reportText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        copyBtn.textContent = '✅ 已复制!';
      }
      setTimeout(() => {
        if (copyBtn) copyBtn.textContent = '📋 复制错误信息';
      }, 2000);
    });

    overlay.querySelector('#crash-btn-resume')?.addEventListener('click', () => {
      this.dismissOverlay();
      try {
        this.onResumeGame?.();
      } catch (e) {
        this.report('resume', e);
      }
    });

    overlay.querySelector('#crash-btn-menu')?.addEventListener('click', () => {
      this.dismissOverlay();
      try {
        this.onReturnMenu?.();
      } catch (e) {
        this.report('returnToMenu', e);
      }
    });

    overlay.querySelector('#crash-btn-reload')?.addEventListener('click', () => {
      window.location.reload();
    });

    document.body.appendChild(overlay);
    this.overlayEl = overlay;
  }

  private dismissOverlay(): void {
    this.isShowing = false;
    this.overlayEl?.remove();
    this.overlayEl = null;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

export const crashReporter = new CrashReporter();
