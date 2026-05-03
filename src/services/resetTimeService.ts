import { format as formatTz, toZonedTime } from 'date-fns-tz';
import type { ResetTimeInfo, UserConfiguration } from '../types/usage.js';

// Claude's session window: a rolling 5-hour bucket that anchors when the
// first message is sent. After it elapses, usage resets. The previous
// implementation modeled this as a calendar-monthly cycle anchored at
// 9 AM Pacific, which doesn't match Claude's actual cadence.
const CYCLE_DURATION_MS = 5 * 60 * 60 * 1000;

export class ResetTimeService {
  private static instance: ResetTimeService;

  private defaultConfig: UserConfiguration = {
    resetHour: 9,
    timezone: 'America/Los_Angeles',
    updateInterval: 30000,
    warningThresholds: {
      low: 70,
      high: 90,
    },
    plan: 'auto',
    customTokenLimit: undefined,
  };

  private currentConfig: UserConfiguration;

  constructor(config?: Partial<UserConfiguration>) {
    this.currentConfig = { ...this.defaultConfig, ...config };
  }

  static getInstance(config?: Partial<UserConfiguration>): ResetTimeService {
    if (!ResetTimeService.instance) {
      ResetTimeService.instance = new ResetTimeService(config);
    } else if (config) {
      ResetTimeService.instance.updateConfiguration(config);
    }
    return ResetTimeService.instance;
  }

  updateConfiguration(config: Partial<UserConfiguration>): void {
    this.currentConfig = { ...this.currentConfig, ...config };
  }

  getConfiguration(): UserConfiguration {
    return { ...this.currentConfig };
  }

  /**
   * Build ResetTimeInfo from Claude's actual 5-hour session window.
   *
   * @param actualNextResetTime The current active block's end time. When
   *   the user has no active session this is null and we return a degraded
   *   "no active session" payload (timeUntilReset = 0). Previously this
   *   service synthesized a monthly billing-cycle reset anchored at 9 AM
   *   Pacific, which had no relationship to Claude's real reset cadence.
   */
  calculateResetInfo(
    actualNextResetTime: Date | null = null,
    currentDate: Date = new Date()
  ): ResetTimeInfo {
    const { resetHour, timezone } = this.currentConfig;

    if (!actualNextResetTime) {
      return {
        nextResetTime: '',
        timeUntilReset: 0,
        cycleDurationMs: CYCLE_DURATION_MS,
        percentUntilReset: 0,
        resetHour,
        timezone,
      };
    }

    const timeUntilReset = Math.max(0, actualNextResetTime.getTime() - currentDate.getTime());
    const elapsedMs = Math.max(0, CYCLE_DURATION_MS - timeUntilReset);
    const percentUntilReset = Math.min(100, (elapsedMs / CYCLE_DURATION_MS) * 100);

    return {
      nextResetTime: actualNextResetTime.toISOString(),
      timeUntilReset,
      cycleDurationMs: CYCLE_DURATION_MS,
      percentUntilReset,
      resetHour,
      timezone,
    };
  }

  /** Human-readable countdown — "2h 34m" / "12m" / "Soon". */
  formatTimeUntilReset(timeUntilReset: number): string {
    const msInMinute = 60 * 1000;
    const msInHour = 60 * msInMinute;
    const msInDay = 24 * msInHour;

    const days = Math.floor(timeUntilReset / msInDay);
    const hours = Math.floor((timeUntilReset % msInDay) / msInHour);
    const minutes = Math.floor((timeUntilReset % msInHour) / msInMinute);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return 'Soon';
  }

  /** Format a stored reset time for display in the user's timezone. */
  getFormattedResetTime(resetTime: string, timezone: string): string {
    const utcDate = new Date(resetTime);
    const zonedDate = toZonedTime(utcDate, timezone);
    return formatTz(zonedDate, "MMM d, yyyy 'at' h:mm a zzz", { timeZone: timezone });
  }

  /** Common timezones offered in the settings dropdown. */
  static getCommonTimezones(): Array<{ label: string; value: string }> {
    return [
      { label: 'Pacific Time (Los Angeles)', value: 'America/Los_Angeles' },
      { label: 'Mountain Time (Denver)', value: 'America/Denver' },
      { label: 'Central Time (Chicago)', value: 'America/Chicago' },
      { label: 'Eastern Time (New York)', value: 'America/New_York' },
      { label: 'GMT (London)', value: 'Europe/London' },
      { label: 'Central European Time (Paris)', value: 'Europe/Paris' },
      { label: 'Japan Standard Time (Tokyo)', value: 'Asia/Tokyo' },
      { label: 'Australian Eastern Time (Sydney)', value: 'Australia/Sydney' },
      { label: 'UTC', value: 'UTC' },
    ];
  }
}
