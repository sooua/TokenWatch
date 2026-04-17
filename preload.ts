const { contextBridge, ipcRenderer } = require('electron');

type LoadingProgressPayload = { stage: string; message: string };

const electronAPI = {
  getUsageStats: () => ipcRenderer.invoke('get-usage-stats'),
  getCachedUsageStats: () => ipcRenderer.invoke('get-cached-usage-stats'),
  refreshData: () => ipcRenderer.invoke('refresh-data'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
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
  saveSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('save-settings', settings),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
