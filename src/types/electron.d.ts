export interface ScreenshotResult {
  success: boolean;
  filename?: string;
  filepath?: string;
  message?: string;
  error?: string;
}

export interface LoadingProgressPayload {
  stage: string;
  message: string;
}

export type LoadingProgressListener = (payload: LoadingProgressPayload) => void;

export interface ElectronAPI {
  getUsageStats: () => Promise<any>;
  getCachedUsageStats: () => Promise<any | null>;
  getCodexStats: () => Promise<any>;
  refreshData: () => Promise<any>;
  quitApp: () => Promise<void>;
  takeScreenshot: () => Promise<ScreenshotResult>;
  onUsageUpdated: (callback: () => void) => void;
  removeUsageUpdatedListener: (callback: () => void) => void;
  onLoadingProgress: (callback: LoadingProgressListener) => (...args: unknown[]) => void;
  removeLoadingProgressListener: (listener: (...args: unknown[]) => void) => void;
  loadSettings: () => Promise<any>;
  saveSettings: (settings: Record<string, unknown>) => Promise<{ success: boolean }>;
  windowMinimize: () => Promise<void>;
  windowToggleMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  onWindowMaximizeChanged: (
    callback: (isMaximized: boolean) => void
  ) => (...args: unknown[]) => void;
  removeWindowMaximizeChangedListener: (listener: (...args: unknown[]) => void) => void;
  miniHudGetContent: () => Promise<'percentage' | 'percentageCost' | 'percentageCostBurn'>;
  miniHudOpenMain: () => Promise<void>;
  miniHudClose: () => Promise<void>;
  onMiniHudContentChanged: (
    callback: (content: string) => void
  ) => (...args: unknown[]) => void;
  removeMiniHudContentChangedListener: (listener: (...args: unknown[]) => void) => void;
  getAppVersion: () => Promise<string>;
  updateCheck: () => Promise<void>;
  updateDownload: () => Promise<void>;
  updateInstall: () => Promise<void>;
  onUpdateStatus: (
    callback: (payload: Record<string, unknown>) => void
  ) => (...args: unknown[]) => void;
  removeUpdateStatusListener: (listener: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
