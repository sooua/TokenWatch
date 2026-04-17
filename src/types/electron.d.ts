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
  refreshData: () => Promise<any>;
  quitApp: () => Promise<void>;
  takeScreenshot: () => Promise<ScreenshotResult>;
  onUsageUpdated: (callback: () => void) => void;
  removeUsageUpdatedListener: (callback: () => void) => void;
  onLoadingProgress: (callback: LoadingProgressListener) => (...args: unknown[]) => void;
  removeLoadingProgressListener: (listener: (...args: unknown[]) => void) => void;
  loadSettings: () => Promise<any>;
  saveSettings: (settings: Record<string, unknown>) => Promise<{ success: boolean }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
