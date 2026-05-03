import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type {
  ActualResetInfo,
  DailyUsage,
  MenuBarData,
  PredictionInfo,
  ResetTimeInfo,
  UsageStats,
  UserConfiguration,
  VelocityInfo,
} from '../types/usage.js';
import {
  calculateBurnRate as utilCalculateBurnRate,
  detectPlan as utilDetectPlan,
  getTokenLimit as utilGetTokenLimit,
  PLAN_LIMITS,
  toISOStringLocal as utilToISOStringLocal,
} from './ccusage-utils.js';
import { ResetTimeService } from './resetTimeService.js';
import { SessionTracker } from './sessionTracker.js';

const STATS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — stale but useful for cold start

interface PersistedStatsPayload {
  savedAt: number;
  stats: UsageStats;
}

interface ModelBreakdown {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

interface DailyDataEntry {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCost: number;
  modelBreakdowns: ModelBreakdown[];
}

interface UsageDataItem {
  date: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  totalCost?: number;
  cost?: number;
  modelBreakdowns?: ModelBreakdown[];
}

// Define SessionBlock interface matching ccusage package structure
interface LoadedUsageEntry {
  timestamp: Date;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  costUSD: number | null;
  model: string;
  version?: string;
}

interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

interface SessionBlock {
  id: string;
  startTime: Date;
  endTime: Date;
  actualEndTime?: Date;
  isActive: boolean;
  isGap?: boolean;
  entries: LoadedUsageEntry[];
  tokenCounts: TokenCounts;
  costUSD: number;
  models: string[];
}

export class CCUsageService {
  private static instance: CCUsageService;
  private cachedStats: UsageStats | null = null;
  private lastUpdate = 0;
  private readonly CACHE_DURATION = 20000; // 20s — in-memory freshness, matches ~polling cadence
  private inFlightFetch: Promise<UsageStats> | null = null;
  private resetTimeService: ResetTimeService;
  private sessionTracker: SessionTracker;
  private historicalBlocks: SessionBlock[] = []; // Store session blocks for analysis
  private currentActiveBlock: SessionBlock | null = null; // Store current active block
  // Plan selected by the user ("auto" by default for auto-detection)
  private selectedPlan: 'auto' | 'Pro' | 'Max5' | 'Max20' | 'Custom' = 'auto';
  // Actual plan used for calculations after applying auto detection/selection
  private currentPlan: 'Pro' | 'Max5' | 'Max20' | 'Custom' = 'Pro';
  // Custom token limit specified by the user when plan === 'Custom'
  private customTokenLimit: number | undefined = undefined;
  private detectedTokenLimit: number = PLAN_LIMITS.Pro;
  // Basis for cost shown in menu bar
  private menuBarCostSource: 'today' | 'sessionWindow' = 'today';
  private readonly statsCachePath: string;

  private worker: Worker | null = null;
  private pendingWorkerRequests = new Map<
    number,
    { resolve: (blocks: SessionBlock[]) => void; reject: (err: Error) => void }
  >();
  private nextWorkerRequestId = 1;

  constructor() {
    this.resetTimeService = ResetTimeService.getInstance();
    this.sessionTracker = SessionTracker.getInstance();
    this.statsCachePath = path.join(os.homedir(), '.tokenwatch', 'stats-cache.json');
  }

  /**
   * Lazily spin up a worker_threads worker that runs ccusage's JSONL parsing
   * off the Electron main process. Keeping the worker alive between requests
   * avoids the cold-start cost of re-loading the ccusage bundle. It also keeps
   * the libuv thread pool warm for file I/O.
   */
  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const here = path.dirname(fileURLToPath(import.meta.url));
    const workerPath = path.join(here, '..', 'workers', 'ccusageWorker.js');

    const worker = new Worker(workerPath);

    worker.on(
      'message',
      (msg: { id: number; ok: boolean; blocks?: SessionBlock[]; error?: string }) => {
        const pending = this.pendingWorkerRequests.get(msg.id);
        if (!pending) return;
        this.pendingWorkerRequests.delete(msg.id);
        if (msg.ok && msg.blocks) {
          pending.resolve(msg.blocks);
        } else {
          pending.reject(new Error(msg.error || 'Worker returned no blocks'));
        }
      }
    );

    worker.on('error', (err) => {
      console.error('[ccusage worker] error:', err);
      // Reject everything waiting so callers unblock instead of hanging.
      for (const [, pending] of this.pendingWorkerRequests) pending.reject(err);
      this.pendingWorkerRequests.clear();
    });

    worker.on('exit', (code) => {
      this.worker = null;
      if (code !== 0) {
        console.error('[ccusage worker] exited with code', code);
        for (const [, pending] of this.pendingWorkerRequests) {
          pending.reject(new Error(`Worker exited with code ${code}`));
        }
        this.pendingWorkerRequests.clear();
      }
    });

