import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BrowserWindow,
  Menu,
  type NativeImage,
  Tray,
  app,
  ipcMain,
  nativeImage,
  screen,
  shell,
} from 'electron';
import electronUpdater from 'electron-updater';
import { CCUsageService } from './src/services/ccusageService.js';
import { CodexService } from './src/services/codexService.js';
import { logger } from './src/services/logger.js';
import { NotificationService } from './src/services/notificationService.js';
import { SettingsService } from './src/services/settingsService.js';

const { autoUpdater } = electronUpdater;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

// When launched as a Windows GUI app (or when the parent shell exits), stdout
// and stderr can become detached or have broken pipes. Any write then throws
// EPIPE and bubbles up to the main process, killing the app. ccusage/consola
// hits this whenever it warns. Swallow the benign pipe errors here.
for (const stream of [process.stdout, process.stderr] as const) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) {
      return;
    }
  });
}

process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) {
    return;
  }
  // Persist to disk — in a packaged GUI build console output is discarded, so
  // this is the only durable record of a main-process crash.
  logger.error('Uncaught exception', err);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason);
});

const APP_USER_MODEL_ID = 'com.tokenwatch.app';
if (isWindows) {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

// Make sure `app.getName()` returns TokenWatch regardless of where it's read
// from (package.json, exe metadata). Surfaces in OS-level places like the
// taskbar thumbnail label, Dock menu title, notifications attribution.
app.setName('TokenWatch');

// Enforce a single running instance. Without this, relaunching TokenWatch from a
// shortcut or the installer opens a second tray icon / window while the first
// one is still hidden, which is confusing and doubles the ccusage workload.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  // A second main process tried to start. Record it so the "duplicate
  // TokenWatch.exe" question can be answered from the log instead of guesswork.
  logger.warn(`Single-instance lock denied (pid ${process.pid}) — exiting`);
  app.quit();
  process.exit(0);
}
logger.info(`TokenWatch main process started (pid ${process.pid}, v${app.getVersion()})`);

class TokenWatchApp {
  private tray: Tray | null = null;
  private window: BrowserWindow | null = null;
  private usageService: CCUsageService;
  private codexService: CodexService;
  private notificationService: NotificationService;
  private settingsService: SettingsService;
  private updateInterval: NodeJS.Timeout | null = null;
  private displayInterval: NodeJS.Timeout | null = null;
  private showPercentage = true;
  private cachedMenuBarData: any = null;
  // Tray icon tinted by usage status (Windows/Linux only — macOS is text-only).
  private trayStatus: 'safe' | 'warning' | 'critical' | null = null;
  private trayIconCache = new Map<string, NativeImage>();
  private menuBarDisplayMode: 'percentage' | 'cost' | 'alternate' = 'alternate';
  private menuBarCostSource: 'today' | 'sessionWindow' = 'today';
  private isQuitting = false;
  private firstFetchDone = false;
  private progressTimer: NodeJS.Timeout | null = null;
  private standaloneWindow = false;
  // Whether to fold today's Codex per-model usage into the "by model"
  // distribution (mirrors the Codex card toggle).
  private showCodexCard = false;
  private miniHudWindow: BrowserWindow | null = null;
  private miniHudEnabled = false;
  private miniHudContent: 'percentage' | 'percentageCost' | 'percentageCostBurn' =
    'percentageCost';
  private miniHudSavePositionTimer: NodeJS.Timeout | null = null;
  private autoUpdateTimer: NodeJS.Timeout | null = null;
  private autoUpdateInitialized = false;
  // While a check is running through runUpdateCheck(), we swallow
  // autoUpdater's own 'error' events so they don't fire the red banner
  // before our retry wrapper decides whether to surface the failure.
  private updateCheckInFlight = false;

  constructor() {
    this.usageService = CCUsageService.getInstance();
    this.codexService = CodexService.getInstance();
    this.notificationService = NotificationService.getInstance();
    this.settingsService = SettingsService.getInstance();
  }

