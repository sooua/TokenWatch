import { Notification, app } from 'electron';
import { en } from '../i18n/en.js';
import { zh } from '../i18n/zh.js';
import type { MenuBarData } from '../types/usage.js';
import { logger } from './logger.js';
import type { AppSettings } from './settingsService.js';

type NotificationKey = keyof typeof en.notifications;

export class NotificationService {
  private static instance: NotificationService;
  private lastNotificationTime = 0;
  private readonly NOTIFICATION_COOLDOWN = 300000; // 5 minutes
  private lastWarningLevel: 'safe' | 'warning' | 'critical' = 'safe';
  private lastNotificationData = '';
  private notificationInProgress = false;
  private language: 'en' | 'zh' = 'en';

  /**
   * Follow the user's language setting. Pulling react-i18next into the main
   * process just for four strings isn't worth it, so the locale tables are read
   * directly and interpolated by hand.
   *
   * `auto` resolves via `app.getLocale()` — the main process has no
   * `navigator`, which is what the renderer's `resolveLanguage` uses.
   */
  setLanguage(pref: AppSettings['language'] | undefined): void {
    if (pref === 'en' || pref === 'zh') {
      this.language = pref;
      return;
    }
    let locale = '';
    try {
      locale = app.getLocale();
    } catch {
      // Called before app-ready (or outside Electron) — English is the default.
    }
    this.language = locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }

  private t(key: NotificationKey, vars?: Record<string, string | number>): string {
    const table = this.language === 'zh' ? zh.notifications : en.notifications;
    return table[key].replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars?.[name] ?? ''));
  }

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  checkAndNotify(data: MenuBarData, source: 'auto' | 'manual' = 'auto'): void {
    const now = Date.now();
    const timeSinceLastNotification = now - this.lastNotificationTime;

    // Create a unique identifier for this data state
    const dataIdentifier = `${data.status}-${Math.round(data.percentageUsed)}-${data.tokensUsed}`;

    // Prevent duplicate notifications for the same data
    if (this.lastNotificationData === dataIdentifier || this.notificationInProgress) {
      return;
    }

    // Let the level fall back down when usage recovers. Claude's 5-hour window
    // resets several times a day; without this the first escalation to
    // "critical" latched forever and every later window went unannounced —
    // the notifications effectively worked once per app launch.
    if (data.status === 'safe') {
      this.lastWarningLevel = 'safe';
    } else if (data.status === 'warning' && this.lastWarningLevel === 'critical') {
      this.lastWarningLevel = 'warning';
    }

    // Decide what (if anything) to send before deciding whether to throttle.
    let shouldNotify = false;
    let title = '';
    let body = '';

    const percent = Math.round(data.percentageUsed);
    if (data.status === 'critical' && this.lastWarningLevel !== 'critical') {
      shouldNotify = true;
      title = this.t('criticalTitle');
      body = this.t('criticalBody', { percent });
    } else if (data.status === 'warning' && this.lastWarningLevel === 'safe') {
      shouldNotify = true;
      title = this.t('warningTitle');
      body = this.t('warningBody', { percent });
    }

    // Apply the cooldown only when the bucket hasn't worsened — don't
    // suppress a critical escalation that arrives 2 min after a warning.
    const isEscalation = data.status === 'critical' && this.lastWarningLevel !== 'critical';
    if (!isEscalation && timeSinceLastNotification < this.NOTIFICATION_COOLDOWN) {
      return;
    }

    if (shouldNotify) {
      this.notificationInProgress = true;
      this.sendNotification(title, body);
      this.lastNotificationTime = now;
      this.lastWarningLevel = data.status;
      this.lastNotificationData = dataIdentifier;

      // Reset notification lock after a short delay
      setTimeout(() => {
        this.notificationInProgress = false;
      }, 1000);
    }
  }

  private sendNotification(title: string, body: string): void {
    try {
      if (Notification.isSupported()) {
        new Notification({
          title,
          body,
          silent: false,
        }).show();
      }
    } catch (error) {
      logger.error('Error sending notification', error);
    }
  }
}