    this.worker = worker;
    return worker;
  }

  private loadBlocksInWorker(): Promise<SessionBlock[]> {
    const worker = this.ensureWorker();
    const id = this.nextWorkerRequestId++;
    return new Promise<SessionBlock[]>((resolve, reject) => {
      this.pendingWorkerRequests.set(id, { resolve, reject });
      worker.postMessage({
        type: 'fetch',
        id,
        sessionDurationHours: 5,
        mode: 'calculate',
      });
    });
  }

  static getInstance(): CCUsageService {
    if (!CCUsageService.instance) {
      CCUsageService.instance = new CCUsageService();
    }
    return CCUsageService.instance;
  }

  private toISOStringLocal(date: Date): string {
    return utilToISOStringLocal(date);
  }

  updateConfiguration(config: Partial<UserConfiguration>): void {
    this.resetTimeService.updateConfiguration(config);

    if (config.plan !== undefined) {
      this.selectedPlan = config.plan;
    }
    if (config.customTokenLimit !== undefined) {
      this.customTokenLimit = config.customTokenLimit;
    }
    if (config.menuBarCostSource !== undefined) {
      this.menuBarCostSource = config.menuBarCostSource;
    }

    // Clear cache to force recalculation with new config
    this.cachedStats = null;
  }

  async getUsageStats(): Promise<UsageStats> {
    const now = Date.now();

    // Return cached data if it's still fresh
    if (this.cachedStats && now - this.lastUpdate < this.CACHE_DURATION) {
      return this.cachedStats;
    }

    // Coalesce concurrent callers onto a single in-flight fetch. Without this,
    // the main-process 30s polling + renderer requests fire multiple
    // simultaneous ccusage reads over the same JSONL set, which can
    // dramatically slow down the first result on large histories.
    if (this.inFlightFetch) {
      return this.inFlightFetch;
    }

    this.inFlightFetch = this.performFetch().finally(() => {
      this.inFlightFetch = null;
    });
    return this.inFlightFetch;
  }

  private async performFetch(): Promise<UsageStats> {
    try {
      // ccusage's JSONL parsing runs in a worker_threads worker so the
      // Electron main process stays responsive (tray, IPC, window events)
      // while ~1,700 files get scanned on a cold start. We used to also call
      // `loadDailyUsageData` in parallel, but it walks the same
      // ~/.claude/projects tree and re-parses every JSONL file — roughly
      // doubling cold-start I/O and CPU. `parseBlocksData` derives daily
      // usage from blocks (see `convertBlocksToDailyUsage`), so the extra
      // call is redundant. Trade-off: per-model token splits become
      // approximate (evenly divided across the models in a block) —
      // acceptable for a monitoring dashboard.
      const blocks = await this.loadBlocksInWorker();

      if (!blocks || blocks.length === 0) {
        console.error('No blocks data received');
        return this.getMockStats();
      }

      const stats = this.parseBlocksData(blocks);

      this.cachedStats = stats;
      this.lastUpdate = Date.now();
      this.historicalBlocks = blocks;

      // Persist to disk so the next cold start can render immediately.
      this.persistStatsToDisk(stats);

      return stats;
    } catch (error) {
      console.error('Error fetching usage stats:', error);
      // Returning mock data here used to leak fake numbers (4,200 tokens,
      // $2.45 cost, fabricated week/month series) into the UI on transient
      // file errors. Default zeros let the renderer show an honest
      // "no data" state instead of plausible-but-wrong numbers.
      return this.getDefaultStats();
    }
  }

