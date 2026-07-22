/**
 * Type declarations for the two ccusage internals TokenWatch re-exports through
 * `patches/ccusage+18.0.8.patch`.
 *
 * Why: the incremental block loader (`src/workers/blockLoader.ts`) keeps parsed
 * JSONL entries in memory per file and only re-reads appended bytes. To turn
 * those cached entries back into 5-hour blocks it needs ccusage's own bucketing
 * algorithm (`identifySessionBlocks`) rather than a re-implementation that would
 * silently drift from upstream. `PricingFetcher` is needed because
 * `calculateCostForEntry` (already public) takes one.
 *
 * The patch only adds JS re-exports; the types live here so the patch stays
 * small and survives `patch-package` regeneration.
 */
import 'ccusage/data-loader';

declare module 'ccusage/data-loader' {
  interface TwLoadedUsageEntry {
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
    usageLimitResetTime?: Date;
  }

  interface TwSessionBlock {
    id: string;
    startTime: Date;
    endTime: Date;
    actualEndTime?: Date;
    isActive: boolean;
    isGap?: boolean;
    entries: TwLoadedUsageEntry[];
    tokenCounts: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens: number;
      cacheReadInputTokens: number;
    };
    costUSD: number;
    models: string[];
    usageLimitResetTime?: Date;
  }

  export function identifySessionBlocks(
    entries: TwLoadedUsageEntry[],
    sessionDurationHours?: number
  ): TwSessionBlock[];

  export class PricingFetcher {
    constructor(offline?: boolean);
  }
}
