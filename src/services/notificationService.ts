import { Notification } from 'electron';
import type { MenuBarData } from '../types/usage.js';

export class NotificationService {
  private static instance: NotificationService;
  private lastNotificationTime = 0;
  private readonly NOTIFICATION_COOLDOWN = 300000; // 5 minutes
  private lastWarningLevel: 'safe' | 'warning' | 'critical' = 'safe';
  private lastNotificationData = '';
  private notificationInProgress = false;

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

    // Decide what (if anything) to send before deciding whether to throttle.
    let shouldNotify = false;
    let title = '';
    let body = '';

    if (data.status === 'critical' && this.lastWarningLevel !== 'critical') {
      shouldNotify = true;
      title = 'TokenWatch: Usage critical';
      body = `You've used ${Math.round(data.percentageUsed)}% of your tokens. Consider upgrading your plan.`;
    } else if (data.status === 'warning' && this.lastWarningLevel === 'safe') {
      shouldNotify = true;
      title = 'TokenWatch: Usage warning';
      body = `You've used ${Math.round(data.percentageUsed)}% of your tokens. Monitor your usage carefully.`;
    }

    // Apply the cooldown only when the bucket hasn't worsened — don't
    // suppress a critical escalation that arrives 2 min after a warning.
    const isEscalation =
      data.status === 'critical' && this.lastWarningLevel !== 'critical';
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
      console.error('Error sending notification:', error);
    }
  }

  // Send a daily summary notification
  sendDailySummary(tokensUsed: number, cost: number): void {
    if (!Notification.isSupported()) return;

    const title = 'TokenWatch: Daily summary';
    const body = `Today: ${tokensUsed.toLocaleString()} tokens used, $${cost.toFixed(3)} spent`;

    this.sendNotification(title, body);
  }
}
