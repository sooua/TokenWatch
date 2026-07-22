import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger } from './logger.js';

export type MiniHudContent = 'percentage' | 'percentageCost' | 'percentageCostBurn';

export interface AppSettings {
  timezone: string;
  resetHour: number;
  plan: 'auto' | 'Pro' | 'Max5' | 'Max20' | 'Custom';
  customTokenLimit?: number;
  // Effective token limit calibrated against Claude's /status (0/undefined =
  // not calibrated). Overrides the plan limit for percentage display when set.
  calibratedTokenLimit?: number;
  menuBarDisplayMode: 'percentage' | 'cost' | 'alternate';
  menuBarCostSource: 'today' | 'sessionWindow';
  launchOnStartup: boolean;
  standaloneWindow: boolean;
  language: 'auto' | 'en' | 'zh';
  miniHud: boolean;
  miniHudContent: MiniHudContent;
  // Remembered position after the user drags the HUD. Undefined until first
  // move — main process anchors top-right on first show.
  miniHudX?: number;
  miniHudY?: number;
  autoCheckUpdates: boolean;
  showCodexCard: boolean;
}

export class SettingsService {
  private static instance: SettingsService;
  private settingsPath: string;
  private defaultSettings: AppSettings;
  /** True when settings.json exists but could not be parsed — saving is unsafe. */
  private settingsFileCorrupt = false;

  constructor() {
    // Create settings directory in user's home directory
    const settingsDir = path.join(os.homedir(), '.tokenwatch');
    this.settingsPath = path.join(settingsDir, 'settings.json');

    // Auto-detect timezone as default
    const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    this.defaultSettings = {
      timezone: detectedTimezone,
      resetHour: 0,
      plan: 'auto',
      customTokenLimit: undefined,
      calibratedTokenLimit: undefined,
      menuBarDisplayMode: 'alternate',
      menuBarCostSource: 'today',
      launchOnStartup: false,
      standaloneWindow: false,
      language: 'auto',
      miniHud: false,
      miniHudContent: 'percentageCost',
      autoCheckUpdates: true,
      // Off by default — the dashboard is Claude-first; Codex is optional
      // extra content the user can enable explicitly.
      showCodexCard: false,
    };

    // Ensure settings directory exists
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }
  }

  static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService();
    }
    return SettingsService.instance;
  }

  async loadSettings(): Promise<AppSettings> {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf8');
        const settings = JSON.parse(data) as Partial<AppSettings>;

        this.settingsFileCorrupt = false;

        // Merge with defaults to ensure all required fields are present
        return {
          ...this.defaultSettings,
          ...settings,
        };
      }
      this.settingsFileCorrupt = false;
    } catch (error) {
      // An unreadable settings file used to fall through to defaults in
      // silence — and the next save then wrote those defaults back, quietly
      // destroying the user's calibrated limit, timezone and HUD position.
      // Keep a copy of the bad file and refuse to overwrite it until it has
      // been dealt with.
      this.settingsFileCorrupt = true;
      logger.error(
        `Settings file unreadable, falling back to defaults: ${this.settingsPath}`,
        error
      );
      this.backupCorruptSettings();
    }

    // Return defaults if file doesn't exist or error occurred
    return this.defaultSettings;
  }

  private backupCorruptSettings(): void {
    try {
      const backupPath = `${this.settingsPath}.corrupt`;
      // One backup is enough: overwriting it keeps the *latest* bad state, and
      // the original good file (if any) is already gone by definition.
      fs.copyFileSync(this.settingsPath, backupPath);
      logger.warn(`Copied unreadable settings to ${backupPath}`);
    } catch (error) {
      logger.error('Failed to back up unreadable settings file', error);
    }
  }

  async saveSettings(settings: Partial<AppSettings>): Promise<void> {
    try {
      // Load existing settings first
      const currentSettings = await this.loadSettings();

      if (this.settingsFileCorrupt) {
        // Writing now would replace a file we could not read with defaults +
        // this one change, losing everything else the user had configured.
        throw new Error(
          `Refusing to overwrite unreadable settings file (${this.settingsPath}); a copy is at ${this.settingsPath}.corrupt`
        );
      }

      // Merge with new settings
      const updatedSettings = {
        ...currentSettings,
        ...settings,
      };

      // Write via a temp file + rename so a crash mid-write cannot leave a
      // truncated settings.json behind — the failure mode this method is
      // otherwise cleaning up after.
      const tempPath = `${this.settingsPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(updatedSettings, null, 2), 'utf8');
      fs.renameSync(tempPath, this.settingsPath);
    } catch (error) {
      logger.error('Error saving settings', error);
      throw error;
    }
  }

  getDefaultSettings(): AppSettings {
    return { ...this.defaultSettings };
  }

  getSettingsPath(): string {
    return this.settingsPath;
  }
}
