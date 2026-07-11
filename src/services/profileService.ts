import type { ProfileStats } from '../types/usage.js';
import { CCUsageService } from './ccusageService.js';
import { CodexService } from './codexService.js';

/**
 * Streaks over a set of active local-date strings (YYYY-MM-DD).
 * - longest: longest run of consecutive calendar days present in the set.
 * - current: run ending today, or yesterday if today has no activity yet
 *   (so an idle morning doesn't zero out an otherwise-live streak).
 * `todayStr` is injected for deterministic testing.
 */
export function computeStreaks(
  activeDates: Iterable<string>,
  todayStr: string
): { current: number; longest: number } {
  const set = new Set(activeDates);
  if (set.size === 0) return { current: 0, longest: 0 };

  const dayMs = 24 * 60 * 60 * 1000;
  const parse = (s: string) => new Date(`${s}T00:00:00`).getTime();
  const fmt = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // Longest: sort dates, count consecutive-day runs.
  const sorted = [...set].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (parse(sorted[i]) - parse(sorted[i - 1]) === dayMs) {
      run++;
    } else {
      run = 1;
    }
    if (run > longest) longest = run;
  }

  // Current: walk back from today (or yesterday) while days are present.
  const todayMs = parse(todayStr);
  let cursor: number;
  if (set.has(todayStr)) cursor = todayMs;
  else if (set.has(fmt(todayMs - dayMs))) cursor = todayMs - dayMs;
  else return { current: 0, longest };

  let current = 0;
  while (set.has(fmt(cursor))) {
    current++;
    cursor -= dayMs;
  }
  return { current, longest };
}

/**
 * Merges the Claude (ccusage) and Codex all-time rollups into one profile.
 * Both providers run concurrently; a Codex-less machine still yields a full
 * Claude-only profile.
 */
export class ProfileService {
  private static instance: ProfileService;
  private readonly ccusage = CCUsageService.getInstance();
  private readonly codex = CodexService.getInstance();
  private cached: ProfileStats | null = null;
  private cachedAt = 0;
  private readonly CACHE_MS = 30_000;

  static getInstance(): ProfileService {
    if (!ProfileService.instance) ProfileService.instance = new ProfileService();
    return ProfileService.instance;
  }

  async getProfileStats(): Promise<ProfileStats> {
    const now = Date.now();
    if (this.cached && now - this.cachedAt < this.CACHE_MS) {
      return this.cached;
    }
    const result = await this.computeProfileStats();
    this.cached = result;
    this.cachedAt = now;
    return result;
  }

  private async computeProfileStats(): Promise<ProfileStats> {
    const [claude, codex] = await Promise.all([
      this.ccusage.getAllTimeDailyAndModels(),
      this.codex.getProfileAggregate(),
    ]);

    // Combined per-day tokens.
    const perDay: Record<string, number> = {};
    for (const [date, n] of Object.entries(claude.perDay)) perDay[date] = (perDay[date] ?? 0) + n;
    for (const [date, n] of Object.entries(codex.perDay)) perDay[date] = (perDay[date] ?? 0) + n;

    const dates = Object.keys(perDay).sort();
    const todayStr = ProfileService.today();

    // Dense daily series from first active day → today (fill gaps with 0 so the
    // heatmap and streaks see every calendar day).
    const daily: { date: string; tokens: number }[] = [];
    let peakDayTokens = 0;
    if (dates.length > 0) {
      const dayMs = 24 * 60 * 60 * 1000;
      const start = new Date(`${dates[0]}T00:00:00`).getTime();
      const end = new Date(`${todayStr}T00:00:00`).getTime();
      for (let ms = start; ms <= end; ms += dayMs) {
        const d = new Date(ms);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const tokens = perDay[key] ?? 0;
        daily.push({ date: key, tokens });
        if (tokens > peakDayTokens) peakDayTokens = tokens;
      }
    }

    const activeDates = dates.filter((d) => (perDay[d] ?? 0) > 0);
    const { current, longest } = computeStreaks(activeDates, todayStr);

    const models = [
      ...Object.entries(claude.models).map(([name, tokens]) => ({
        name,
        tokens,
        provider: 'claude' as const,
      })),
      ...Object.entries(codex.models).map(([name, tokens]) => ({
        name,
        tokens,
        provider: 'codex' as const,
      })),
    ].sort((a, b) => b.tokens - a.tokens);

    const efforts = Object.entries(codex.efforts)
      .map(([effort, turns]) => ({ effort, turns }))
      .sort((a, b) => b.turns - a.turns);

    return {
      totalTokens: claude.totalTokens + codex.totalTokens,
      claudeTokens: claude.totalTokens,
      codexTokens: codex.totalTokens,
      peakDayTokens,
      currentStreak: current,
      longestStreak: longest,
      activeDays: activeDates.length,
      totalSessions: claude.sessionCount + codex.sessionCount,
      daily,
      models,
      efforts,
      codexInstalled: codex.installed,
    };
  }

  private static today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