  async initialize() {
    await app.whenReady();

    const settings = await this.settingsService.loadSettings();
    this.menuBarDisplayMode = settings.menuBarDisplayMode || 'alternate';
    this.menuBarCostSource = settings.menuBarCostSource || 'today';
    this.standaloneWindow = settings.standaloneWindow === true;
    this.showCodexCard = settings.showCodexCard === true;
    this.miniHudEnabled = settings.miniHud === true;
    this.miniHudContent = settings.miniHudContent || 'percentageCost';

    this.usageService.updateConfiguration({
      plan: settings.plan,
      customTokenLimit: settings.customTokenLimit,
      calibratedTokenLimit: settings.calibratedTokenLimit,
      menuBarCostSource: settings.menuBarCostSource,
    });

    this.applyLaunchOnStartup(settings.launchOnStartup === true);
    this.initAutoUpdate(settings.autoCheckUpdates !== false);

    this.createTray();
    this.createWindow();
    this.setupIPC();
    this.startUsagePolling();

    if (this.miniHudEnabled) {
      this.createMiniHud(settings.miniHudX, settings.miniHudY);
    }

    if (this.menuBarDisplayMode === 'alternate') {
      this.startDisplayToggle();
    }

    app.on('window-all-closed', () => {
      // Keep the app alive in the tray
    });

    app.on('before-quit', () => {
      this.isQuitting = true;
      this.teardown();
    });

    app.on('activate', () => {
      if (this.window === null) {
        this.createWindow();
      }
    });

    // When a second instance tries to launch, surface the existing window
    // instead of letting the second process die silently. This covers the
    // shortcut/double-launch case on Windows where the first instance is
    // hidden in the tray.
    app.on('second-instance', () => {
      logger.info('second-instance received — surfacing existing window');
      this.showWindow();
    });
  }

  private getTrayIconImage() {
    // macOS: text-only menu bar — empty image is fine, text is drawn via setTitle.
    // Windows/Linux: need a real image, otherwise the tray icon is invisible.
    if (isMac) {
      return nativeImage.createEmpty();
    }

    const preferred = this.resolveTrayIconPath();
    if (preferred) {
      return nativeImage.createFromPath(preferred);
    }
    // Last-resort fallback so the constructor doesn't crash.
    return nativeImage.createEmpty();
  }

