// Pure helpers extracted from CCUsageService for unit testing.
// Keep this module side-effect-free — no fs, no ccusage imports, no class
// state. Anything here must be derivable from its inputs alone.

export interface UsageDataItem {
  date: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
}

// Claude plan thresholds mirror the dashboard's auto-detect logic.
export const PLAN_LIMITS = {
  Pro: 7000,
  Max5: 35000,
  Max20: 140000,
  Custom: 500000,
} as const;

export type PlanName = 'Pro' | 'Max5' | 'Max20' | 'Custom';

// Format a Date as a timezone-aware ISO-8601 string using LOCAL time
// (not UTC). Used so "today" in the dashboard matches the user's wall
// clock — under UTC conversion we could wrap past midnight and render
// an empty model-distribution card at the midnight hour.
export function toISOStringLocal(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const milliseconds = date.getMilliseconds().toString().padStart(3, '0');

  const timezoneOffsetMinutes = date.getTimezoneOffset();
  const offsetSign = timezoneOffsetMinutes > 0 ? '-' : '+';
  const offsetHours = Math.floor(Math.abs(timezoneOffsetMinutes) / 60)
    .toString()
    .padStart(2, '0');
  const offsetMinutes = (Math.abs(timezoneOffsetMinutes) % 60).toString().padStart(2, '0');
  const timezoneOffsetString = `${offsetSign}${offsetHours}:${offsetMinutes}`;

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${timezoneOffsetString}`;
}

// Classify a daily token total into the smallest plan that could have
// produced it. Used when `plan: 'auto'` is configured.
export function detectPlan(totalTokens: number): PlanName {
  if (totalTokens <= PLAN_LIMITS.Pro) return 'Pro';
  if (totalTokens <= PLAN_LIMITS.Max5) return 'Max5';
  if (totalTokens <= PLAN_LIMITS.Max20) return 'Max20';
  return 'Custom';
}

// Daily token limit for a given plan. Used to compute "remaining".
export function getTokenLimit(plan: string): number {
  switch (plan) {
    case 'Pro':
      return PLAN_LIMITS.Pro;
    case 'Max5':
      return PLAN_LIMITS.Max5;
    case 'Max20':
      return PLAN_LIMITS.Max20;
    default:
      return PLAN_LIMITS.Custom;
  }
}

// Average tokens/hour over the past 24 h of `data`. Entries older than
// 24 h are dropped; cache-read tokens are intentionally excluded because
// they don't count toward the per-day cap.
export function calculateBurnRate(data: UsageDataItem[], now: Date = new Date()): number {
  const last24Hours = data.filter((item) => {
    const itemDate = new Date(item.date);
    const hoursDiff = (now.getTime() - itemDate.getTime()) / (1000 * 60 * 60);
    return hoursDiff <= 24;
  });

  const totalTokens = last24Hours.reduce((sum, item) => {
    return (
      sum + (item.inputTokens || 0) + (item.outputTokens || 0) + (item.cacheCreationTokens || 0)
    );
  }, 0);
  return Math.round(totalTokens / 24);
}
