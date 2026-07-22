const { contextBridge, ipcRenderer } = require('electron');

type LoadingProgressPayload = { stage: string; message: string };

const electronAPI = {
  getUsageStats: () => ipcRenderer.invoke('get-usage-stats'),
  getCachedUsageStats: () => ipcRenderer.invoke('get-cached-usage-stats'),
  getCodexStats: () => ipcRenderer.invoke('get-codex-stats'),
  getProfileStats: () => ipcRenderer.invoke('get-profile-stats'),
  refreshData: () => ipcRenderer.invoke('refresh-data'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  onUsageUpdated: (callback: () => void) => ipcRenderer.on('usage-updated', callback),
  removeUsageUpdatedListener: (callback: () => void) =>
    ipcRenderer.removeListener('usage-updated', callback),
  onLoadingProgress: (callback: (payload: LoadingProgressPayload) => void) => {
    const listener = (_event: unknown, payload: LoadingProgressPayload) => callback(payload);
    ipcRenderer.on('usage-loading-progress', listener);
    return listener;
  },
  removeLoadingProgressListener: (listener: (...args: unknown[]) => void) =>
    ipcRenderer.removeListener('usage-loading-progress', listener),
  // Settings methods
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('save-settings', settings),
  // Custom window controls (we draw our own title bar).
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximizeChanged: (callback: (isMaximized: boolean) => void) => {
    const listener = (_event: unknown, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on('window-maximize-changed', listener);
    return listener;
  },
  removeWindowMaximizeChangedListener: (listener: (...args: unknown[]) => void) =>
    ipcRenderer.removeListener('window-maximize-changed', listener),
  // Mini HUD
  miniHudGetContent: () => ipcRenderer.invoke('mini-hud-get-content'),
  miniHudOpenMain: () => ipcRenderer.invoke('mini-hud-open-main'),
  miniHudClose: () => ipcRenderer.invoke('mini-hud-close'),
  onMiniHudContentChanged: (callback: (content: string) => void) => {
    const listener = (_event: unknown, content: string) => callback(content);
    ipcRenderer.on('mini-hud-content-changed', listener);
    return listener;
  },
  removeMiniHudContentChangedListener: (listener: (...args: unknown[]) => void) =>
    ipcRenderer.removeListener('mini-hud-content-changed', listener),
  onMiniHudLanguageChanged: (callback: (language: string) => void) => {
    const listener = (_event: unknown, language: string) => callback(language);
    ipcRenderer.on('mini-hud-language-changed', listener);
    return listener;
  },
  removeMiniHudLanguageChangedListener: (listener: (...args: unknown[]) => void) =>
    ipcRenderer.removeListener('mini-hud-language-changed', listener),
  // Auto-update
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateDownload: () => ipcRenderer.invoke('update-download'),
  updateInstall: () => ipcRenderer.invoke('update-install'),
  onUpdateStatus: (callback: (payload: Record<string, unknown>) => void) => {
    const listener = (_event: unknown, payload: Record<string, unknown>) => callback(payload);
    ipcRenderer.on('update-status', listener);
    return listener;
  },
  removeUpdateStatusListener: (listener: (...args: unknown[]) => void) =>
    ipcRenderer.removeListener('update-status', listener),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