  // Resolve the best tray icon file for a status, preferring a tinted variant
  // (tray-<status>.ico/png) and falling back to the plain icon when the
  // status-colored assets haven't been generated (see make-tray-status-icons).
  private resolveTrayIconPath(status?: 'safe' | 'warning' | 'critical'): string | null {
    const dir = path.join(__dirname, '..', 'assets');
    const names: string[] = [];
    if (status) {
      if (isWindows) names.push(`tray-${status}.ico`);
      names.push(`tray-${status}.png`);
    }
    if (isWindows) names.push('tray.ico');
    names.push('tray.png');

    for (const name of names) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }
    return null;
  }

  // Swap the tray icon to the status-tinted variant. No-op on macOS (text-only)
  // and when the status hasn't changed, so it's cheap to call on every refresh.
  private applyTrayStatusIcon(status: 'safe' | 'warning' | 'critical') {
    if (isMac || !this.tray || this.trayStatus === status) return;
    this.trayStatus = status;

    const iconPath = this.resolveTrayIconPath(status);
    if (!iconPath) return;

    let img = this.trayIconCache.get(iconPath);
    if (!img) {
      img = nativeImage.createFromPath(iconPath);
      this.trayIconCache.set(iconPath, img);
    }
    if (!img.isEmpty()) {
      this.tray.setImage(img);
    }
  }

  private createTray() {
    this.tray = new Tray(this.getTrayIconImage());
    this.tray.setToolTip('TokenWatch');

    this.updateTrayTitle();

    // Single click: toggle window. On Windows 'click' fires for left-click.
    this.tray.on('click', () => {
      this.toggleWindow();
    });

    // Context menu on right-click — provides a reliable way to quit on Windows.
    this.rebuildContextMenu();
  }

  private rebuildContextMenu() {
    if (!this.tray) return;

    const data = this.cachedMenuBarData;
    const pctLabel =
      data != null ? `Usage: ${Math.round(data.percentageUsed)}%` : 'Usage: --';
    const costLabel =
      data != null ? `Cost: $${Number(data.cost ?? 0).toFixed(2)}` : 'Cost: --';

    const menu = Menu.buildFromTemplate([
      { label: pctLabel, enabled: false },
      { label: costLabel, enabled: false },
      { type: 'separator' },
      { label: 'Open TokenWatch', click: () => this.showWindow() },
      {
        label: 'Mini HUD',
        type: 'checkbox',
        checked: this.miniHudEnabled,
        click: async () => {
          this.miniHudEnabled = !this.miniHudEnabled;
          if (this.miniHudEnabled) {
            const current = await this.settingsService.loadSettings();
            this.createMiniHud(current.miniHudX, current.miniHudY);
          } else {
            this.closeMiniHud();
          }
          await this.settingsService
            .saveSettings({ miniHud: this.miniHudEnabled })
            .catch((err) => logger.error('Failed to persist miniHud:', err));
          this.rebuildContextMenu();
        },
      },
      {
        label: 'Refresh',
        click: async () => {
          await this.usageService.getUsageStats();
          await this.updateTrayTitle();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          this.isQuitting = true;
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  private async updateTrayTitle() {
    const startedProgress = this.startFirstFetchProgress();
    try {
      const menuBarData = await this.usageService.getMenuBarData();
      this.cachedMenuBarData = menuBarData;

      this.updateTrayDisplay();
      this.rebuildContextMenu();

      this.notificationService.checkAndNotify(menuBarData, 'auto');

      if (startedProgress) {
        this.emitProgress({ stage: 'done', message: 'Up to date' });
      }
    } catch (error) {
      logger.error('Error updating tray title:', error);
      this.setTrayLabel('--');
      this.cachedMenuBarData = null;
      this.rebuildContextMenu();
      if (startedProgress) {
        this.emitProgress({ stage: 'error', message: 'Failed to load usage data' });
      }
    } finally {
      this.stopFirstFetchProgress();
      this.firstFetchDone = true;
    }
  }

  private startFirstFetchProgress(): boolean {
    if (this.firstFetchDone) return false;

    const fileCount = this.usageService.countSessionFiles();
    const steps: Array<{ atMs: number; stage: string; message: string }> = [
      {
        atMs: 0,
        stage: 'scanning',
        message:
          fileCount > 0
            ? `Scanning ~/.claude (${fileCount.toLocaleString()} session files)…`
            : 'Scanning ~/.claude…',
      },
      { atMs: 1500, stage: 'parsing', message: 'Parsing session logs…' },
      { atMs: 4000, stage: 'pricing', message: 'Fetching model pricing…' },
      { atMs: 8000, stage: 'computing', message: 'Computing usage statistics…' },
      {
        atMs: 15000,
        stage: 'slow',
        message: 'Large history detected — this may take a bit longer…',
      },
    ];

    let idx = 0;
    this.emitProgress(steps[0]);
    this.progressTimer = setInterval(() => {
      idx++;
      if (idx >= steps.length) {
        if (this.progressTimer) {
          clearInterval(this.progressTimer);
          this.progressTimer = null;
        }
        return;
      }
      this.emitProgress(steps[idx]);
    }, 1500);

    return true;
  }

  private stopFirstFetchProgress() {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  private emitProgress(payload: { stage: string; message: string }) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('usage-loading-progress', payload);
    }
  }

  // --- Auto-update (electron-updater against GitHub Releases) -------------
  // Only active in a packaged build — in dev there's no installed copy to
  // replace. Events are forwarded to the renderer so the UI can show a banner
  // and progress.

  private initAutoUpdate(enabled: boolean) {
    if (!app.isPackaged) return;

    if (!this.autoUpdateInitialized) {
      autoUpdater.autoDownload = false; // User confirms before the download starts
      autoUpdater.autoInstallOnAppQuit = true;

      autoUpdater.on('checking-for-update', () => this.emitUpdate({ status: 'checking' }));
      autoUpdater.on('update-available', (info) =>
        this.emitUpdate({
          status: 'available',
          version: info?.version,
          releaseNotes:
            typeof info?.releaseNotes === 'string' ? info.releaseNotes : undefined,
          releaseDate: info?.releaseDate,
        })
      );
      autoUpdater.on('update-not-available', () =>
        this.emitUpdate({ status: 'not-available' })
      );
      autoUpdater.on('download-progress', (progress) =>
        this.emitUpdate({
          status: 'downloading',
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
        })
      );
      autoUpdater.on('update-downloaded', (info) =>
        this.emitUpdate({ status: 'downloaded', version: info?.version })
      );
      autoUpdater.on('error', (err) => {
        // While a runUpdateCheck() loop is running, all failures are
        // handled by the retry wrapper. Surfacing them here would flash
        // the banner on every attempt (4× for the default backoff) and
        // defeat the "silent auto-check" guarantee. Download/install
        // errors still fall through because updateCheckInFlight is only
        // set around checkForUpdates calls.
        if (this.updateCheckInFlight) {
          logger.error(
            'autoUpdater error during check (deferring to retry wrapper):',
            err?.message || err
          );
          return;
        }
        this.emitUpdate({ status: 'error', error: err?.message || String(err) });
      });

      this.autoUpdateInitialized = true;
    }

    // Clear any existing periodic check before re-arming with the current
    // preference — the setting can flip at runtime.
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
      this.autoUpdateTimer = null;
    }

    if (enabled) {
      // First check runs shortly after boot so it doesn't compete with
      // ccusage's cold-start parsing for network bandwidth. Silent so a
      // GitHub 504 right after launch doesn't greet the user with a red
      // banner.
      setTimeout(() => {
        void this.runUpdateCheck({ silent: true });
      }, 15_000);

      this.autoUpdateTimer = setInterval(
        () => {
          void this.runUpdateCheck({ silent: true });
        },
        4 * 60 * 60 * 1000 // 4 hours
      );
    }
  }

  // Transient HTTP errors from GitHub (503 / 504, connection timeouts)
  // are common on the releases.atom feed; we don't want a single hiccup
  // to trip the "update check failed" banner. Retry with backoff, and
  // when triggered by the automatic scheduler (`silent: true`) suppress
  // the error toast entirely — only manual "check now" clicks surface it.
  private async runUpdateCheck(opts: { silent: boolean }): Promise<void> {
    const isTransient = (err: unknown): boolean => {
      const msg = (err as Error)?.message || String(err);
      return /\b(5\d\d|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|network)\b/i.test(msg);
    };

    this.updateCheckInFlight = true;
    const backoffMs = [0, 2_000, 5_000, 15_000];
    let lastErr: unknown;
    try {
      for (let i = 0; i < backoffMs.length; i++) {
        if (backoffMs[i] > 0) await new Promise((r) => setTimeout(r, backoffMs[i]));
        try {
          await autoUpdater.checkForUpdates();
          return;
        } catch (err) {
          lastErr = err;
          logger.error(
            `update-check attempt ${i + 1}/${backoffMs.length} failed:`,
            (err as Error)?.message || err
          );
          if (!isTransient(err)) break; // Auth errors won't benefit from retry.
        }
      }
    } finally {
      this.updateCheckInFlight = false;
    }

    if (opts.silent) return;
    const msg = (lastErr as Error)?.message || String(lastErr);
    const friendly = /\b5\d\d\b/.test(msg)
      ? 'GitHub temporarily unavailable — please try again in a moment.'
      : msg;
    // `source: 'check'` tells the renderer this failure came from a
    // manual "check now" click — UpdateBanner hides these because the
    // SettingsPanel button flow already surfaces them as a toast. Only
    // download/install failures paint the persistent banner.
    this.emitUpdate({ status: 'error', error: friendly, source: 'check' });
  }

  private emitUpdate(payload: Record<string, unknown>) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('update-status', payload);
    }
  }

  private applyLaunchOnStartup(enabled: boolean) {
    // On Windows this writes HKCU\Software\Microsoft\Windows\CurrentVersion\Run.
    // On macOS it uses the LSBackgroundOnly launchd item. Linux is a no-op.
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: true, // start minimized to the tray, not as a visible window
        name: 'TokenWatch',
      });
    } catch (error) {
      logger.error('Failed to update login item settings:', error);
    }
  }

  private setTrayLabel(label: string) {
    if (!this.tray) return;
    if (isMac) {
      // macOS shows text directly in the menu bar.
      this.tray.setTitle(label);
      this.tray.setToolTip(`TokenWatch ${label}`);
    } else {
      // Windows/Linux can only show text in the tooltip (hover).
      this.tray.setToolTip(`TokenWatch — ${label}`);
    }
  }

  private updateTrayDisplay() {
    if (!this.cachedMenuBarData) return;

    // Tint the tray icon by status (safe/warning/critical) on Windows/Linux.
    if (this.cachedMenuBarData.status) {
      this.applyTrayStatusIcon(this.cachedMenuBarData.status);
    }

    switch (this.menuBarDisplayMode) {
      case 'percentage': {
        const percentage = Math.round(this.cachedMenuBarData.percentageUsed);
        this.setTrayLabel(`${percentage}%`);
        break;
      }
      case 'cost': {
        const cost = this.cachedMenuBarData.cost;
        this.setTrayLabel(`$${cost.toFixed(2)}`);
        break;
      }
      case 'alternate': {
        if (this.showPercentage) {
          const pct = Math.round(this.cachedMenuBarData.percentageUsed);
          this.setTrayLabel(`${pct}%`);
        } else {
          const cst = this.cachedMenuBarData.cost;
          this.setTrayLabel(`$${cst.toFixed(2)}`);
        }
        break;
      }
    }
  }

  private startDisplayToggle() {
    this.displayInterval = setInterval(() => {
      this.showPercentage = !this.showPercentage;
      this.updateTrayDisplay();
    }, 3000);
  }

  private createWindow() {
    // Two modes:
    //   - Tray popup (default): frameless, alwaysOnTop, no taskbar, auto-hides
    //     on blur — behaves like a menu bar dropdown.
    //   - Standalone window: framed, resizable, appears in the taskbar, no
    //     auto-hide — behaves like a normal desktop app. Users can tick this
    //     in Settings to get a proper main window they can minimize/snap.
    const windowIconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
    const tryIcon = isWindows && fs.existsSync(windowIconPath) ? windowIconPath : undefined;

    const standalone = this.standaloneWindow;
    this.window = new BrowserWindow({
      width: standalone ? 960 : 600,
      height: standalone ? 720 : 600,
      minWidth: 520,
      minHeight: 480,
      show: false,
      // Always frameless — we draw our own Claude-styled title bar inside the
      // renderer. In standalone mode we add minimize/maximize/close buttons;
      // in tray popup mode the existing header doubles as the title bar.
      frame: false,
      resizable: true,
      skipTaskbar: !standalone,
      alwaysOnTop: !standalone,
      title: 'TokenWatch',
      icon: tryIcon,
      backgroundColor: '#f5f4ed', // parchment, avoids white flash on open
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    this.window.loadFile(path.join(__dirname, 'index.html'));
    if (process.env.NODE_ENV === 'development') {
      this.window.webContents.openDevTools({ mode: 'detach' });
    }

    this.window.on('blur', () => {
      // In dev with DevTools attached, the main window blurs when DevTools
      // takes focus — skip auto-hide in that case so debugging stays usable.
      // In standalone mode, we're a normal window — don't auto-hide either.
      if (process.env.NODE_ENV !== 'development' && !this.standaloneWindow) {
        this.hideWindow();
      }
    });

    this.window.on('close', (event) => {
      // Standalone window: clicking X should hide to tray, not quit, so the
      // tray stays responsive. The tray's Quit menu item (or Ctrl+Q) is the
      // real way out.
      if (!this.isQuitting) {
        event.preventDefault();
        this.hideWindow();
      }
    });

    // Notify the renderer whenever the maximized state changes so the title
    // bar can flip its maximize / restore icon.
    const emitMaximizeState = () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('window-maximize-changed', this.window.isMaximized());
      }
    };
    this.window.on('maximize', emitMaximizeState);
    this.window.on('unmaximize', emitMaximizeState);

    this.window.on('closed', () => {
      this.window = null;
    });
  }

  private recreateWindow() {
    if (this.window && !this.window.isDestroyed()) {
      // destroy() skips the `close` handler that would otherwise just hide
      // the window — we actually want it gone so `createWindow` can rebuild
      // with the new chrome (frame/taskbar flags).
      this.window.destroy();
    }
    this.window = null;
    this.createWindow();
  }

  // --- Mini HUD ---------------------------------------------------------
  // A small always-on-top window that shows the live percentage / cost / burn
  // rate. Off by default; toggled from Settings. Independent of the main
  // window so users can keep an eye on usage without opening the full app.

  private computeMiniHudBounds(
    savedX: number | undefined,
    savedY: number | undefined,
    width: number,
    height: number
  ) {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const work = display.workArea;
    const margin = 12;

    if (typeof savedX === 'number' && typeof savedY === 'number') {
      // Clamp remembered position inside the current work area in case the
      // display setup changed since last save.
      const x = Math.min(Math.max(savedX, work.x), work.x + work.width - width);
      const y = Math.min(Math.max(savedY, work.y), work.y + work.height - height);
      return { x, y, width, height };
    }

    // Default anchor: top-right of the primary-ish (cursor-adjacent) display.
    return {
      x: work.x + work.width - width - margin,
      y: work.y + margin,
      width,
      height,
    };
  }

  private createMiniHud(savedX?: number, savedY?: number) {
    if (this.miniHudWindow && !this.miniHudWindow.isDestroyed()) {
      this.miniHudWindow.show();
      return;
    }

    const width = 220;
    const height = 64;
    const bounds = this.computeMiniHudBounds(savedX, savedY, width, height);

    this.miniHudWindow = new BrowserWindow({
      width,
      height,
      x: bounds.x,
      y: bounds.y,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      hasShadow: false,
      show: false,
      focusable: false, // don't steal focus from other apps when it redraws
      backgroundColor: '#00000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    // Visible across virtual desktops / fullscreen apps on macOS.
    if (isMac) {
      this.miniHudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    this.miniHudWindow.loadFile(path.join(__dirname, 'index.html'), {
      query: { view: 'minihud' },
    });

    // Persist position after the user drags the HUD. Debounce so we don't
    // hammer the disk during a drag.
    this.miniHudWindow.on('moved', () => this.scheduleMiniHudPositionSave());

    this.miniHudWindow.once('ready-to-show', () => {
      this.miniHudWindow?.show();
    });

    this.miniHudWindow.on('closed', () => {
      this.miniHudWindow = null;
    });
  }

  private scheduleMiniHudPositionSave() {
    if (this.miniHudSavePositionTimer) {
      clearTimeout(this.miniHudSavePositionTimer);
    }
    this.miniHudSavePositionTimer = setTimeout(() => {
      this.miniHudSavePositionTimer = null;
      if (!this.miniHudWindow || this.miniHudWindow.isDestroyed()) return;
      const [x, y] = this.miniHudWindow.getPosition();
      this.settingsService.saveSettings({ miniHudX: x, miniHudY: y }).catch((err) => {
        logger.error('Failed to persist mini HUD position:', err);
      });
    }, 400);
  }

  private closeMiniHud() {
    if (this.miniHudWindow && !this.miniHudWindow.isDestroyed()) {
      this.miniHudWindow.destroy();
    }
    this.miniHudWindow = null;
  }

  private setupIPC() {
    // Window controls for the custom (frameless) title bar.
    ipcMain.handle('window-minimize', () => {
      if (this.window && !this.window.isDestroyed()) this.window.minimize();
    });
    ipcMain.handle('window-toggle-maximize', () => {
      if (!this.window || this.window.isDestroyed()) return false;
      if (this.window.isMaximized()) this.window.unmaximize();
      else this.window.maximize();
      return this.window.isMaximized();
    });
    ipcMain.handle('window-close', () => {
      // Close button behaves like "hide to tray" (handled by the close event
      // listener in createWindow — it calls preventDefault + hideWindow).
      if (this.window && !this.window.isDestroyed()) this.window.close();
    });
    ipcMain.handle('window-is-maximized', () => {
      return !!(this.window && !this.window.isDestroyed() && this.window.isMaximized());
    });

    // Mini HUD: tell the renderer which content mode to show, and respond to
    // clicks on the HUD by surfacing the main window.
    ipcMain.handle('mini-hud-get-content', () => this.miniHudContent);
    ipcMain.handle('mini-hud-open-main', () => {
      this.showWindow();
    });
    // Auto-update — renderer can trigger a check, start the download after
    // we've announced an available version, or install what's already
    // downloaded. GitHub's releases.atom feed occasionally returns 5xx /
    // times out; the check retries a few times with backoff before
    // surfacing the error so a single hiccup doesn't flash a red banner.
    ipcMain.handle('get-app-version', () => app.getVersion());
    ipcMain.handle('update-check', async () => {
      if (!app.isPackaged) {
        this.emitUpdate({ status: 'not-available', info: 'dev build' });
        return;
      }
      await this.runUpdateCheck({ silent: false });
    });
    ipcMain.handle('update-download', async () => {
      try {
        await autoUpdater.downloadUpdate();
      } catch (err) {
        logger.error('update-download failed:', err);
        this.emitUpdate({ status: 'error', error: (err as Error)?.message || String(err) });
      }
    });
    ipcMain.handle('update-install', () => {
      this.isQuitting = true;
      autoUpdater.quitAndInstall(false, true);
    });

    ipcMain.handle('mini-hud-close', () => {
      // Called by the close-button inside the HUD itself. Persist the flip so
      // the HUD stays off across relaunches.
      this.miniHudEnabled = false;
      this.closeMiniHud();
      this.settingsService.saveSettings({ miniHud: false }).catch((err) => {
        logger.error('Failed to persist miniHud=false:', err);
      });
    });

    ipcMain.handle('get-usage-stats', async () => {
      try {
        return await this.withCodexModels(await this.usageService.getUsageStats());
      } catch (error) {
        logger.error('Error getting usage stats:', error);
        throw error;
      }
    });

    ipcMain.handle('get-codex-stats', async () => {
      try {
        return await this.codexService.getStats();
      } catch (error) {
        logger.error('Error getting codex stats:', error);
        return { installed: false } as const;
      }
    });

    ipcMain.handle('get-cached-usage-stats', () => {
      try {
        return this.usageService.loadPersistedStats();
      } catch (error) {
        logger.error('Error reading cached stats:', error);
        return null;
      }
    });

    ipcMain.handle('refresh-data', async () => {
      try {
        const stats = await this.usageService.getUsageStats();
        await this.updateTrayTitle();
        return this.withCodexModels(stats);
      } catch (error) {
        logger.error('Error refreshing data:', error);
        throw error;
      }
    });

    ipcMain.handle('quit-app', () => {
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
      }
      if (this.displayInterval) {
        clearInterval(this.displayInterval);
      }
      this.isQuitting = true;
      app.quit();
    });

    ipcMain.handle('take-screenshot', async () => {
      return this.takeScreenshot();
    });

    // Open the folder containing main.log so users can grab logs for a bug
    // report without hunting through their home directory.
    ipcMain.handle('open-logs-folder', async () => {
      const logDir = path.dirname(logger.getLogPath());
      try {
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
        const result = await shell.openPath(logDir);
        // openPath resolves with a non-empty string on failure (not a throw).
        if (result) {
          logger.error('Failed to open logs folder', result);
          return { success: false, error: result };
        }
        return { success: true, path: logDir };
      } catch (error) {
        logger.error('Failed to open logs folder', error);
        return { success: false, error: (error as Error)?.message || String(error) };
      }
    });

    ipcMain.handle('load-settings', async () => {
      try {
        return await this.settingsService.loadSettings();
      } catch (error) {
        logger.error('Error loading settings:', error);
        throw error;
      }
    });

    ipcMain.handle('save-settings', async (_, settings) => {
      try {
        await this.settingsService.saveSettings(settings);

        this.usageService.updateConfiguration({
          plan: settings.plan,
          customTokenLimit: settings.customTokenLimit,
          calibratedTokenLimit: settings.calibratedTokenLimit,
          menuBarCostSource: settings.menuBarCostSource,
        });

        // Calibration changes the effective limit (and thus every percentage)
        // — recompute immediately and push to the renderer so the user sees the
        // result of their /status entry without waiting for the next poll.
        if (settings && 'calibratedTokenLimit' in settings) {
          await this.updateTrayTitle();
          if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send('usage-updated');
          }
          if (this.miniHudWindow && !this.miniHudWindow.isDestroyed()) {
            this.miniHudWindow.webContents.send('usage-updated');
          }
        }

        if (
          settings.menuBarDisplayMode &&
          settings.menuBarDisplayMode !== this.menuBarDisplayMode
        ) {
          this.menuBarDisplayMode = settings.menuBarDisplayMode;

          if (this.menuBarDisplayMode === 'alternate') {
            if (!this.displayInterval) {
              this.startDisplayToggle();
            }
          } else if (this.displayInterval) {
            clearInterval(this.displayInterval);
            this.displayInterval = null;
          }

          this.updateTrayDisplay();
        }

        if (
          settings.menuBarCostSource &&
          settings.menuBarCostSource !== this.menuBarCostSource
        ) {
          this.menuBarCostSource = settings.menuBarCostSource;
          await this.updateTrayTitle();
        }

        if (typeof settings.launchOnStartup === 'boolean') {
          this.applyLaunchOnStartup(settings.launchOnStartup);
        }

        if (typeof settings.autoCheckUpdates === 'boolean') {
          this.initAutoUpdate(settings.autoCheckUpdates);
        }

        if (typeof settings.miniHud === 'boolean' && settings.miniHud !== this.miniHudEnabled) {
          this.miniHudEnabled = settings.miniHud;
          if (this.miniHudEnabled) {
            const current = await this.settingsService.loadSettings();
            this.createMiniHud(current.miniHudX, current.miniHudY);
          } else {
            this.closeMiniHud();
          }
        }

        if (settings.miniHudContent && settings.miniHudContent !== this.miniHudContent) {
          this.miniHudContent = settings.miniHudContent;
          if (this.miniHudWindow && !this.miniHudWindow.isDestroyed()) {
            this.miniHudWindow.webContents.send('mini-hud-content-changed', this.miniHudContent);
          }
        }

        if (
          typeof settings.standaloneWindow === 'boolean' &&
          settings.standaloneWindow !== this.standaloneWindow
        ) {
          this.standaloneWindow = settings.standaloneWindow;
          // Rebuild the window with the new chrome. Preserve visibility so the
          // user isn't surprised by the window disappearing on them.
          const wasVisible = this.window?.isVisible() ?? false;
          this.recreateWindow();
          if (wasVisible) {
            // Let the window finish loading before showing it again.
            this.window?.webContents.once('did-finish-load', () => this.showWindow());
          }
        }

        if (typeof settings.showCodexCard === 'boolean') {
          this.showCodexCard = settings.showCodexCard;
        }

        return { success: true };
      } catch (error) {
        logger.error('Error saving settings:', error);
        throw error;
      }
    });
  }

  // Centralized teardown so a quit (tray menu, Ctrl+Q, update-install) frees
  // every long-lived handle deterministically instead of relying on process
  // exit to reap them. Idempotent — safe to call from multiple quit paths.
  private teardown() {
    for (const t of [
      this.updateInterval,
      this.displayInterval,
      this.progressTimer,
      this.autoUpdateTimer,
      this.miniHudSavePositionTimer,
    ]) {
      if (t) clearInterval(t as NodeJS.Timeout);
    }
    this.updateInterval = null;
    this.displayInterval = null;
    this.progressTimer = null;
    this.autoUpdateTimer = null;
    this.miniHudSavePositionTimer = null;

    // Release the ccusage parsing worker thread explicitly.
    void this.usageService.dispose();
  }

  // Fold today's Codex per-model usage into stats.today.models so the "by
  // model" distribution shows both agents. Returns a shallow copy — never
  // mutates the service's cached stats. Codex tokens are non-cached (see
  // CodexService.getTodayModelUsage) to stay comparable with Claude. Per-model
  // percentages in the UI divide by the sum of this map, so adding Codex
  // entries keeps them consistent without touching today.totalTokens.
  private async withCodexModels<T extends { today?: { models?: Record<string, unknown> } }>(
    stats: T
  ): Promise<T> {
    if (!this.showCodexCard || !stats?.today) return stats;
    try {
      const codexModels = await this.codexService.getTodayModelUsage();
      if (!codexModels || Object.keys(codexModels).length === 0) return stats;
      return {
        ...stats,
        today: {
          ...stats.today,
          models: { ...(stats.today.models ?? {}), ...codexModels },
        },
      };
    } catch (error) {
      logger.error('Failed to merge Codex model usage', error);
      return stats;
    }
  }

  private startUsagePolling() {
    this.updateInterval = setInterval(async () => {
      await this.updateTrayTitle();

      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('usage-updated');
      }
      if (this.miniHudWindow && !this.miniHudWindow.isDestroyed()) {
        this.miniHudWindow.webContents.send('usage-updated');
      }
    }, 30000);

    setTimeout(() => this.updateTrayTitle(), 1000);
  }

  private computeWindowBounds() {
    const currentBounds = this.window?.getBounds();
    const width = currentBounds?.width ?? (this.standaloneWindow ? 960 : 600);
    const height = currentBounds?.height ?? (this.standaloneWindow ? 720 : 600);
    const margin = 10;

    // Standalone window: center on the active display and let the user move
    // it around normally.
    if (this.standaloneWindow) {
      const cursorPoint = screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(cursorPoint);
      const work = display.workArea;
      return {
        x: Math.round(work.x + (work.width - width) / 2),
        y: Math.round(work.y + (work.height - height) / 2),
        width,
        height,
      };
    }

    // On macOS the menu bar sits at the top — anchor near the top-right.
    if (isMac) {
      const cursorPoint = screen.getCursorScreenPoint();
      const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
      const { x, y, width: sw } = activeDisplay.workArea;
      return { x: x + sw - width - margin - 10, y: y + margin, width, height };
    }

    // On Windows/Linux anchor near the tray icon (usually bottom-right).
    const trayBounds = this.tray?.getBounds();
    const anchor =
      trayBounds && trayBounds.width > 0 && trayBounds.height > 0
        ? { x: trayBounds.x + trayBounds.width / 2, y: trayBounds.y + trayBounds.height / 2 }
        : screen.getCursorScreenPoint();

    const display = screen.getDisplayNearestPoint(anchor);
    const work = display.workArea;

    // Clamp the window inside the active display's work area.
    let targetX = Math.round(anchor.x - width / 2);
    targetX = Math.min(Math.max(targetX, work.x + margin), work.x + work.width - width - margin);

    // Decide above or below the tray based on which side has more space.
    const spaceBelow = work.y + work.height - anchor.y;
    const targetY =
      spaceBelow >= height + margin
        ? Math.round(anchor.y + margin)
        : Math.round(Math.max(work.y + margin, anchor.y - height - margin));

    return { x: targetX, y: targetY, width, height };
  }

  private showWindow() {
    if (!this.window) {
      this.createWindow();
    }
    if (!this.window) return;

    if (isMac) {
      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    this.window.setBounds(this.computeWindowBounds());
    this.window.show();
    this.window.focus();
  }

  private hideWindow() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  private toggleWindow() {
    if (!this.window) {
      this.showWindow();
      return;
    }
    if (this.window.isVisible() && this.window.isFocused()) {
      this.hideWindow();
    } else {
      this.showWindow();
    }
  }

  private async takeScreenshot() {
    try {
      if (!this.window) {
        throw new Error('Window not available');
      }

      const image = await this.window.webContents.capturePage();
      const filepath = this.createScreenshotPath();

      fs.writeFileSync(filepath, image.toPNG());

      return {
        success: true,
        filename: path.basename(filepath),
        filepath,
        message: `Screenshot saved to ${filepath}`,
      };
    } catch (error) {
      logger.error('Screenshot error:', error);
      return {
        success: false,
        error: this.getScreenshotErrorMessage(error),
      };
    }
  }

  private createScreenshotPath(): string {
    const screenshotsDir = path.join(os.homedir(), 'Pictures', 'TokenWatch-Screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `TokenWatch-Screenshot-${timestamp}.png`;
    return path.join(screenshotsDir, filename);
  }

  private getScreenshotErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
      return 'Unknown screenshot error';
    }

    if (error.message.includes('capturePage')) {
      return 'Failed to capture window content. Please make sure the window is visible.';
    }
    if (error.message.includes('ENOENT') || error.message.includes('directory')) {
      return 'Failed to create screenshots directory. Please check permissions.';
    }
    if (error.message.includes('EACCES')) {
      return 'Permission denied. Please check file system permissions.';
    }
    return error.message;
  }
}

const tokenWatchApp = new TokenWatchApp();
tokenWatchApp.initialize().catch((err) => logger.error('Initialization failed', err));