  /**
   * Load the most recently persisted stats, if any. Used on cold start so the
   * UI can render immediately with last-known values while a fresh fetch runs.
   * Returns null when the cache is missing, unreadable, or too stale.
   */
  loadPersistedStats(): UsageStats | null {
    try {
      if (!fs.existsSync(this.statsCachePath)) {
        return null;
      }
      const raw = fs.readFileSync(this.statsCachePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedStatsPayload;
      if (!parsed || typeof parsed.savedAt !== 'number' || !parsed.stats) {
        return null;
      }
      if (Date.now() - parsed.savedAt > STATS_CACHE_MAX_AGE_MS) {
        return null;
      }
      return parsed.stats;
    } catch (error) {
      console.error('Failed to load persisted stats cache:', error);
      return null;
    }
  }

  /**
   * Cheap count of JSONL session files under ~/.claude/projects. Used by the
   * loading screen to tell the user how much data is being parsed.
   */
  countSessionFiles(): number {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) return 0;
    let count = 0;
    const walk = (dir: string, depth: number) => {
      if (depth > 3) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          count++;
        }
      }
    };
    walk(projectsDir, 0);
    return count;
  }

  private persistStatsToDisk(stats: UsageStats): void {
    try {
      const dir = path.dirname(this.statsCachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const payload: PersistedStatsPayload = { savedAt: Date.now(), stats };
      fs.writeFileSync(this.statsCachePath, JSON.stringify(payload), 'utf8');
    } catch (error) {
      // Cache write failures should never break the app — log and continue.
      console.error('Failed to persist stats cache:', error);
    }
  }

  /**
   * Resolve the plan and token limit based on user selection and detected usage
   */
  private resolvePlan(blocks: SessionBlock[]): {
    plan: 'Pro' | 'Max5' | 'Max20' | 'Custom';
    tokenLimit: number;
  } {
    if (this.selectedPlan === 'auto') {
      // Auto-detect plan based on maximum usage across all blocks
      const maxTokens = this.getMaxTokensFromBlocks(blocks);
      const detectedPlan = this.detectPlan(maxTokens);
      return {
        plan: detectedPlan,
        tokenLimit: detectedPlan === 'Custom' ? maxTokens : this.getTokenLimit(detectedPlan),
      };
    }

    if (this.selectedPlan === 'Custom') {
      // Use custom token limit or fallback to detected limit
      const tokenLimit = this.customTokenLimit ?? this.getMaxTokensFromBlocks(blocks);
      return {
        plan: 'Custom',
        tokenLimit,
      };
    }

    // Use explicitly selected plan
    return {
      plan: this.selectedPlan,
      tokenLimit: this.getTokenLimit(this.selectedPlan),
    };
  }

  /**
   * Parse blocks data similar to Python implementation
   */
  private parseBlocksData(blocks: SessionBlock[], dailyData?: DailyDataEntry[]): UsageStats {
    // Find active block
    const activeBlock = blocks.find((block) => block.isActive && !block.isGap);

    if (!activeBlock) {
      this.currentActiveBlock = null;
      return this.getDefaultStats();
    }

    // Store the active block for reset time calculation
    this.currentActiveBlock = activeBlock;

    // Get tokens from active session
    const tokensUsed = this.getTotalTokensFromBlock(activeBlock);

    // Resolve plan and token limit based on user selection and detected usage
    const { plan, tokenLimit } = this.resolvePlan(blocks);
    this.currentPlan = plan;
    this.detectedTokenLimit = tokenLimit;

    // Calculate burn rate from last hour across all sessions
    const burnRate = this.calculateHourlyBurnRate(blocks);

    // Calculate enhanced metrics
    const velocity = this.calculateVelocityFromBlocks(blocks, burnRate);
    const resetInfo = this.resetTimeService.calculateResetInfo(activeBlock.endTime);
    const prediction = this.calculatePredictionInfo(tokensUsed, tokenLimit, velocity);

    // Update session tracking with 5-hour rolling windows
    const sessionTracking = this.sessionTracker.updateFromBlocks(
      this.convertSessionBlocksToCC(blocks)
    );

    // Use daily data if provided, otherwise convert from blocks
    let processedDailyData: DailyUsage[];
    if (dailyData) {
      // Process the daily data from ccusage, filtering out synthetic models.
      // Cache-read tokens excluded — see getTotalTokensFromBlock.
      processedDailyData = dailyData.map((day) => ({
        date: day.date,
        totalTokens: day.inputTokens + day.outputTokens + day.cacheCreationTokens,
        totalCost: day.totalCost,
        models: day.modelBreakdowns
          .filter((mb: ModelBreakdown) => mb.modelName !== '<synthetic>')
          .reduce(
            (acc: { [key: string]: { tokens: number; cost: number } }, mb: ModelBreakdown) => {
              acc[mb.modelName] = {
                tokens: mb.inputTokens + mb.outputTokens + mb.cacheCreationTokens,
                cost: mb.cost,
              };
              return acc;
            },
            {}
          ),
      }));
    } else {
      processedDailyData = this.convertBlocksToDailyUsage(blocks);
    }

    const todayStr = this.toISOStringLocal(new Date()).split('T')[0];
    const todayData =
      processedDailyData.find((d) => d.date === todayStr) || this.getEmptyDailyUsage();

    // Get actual reset time from session data
    const actualResetInfo = this.getTimeUntilActualReset();

    return {
      today: todayData,
      thisWeek: processedDailyData.filter((d) => {
        const date = new Date(d.date);
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return date >= weekAgo;
      }),
      thisMonth: processedDailyData.filter((d) => {
        const date = new Date(d.date);
        const monthAgo = new Date();
        monthAgo.setDate(monthAgo.getDate() - 30);
        return date >= monthAgo;
      }),
      burnRate,
      velocity,
      prediction,
      resetInfo,
      actualResetInfo,
      predictedDepleted: prediction.depletionTime,
      currentPlan: this.currentPlan,
      tokenLimit,
      tokensUsed,
      tokensRemaining: Math.max(0, tokenLimit - tokensUsed),
      percentageUsed: Math.min(100, (tokensUsed / tokenLimit) * 100),
      // Enhanced session tracking
      sessionTracking,
    };
  }

  /**
   * Convert SessionBlock array to CCUsageBlock array for compatibility
   */
  private convertSessionBlocksToCC(
    blocks: SessionBlock[]
  ): import('../types/usage.js').CCUsageBlock[] {
    return blocks.map((block) => ({
      id: block.id,
      startTime: block.startTime.toISOString(),
      endTime: block.endTime.toISOString(),
      actualEndTime: block.actualEndTime?.toISOString(),
      isActive: block.isActive,
      isGap: block.isGap,
      models: block.models,
      costUSD: block.costUSD,
      tokenCounts: block.tokenCounts,
    }));
  }

  /**
   * Total user-billable tokens for a session block.
   * Cache-read tokens are excluded — they're prompt-cache hits, weighted
   * roughly 0.1× by Anthropic's rate limiter and contributing very little
   * to cost. Including them inflates the displayed "tokens used" by 10-100×
   * on cache-heavy sessions and mis-triggers the Custom plan auto-detect.
   */
  private getTotalTokensFromBlock(block: SessionBlock): number {
    const counts = block.tokenCounts;
    return counts.inputTokens + counts.outputTokens + counts.cacheCreationInputTokens;
  }

  /**
   * Largest single-block token total observed across history. Used to seed
   * the auto-detected plan limit. Includes the active block too — the
   * previous version skipped it, so a fresh install or single-session user
   * always fell back to Pro (7K) regardless of how heavy the session was.
   */
  private getMaxTokensFromBlocks(blocks: SessionBlock[]): number {
    let maxTokens = 0;

    for (const block of blocks) {
      if (block.isGap) continue;
      const totalTokens = this.getTotalTokensFromBlock(block);
      if (totalTokens > maxTokens) {
        maxTokens = totalTokens;
      }
    }

    return maxTokens > 0 ? maxTokens : PLAN_LIMITS.Pro;
  }

  /**
   * Tokens-per-HOUR consumed in the last hour.
   *
   * Walks individual entries by their own timestamp instead of pro-rating
   * the enclosing block uniformly across its lifetime. Pro-rating made the
   * burn rate stay artificially high after activity stopped, because the
   * tokens of a still-active 5-hour block were spread across all minutes
   * including the idle ones at the end.
   *
   * The sum equals tokens in the last hour, which by definition is the
   * tokens-per-hour rate for that window — no further conversion needed.
   * (Previous version returned tokens/min and relied on every consumer to
   * multiply by 60, which the UI labels and depletion math both forgot.)
   */
  private calculateHourlyBurnRate(blocks: SessionBlock[]): number {
    if (!blocks || blocks.length === 0) return 0;

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let totalTokens = 0;

    for (const block of blocks) {
      if (block.isGap) continue;
      // Skip blocks that ended before the window — entries can't contribute.
      const end = block.actualEndTime ?? block.endTime;
      if (!block.isActive && end.getTime() < oneHourAgo) continue;

      for (const entry of block.entries) {
        const ts = (entry.timestamp as Date).getTime?.() ?? new Date(entry.timestamp).getTime();
        if (ts < oneHourAgo) continue;
        totalTokens +=
          entry.usage.inputTokens + entry.usage.outputTokens + entry.usage.cacheCreationInputTokens;
      }
    }

    return totalTokens;
  }

  /**
   * Convert session blocks into per-day totals.
   *
   * We iterate individual `entries` inside each block (not block.startTime)
   * so each entry is filed under its own local-date bucket. Using block
   * start-time instead would lump every entry in a 5-hour block into the
   * block's opening day, which breaks today's dashboard whenever a session
   * spans local midnight — a common case in the evening for non-UTC users.
   */
  private convertBlocksToDailyUsage(blocks: SessionBlock[]): DailyUsage[] {
    const dailyMap = new Map<string, DailyUsage>();

    for (const block of blocks) {
      if (block.isGap) continue;

      for (const entry of block.entries) {
        const date = this.toISOStringLocal(entry.timestamp).split('T')[0];
        let daily = dailyMap.get(date);
        if (!daily) {
          daily = { date, totalTokens: 0, totalCost: 0, models: {} };
          dailyMap.set(date, daily);
        }

        // Cache-read tokens excluded — see getTotalTokensFromBlock.
        const entryTokens =
          entry.usage.inputTokens + entry.usage.outputTokens + entry.usage.cacheCreationInputTokens;
        const entryCost = entry.costUSD ?? 0;

        daily.totalTokens += entryTokens;
        daily.totalCost += entryCost;

        // Filter synthetic model names — they show up as meta events, not
        // real API calls, and would pollute the per-model chart.
        if (entry.model && entry.model !== '<synthetic>') {
          if (!daily.models[entry.model]) {
            daily.models[entry.model] = { tokens: 0, cost: 0 };
          }
          daily.models[entry.model].tokens += entryTokens;
          daily.models[entry.model].cost += entryCost;
        }
      }
    }

    // Convert to array and sort by date
    return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * 24h and 7d rolling averages, computed from individual entry timestamps
   * so the windows are honored exactly. The previous version filtered
   * whole blocks by `block.startTime` and then divided by a fixed 24/168,
   * which both over-counted (a 5-hour block starting 23h ago was credited
   * in full to the last 24h) and under-counted (a still-active block that
   * started 25h ago was excluded entirely).
   */
  private calculateVelocityFromBlocks(
    blocks: SessionBlock[],
    currentBurnRate: number
  ): VelocityInfo {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    let tokens24h = 0;
    let tokens7d = 0;

    for (const block of blocks) {
      if (block.isGap) continue;
      const end = block.actualEndTime ?? block.endTime;
      if (!block.isActive && end.getTime() < oneWeekAgo) continue;

      for (const entry of block.entries) {
        const ts = (entry.timestamp as Date).getTime?.() ?? new Date(entry.timestamp).getTime();
        if (ts < oneWeekAgo) continue;
        const entryTokens =
          entry.usage.inputTokens + entry.usage.outputTokens + entry.usage.cacheCreationInputTokens;
        tokens7d += entryTokens;
        if (ts >= oneDayAgo) tokens24h += entryTokens;
      }
    }

    const average24h = tokens24h / 24;
    const average7d = tokens7d / (7 * 24);

    // currentBurnRate is now tokens/hour (see calculateHourlyBurnRate).
    const trendPercent = average24h > 0 ? ((currentBurnRate - average24h) / average24h) * 100 : 0;
    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (Math.abs(trendPercent) > 15) {
      trend = trendPercent > 0 ? 'increasing' : 'decreasing';
    }

    return {
      current: currentBurnRate,
      average24h,
      average7d,
      trend,
      trendPercent: Math.round(trendPercent * 10) / 10,
      peakHour: this.calculatePeakHourFromBlocks(blocks),
      isAccelerating: trend === 'increasing' && trendPercent > 20,
    };
  }

  /**
   * Hour of day (0-23, local time) with the highest token consumption
   * across the last 7 days. Returns 12 (noon) when there's no data.
   */
  private calculatePeakHourFromBlocks(blocks: SessionBlock[]): number {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const buckets = new Array(24).fill(0);

    for (const block of blocks) {
      if (block.isGap) continue;
      const end = block.actualEndTime ?? block.endTime;
      if (!block.isActive && end.getTime() < oneWeekAgo) continue;

      for (const entry of block.entries) {
        const ts = entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp);
        if (ts.getTime() < oneWeekAgo) continue;
        buckets[ts.getHours()] +=
          entry.usage.inputTokens + entry.usage.outputTokens + entry.usage.cacheCreationInputTokens;
      }
    }

    let peak = 12;
    let max = 0;
    for (let i = 0; i < 24; i++) {
      if (buckets[i] > max) {
        max = buckets[i];
        peak = i;
      }
    }
    return peak;
  }

  private getEmptyDailyUsage(): DailyUsage {
    return {
      // Must match the local-date convention used by todayStr in parseBlocksData
      // — otherwise today's fallback row is filed under the wrong key.
      date: this.toISOStringLocal(new Date()).split('T')[0],
      totalTokens: 0,
      totalCost: 0,
      models: {},
    };
  }

  async getMenuBarData(): Promise<MenuBarData> {
    const stats = await this.getUsageStats();

    // Determine cost based on configured source
    let cost = stats.today.totalCost;
    if (this.menuBarCostSource === 'sessionWindow') {
      if (stats.sessionTracking?.activeWindow.totalCost !== undefined) {
        cost = stats.sessionTracking.activeWindow.totalCost;
      } else if (this.historicalBlocks && this.historicalBlocks.length > 0) {
        cost = this.getSessionWindowCostFromBlocks(this.historicalBlocks);
      }
    }

    return {
      tokensUsed: stats.tokensUsed,
      tokenLimit: stats.tokenLimit,
      percentageUsed: stats.percentageUsed,
      status: this.getUsageStatus(stats.percentageUsed),
      cost,
    };
  }

  private getMockStats(): UsageStats {
    const today = new Date().toISOString().split('T')[0];
    const tokensUsed = Math.round(PLAN_LIMITS.Pro * 0.6);
    const tokenLimit = PLAN_LIMITS.Pro;
    const todayCost = 2.45;
    const burnRate = 35;

    // Create mock data for enhanced features
    const resetInfo = this.resetTimeService.calculateResetInfo();
    const velocity: VelocityInfo = {
      current: burnRate,
      average24h: 32,
      average7d: 28,
      trend: 'increasing',
      trendPercent: 12.5,
      peakHour: 14, // 2 PM
      isAccelerating: true,
    };

    const prediction: PredictionInfo = {
      depletionTime: new Date(Date.now() + 80 * 60 * 60 * 1000).toISOString(),
      confidence: 85,
      daysRemaining: 3.3,
    };

    return {
      today: {
        date: today,
        totalTokens: 850,
        totalCost: todayCost,
        models: {
          'claude-3-5-sonnet-20241022': { tokens: 650, cost: 1.95 },
          'claude-3-haiku-20240307': { tokens: 200, cost: 0.5 },
        },
      },
      thisWeek: this.generateMockWeekData(),
      thisMonth: this.generateMockMonthData(),
      burnRate, // legacy field
      velocity,
      prediction,
      resetInfo,
      predictedDepleted: prediction.depletionTime, // legacy field
      currentPlan: 'Pro',
      tokenLimit,
      tokensUsed,
      tokensRemaining: tokenLimit - tokensUsed,
      percentageUsed: (tokensUsed / tokenLimit) * 100,
    };
  }

  private generateMockWeekData(): DailyUsage[] {
    const result: DailyUsage[] = [];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      const tokens = Math.floor(Math.random() * 1000) + 200;
      const cost = tokens * 0.003; // Mock cost calculation

      result.push({
        date: dateStr,
        totalTokens: tokens,
        totalCost: cost,
        models: {
          'claude-3-5-sonnet-20241022': {
            tokens: Math.floor(tokens * 0.7),
            cost: cost * 0.7,
          },
          'claude-3-haiku-20240307': {
            tokens: Math.floor(tokens * 0.3),
            cost: cost * 0.3,
          },
        },
      });
    }

    return result;
  }

  private generateMockMonthData(): DailyUsage[] {
    const result: DailyUsage[] = [];
    const now = new Date();

    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      const tokens = Math.floor(Math.random() * 800) + 100;
      const cost = tokens * 0.003;

      result.push({
        date: dateStr,
        totalTokens: tokens,
        totalCost: cost,
        models: {
          'claude-3-5-sonnet-20241022': {
            tokens: Math.floor(tokens * 0.6),
            cost: cost * 0.6,
          },
          'claude-3-haiku-20240307': {
            tokens: Math.floor(tokens * 0.4),
            cost: cost * 0.4,
          },
        },
      });
    }

    return result;
  }

  private detectPlan(totalTokens: number): 'Pro' | 'Max5' | 'Max20' | 'Custom' {
    return utilDetectPlan(totalTokens);
  }

  private getTokenLimit(plan: string): number {
    return utilGetTokenLimit(plan);
  }

  private calculatePredictedDepletion(
    tokensUsed: number,
    tokenLimit: number,
    burnRate: number
  ): string | null {
    if (burnRate <= 0) return null;

    const tokensRemaining = tokenLimit - tokensUsed;
    if (tokensRemaining <= 0) return 'Depleted';

    const hoursRemaining = tokensRemaining / burnRate;
    const depletionDate = new Date(Date.now() + hoursRemaining * 60 * 60 * 1000);

    return depletionDate.toISOString();
  }

  private groupByModel(data: UsageDataItem[]): { [key: string]: { tokens: number; cost: number } } {
    const models: { [key: string]: { tokens: number; cost: number } } = {};

    for (const item of data) {
      this.processItemModelBreakdowns(item, models);
    }

    return models;
  }

  private processItemModelBreakdowns(
    item: UsageDataItem,
    models: { [key: string]: { tokens: number; cost: number } }
  ): void {
    if (!item.modelBreakdowns || !Array.isArray(item.modelBreakdowns)) {
      return;
    }

    for (const breakdown of item.modelBreakdowns) {
      this.aggregateModelData(breakdown, models);
    }
  }

  private aggregateModelData(
    breakdown: ModelBreakdown,
    models: { [key: string]: { tokens: number; cost: number } }
  ): void {
    const modelName = breakdown.modelName || 'unknown';
    if (!models[modelName]) {
      models[modelName] = { tokens: 0, cost: 0 };
    }
    models[modelName].tokens +=
      (breakdown.inputTokens || 0) +
      (breakdown.outputTokens || 0) +
      (breakdown.cacheCreationTokens || 0);
    models[modelName].cost += breakdown.cost || 0;
  }

  private groupByDay(data: UsageDataItem[], days: number): DailyUsage[] {
    const result: DailyUsage[] = [];
    const now = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];

      const dayData = data.filter((item) => item.date === dateStr);
      const totalTokens = dayData.reduce((sum, item) => {
        return (
          sum + (item.inputTokens || 0) + (item.outputTokens || 0) + (item.cacheCreationTokens || 0)
        );
      }, 0);
      const totalCost = dayData.reduce((sum, item) => {
        return sum + (item.totalCost || item.cost || 0);
      }, 0);

      result.push({
        date: dateStr,
        totalTokens,
        totalCost,
        models: this.groupByModel(dayData),
      });
    }

    return result.reverse();
  }

  private getUsageStatus(percentageUsed: number): 'safe' | 'warning' | 'critical' {
    if (percentageUsed >= 90) return 'critical';
    if (percentageUsed >= 70) return 'warning';
    return 'safe';
  }

  private getDefaultStats(): UsageStats {
    const today = new Date().toISOString().split('T')[0];
    const resetInfo = this.resetTimeService.calculateResetInfo();

    const velocity: VelocityInfo = {
      current: 0,
      average24h: 0,
      average7d: 0,
      trend: 'stable',
      trendPercent: 0,
      peakHour: 12,
      isAccelerating: false,
    };

    const prediction: PredictionInfo = {
      depletionTime: null,
      confidence: 0,
      daysRemaining: 0,
    };

    return {
      today: {
        date: today,
        totalTokens: 0,
        totalCost: 0,
        models: {},
      },
      thisWeek: [],
      thisMonth: [],
      burnRate: 0, // legacy field
      velocity,
      prediction,
      resetInfo,
      predictedDepleted: null, // legacy field
      currentPlan:
        this.selectedPlan === 'auto'
          ? 'Pro'
          : (this.selectedPlan as 'Pro' | 'Max5' | 'Max20' | 'Custom'),
      tokenLimit:
        this.selectedPlan === 'Custom'
          ? (this.customTokenLimit ?? PLAN_LIMITS.Custom)
          : this.getTokenLimit(this.selectedPlan === 'auto' ? 'Pro' : this.selectedPlan),
      tokensUsed: 0,
      tokensRemaining:
        this.selectedPlan === 'Custom'
          ? (this.customTokenLimit ?? PLAN_LIMITS.Custom)
          : this.getTokenLimit(this.selectedPlan === 'auto' ? 'Pro' : this.selectedPlan),
      percentageUsed: 0,
    };
  }

  /**
   * Calculate burn rate from daily data (for legacy compatibility)
   */
  private calculateBurnRate(data: UsageDataItem[]): number {
    return utilCalculateBurnRate(data);
  }

  /**
   * Calculate enhanced velocity information based on Python implementation
   */
  private calculateVelocityInfo(data: UsageDataItem[]): VelocityInfo {
    const now = new Date();

    // Current burn rate (last 24 hours)
    const current = this.calculateBurnRate(data);

    // 24-hour average
    const last24Hours = data.filter((item) => {
      const itemDate = new Date(item.date);
      const hoursDiff = (now.getTime() - itemDate.getTime()) / (1000 * 60 * 60);
      return hoursDiff <= 24;
    });
    const average24h = this.calculateAverageBurnRate(last24Hours);

    // 7-day average
    const last7Days = data.filter((item) => {
      const itemDate = new Date(item.date);
      const daysDiff = (now.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysDiff <= 7;
    });
    const average7d = this.calculateAverageBurnRate(last7Days);

    // Trend analysis
    const trendPercent = average24h > 0 ? ((current - average24h) / average24h) * 100 : 0;
    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';

    if (Math.abs(trendPercent) > 15) {
      // 15% threshold for trend detection
      trend = trendPercent > 0 ? 'increasing' : 'decreasing';
    }

    // Peak hour analysis
    const peakHour = this.calculatePeakUsageHour(data);

    return {
      current,
      average24h,
      average7d,
      trend,
      trendPercent: Math.round(trendPercent * 10) / 10,
      peakHour,
      isAccelerating: trend === 'increasing' && trendPercent > 20,
    };
  }

  /**
   * Calculate prediction information with confidence levels.
   *
   * Note: previously also computed `recommendedDailyLimit` and
   * `onTrackForReset` from a synthesized monthly billing cycle. Both were
   * never displayed and were based on an incorrect cadence model — removed
   * along with the monthly cycle in ResetTimeService.
   */
  private calculatePredictionInfo(
    tokensUsed: number,
    tokenLimit: number,
    velocity: VelocityInfo
  ): PredictionInfo {
    const tokensRemaining = Math.max(0, tokenLimit - tokensUsed);

    let confidence = 50;
    if (velocity.current > 0 && velocity.average24h > 0) {
      confidence = Math.min(95, confidence + 30);
      if (Math.abs(velocity.trendPercent) > 50) {
        confidence -= 20;
      }
    }

    let depletionTime: string | null = null;
    let daysRemaining = 0;

    if (velocity.current > 0) {
      const hoursRemaining = tokensRemaining / velocity.current;
      daysRemaining = hoursRemaining / 24;
      depletionTime = new Date(Date.now() + hoursRemaining * 60 * 60 * 1000).toISOString();
    }

    return {
      depletionTime,
      confidence: Math.round(confidence),
      daysRemaining: Math.round(daysRemaining * 10) / 10,
    };
  }

  /**
   * Calculate average burn rate for a given dataset
   */
  private calculateAverageBurnRate(data: UsageDataItem[]): number {
    if (data.length === 0) return 0;

    const totalTokens = data.reduce((sum, item) => {
      return (
        sum + (item.inputTokens || 0) + (item.outputTokens || 0) + (item.cacheCreationTokens || 0)
      );
    }, 0);

    const totalHours = data.length * 24; // Assuming daily data points
    return totalHours > 0 ? Math.round(totalTokens / totalHours) : 0;
  }

  /**
   * Calculate peak usage hour (simplified version)
   */
  private calculatePeakUsageHour(data: UsageDataItem[]): number {
    // Simplified: assume afternoon hours are peak usage
    // In a real implementation, this would analyze hourly usage patterns
    return 14; // 2 PM
  }

  /**
   * Get actual next reset time based on active session block end time
   */
  private getActualNextResetTime(): Date | null {
    if (!this.currentActiveBlock) {
      return null;
    }

    // Use only endTime from the active block
    return this.currentActiveBlock.endTime;
  }

  /**
   * Calculate time remaining until next reset based on actual session data
   */
  getTimeUntilActualReset(): {
    nextResetTime: Date | null;
    timeUntilReset: number;
    formattedTimeRemaining: string;
  } {
    const actualResetTime = this.getActualNextResetTime();

    if (!actualResetTime) {
      return {
        nextResetTime: null,
        timeUntilReset: 0,
        formattedTimeRemaining: 'No active session',
      };
    }

    const now = new Date();
    const timeUntilReset = Math.max(0, actualResetTime.getTime() - now.getTime());

    // Format time remaining
    const hours = Math.floor(timeUntilReset / (1000 * 60 * 60));
    const minutes = Math.floor((timeUntilReset % (1000 * 60 * 60)) / (1000 * 60));

    let formattedTimeRemaining: string;
    if (timeUntilReset <= 0) {
      formattedTimeRemaining = 'Reset available';
    } else if (hours > 0) {
      formattedTimeRemaining = `${hours} hours ${minutes} minutes left`;
    } else if (minutes > 0) {
      formattedTimeRemaining = `${minutes} minutes left`;
    } else {
      formattedTimeRemaining = 'Less than 1 minute left';
    }

    return {
      nextResetTime: actualResetTime,
      timeUntilReset,
      formattedTimeRemaining,
    };
  }

  /**
   * Enhanced menu bar data with reset time information
   */
  async getEnhancedMenuBarData(): Promise<MenuBarData> {
    const stats = await this.getUsageStats();

    let cost = stats.today.totalCost;
    if (this.menuBarCostSource === 'sessionWindow') {
      if (stats.sessionTracking?.activeWindow.totalCost !== undefined) {
        cost = stats.sessionTracking.activeWindow.totalCost;
      } else if (this.historicalBlocks && this.historicalBlocks.length > 0) {
        cost = this.getSessionWindowCostFromBlocks(this.historicalBlocks);
      }
    }

    return {
      tokensUsed: stats.tokensUsed,
      tokenLimit: stats.tokenLimit,
      percentageUsed: stats.percentageUsed,
      status: this.getUsageStatus(stats.percentageUsed),
      cost,
      timeUntilReset: this.resetTimeService.formatTimeUntilReset(stats.resetInfo.timeUntilReset),
      resetInfo: stats.resetInfo,
    };
  }

  /**
   * Total cost incurred within the rolling 5-hour window. Walks individual
   * entries by their own timestamp — the previous version added the whole
   * block's cost whenever the block's startTime fell inside the window,
   * which double-counted any activity from before the window for blocks
   * straddling the boundary.
   */
  private getSessionWindowCostFromBlocks(blocks: SessionBlock[]): number {
    if (!blocks || blocks.length === 0) return 0;
    const windowStart = Date.now() - 5 * 60 * 60 * 1000;
    let total = 0;

    for (const block of blocks) {
      if (block.isGap) continue;
      const end = block.actualEndTime ?? block.endTime;
      if (!block.isActive && end.getTime() < windowStart) continue;

      for (const entry of block.entries) {
        const ts = (entry.timestamp as Date).getTime?.() ?? new Date(entry.timestamp).getTime();
        if (ts < windowStart) continue;
        total += entry.costUSD ?? 0;
      }
    }
    return total;
  }
}
